"""Bifrost Prompt Repository 代理服务。

Bifrost Management API（所有 `/api/prompt-repo/*`）使用
`Authorization: Bearer <Management API Key>` 鉴权。Key 只存于系统设置
（admin/settings，列表接口只返回掩码），所有请求经后端代理转发，
绝不暴露给画布前端。

预览图：Bifrost 官方数据无图片字段，预览图由本系统本地存储
（backend/static/prompt-previews + prompt_metadata 表），列表/详情接口合并返回。
"""
import base64
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

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
    config: BifrostAuthConfig, path: str, params: Optional[Dict[str, Any]] = None
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
        return resp.json()
    except ValueError:
        raise BifrostError("Bifrost 返回了非 JSON 响应")


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
            if isinstance(seg, dict):
                text = seg.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
        return "\n".join(parts)
    return ""


def _extract_prompt_text(prompt: Dict[str, Any]) -> str:
    """从 prompt 的 latest_version.messages 提取可读文本（多段用空行拼接）。

    官方结构：messages: [{"id": 1, "order_index": 0, "message": {...}}]。
    兼容 message 直接携带 content 的形态。
    """
    latest = prompt.get("latest_version") or {}
    if not isinstance(latest, dict):
        return ""
    messages = latest.get("messages") or []
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
    latest = prompt.get("latest_version") or {}
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
        "version_number": (
            latest.get("version_number") if isinstance(latest, dict) else None
        ),
        "commit_message": (
            (latest.get("commit_message") or "") if isinstance(latest, dict) else ""
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


async def get_prompt(db, prompt_id: str) -> Dict[str, Any]:
    """获取单个提示词详情（含提取的正文文本 + 本地预览图）。"""
    config = _require_config(db)
    payload = await _get_json(config, f"/api/prompt-repo/prompts/{prompt_id}")
    if not isinstance(payload, dict):
        raise BifrostError("Bifrost 返回了非预期的提示词数据")
    previews = _preview_map(db, [prompt_id])
    return _compact_prompt(payload, previews.get(prompt_id))
