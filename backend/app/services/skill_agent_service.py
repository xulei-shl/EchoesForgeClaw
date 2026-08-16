"""Skill Agent 执行服务（基于 openai-agents-python 的多步执行）。

Skill = 一个目录（SKILL.md + scripts/ + references/ ...），SKILL.md 以 YAML
frontmatter 开头（name / description 必填）。运行时工作区按节点隔离（目录约定见常量区）：
    runtime/{user_id}/workspace/{workspace_id}/      # 节点工作区（软链装配 + agent 产物）
    runtime/.agent/skills/{skill_name}/              # Bifrost 共享真实 skill 包（跨用户）
    runtime/.agent/agents/{agent_id}/AGENTS.md       # 系统提示词物化文件
    runtime/{user_id}/skills/{skill_name}/           # 用户「已安装 skill」登记（软链或真实目录）

职责：
1. SKILL.md 解析 / 上传 zip 合法性校验（根目录必须有含 name/description 的 SKILL.md）
2. 构建 openai-agents-python Agent（任意 OpenAI 兼容端点，chat completions 协议）
3. FunctionTool 沙箱执行器（不能用 LocalShellTool：它是 hosted tool，ChatCompletions
   兼容端点（use_responses=False）会在转换工具时直接报错）：cwd 限定在用户工作区、
   绝对路径/.. 逃逸拦截、POSIX 资源限制（CPU/内存/文件大小）、超时强杀进程组、
   输出上限、新文件检测
4. Runner.run_streamed 事件归一化为统一 dict 事件流（与 fastclaw_service 同构），
   新增 agent_file 事件透传 skill 执行产生的文件（供前端渲染下载卡片）
"""
import asyncio
import io
import json
import logging
import os
import re
import shutil
import signal
import threading
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# 仓库根（backend/app/services/ 上溯 3 层）与运行时根目录 runtime/（整目录 gitignore，不纳入版本控制）：
#   runtime/.agent/skills/{name}          Bifrost 检索安装的真实 skill 包（跨用户共享，只读「源」）
#   runtime/.agent/agents/{agent_id}/AGENTS.md   SkillAgentConfig 引用的提示词物化文件
#   runtime/{user_id}/skills/{name}       用户「已安装 skill」登记：Bifrost=软链->共享区；上传=真实目录
#   runtime/{user_id}/workspace/{ws_id}/  单个 chat 节点的运行时工作区（软链装配 + agent 产物）
REPO_ROOT = Path(__file__).resolve().parents[3]
RUNTIME_ROOT = REPO_ROOT / "runtime"
REAL_SKILLS_ROOT = RUNTIME_ROOT / ".agent" / "skills"
REAL_AGENTS_ROOT = RUNTIME_ROOT / ".agent" / "agents"

# workspace_id 允许的字符集（防目录穿越）：仅字母/数字/中划线/下划线，其余一律剔除
_WORKSPACE_ID_PATTERN = re.compile(r"[^A-Za-z0-9_-]+")
MAX_WORKSPACE_ID_LEN = 120

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
# preexec_fn 仅 POSIX 可用（Linux/macOS）；Windows 上跳过资源限制。
# resource 为 POSIX-only 模块：条件导入，Windows 下置 None（模块顶部导入——
# preexec_fn 内禁止 import，多线程下 fork 子进程可能死锁于导入锁）
try:
    import resource  # noqa: F401

except ImportError:  # pragma: no cover - Windows
    resource = None  # type: ignore[assignment]
_POSIX_LIMITS_AVAILABLE = hasattr(os, "fork")


class SkillAgentError(Exception):
    """Skill Agent 调用失败（由 SSE 端点捕获后以 error 事件传导到前端）。"""


class SkillValidationError(Exception):
    """skill zip 校验失败（缺 SKILL.md / 缺 name / description 元数据等）。"""


@dataclass
class SkillRuntimeConfig:
    """一次 Skill Agent 调用所需的运行时配置（由 NodeConfig 解析而来）。

    system_prompt 保留字段（存量兼容）：运行时系统提示词唯一来源为物化的
    runtime/.agent/agents/{agent_id}/AGENTS.md（见 write_agent_md / _build_instructions）。
    """

    base_url: str = ""
    api_key: str = ""
    model_name: str = ""
    system_prompt: str = ""
    user_id: int = 0
    # SkillAgentConfig.id：定位共享 AGENTS.md 物化文件（跨用户共享同一份）
    agent_id: int = 0


# ---------------------------------------------------------------------------
# 工作区 & skill 元数据
# ---------------------------------------------------------------------------

def workspace_root(user_id: int) -> Path:
    """该用户的运行时工作区根目录（自动创建）：runtime/{user_id}/workspace/。

    节点工作区（node_workspace）是其子目录；无 workspace_id 的旧路径回退用此根目录。
    """
    root = RUNTIME_ROOT / str(user_id) / "workspace"
    root.mkdir(parents=True, exist_ok=True)
    return root


def user_skills_root(user_id: int) -> Path:
    """该用户「已安装 skill」登记目录：runtime/{user_id}/skills/。

    - Bifrost 检索安装：子目录为软链 -> runtime/.agent/skills/{name}（共享真实包，零拷贝）；
    - 用户上传安装：子目录为真实解压目录（私有，仅本用户可见）。
    已安装列表 / 删除均以本目录为单一事实来源，避免共享区跨用户可见性泄漏。
    """
    d = RUNTIME_ROOT / str(user_id) / "skills"
    d.mkdir(parents=True, exist_ok=True)
    return d


def skills_dir(user_id: int) -> Path:
    """已安装 skill 目录（与 user_skills_root 同义，保留旧函数名供调用方使用）。"""
    return user_skills_root(user_id)


def sanitize_workspace_id(workspace_id: str) -> str:
    """消毒 workspace_id：剔除非法字符（仅保留字母/数字/中划线/下划线）并限长，防目录穿越。"""
    return _WORKSPACE_ID_PATTERN.sub("", workspace_id or "")[:MAX_WORKSPACE_ID_LEN]


def node_workspace(user_id: int, workspace_id: str) -> Path:
    """创建并返回单个 chat 节点的工作区：runtime/{user_id}/workspace/{workspace_id}。

    workspace_id 预先消毒；为空时回退到时间戳目录。同节点同 workspace_id 多轮复用同一工作区
    （产物/文件跨轮保留），清空对话后前端重新生成 workspace_id -> 干净工作区。
    """
    ws = sanitize_workspace_id(workspace_id)
    if not ws:
        ws = f"node_{int(time.time() * 1000)}"
    d = RUNTIME_ROOT / str(user_id) / "workspace" / ws
    d.mkdir(parents=True, exist_ok=True)
    return d


def _remove_path(p: Path) -> None:
    """删除文件 / 软链 / 目录（软链不穿透：删除软链本身，不动其指向的真实目录）。"""
    if p.is_symlink() or p.is_file():
        p.unlink(missing_ok=True)
    elif p.is_dir():
        shutil.rmtree(p, ignore_errors=True)


def _symlink_or_copy(target: Path, link: Path) -> None:
    """建软链指向绝对目标；失败（如 Windows 无 symlink 权限）退化为真实复制。

    软链与复制功能等价（skill / AGENTS.md 均可被 agent 读取），仅失去零拷贝优势。
    """
    link.parent.mkdir(parents=True, exist_ok=True)
    try:
        link.symlink_to(str(target), target_is_directory=target.is_dir())
    except OSError:
        if target.is_dir():
            shutil.copytree(target, link, dirs_exist_ok=True)
        else:
            shutil.copy2(target, link)


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
    """读取单个 skill 目录的元数据（name/description/正文/文件树）。

    登记目录里的 Bifrost skill 是软链：先 resolve 到真实目录再列文件树，
    否则 Path.rglob 默认不递归符号链接目录，文件树会为空。
    """
    real = skill_dir.resolve() if skill_dir.is_symlink() else skill_dir
    md_path = real / "SKILL.md"
    if not md_path.is_file():
        return {"name": real.name, "description": "", "body": "", "files": []}
    text = md_path.read_text(encoding="utf-8", errors="replace")
    meta, body = _parse_frontmatter(text)
    files = [
        str(p.relative_to(real)).replace("\\", "/")
        for p in sorted(real.rglob("*"))
        if p.is_file()
    ]
    return {
        "name": meta.get("name") or skill_dir.name,
        "description": meta.get("description", ""),
        "body": body,
        "files": files,
    }


def list_installed_skills(user_id: int) -> List[Dict[str, Any]]:
    """列出该用户已安装的 skill（含 name/description/文件树）。以用户登记目录为事实来源。"""
    d = user_skills_root(user_id)
    items = []
    for child in sorted(d.iterdir()):
        if not child.is_dir():
            continue
        if not (child / "SKILL.md").is_file():
            continue
        meta = read_skill_meta(child)
        meta["path"] = f"skills/{child.name}"
        items.append(meta)
    return items


def resolve_skill_abs(
    user_id: int, rel_path: str, workspace: Optional[Path] = None
) -> Optional[Path]:
    """把工作区内的相对路径解析为绝对路径；越界（../ 等）返回 None。

    workspace 为节点运行时工作区（/skill-files 下载时由 workspace_id 定位）；缺省回退
    该用户工作区根目录。两道防线：
    1. 词法越界拦截：先按 normpath 检查 .. 是否跳出工作区（阻止通过任意 ../ 直达
       共享/登记区，如 ../../../.agent/agents/1/AGENTS.md）；
    2. 软链放行：Path.resolve() 穿透软链后，仅当落点在工作区内或共享/登记前缀
       （runtime/.agent/skills、runtime/.agent/agents、用户登记区）才放行。
    工作区内指向他人目录的软链解析后不在任何前缀内，一律拒绝。
    """
    root = (workspace or workspace_root(user_id)).resolve()
    root_str = str(root)
    # 1) 词法层：.. 跳出工作区的路径直接拒绝（不跟随软链，纯路径规范化）
    lexical = os.path.normpath(os.path.join(root_str, rel_path or ""))
    if lexical != root_str and not lexical.startswith(root_str + os.sep):
        return None
    # 2) 符号层：跟随工作区内软链（装配的 skill / AGENTS.md），落点在前缀内才放行
    candidate = Path(lexical).resolve()
    allowed_roots = (
        root,
        REAL_SKILLS_ROOT.resolve(),
        REAL_AGENTS_ROOT.resolve(),
        user_skills_root(user_id).resolve(),
    )
    for allowed in allowed_roots:
        if candidate == allowed or allowed in candidate.parents:
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


def _extract_skill_zip(zip_bytes: bytes, dest: Path, info: Dict[str, Any]) -> Dict[str, Any]:
    """把已校验的 zip 解压到 dest（zip-slip 防护 + 大小/数量上限，失败清理半成品）。"""
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
    return read_skill_meta(dest)


# 共享区安装锁：install_skill_zip 的 rmtree+重解压作用于跨用户共享目录，
# 并发安装/更新同名 skill 会互相破坏（FastAPI 同步端点跑在线程池中）
_SHARED_INSTALL_LOCK = threading.Lock()


def install_skill_zip(user_id: int, zip_bytes: bytes) -> Dict[str, Any]:
    """Bifrost 检索路径：校验并真实解压到共享区 runtime/.agent/skills/{name}/，
    再在该用户登记目录 runtime/{user_id}/skills/{name} 建软链（Windows 失败退化为复制）。

    跨用户共享同一真实包（零拷贝）；删除登记不影响共享包（Q5 语义，由运维定期 GC）。
    """
    info = validate_skill_zip(zip_bytes)
    name = info["name"]
    with _SHARED_INSTALL_LOCK:
        dest = REAL_SKILLS_ROOT / name
        if dest.exists():
            # 同名 skill 已存在：先清空再覆盖（重装 = 更新）
            shutil.rmtree(dest)
        meta = _extract_skill_zip(zip_bytes, dest, info)
    # 用户登记：软链 -> 共享真实包（绝对目标路径；Windows 无权限退化为真实复制）
    registry = user_skills_root(user_id) / name
    if registry.exists() or registry.is_symlink():
        _remove_path(registry)
    _symlink_or_copy(dest, registry)
    meta["path"] = f"skills/{name}"
    return meta


def install_user_skill_zip(user_id: int, zip_bytes: bytes) -> Dict[str, Any]:
    """用户上传路径：校验并真实解压到私有登记目录 runtime/{user_id}/skills/{name}/。

    用户私有数据不跨用户共享；运行时按需复制进节点工作区（真实目录语义）。
    """
    info = validate_skill_zip(zip_bytes)
    name = info["name"]
    dest = user_skills_root(user_id) / name
    if dest.exists() or dest.is_symlink():
        _remove_path(dest)
    meta = _extract_skill_zip(zip_bytes, dest, info)
    meta["path"] = f"skills/{name}"
    return meta


# ---------------------------------------------------------------------------
# Bifrost skill 共享包管理（Admin 端集中管理 + 画布缓存命中）
# ---------------------------------------------------------------------------

def register_existing_bifrost_skill(
    user_id: int, name: str
) -> Optional[Dict[str, Any]]:
    """共享区已缓存该 Bifrost skill 时，跳过网络下载，仅在该用户登记区建软链。

    画布安装接口的缓存命中路径：共享真实包 runtime/.agent/skills/{name} 存在且
    SKILL.md 有效即视为命中（毫秒级）；未命中返回 None，由调用方走网络下载。
    用户登记已存在且有效 → 直接返回（幂等，不重复建链）。

    name 含非法字符时抛 SkillValidationError（与 install_skill_zip 同套卫生规则）。
    """
    name = (name or "").strip()
    if (
        not name
        or len(name) > MAX_SKILL_NAME_LEN
        or "/" in name
        or "\\" in name
        or name in (".", "..")
        or any(ord(ch) < 32 for ch in name)
    ):
        raise SkillValidationError(
            "SKILL.md 的 name 含非法字符：仅允许字母/数字/中划线/下划线/空格（将作为目录名使用）"
        )
    dest = REAL_SKILLS_ROOT / name
    if not dest.is_dir() or not (dest / "SKILL.md").is_file():
        return None
    registry = user_skills_root(user_id) / name
    # 已登记且有效：幂等返回，不重复建链（软链或复制退化副本均可）
    if (registry / "SKILL.md").is_file():
        meta = read_skill_meta(registry)
        meta["path"] = f"skills/{name}"
        return meta
    if registry.exists() or registry.is_symlink():
        _remove_path(registry)
    _symlink_or_copy(dest, registry)
    meta = read_skill_meta(registry)
    meta["path"] = f"skills/{name}"
    return meta


def update_shared_bifrost_skill(zip_bytes: bytes) -> Dict[str, Any]:
    """Admin 同步：校验并覆盖共享区 runtime/.agent/skills/{name}/（不动任何用户登记）。

    与 install_skill_zip 的共享区部分等价，但不触碰用户登记：
    - POSIX：用户登记是软链，下次节点运行自动读到新版本；
    - Windows 无软链权限（登记退化为复制）：已登记用户保留旧副本，需重新安装才更新。
    """
    info = validate_skill_zip(zip_bytes)
    name = info["name"]
    with _SHARED_INSTALL_LOCK:
        dest = REAL_SKILLS_ROOT / name
        if dest.exists() or dest.is_symlink():
            _remove_path(dest)
        meta = _extract_skill_zip(zip_bytes, dest, info)
    return meta


def list_shared_bifrost_skills() -> List[Dict[str, Any]]:
    """扫描共享区 runtime/.agent/skills/，返回各 skill 的元数据 + 目录修改时间。

    供 Admin 端 Bifrost Skills 管理页使用（本地缓存的事实来源）；
    残缺目录（缺 SKILL.md，如历史残留）不展示。
    """
    if not REAL_SKILLS_ROOT.is_dir():
        return []
    items = []
    for child in sorted(REAL_SKILLS_ROOT.iterdir()):
        if not child.is_dir() or not (child / "SKILL.md").is_file():
            continue
        meta = read_skill_meta(child)
        try:
            meta["updated_at"] = child.stat().st_mtime
        except OSError:
            meta["updated_at"] = None
        items.append(meta)
    return items


def remove_shared_bifrost_skill(name: str) -> int:
    """Admin 删除：从共享区彻底删除该 skill 包，并清理指向它的用户登记软链。

    返回清理掉的用户登记软链条目数。登记软链被删后变悬空（导致装配/列表异常），
    故一并移除；真实目录登记（用户上传 / Windows 复制退化）是用户数据，保留不删。
    删除后画布再次安装该 skill 会重新触发网络下载（缓存未命中）。
    """
    name = (name or "").strip()
    if (
        not name
        or "/" in name
        or "\\" in name
        or name in (".", "..")
    ):
        raise SkillValidationError("skill 名称含非法字符")
    cleaned = 0
    with _SHARED_INSTALL_LOCK:
        dest = REAL_SKILLS_ROOT / name
        if dest.exists() or dest.is_symlink():
            _remove_path(dest)
        # 清理指向共享区的用户登记软链（真实目录 = 用户上传/复制副本，保留）
        if RUNTIME_ROOT.is_dir():
            for user_dir in RUNTIME_ROOT.iterdir():
                if not user_dir.is_dir() or not user_dir.name.isdigit():
                    continue
                registry = user_dir / "skills" / name
                if registry.is_symlink():
                    registry.unlink(missing_ok=True)
                    cleaned += 1
    return cleaned


def write_agent_md(agent_id: Any, content: str) -> Optional[Path]:
    """物化 SkillAgentConfig 的系统提示词为 runtime/.agent/agents/{agent_id}/AGENTS.md。

    content 非空 → 写入并返回路径；为空 → 删除已存在文件并返回 None
    （「未配置提示词则没有」语义，运行时以文件存在性为准，文件与 DB 同步刷新）。
    """
    target_dir = REAL_AGENTS_ROOT / str(agent_id)
    target = target_dir / "AGENTS.md"
    if content and content.strip():
        target_dir.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return target
    if target.exists():
        target.unlink(missing_ok=True)
    return None


def prepare_runtime_workspace(
    user_id: int,
    workspace_id: str,
    agent_id: Optional[Any],
    skill_names: Optional[List[str]] = None,
) -> Path:
    """按节点装配运行时工作区（每次 /chat 执行前调用，幂等）：

    1. 工作区 = runtime/{user_id}/workspace/{workspace_id}；
    2. 若该 agent 物化了 AGENTS.md → 工作区根软链一份（否则该文件不存在）；
    3. 对每个选中的 skill：用户登记为软链（Bifrost）→ 工作区 .agents/skills/{name}
       软链到共享真实包；登记为真实目录（上传）→ copytree 复制进工作区（用户私有语义）。
    所有软链创建失败自动退化为真实复制（Windows 无权限仍可用）。
    """
    ws = node_workspace(user_id, workspace_id)

    # AGENTS.md：仅当配置了提示词才存在（软链 -> runtime/.agent/agents/{id}/AGENTS.md）
    agent_md = REAL_AGENTS_ROOT / str(agent_id or 0) / "AGENTS.md"
    ws_agent_md = ws / "AGENTS.md"
    if agent_md.is_file():
        if not ws_agent_md.exists():
            _symlink_or_copy(agent_md, ws_agent_md)

    # 空/None = 加载该用户全部已安装 skill（与 _build_instructions 的空=全部语义一致），
    # 否则工作区未装配的 skill 会在指令中被引用但实际不存在
    if not skill_names:
        skill_names = [s["name"] for s in list_installed_skills(user_id)]
    skills_ws_dir = ws / ".agents" / "skills"
    skills_ws_dir.mkdir(parents=True, exist_ok=True)
    for name in skill_names:
        if not isinstance(name, str) or not name:
            continue
        # 名称卫生：拒绝路径分隔符 / 相对跳转（防目录穿越到工作区外）
        if "/" in name or "\\" in name or name in (".", ".."):
            continue
        link = skills_ws_dir / name
        if link.exists():
            continue  # 已装配（同 workspace_id 多轮复用）
        src = user_skills_root(user_id) / name
        if src.is_symlink():
            _symlink_or_copy(src.resolve(), link)  # Bifrost：软链到共享真实包
        elif src.is_dir():
            shutil.copytree(src, link)  # 上传：真实复制（用户私有）
    return ws


# ---------------------------------------------------------------------------
# Agent 构建 & 沙箱执行
# ---------------------------------------------------------------------------

def _build_instructions(
    config: SkillRuntimeConfig,
    user_id: int,
    skill_names: Optional[List[str]] = None,
    workspace: Optional[Path] = None,
) -> str:
    """组装 Agent instructions：AGENTS.md 系统提示词 + 指定 skill 的 SKILL.md 指令。

    - 系统提示词唯一来源为物化的 runtime/.agent/agents/{id}/AGENTS.md（工作区根软链）：
      工作区存在该文件则读全文置于 skills 段之前，不存在则无系统提示词段
      （不再从 DB system_prompt 字段注入——管理端保存时已同步物化文件）。
    - skill_names 为上游「Skill 检索」节点选中的 skill 名（空/None = 加载全部已安装 skill）。
      位置字段固定为工作区相对路径 .agents/skills/{name}（软链可读，与目录约定一致）。
    """
    parts: List[str] = []
    if workspace is not None:
        agent_md = workspace / "AGENTS.md"
        if agent_md.is_file():
            text = agent_md.read_text(encoding="utf-8", errors="replace").strip()
            if text:
                parts.append(text)
    skills = list_installed_skills(user_id)
    if skill_names:
        wanted = set(skill_names)
        skills = [s for s in skills if s["name"] in wanted]
    if skills:
        skill_sections = [
            (
                f"## Skill: {s['name']}\n"
                f"描述：{s['description']}\n"
                f"位置：.agents/skills/{s['name']}\n\n"
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
    """强杀整个进程组（命令与其派生的孙进程），防止超时后残留孤儿进程。

    POSIX 用 killpg（start_new_session 使命令自成进程组）；Windows 无进程组
    语义（os.killpg 不存在），退化为直接 proc.kill()（尽力而为）。
    """
    killpg = getattr(os, "killpg", None)
    if killpg is None:
        try:
            proc.kill()
        except OSError:
            pass
        return
    try:
        killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        pass


class SandboxedShellExecutor:
    """沙箱 shell 执行器（供 FunctionTool 包装）。

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

    def __init__(
        self,
        user_id: int,
        workspace: Optional[Path] = None,
        workspace_id: Optional[str] = None,
    ):
        self.user_id = user_id
        self.root = workspace or workspace_root(user_id)
        # 工作区目录名（前端首轮生成的 workspaceId）：agent_file 下载 URL 携带，供 /skill-files 定位
        self.workspace_id = workspace_id
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
                        "url": f"/api/modules/bookplate/skill-files?path={rel}"
                        + (f"&workspace_id={self.workspace_id}" if self.workspace_id else ""),
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

    async def run_command(self, command: List[str], timeout_ms: Optional[int] = None) -> str:
        """执行一条命令（FunctionTool on_invoke 调用）。"""
        if not command:
            return "（空命令）"
        # 路径逃逸校验：绝对路径 / .. 穿越一律拒绝（cwd 限定之外的又一道闸）
        reject = self._escape_reason(command)
        if reject:
            return reject
        # 超时：模型请求值封顶，避免长命令拖垮连接
        timeout_ms = timeout_ms or DEFAULT_CMD_TIMEOUT * 1000
        timeout = min(timeout_ms / 1000.0, DEFAULT_CMD_TIMEOUT)

        before: Optional[Dict[str, Tuple[int, int]]] = None
        try:
            before = self._snapshot()
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
        except Exception as exc:
            # 命令级故障一律转为可见的工具结果（而不是中断整轮 agent 流）：
            # 除 FileNotFoundError/PermissionError 外还有 Windows 专属异常 / 非法
            # 命令参数等非 OSError 异常，带类型名一并返回，便于模型调整与排查。
            logger.warning("local_shell 命令执行失败: %s", command, exc_info=True)
            return f"（命令执行失败: {type(exc).__name__}: {exc}）"

        parts: List[str] = []
        if stdout_b:
            parts.append(stdout_b.decode("utf-8", errors="replace")[:MAX_OUTPUT_LENGTH])
        if stderr_b:
            parts.append("[stderr]\n" + stderr_b.decode("utf-8", errors="replace")[:MAX_OUTPUT_LENGTH])
        result = "\n".join(parts).strip() or "（命令执行完成，无输出）"
        if before is not None:
            try:
                self._diff(before)
            except Exception:
                # 产物文件扫描失败不影响命令结果（尽力而为的探测）
                pass
        return result


def build_agent(
    config: SkillRuntimeConfig,
    skill_names: Optional[List[str]] = None,
    workspace: Optional[Path] = None,
    workspace_id: Optional[str] = None,
):
    """构建 openai-agents-python Agent（任意 OpenAI 兼容端点，chat completions 协议）。

    关键：工具必须是 FunctionTool。LocalShellTool 是 hosted tool，ChatCompletions
    兼容端点的工具转换器（Converter.tool_to_openai）不识别它，会直接抛
    "Hosted tools are not supported with the ChatCompletions API"——这正是
    Skill Agent 在任意兼容端点上「对话超时」的根因（异常逃逸出 SSE 生成器，
    前端 120 秒空闲超时后才提示）。
    """
    from agents import (
        Agent,
        FunctionTool,
        ModelSettings,
        OpenAIProvider,
        RunConfig,
        ToolOutputText,
    )

    provider = OpenAIProvider(
        api_key=config.api_key or None,
        base_url=config.base_url or None,
        use_responses=False,  # 兼容任意 OpenAI-compatible 端点（不走 Responses API）
    )
    executor = SandboxedShellExecutor(
        config.user_id, workspace=workspace, workspace_id=workspace_id
    )

    async def _invoke_shell(_ctx, arguments: str) -> ToolOutputText:
        """FunctionTool 处理器：解析模型 JSON 参数 → 沙箱执行。

        _ctx 为 ToolContext（ToolContext 未从 agents 顶层导出，无需注解；
        FunctionTool 直接构造时 schema 来自 params_json_schema，不依赖签名注解）。
        """
        try:
            args = json.loads(arguments or "{}")
        except json.JSONDecodeError:
            return ToolOutputText(text="（工具参数不是合法 JSON，无法执行）")
        raw_cmd = args.get("command")
        # 先校验再转换：直接 list("ls") 会把字符串拆成 ["l","s"] 绕过类型检查
        if not isinstance(raw_cmd, list) or not all(isinstance(c, str) for c in raw_cmd):
            return ToolOutputText(text="（工具参数缺少 command 字符串数组）")
        command = raw_cmd
        timeout_ms = args.get("timeout_ms")
        # bool 是 int 子类：True 会被当成 1ms 超时，需显式排除
        if not isinstance(timeout_ms, int) or isinstance(timeout_ms, bool):
            timeout_ms = None
        result = await executor.run_command(command, timeout_ms)
        return ToolOutputText(text=result)

    shell_tool = FunctionTool(
        name="local_shell",
        description=(
            "在工作区目录中执行 shell 命令（无 shell 展开，命令以参数数组形式给出）。"
            "例如 [\"ls\", \"-la\"]、[\"cat\", \".agents/skills/demo/SKILL.md\"]、"
            "[\"bash\", \"scripts/run.sh\"]。禁止使用绝对路径或 .. 路径段。"
        ),
        params_json_schema={
            "type": "object",
            "properties": {
                "command": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "命令及其参数（不经过 shell 展开）",
                },
                "timeout_ms": {
                    "type": "integer",
                    "description": "可选：命令超时（毫秒），不传则用默认超时",
                },
            },
            "required": ["command"],
        },
        on_invoke_tool=_invoke_shell,
        # 非 strict：兼容更多 OpenAI 兼容端点的工具 schema 解析
        strict_json_schema=False,
    )

    agent = Agent(
        name="Skill Agent",
        instructions=_build_instructions(config, config.user_id, skill_names, workspace),
        model=config.model_name or "gpt-4o-mini",
        tools=[shell_tool],
        model_settings=ModelSettings(temperature=0.3),
    )
    # 注意：max_turns 不是 RunConfig 的字段，而是 Runner.run_streamed() 的参数，
    # 传错会抛 TypeError 并逃逸出 SSE 生成器（表现为前端「对话超时」）
    run_config = RunConfig(model_provider=provider)
    return agent, run_config, executor


def _to_input_items(messages: list) -> list:
    """OpenAI 格式消息 → openai-agents-python 输入项。

    兼容多种消息形态（历史消息可能来自不同路径）：
    - 纯文本 user 消息（content 为 str）；
    - 多模态 user 消息（content 为 text + image_url 数组，_multimodal_messages 产出）；
    - 已按 Responses/Items 格式的 user 消息（content 为 input_text / input_image 数组）；
    - assistant 消息保持 output_text。
    """
    items: list = []
    for m in messages or []:
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        content = m.get("content")
        if role in ("system", "developer"):
            # 系统/开发者消息原样透传（转换器原生支持这两个角色）
            if isinstance(content, str) and content.strip():
                items.append({"role": role, "content": content})
            continue
        if role == "assistant":
            # assistant 历史消息必须以 input_text 呈现：output_text 是输出类型，
            # ChatCompletions 转换器的 extract_all_content 不认它，
            # 多轮对话（第二轮起含 assistant 历史）会抛 "Unknown content"
            if isinstance(content, str):
                text = content
            elif isinstance(content, list):
                # 多段 assistant 回复（output_text/text 段）合并为纯文本，避免静默丢弃
                segments = []
                for part in content:
                    if isinstance(part, dict) and part.get("type") in ("output_text", "text") and part.get("text"):
                        segments.append(str(part["text"]))
                text = "\n".join(segments)
            else:
                text = ""
            items.append({"role": "assistant", "content": [{"type": "input_text", "text": text}]})
            continue
        # user：纯文本
        if isinstance(content, str):
            items.append({"role": "user", "content": [{"type": "input_text", "text": content}]})
            continue
        parts: list = []
        # 仅接受可迭代的 content（防御非列表值，如数字，避免 for 循环直接炸裂）
        for part in content if isinstance(content, list) else []:
            if not isinstance(part, dict):
                continue
            ptype = part.get("type")
            # chat-completions 的 text 与 Responses 的 input_text 语义一致，合并处理
            if ptype in ("text", "input_text"):
                parts.append({"type": "input_text", "text": str(part.get("text", ""))})
            elif ptype in ("image_url", "input_image"):
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
    """从 ToolCallItem 提取参数 JSON 字符串。

    兼容三种 raw_item 形态：
    - dict（自定义/旧路径）：arguments 可能为 dict 或 JSON 字符串；
    - ResponseFunctionToolCall（chatcmpl 模式 FunctionTool）：
      arguments 直接挂在对象上，为 JSON 字符串（如 '{"command": ["ls"]}'）；
    - Responses API FunctionCall：arguments 为 dict。
    """
    raw = getattr(item, "raw_item", None)
    if isinstance(raw, dict):
        args = raw.get("arguments")
        if isinstance(args, dict):
            return json.dumps(args, ensure_ascii=False)
        return str(args or "")
    # ResponseFunctionToolCall / FunctionCall：arguments 为对象字段
    args = getattr(raw, "arguments", None)
    if isinstance(args, dict):
        return json.dumps(args, ensure_ascii=False)
    if isinstance(args, str):
        return args
    # 兜底：function.arguments（部分 provider 的嵌套结构）
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
    workspace_id: Optional[str] = None,
    workspace: Optional[Path] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """运行 Skill Agent 并产出归一化事件流。

    事件形态与 fastclaw_service 一致（content_delta / tool_call / tool_result /
    status / done / error），并新增 agent_file（skill 执行产生的文件，前端渲染下载卡片）。

    - workspace_id：前端下发的节点工作区标识（{node_id}_{timestamp}），据此装配工作区
      （软链 skill / AGENTS.md，prepare_runtime_workspace）；缺省回退该用户工作区根目录
      （旧路径兼容，不装配软链）。
    - workspace：调用方已装配好的工作区（router 层 prepare 后传入），优先于 workspace_id。
    """
    from agents import Runner

    try:
        from agents import set_tracing_disabled

        set_tracing_disabled(True)  # 自托管：不上报 tracing
    except Exception:
        pass

    if not config.api_key:
        raise SkillAgentError("DeepSeek Agent 配置缺少 API Key")
    if not config.model_name:
        raise SkillAgentError("DeepSeek Agent 配置缺少模型名称")

    try:
        if workspace is None and workspace_id:
            workspace = prepare_runtime_workspace(
                config.user_id, workspace_id, config.agent_id, skills
            )
        agent, run_config, executor = build_agent(
            config, skills, workspace=workspace, workspace_id=workspace_id
        )
        items = _to_input_items(messages)
        if not any(i.get("role") == "user" for i in items):
            raise SkillAgentError("AI 对话缺少用户消息")

        # 端点兼容兜底：部分思维模型/网关把完整回答（含正文）也放在 reasoning_content
        # 字段流式输出、content 字段恒为空（agnes-2.5-flash 等）→ SDK 会把全部增量
        # 归为 reasoning。此处 reasoning 仍实时透传（保持思考过程展示），同时缓冲全文；
        # 整轮结束时若从未产出正文，把缓冲的思考文本作为正文补发，避免回答被全部
        # 折叠进思考过程组件（正文气泡为空）。正常端点（思考 + 正文分离）不受影响。
        pending_reasoning: List[str] = []
        saw_content = False
        # max_turns 是 Runner.run_streamed() 的参数（不是 RunConfig 的）
        result = Runner.run_streamed(
            agent, input=items, run_config=run_config, max_turns=MAX_TURNS
        )
        async for event in result.stream_events():
            etype = event.type
            # 文本增量（Responses 路径：ResponseTextDeltaEvent；ChatCompletions 路径：chunk delta）
            if etype == "raw_response_event":
                data = event.data
                dtype = getattr(data, "type", "")
                # 回答正文与思考过程（reasoning）拆成独立事件：output_text.delta ->
                # content_delta（前端拼入消息正文），reasoning_text/reasoning_summary_text.delta
                # （DeepSeek 等端点的推理增量）-> reasoning_delta（前端独立折叠展示）。
                # 工具调用参数增量（response.function_call_arguments.delta）的 delta 字段是参数
                # JSON，绝不能当对话文本渲染（此前被误透传 → 聊天气泡里出现 {"command": ...}）。
                # refusal 增量（response.refusal.delta）刻意不展示：安全过滤拒答不应作为
                # 正常回复文本渲染（模型最终会以 output_text 给出拒答说明）。
                if dtype == "response.output_text.delta":
                    delta = getattr(data, "delta", None)
                    if isinstance(delta, str) and delta:
                        saw_content = True
                        yield {"type": "content_delta", "data": {"delta": delta}}
                    continue
                if dtype in (
                    "response.reasoning_text.delta",
                    "response.reasoning_summary_text.delta",
                ):
                    delta = getattr(data, "delta", None)
                    if isinstance(delta, str) and delta:
                        pending_reasoning.append(delta)
                        yield {"type": "reasoning_delta", "data": {"delta": delta}}
                    continue
                # 未走事件归一化时的原始 chunk 兜底（content / reasoning_content，工具调用除外）
                choices = getattr(data, "choices", None)
                if choices:
                    d = getattr(choices[0], "delta", None)
                    content = getattr(d, "content", None)
                    if content and not getattr(d, "tool_calls", None):
                        saw_content = True
                        yield {"type": "content_delta", "data": {"delta": content}}
                    reasoning = getattr(d, "reasoning_content", None)
                    if isinstance(reasoning, str) and reasoning:
                        pending_reasoning.append(reasoning)
                        yield {"type": "reasoning_delta", "data": {"delta": reasoning}}
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
        # 整轮未产出任何正文（仅 reasoning）：把思考文本作为正文补发（见循环前的兜底说明）
        if not saw_content and pending_reasoning:
            logger.warning(
                "Skill Agent 端点本轮未产出正文（仅 reasoning，共 %d 字符），已将思考文本作为正文透传",
                sum(len(s) for s in pending_reasoning),
            )
            yield {
                "type": "content_delta",
                "data": {"delta": "\n".join(pending_reasoning)},
            }
        yield {"type": "done", "data": {}}
    except SkillAgentError:
        raise
    except Exception as exc:
        # 任何意外异常（SDK 参数错误 / 端点不兼容等）都必须转成 error 事件透传，
        # 否则会逃逸出 SSE 生成器 → 前端流静默中断 → 表现为「对话超时，请重试」
        logger.error("Skill Agent 执行失败: %s", exc, exc_info=True)
        # 带上异常类型名：即使异常 str() 为空（如某些裸抛 Exception），
        # 前端也能看到具体类型，避免出现「Error running tool local_shell:」无尾注的哑错误
        raise SkillAgentError(f"Skill Agent 执行失败: {type(exc).__name__}: {exc}") from exc



