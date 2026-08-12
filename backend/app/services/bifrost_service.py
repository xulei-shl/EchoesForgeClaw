"""Bifrost Prompt Repository 代理服务。

Bifrost Management API（所有 `/api/prompt-repo/*`）鉴权（自部署默认）：
- 主方案：Basic Auth（`Authorization: Basic base64(username:password)`），
  凭据存于系统设置 bitfrost.username / bitfrost.password（密码仅掩码回传）；
- 兼容方案：Bearer Management API Key（bitfrost.api_key，旧部署回退）。
两者都配置时 Basic 优先；启动时若 Basic 凭据齐全会自动清理遗留的 api_key 行。

预览图：Bifrost 官方数据无图片字段，预览图由本系统本地存储
（backend/static/prompt-previews + prompt_metadata 表），列表/详情接口合并返回。
"""
import base64
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx

from app.models.app_setting import AppSetting
from app.models.prompt_metadata import PromptMetadata

logger = logging.getLogger(__name__)

# 预览图本地目录: backend/static/prompt-previews（复用 main.py 的 /static 挂载）
PREVIEW_DIR = Path(__file__).resolve().parents[2] / "static" / "prompt-previews"
PREVIEW_PREFIX = "/static/prompt-previews"
PREVIEW_MAX_BYTES = 5 * 1024 * 1024

_IMAGE_MAGIC_PREFIXES = (
    (b"\xff\xd8\xff", ".jpg"),
    (b"\x89PNG\r\n\x1a\n", ".png"),
    (b"GIF87a", ".gif"),
    (b"GIF89a", ".gif"),
)


class BifrostError(Exception):
    """Bifrost 调用失败（由路由捕获后转为 502 响应）。"""


class BifrostNotConfiguredError(BifrostError):
    """Bifrost 未配置（base_url / api_key 缺失），提示前往系统设置。"""


class BifrostNotFoundError(BifrostError):
    """Bifrost 资源不存在（HTTP 404，如提示词已被删除），映射为 404 响应。"""


def detect_image_ext(content: bytes) -> Optional[str]:
    """通过文件头魔数判断字节是否为真实图片；是则返回扩展名，否则 None。"""
    if not content:
        return None
    for magic, ext in _IMAGE_MAGIC_PREFIXES:
        if content.startswith(magic):
            return ext
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return ".webp"
    return None


def sanitize_prompt_id(prompt_id: str) -> str:
    """把 prompt_id 清洗为安全的文件名基名（Bifrost 为 UUID，防御性兜底）。"""
    return re.sub(r"[^A-Za-z0-9_-]", "", prompt_id) or "prompt"


@dataclass
class BifrostAuthConfig:
    """一次 Bifrost 管理 API 调用所需的连接与认证配置。

    自部署版本的管理 API（/api/*，含 Prompt Repo）默认使用 Basic Auth
    （Authorization: Basic base64(username:password)），账号密码存于系统设置
    （bitfrost.username / bitfrost.password，密码掩码）。兼容旧部署的 Bearer
    Management API Key（bitfrost.api_key）——两者都配置时 Basic 优先。
    """

    base_url: str = ""
    username: str = ""
    password: str = ""
    api_key: str = ""

    @property
    def headers(self) -> Dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.username and self.password:
            token = base64.b64encode(
                f"{self.username}:{self.password}".encode("utf-8")
            ).decode("ascii")
            headers["Authorization"] = f"Basic {token}"
        elif self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers


def _bifrost_config(db) -> BifrostAuthConfig:
    settings_map = {s.key: s.value for s in db.query(AppSetting).all()}
    return BifrostAuthConfig(
        base_url=(settings_map.get("bitfrost.base_url") or "").strip().rstrip("/"),
        username=(settings_map.get("bitfrost.username") or "").strip(),
        password=settings_map.get("bitfrost.password") or "",
        api_key=(settings_map.get("bitfrost.api_key") or "").strip(),
    )


def _require_config(db) -> BifrostAuthConfig:
    config = _bifrost_config(db)
    if not config.base_url:
        raise BifrostNotConfiguredError(
            "Bifrost 未配置：请在「系统设置」中添加 bitfrost.base_url"
        )
    if not ((config.username and config.password) or config.api_key):
        raise BifrostNotConfiguredError(
            "Bifrost 未配置：请在「系统设置」中添加 bitfrost.username / bitfrost.password"
            "（或兼容的 bitfrost.api_key）"
        )
    return config


async def _get_json(
    config: BifrostAuthConfig,
    path: str,
    params: Optional[Dict[str, Any]] = None,
    *,
    raw: bool = False,
) -> Any:
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(10.0, read=30.0)
        ) as client:
            resp = await client.get(
                config.base_url + path, headers=config.headers, params=params
            )
    except httpx.HTTPError as exc:
        raise BifrostError(f"连接 Bifrost 失败: {exc}") from exc
    if resp.status_code == 404:
        raise BifrostNotFoundError("Bifrost 资源不存在（可能已被删除）")
    if resp.status_code != 200:
        detail = resp.text[:300] if resp.text else ""
        raise BifrostError(f"Bifrost API 返回 HTTP {resp.status_code}: {detail}")
    try:
        data = resp.json()
    except ValueError:
        raise BifrostError("Bifrost 返回了非 JSON 响应")
    # Bifrost 部分错误以 HTTP 200 + is_bifrost_error 标记返回（网关形态）：
    # 不能当作成功数据解析，否则列表/详情会静默得到空内容。
    # raw=true（调试透传）时跳过该检查，让调用方看到 Bifrost 的真实返回。
    if not raw and isinstance(data, dict) and data.get("is_bifrost_error"):
        # 包络内带 404 语义（如提示词已删除）时映射为 BifrostNotFoundError
        if data.get("status_code") == 404:
            raise BifrostNotFoundError("Bifrost 资源不存在（可能已被删除）")
        err = data.get("error") or {}
        message = err.get("message") if isinstance(err, dict) else ""
        raise BifrostError(
            message
            or f"Bifrost 返回错误: {data.get('type') or data.get('status_code') or '未知'}"
        )
    return data


def _as_list(payload: Any, key: str) -> List[Dict[str, Any]]:
    """兼容「{'<key>': [...]}」与直接数组两种响应形态。"""
    if isinstance(payload, dict):
        data = payload.get(key)
        if isinstance(data, list):
            return data
    if isinstance(payload, list):
        return payload
    return []


def _message_text(message: Any) -> str:
    """从单条 message 提取文本内容（OpenAI 风格 content：字符串或多段列表）。"""
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: List[str] = []
        for seg in content:
            if not isinstance(seg, dict):
                continue
            text = seg.get("text")
            if isinstance(text, str) and text.strip():
                parts.append(text.strip())
            elif isinstance(seg.get("content"), str) and seg["content"].strip():
                parts.append(seg["content"].strip())
        return "\n".join(parts)
    # 兜底：content 缺失时尝试 text 字段
    text = message.get("text")
    if isinstance(text, str):
        return text.strip()
    return ""


def _pick_message_source(prompt: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], str]:
    """选择最佳正文来源，逐级回退：latest_version → versions → sessions。

    返回 (来源对象, 来源类型)。Bifrost Dashboard 中编辑的内容默认存在
    Session（Playground）里，只有 Commit 后才生成不可变 Version；若用户
    未提交，latest_version 可能缺失或为空——回退到 versions / sessions
    才能取到实际编辑的正文。
    """
    latest = prompt.get("latest_version")
    if isinstance(latest, dict) and isinstance(latest.get("messages"), list) and latest["messages"]:
        return latest, "latest_version"
    versions = prompt.get("versions")
    if isinstance(versions, list) and versions:
        ordered = sorted(
            (
                v
                for v in versions
                if isinstance(v, dict) and isinstance(v.get("messages"), list) and v["messages"]
            ),
            key=lambda v: v.get("version_number") if isinstance(v.get("version_number"), int) else v.get("id") or 0,
            reverse=True,
        )
        if ordered:
            return ordered[0], "versions"
    sessions = prompt.get("sessions")
    if isinstance(sessions, list) and sessions:
        ordered = sorted(
            (
                s
                for s in sessions
                if isinstance(s, dict) and isinstance(s.get("messages"), list) and s["messages"]
            ),
            key=lambda s: s.get("id") if isinstance(s.get("id"), int) else 0,
            reverse=True,
        )
        if ordered:
            return ordered[0], "sessions"
    return latest if isinstance(latest, dict) else None, "latest_version"


def _extract_prompt_text(prompt: Dict[str, Any]) -> str:
    """从 prompt 的正文来源（latest_version → versions → sessions）提取可读文本。

    官方结构：messages: [{"id": 1, "order_index": 0, "message": {...}}]，
    message 内含 role / content（string 或多段列表）。多段用空行拼接。
    """
    source, _ = _pick_message_source(prompt)
    if not source:
        return ""
    messages = source.get("messages") or []
    parts: List[str] = []
    for m in messages:
        if not isinstance(m, dict):
            continue
        msg = m.get("message")
        text = _message_text(msg if isinstance(msg, dict) else m)
        if text:
            parts.append(text)
    return "\n\n".join(parts)


def _preview_map(db, prompt_ids: List[str]) -> Dict[str, str]:
    if not prompt_ids:
        return {}
    rows = (
        db.query(PromptMetadata)
        .filter(PromptMetadata.prompt_id.in_(prompt_ids))
        .all()
    )
    return {r.prompt_id: r.preview_image for r in rows if r.preview_image}


def _compact_prompt(
    prompt: Dict[str, Any], preview_image: Optional[str]
) -> Dict[str, Any]:
    """Bifrost prompt 对象 → 前端紧凑结构（含提取的正文文本 + 本地预览图）。"""
    folder = prompt.get("folder") or {}
    source, _ = _pick_message_source(prompt)
    return {
        "id": prompt.get("id") or "",
        "name": prompt.get("name") or "",
        "folder_id": prompt.get("folder_id"),
        "folder_name": (
            folder.get("name") if isinstance(folder, dict) else None
        ) or None,
        "content": _extract_prompt_text(prompt),
        "preview_image": preview_image or None,
        "created_at": prompt.get("created_at"),
        "updated_at": prompt.get("updated_at"),
        "version_number": source.get("version_number") if source else None,
        "commit_message": (
            (source.get("commit_message") or "") if source else ""
        ) or None,
    }


async def list_folders(db) -> List[Dict[str, Any]]:
    """列出全部文件夹（Bifrost 官方数据，原样透传）。"""
    config = _require_config(db)
    payload = await _get_json(config, "/api/prompt-repo/folders")
    return _as_list(payload, "folders")


async def list_prompts(
    db,
    folder_id: Optional[str] = None,
    q: str = "",
) -> List[Dict[str, Any]]:
    """列出提示词（可选按文件夹过滤），合并本地预览图。

    Bifrost 官方列表接口不支持关键词检索，`q` 在代理侧对
    「名称 + 正文文本」做包含过滤（供画布检索节点与管理页搜索）。
    """
    config = _require_config(db)
    params = {"folder_id": folder_id} if folder_id else None
    payload = await _get_json(config, "/api/prompt-repo/prompts", params=params)
    prompts = _as_list(payload, "prompts")
    if not prompts:
        return []
    previews = _preview_map(db, [p.get("id") or "" for p in prompts if p.get("id")])
    keyword = (q or "").strip().lower()
    items: List[Dict[str, Any]] = []
    for p in prompts:
        pid = p.get("id")
        if not pid:
            continue
        item = _compact_prompt(p, previews.get(pid))
        if keyword:
            haystack = f"{item['name']}\n{item['content']}".lower()
            if keyword not in haystack:
                continue
        items.append(item)
    return items


async def get_prompt_raw(db, prompt_id: str) -> Any:
    """获取单个提示词的 Bifrost 原始响应（调试用，管理端 raw=true 透传）。

    raw 透传不做错误包络判断——调试目的就是看 Bifrost 真实返回了什么。
    """
    config = _require_config(db)
    return await _get_json(config, f"/api/prompt-repo/prompts/{prompt_id}", raw=True)


async def list_prompts_raw(db, folder_id: Optional[str] = None) -> Any:
    """获取提示词列表的 Bifrost 原始响应（调试用，管理端 raw=true 透传）。

    raw 透传不做错误包络判断——调试目的就是看 Bifrost 真实返回了什么。
    注意：raw 透传时忽略关键词 q（管理端调试场景不参与内容过滤）。
    """
    config = _require_config(db)
    params = {"folder_id": folder_id} if folder_id else None
    return await _get_json(config, "/api/prompt-repo/prompts", params=params, raw=True)


async def get_prompt(db, prompt_id: str) -> Dict[str, Any]:
    """获取单个提示词详情（含提取的正文文本 + 本地预览图）。

    官方 Get Prompt 响应为 `{"prompt": {...}}` 包装结构（列表接口才是裸数组
    items），必须先解包；否则 latest_version 永远取不到、正文恒为空。
    """
    config = _require_config(db)
    payload = await _get_json(config, f"/api/prompt-repo/prompts/{prompt_id}")
    if not isinstance(payload, dict):
        raise BifrostError("Bifrost 返回了非预期的提示词数据")
    prompt = payload.get("prompt") or payload
    if not isinstance(prompt, dict):
        raise BifrostError("Bifrost 返回了非预期的提示词数据")
    previews = _preview_map(db, [prompt_id])
    return _compact_prompt(prompt, previews.get(prompt_id))
