"""Skill Agent 执行服务（基于 openai-agents-python 的多步执行）。

Skill = 一个目录（SKILL.md + scripts/ + references/ ...），SKILL.md 以 YAML
frontmatter 开头（name / description 必填）。工作区按用户隔离：
    backend/workspaces/skills/{user_id}/skills/<skill_name>/...

职责：
1. SKILL.md 解析 / 上传 zip 合法性校验（根目录必须有含 name/description 的 SKILL.md）
2. 构建 openai-agents-python Agent（任意 OpenAI 兼容端点，chat completions 协议）
3. LocalShellTool 沙箱执行器：cwd 限定在用户工作区、绝对路径/.. 逃逸拦截、
   POSIX 资源限制（CPU/内存/文件大小）、超时强杀进程组、输出上限、新文件检测
4. Runner.run_streamed 事件归一化为统一 dict 事件流（与 fastclaw_service 同构），
   新增 agent_file 事件透传 skill 执行产生的文件（供前端渲染下载卡片）
"""
import asyncio
import io
import json
import logging
import os
import resource  # noqa: F401  模块顶部导入：preexec_fn 内禁止 import（多线程下 fork 子进程可能死锁于导入锁）
import shutil
import signal
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# 用户 skill 工作区根目录: backend/workspaces/skills/{user_id}/
_WORKSPACES_ROOT = Path(__file__).resolve().parents[2] / "workspaces" / "skills"

# 单次 shell 命令输出上限（字符），防止海量输出撑爆上下文
MAX_OUTPUT_LENGTH = 20000
# 单次命令默认超时（秒）
DEFAULT_CMD_TIMEOUT = 120.0
# Agent 多步执行最大轮数（防死循环）
MAX_TURNS = 15
# 每轮可产生的文件上限（防恶意 skill 撑爆工作区）
MAX_FILES_PER_RUN = 50
# skill 解压总大小上限（字节，防 zip 炸弹）
MAX_EXTRACT_BYTES = 100 * 1024 * 1024
# skill 解压文件数上限
MAX_EXTRACT_FILES = 500
# skill 名称长度上限（目录名）
MAX_SKILL_NAME_LEN = 100
# 沙箱子进程资源上限（POSIX，preexec_fn 内应用）：
# - CPU 时间（秒）：与默认命令超时一致，防死循环烧 CPU
LIMIT_CPU_SECONDS = 120
# - 地址空间（字节）：2GB，防内存炸弹
LIMIT_AS_BYTES = 2 * 1024 * 1024 * 1024
# - 单文件大小上限（字节）：100MB，与解压上限一致，防磁盘写爆
LIMIT_FSIZE_BYTES = 100 * 1024 * 1024
# - 打开文件描述符上限
LIMIT_NOFILE = 256
# preexec_fn 仅 POSIX 可用（Linux/macOS）；Windows 上跳过资源限制
_POSIX_LIMITS_AVAILABLE = hasattr(os, "fork")


class SkillAgentError(Exception):
    """Skill Agent 调用失败（由 SSE 端点捕获后以 error 事件传导到前端）。"""


class SkillValidationError(Exception):
    """skill zip 校验失败（缺 SKILL.md / 缺 name / description 元数据等）。"""


@dataclass
class SkillRuntimeConfig:
    """一次 Skill Agent 调用所需的运行时配置（由 NodeConfig 解析而来）。"""

    base_url: str = ""
    api_key: str = ""
    model_name: str = ""
    system_prompt: str = ""
    user_id: int = 0


# ---------------------------------------------------------------------------
# 工作区 & skill 元数据
# ---------------------------------------------------------------------------

def workspace_root(user_id: int) -> Path:
    """该用户的 skill 工作区根目录（自动创建）。"""
    root = _WORKSPACES_ROOT / str(user_id)
    root.mkdir(parents=True, exist_ok=True)
    return root


def skills_dir(user_id: int) -> Path:
    """已安装 skill 目录（每个子目录 = 一个 skill 包）。"""
    d = workspace_root(user_id) / "skills"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _parse_frontmatter(markdown: str) -> Tuple[Dict[str, str], str]:
    """解析 SKILL.md 的 YAML frontmatter（--- ... ---）与正文。

    元数据仅取 name / description（前端预览与 skill 选择所需），其余键忽略。
    无 frontmatter 时返回 ({}, 全文)。
    """
    lines = markdown.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, markdown
    end_index: Optional[int] = None
    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            end_index = index
            break
    if end_index is None:
        return {}, markdown
    meta: Dict[str, str] = {}
    for line in lines[1:end_index]:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or ":" not in stripped:
            continue
        key, _, value = stripped.partition(":")
        key = key.strip()
        value = value.strip().strip("'\"")
        if key in ("name", "description") and value:
            meta[key] = value
    body = "\n".join(lines[end_index + 1:]).strip()
    return meta, body


def read_skill_meta(skill_dir: Path) -> Dict[str, Any]:
    """读取单个 skill 目录的元数据（name/description/正文/文件树）。"""
    md_path = skill_dir / "SKILL.md"
    if not md_path.is_file():
        return {"name": skill_dir.name, "description": "", "body": "", "files": []}
    text = md_path.read_text(encoding="utf-8", errors="replace")
    meta, body = _parse_frontmatter(text)
    files = [
        str(p.relative_to(skill_dir)).replace("\\", "/")
        for p in sorted(skill_dir.rglob("*"))
        if p.is_file()
    ]
    return {
        "name": meta.get("name") or skill_dir.name,
        "description": meta.get("description", ""),
        "body": body,
        "files": files,
    }


def list_installed_skills(user_id: int) -> List[Dict[str, Any]]:
    """列出该用户工作区已安装的 skill（含 name/description/文件树）。"""
    d = skills_dir(user_id)
    items = []
    for child in sorted(d.iterdir()):
        if not child.is_dir():
            continue
        if not (child / "SKILL.md").is_file():
            continue
        meta = read_skill_meta(child)
        meta["path"] = str(child.relative_to(workspace_root(user_id))).replace("\\", "/")
        items.append(meta)
    return items


def resolve_skill_abs(user_id: int, rel_path: str) -> Optional[Path]:
    """把工作区内的相对路径解析为绝对路径；越界（../ 等）返回 None。"""
    root = workspace_root(user_id).resolve()
    candidate = (root / rel_path).resolve()
    if candidate == root or root in candidate.parents:
        return candidate
    return None


# ---------------------------------------------------------------------------
# zip 校验 / 安装
# ---------------------------------------------------------------------------

def validate_skill_zip(zip_bytes: bytes) -> Dict[str, Any]:
    """校验上传的 skill zip 合法性。

    要求：zip 内存在一个「顶层目录」且其根下必须有 SKILL.md，
    SKILL.md 开头必须有包含 name 和 description 的 YAML frontmatter。
    返回 {"name", "description", "body", "root": "顶层目录名"}；
    非法时抛 SkillValidationError（带中文原因，直接展示给用户）。
    """
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except (zipfile.BadZipFile, OSError) as exc:
        raise SkillValidationError("不是有效的 zip 文件") from exc
    names = [n for n in zf.namelist() if not n.endswith("/")]
    if not names:
        raise SkillValidationError("zip 为空，未包含任何文件")

    # 顶层目录：取所有条目公共前缀的第一段
    top = names[0].split("/")[0]
    if any(not n.startswith(top + "/") for n in names):
        # 存在不在同一顶层目录下的条目 → 结构不合法
        raise SkillValidationError(
            "skill zip 结构不合法：所有文件应位于同一个顶层目录下（如 skill-name/SKILL.md）"
        )
    md_rel = f"{top}/SKILL.md"
    try:
        md_text = zf.read(md_rel).decode("utf-8", errors="replace")
    except KeyError:
        raise SkillValidationError(f"zip 缺少 {md_rel}：skill 根目录必须包含 SKILL.md") from None

    meta, body = _parse_frontmatter(md_text)
    if not meta.get("name"):
        raise SkillValidationError("SKILL.md 缺少 name 元数据（YAML frontmatter 必填）")
    if not meta.get("description"):
        raise SkillValidationError("SKILL.md 缺少 description 元数据（YAML frontmatter 必填）")
    name = meta["name"]
    # 名称将作为工作区目录名：拒绝路径分隔符 / 反斜杠 / 相对跳转 / 控制字符，
    # 防止 frontmatter name 被用于目录穿越（如 name: ../../其他用户/...）
    if (
        not name.strip()
        or len(name) > MAX_SKILL_NAME_LEN
        or "/" in name
        or "\\" in name
        or name in (".", "..")
        or any(ord(ch) < 32 for ch in name)
    ):
        raise SkillValidationError(
            "SKILL.md 的 name 含非法字符：仅允许字母/数字/中划线/下划线/空格（将作为目录名使用）"
        )
    return {"name": name, "description": meta["description"], "body": body, "root": top}


def install_skill_zip(user_id: int, zip_bytes: bytes) -> Dict[str, Any]:
    """校验并安装 skill zip 到用户工作区（zip-slip 防护）。返回 skill 元数据。"""
    info = validate_skill_zip(zip_bytes)
    name = info["name"]
    dest = skills_dir(user_id) / name
    if dest.exists():
        # 同名 skill 已存在：先清空再覆盖（重装 = 更新）
        shutil.rmtree(dest)
    dest.mkdir(parents=True, exist_ok=True)

    root_prefix = info["root"] + "/"
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
        total_bytes = 0
        file_count = 0
        for item in zf.namelist():
            if item.endswith("/") or not item.startswith(root_prefix):
                continue
            rel = item[len(root_prefix):]
            target = (dest / rel).resolve()
            # zip-slip 防护：解压目标必须落在 skill 目录内
            if dest != target and dest not in target.parents:
                raise SkillValidationError("zip 包含越界路径（路径穿越），已拒绝")
            if target.parent != dest:
                target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(item) as src, open(target, "wb") as out:
                while True:
                    chunk = src.read(1024 * 1024)
                    if not chunk:
                        break
                    total_bytes += len(chunk)
                    if total_bytes > MAX_EXTRACT_BYTES:
                        raise SkillValidationError(
                            f"解压总大小超过 {MAX_EXTRACT_BYTES // (1024 * 1024)}MB 上限（疑似 zip 炸弹），已拒绝"
                        )
                    out.write(chunk)
            file_count += 1
            if file_count > MAX_EXTRACT_FILES:
                raise SkillValidationError(
                    f"文件数超过 {MAX_EXTRACT_FILES} 个上限，已拒绝"
                )
    except Exception as exc:
        # 解压失败（含校验失败）：清理半成品目录，避免留下残缺 skill
        shutil.rmtree(dest, ignore_errors=True)
        if isinstance(exc, SkillValidationError):
            raise
        raise SkillValidationError(f"解压失败: {exc}") from exc

    meta = read_skill_meta(dest)
    meta["path"] = f"skills/{name}"
    return meta


# ---------------------------------------------------------------------------
# Agent 构建 & 沙箱执行
# ---------------------------------------------------------------------------

def _build_instructions(
    config: SkillRuntimeConfig, user_id: int, skill_names: Optional[List[str]] = None
) -> str:
    """组装 Agent instructions：系统提示词 + 指定 skill 的 SKILL.md 指令。

    skill_names 为上游「Skill 检索」节点选中的 skill 名（空/None = 加载全部已安装 skill）。
    """
    parts: List[str] = []
    if config.system_prompt.strip():
        parts.append(config.system_prompt.strip())
    skills = list_installed_skills(user_id)
    if skill_names:
        wanted = set(skill_names)
        skills = [s for s in skills if s["name"] in wanted]
    if skills:
        skill_sections = [
            (
                f"## Skill: {s['name']}\n"
                f"描述：{s['description']}\n"
                f"位置：{s['path']}\n\n"
                f"{s['body']}"
            )
            for s in skills
        ]
        parts.append(
            "以下 skill 已加载到工作区，按需使用（执行脚本/读取文件前先 cat 对应目录内容）：\n\n"
            + "\n\n".join(skill_sections)
        )
    parts.append(
        "工作区规则：仅允许相对路径命令（绝对路径 / .. 路径段会被拒绝）；"
        "命令不得离开当前工作区目录。"
    )
    return "\n\n".join(parts)


def _detect_mime(filename: str) -> str:
    """按扩展名推断 MIME（文件卡片展示用，非安全边界）。"""
    ext = Path(filename).suffix.lower()
    mimes = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
        ".pdf": "application/pdf", ".csv": "text/csv", ".txt": "text/plain",
        ".md": "text/markdown", ".json": "application/json",
    }
    return mimes.get(ext, "application/octet-stream")


def _apply_child_limits() -> None:
    """在子进程 exec 前应用资源限制（POSIX）。

    作为 preexec_fn 传入，仅在 fork 后的子进程内生效，不影响服务器主进程。
    注意：本函数内不得 import（fork 后的多线程进程 import 可能死锁），
    所需模块一律在模块顶部导入。
    """
    resource.setrlimit(resource.RLIMIT_CPU, (LIMIT_CPU_SECONDS, LIMIT_CPU_SECONDS))
    resource.setrlimit(resource.RLIMIT_AS, (LIMIT_AS_BYTES, LIMIT_AS_BYTES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (LIMIT_FSIZE_BYTES, LIMIT_FSIZE_BYTES))
    resource.setrlimit(resource.RLIMIT_NOFILE, (LIMIT_NOFILE, LIMIT_NOFILE))


def _kill_process_group(proc) -> None:
    """强杀整个进程组（命令与其派生的孙进程），防止超时后残留孤儿进程。"""
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        pass


class SandboxedShellExecutor:
    """LocalShellTool 的沙箱执行器。

    安全约束（尽力而为，非完整沙箱）：
    - cwd 强制为该用户工作区（忽略模型请求的 working_directory）
    - 不经过 shell 展开（exec 形式，避免管道/重定向注入）
    - 命令参数校验：绝对路径 / .. 路径穿越一律拒绝（另见 _escape_reason）
    - 子进程资源限制（POSIX）：CPU 时间 / 内存 / 单文件大小 / 文件描述符上限
    - 单命令超时（默认 120s，取模型请求 timeout_ms 但封顶），超时强杀进程组
    - 输出截断到 MAX_OUTPUT_LENGTH
    - 执行后扫描工作区，检测本次新产生/修改的文件并记录（供 agent_file 事件）

    已知残余风险（官方文档亦如此定位，非完整沙箱）：
    - 解释器内联代码可绕过参数校验（如 python3 -c / bash -c / node -e），
      以及 skill 自带脚本本身，仍可读取服务器进程可访问的文件；
    - 工作区内可创建指向外部的符号链接（ln -s /etc ./leak）后再 cat 相对路径，
      参数校验是语法级检查，无法拦截此类间接越界；
    - 网络访问未限制（skill 脚本可外联）。
    真正隔离需容器化（如 openai-agents-python 的 DockerSandboxEnvironment）。
    """

    def __init__(self, user_id: int):
        self.user_id = user_id
        self.root = workspace_root(user_id)
        # 本次 run 产生的文件（由服务在工具调用后消费为 agent_file 事件）
        self.new_files: List[Dict[str, Any]] = []
        self._seen: set = set()

    def _snapshot(self) -> Dict[str, Tuple[int, int]]:
        """递归快照工作区：相对路径 → (mtime_ns, size)。"""
        snap: Dict[str, Tuple[int, int]] = {}
        for p in self.root.rglob("*"):
            if p.is_file():
                st = p.stat()
                snap[str(p.relative_to(self.root)).replace("\\", "/")] = (st.st_mtime_ns, st.st_size)
        return snap

    def _diff(self, before: Dict[str, Tuple[int, int]]) -> None:
        """对比快照，记录新增/修改的文件（按大小去重，防止重复扫描）。"""
        after = self._snapshot()
        for rel, (mtime, size) in after.items():
            if rel in self._seen:
                continue
            prev = before.get(rel)
            if prev != (mtime, size):
                if len(self.new_files) >= MAX_FILES_PER_RUN:
                    break
                self.new_files.append(
                    {
                        "url": f"/api/modules/bookplate/skill-files?path={rel}",
                        "name": Path(rel).name,
                        "mime": _detect_mime(rel),
                        "size": size,
                        "path": rel,
                    }
                )
                self._seen.add(rel)

    def _escape_reason(self, command: List[str]) -> Optional[str]:
        """检查命令是否试图逃出工作区；返回拒绝原因，None = 放行。

        规则：
        - 参数以 / 开头（绝对路径，如 cat /etc/passwd）→ 拒绝；
        - 选项赋值为绝对路径（如 --output=/tmp/x）→ 拒绝；
        - 参数含 .. 路径段（如 cat ../secret、a/../../etc/passwd）→ 拒绝。

        相对路径在 exec 形式下相对 cwd 解析，天然落在工作区内，无需额外校验。
        """
        for arg in command:
            if arg.startswith("/"):
                return f"（命令含绝对路径，已拒绝：{arg}）"
            if "=" in arg:
                value = arg.split("=", 1)[1].lstrip()
                if value.startswith("/"):
                    return f"（命令含绝对路径参数，已拒绝：{arg}）"
            if ".." in arg.split("/"):
                return f"（命令含 .. 路径穿越，已拒绝：{arg}）"
        return None

    async def __call__(self, request) -> str:
        from openai.types.responses.response_output_item import LocalShellCall

        data: LocalShellCall = request.data
        action = data.action
        command: List[str] = list(getattr(action, "command", []) or [])
        if not command:
            return "（空命令）"
        # 路径逃逸校验：绝对路径 / .. 穿越一律拒绝（cwd 限定之外的又一道闸）
        reject = self._escape_reason(command)
        if reject:
            return reject
        # 超时：模型请求值封顶，避免长命令拖垮连接
        timeout_ms = getattr(action, "timeout_ms", None) or DEFAULT_CMD_TIMEOUT * 1000
        timeout = min(timeout_ms / 1000.0, DEFAULT_CMD_TIMEOUT)

        before = self._snapshot()
        try:
            proc = await asyncio.create_subprocess_exec(
                *command,
                cwd=str(self.root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                # 独立进程组 + POSIX 资源限制（fork 后、exec 前的子进程内生效）
                start_new_session=True,
                preexec_fn=_apply_child_limits if _POSIX_LIMITS_AVAILABLE else None,
            )
            try:
                stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            except asyncio.TimeoutError:
                _kill_process_group(proc)
                # 被 wait_for 取消的 communicate() 不能安全复用（管道读取器已处于中间态），
                # 组强杀后管道写端已关闭，wait() 即可回收进程并释放传输资源
                await proc.wait()
                stdout_b, stderr_b = b"", "（命令超时，已终止）".encode("utf-8")
        except (FileNotFoundError, PermissionError) as exc:
            return f"（命令无法执行: {exc}）"
        except OSError as exc:
            return f"（命令执行失败: {exc}）"

        parts: List[str] = []
        if stdout_b:
            parts.append(stdout_b.decode("utf-8", errors="replace")[:MAX_OUTPUT_LENGTH])
        if stderr_b:
            parts.append("[stderr]\n" + stderr_b.decode("utf-8", errors="replace")[:MAX_OUTPUT_LENGTH])
        result = "\n".join(parts).strip() or "（命令执行完成，无输出）"
        self._diff(before)
        return result


def build_agent(
    config: SkillRuntimeConfig, skill_names: Optional[List[str]] = None
):
    """构建 openai-agents-python Agent（任意 OpenAI 兼容端点，chat completions 协议）。"""
    from agents import Agent, ModelSettings, OpenAIProvider, RunConfig

    provider = OpenAIProvider(
        api_key=config.api_key or None,
        base_url=config.base_url or None,
        use_responses=False,  # 兼容任意 OpenAI-compatible 端点（不走 Responses API）
    )
    executor = SandboxedShellExecutor(config.user_id)
    agent = Agent(
        name="Skill Agent",
        instructions=_build_instructions(config, config.user_id, skill_names),
        model=config.model_name or "gpt-4o-mini",
        tools=[executor],
        model_settings=ModelSettings(temperature=0.3),
    )
    run_config = RunConfig(model_provider=provider, max_turns=MAX_TURNS)
    return agent, run_config, executor


def _to_input_items(messages: list) -> list:
    """OpenAI 格式消息 → openai-agents-python 输入项。

    兼容多模态 user 消息（content 为 text + image_url 数组）与纯文本消息；
    assistant 消息保持 output_text。
    """
    items: list = []
    for m in messages or []:
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        content = m.get("content")
        if role == "assistant":
            text = content if isinstance(content, str) else ""
            items.append({"role": "assistant", "content": [{"type": "output_text", "text": text}]})
            continue
        # user：兼容纯文本与多模态 content（text + image_url）
        if isinstance(content, str):
            items.append({"role": "user", "content": [{"type": "input_text", "text": content}]})
            continue
        parts: list = []
        for part in content or []:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "text":
                parts.append({"type": "input_text", "text": str(part.get("text", ""))})
            elif part.get("type") == "image_url":
                url = part.get("image_url")
                if isinstance(url, dict):
                    url = url.get("url")
                if url:
                    parts.append({"type": "input_image", "image_url": url})
        if parts:
            items.append({"role": "user", "content": parts})
    return items


def _tool_name(item) -> str:
    """从 ToolCallItem 提取工具名（兼容 raw_item 为 dict / pydantic 对象）。"""
    raw = getattr(item, "raw_item", None)
    if isinstance(raw, dict):
        return raw.get("name") or raw.get("tool_name") or ""
    name = getattr(raw, "name", None) or getattr(raw, "tool_name", None)
    if name:
        return str(name)
    return str(getattr(item, "tool_name", "") or "")


def _tool_arguments(item) -> str:
    """从 ToolCallItem 提取参数 JSON 字符串。"""
    raw = getattr(item, "raw_item", None)
    if isinstance(raw, dict):
        args = raw.get("arguments")
        if isinstance(args, dict):
            return json.dumps(args, ensure_ascii=False)
        return str(args or "")
    fn = getattr(raw, "function", None)
    args = getattr(fn, "arguments", None) if fn else None
    if isinstance(args, dict):
        return json.dumps(args, ensure_ascii=False)
    return str(args or "")


def _tool_call_id(item) -> str:
    raw = getattr(item, "raw_item", None)
    if isinstance(raw, dict):
        return str(raw.get("id") or raw.get("call_id") or "")
    return str(getattr(item, "call_id", "") or getattr(raw, "id", "") or "")


async def run_skill_agent(
    config: SkillRuntimeConfig,
    messages: list,
    skills: Optional[List[str]] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """运行 Skill Agent 并产出归一化事件流。

    事件形态与 fastclaw_service 一致（content_delta / tool_call / tool_result /
    status / done / error），并新增 agent_file（skill 执行产生的文件，前端渲染下载卡片）。
    skills 为上游 Skill 检索节点选中的 skill 名（空 = 加载该用户全部已安装 skill）。
    """
    from agents import Runner

    try:
        from agents import set_tracing_disabled

        set_tracing_disabled(True)  # 自托管：不上报 tracing
    except Exception:
        pass

    if not config.api_key:
        raise SkillAgentError("Skill Agent 配置缺少 API Key")
    if not config.model_name:
        raise SkillAgentError("Skill Agent 配置缺少模型名称")

    agent, run_config, executor = build_agent(config, skills)
    items = _to_input_items(messages)
    if not any(i.get("role") == "user" for i in items):
        raise SkillAgentError("AI 对话缺少用户消息")

    result = Runner.run_streamed(agent, input=items, run_config=run_config)
    try:
        async for event in result.stream_events():
            etype = event.type
            # 文本增量（Responses 路径：ResponseTextDeltaEvent；ChatCompletions 路径：chunk delta）
            if etype == "raw_response_event":
                data = event.data
                delta = getattr(data, "delta", None)
                if isinstance(delta, str) and delta:
                    yield {"type": "content_delta", "data": {"delta": delta}}
                    continue
                choices = getattr(data, "choices", None)
                if choices:
                    d = getattr(choices[0], "delta", None)
                    content = getattr(d, "content", None)
                    if content:
                        yield {"type": "content_delta", "data": {"delta": content}}
                continue
            # 工具调用 / 结果
            if etype == "run_item_stream_event":
                item = event.item
                item_type = getattr(item, "type", "")
                if item_type == "tool_call_item":
                    yield {
                        "type": "tool_call",
                        "data": {
                            "id": _tool_call_id(item),
                            "name": _tool_name(item),
                            "arguments": _tool_arguments(item),
                        },
                    }
                elif item_type == "tool_call_output_item":
                    output = getattr(item, "output", "")
                    if not isinstance(output, str):
                        try:
                            output = json.dumps(output, ensure_ascii=False)
                        except Exception:
                            output = str(output)
                    yield {
                        "type": "tool_result",
                        "data": {
                            "id": _tool_call_id(item),
                            "name": _tool_name(item),
                            "result": str(output),
                        },
                    }
                    # 沙箱执行产生的文件 → agent_file 事件（图片缩略 + 下载）
                    for f in executor.new_files:
                        yield {"type": "agent_file", "data": f}
                    executor.new_files.clear()
                continue
            # Agent 切换 / 状态
            if etype == "agent_updated_stream_event":
                new_agent = getattr(event, "new_agent", None)
                name = getattr(new_agent, "name", "") if new_agent else ""
                yield {"type": "status", "data": {"message": f"进入 Agent：{name}"}}
                continue
        yield {"type": "done", "data": {}}
    except Exception as exc:
        logger.error("Skill Agent 执行失败: %s", exc, exc_info=True)
        raise SkillAgentError(f"Skill Agent 执行失败: {exc}") from exc



