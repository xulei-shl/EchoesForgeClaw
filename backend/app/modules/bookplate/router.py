import asyncio
import base64
import binascii
import hashlib
import json
import logging
import random
import re
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional
from urllib.parse import urlparse, quote

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .douban_client import (
    DoubanIsbnClient,
    ClientConfig,
    USER_AGENTS,
    AsyncRateLimiter,
    COVER_REFERERS,
)
from app.core.database import get_db, SessionLocal
from app.core.config import settings
from app.core.deps import get_current_active_user, get_current_admin_user
from app.models.user import User
from app.models.node_config import NodeConfig
from app.models.app_setting import AppSetting
from app.models.fastclaw_agent_config import FastClawAgentConfig
from app.models.skill_agent_config import SkillAgentConfig
from app.models.book_cache import BookCache
from app.modules.bookplate.node_types import (
    NODE_TEMPLATES,
    NODE_IMAGE_ANALYSIS,
    NODE_PROMPT,
    NODE_IMAGE,
    NODE_CHAT,
)
from app.services.llm_service import (
    llm_service,
    TextModelConfig,
    VisionModelConfig,
    LLMGenerationError,
    _multimodal_messages,
)
from app.services.image_service import image_service, ImageModelConfig, ImageGenerationError
from app.services.fastclaw_service import (
    fastclaw_agent_service,
    FastClawRuntimeConfig,
    FastClawAgentError,
    extract_image_url,
)
from app.services.skill_agent_service import (
    run_skill_agent,
    SkillRuntimeConfig,
    SkillAgentError,
    SkillValidationError,
    list_installed_skills,
    install_skill_zip,
    install_user_skill_zip,
    register_existing_bifrost_skill,
    resolve_skill_abs,
    skills_dir,
    node_workspace,
    prepare_runtime_workspace,
)
from sse_starlette.sse import EventSourceResponse

router = APIRouter(prefix="/api/modules/bookplate", tags=["bookplate"])

logger = logging.getLogger(__name__)

# 豆瓣封面本地缓存目录: backend/static/covers（复用 main.py 的 /static 挂载，无需额外配置）
COVERS_DIR = Path(__file__).resolve().parents[3] / "static" / "covers"
COVERS_PREFIX = "/static/covers"

# 上传图片的体积上限（字节）。8MB 足以覆盖普通参考图，
# 防止超大 base64 请求体拖垮分析与网络传输。
MAX_UPLOAD_IMAGE_BYTES = 8 * 1024 * 1024

# 图片魔数前缀 → 扩展名（用于校验下载内容确为图片，防止把反爬挑战页存成 .jpg）
_IMAGE_MAGIC_PREFIXES = (
    (b"\xff\xd8\xff", ".jpg"),
    (b"\x89PNG\r\n\x1a\n", ".png"),
    (b"GIF87a", ".gif"),
    (b"GIF89a", ".gif"),
)

# 封面下载默认限流器：/cover 独立调用、画廊多图并发加载时共用，控制整体请求节奏。
# 固定取保守值 qps=0.5（与系统设置默认一致）；/isbn 内则按 douban.qps 设置构建共享限流器。
_cover_default_limiter = AsyncRateLimiter(max_concurrent=2, qps=0.5)

# BookCache 行 → 与 map_book_payload 输出一致的历史字段白名单（不落库的运行时字段除外）
_BOOK_CACHE_FIELDS = (
    "title",
    "subtitle",
    "original_title",
    "author",
    "translator",
    "publisher",
    "producer",
    "pub_year",
    "pages",
    "price",
    "binding",
    "series",
    "series_link",
    "rating",
    "rating_count",
    "cover_image",
    "cover_image_local",
    "summary",
    "author_intro",
    "catalog",
    "url",
)


def _row_to_book(row: BookCache) -> Dict[str, Any]:
    """把 BookCache 行还原为与豆瓣客户端一致的扁平元数据 dict."""
    return {k: getattr(row, k) for k in _BOOK_CACHE_FIELDS}


def _apply_book_to_row(row: BookCache, book: Dict[str, Any]) -> BookCache:
    """把豆瓣元数据写入 BookCache 行（仅覆盖白名单字段，保留 isbn/时间戳由 ORM 维护）."""
    for k in _BOOK_CACHE_FIELDS:
        val = book.get(k)
        if val is None or val == "":
            # 数值字段用零值兜底，避免 SQLAlchemy 拒绝空字符串
            val = 0.0 if k == "rating" else (0 if k == "rating_count" else "")
        setattr(row, k, val)
    return row


async def _background_cover_task(
    isbn: str,
    cover_image: str,
    proxy: str,
) -> None:
    """后台任务：下载豆瓣封面到本地缓存并回写 book_cache.cover_image_local.

    在 FastAPI BackgroundTasks 中运行，使用独立数据库会话（请求结束时
    请求级 session 已关闭）。下载失败或非 doubanio.com 域名时静默跳过，
    不阻塞检索响应；下次命中该 ISBN 时会再次尝试补图。
    """
    local = await _download_douban_cover(cover_image, proxy=proxy)
    if not local:
        return
    db = SessionLocal()
    try:
        row = db.query(BookCache).filter(BookCache.isbn == isbn).first()
        if row and row.cover_image_local != local:
            row.cover_image_local = local
            db.commit()
    finally:
        db.close()


def _local_cover_missing(row: BookCache) -> bool:
    """cover_image_local 记录的本地文件是否已失效（不存在即视为缺失）."""
    if not row.cover_image_local:
        return True
    filename = row.cover_image_local.split("/")[-1]
    return not (COVERS_DIR / filename).is_file()


def _cached_cover_url(url: str) -> Optional[str]:
    """查询本地缓存中是否已有该封面的有效图片；命中返回本地 URL，否则 None.

    校验文件头魔数，损坏文件（旧版可能存了挑战页）会被删除。
    """
    parsed = urlparse(url)
    if not parsed.netloc.endswith(".doubanio.com"):
        return None

    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]
    if COVERS_DIR.is_dir():
        for cached in COVERS_DIR.glob(f"{digest}.*"):
            try:
                with cached.open("rb") as f:
                    head = f.read(12)
            except OSError:
                head = b""
            if _detect_image_ext(head):
                return f"{COVERS_PREFIX}/{cached.name}"
            cached.unlink(missing_ok=True)
    return None


def _detect_image_ext(content: bytes) -> Optional[str]:
    """通过文件头魔数判断字节是否为真实图片；是则返回扩展名，否则 None."""
    if not content:
        return None
    for magic, ext in _IMAGE_MAGIC_PREFIXES:
        if content.startswith(magic):
            return ext
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return ".webp"
    return None


async def _download_douban_cover(
    url: str,
    proxy: str = "",
    is_disconnected: Optional[Callable[[], Awaitable[bool]]] = None,
) -> Optional[str]:
    """将豆瓣封面下载到本地缓存并返回本地 URL；失败返回 None.

    豆瓣图片 CDN 有 Referer 防盗链（非豆瓣 Referer 直接 403），且 <img> 标签
    无法携带 Authorization 头，因此统一由后端携带 Referer 下载一次并缓存到
    backend/static/covers，前端从 /static/covers/... 直接加载，无需鉴权头。

    注意：豆瓣 CDN 触发反爬时返回「HTTP 200 + JS 挑战页」（内容为 <script>），
    仅凭状态码无法识别。因此必须校验文件头魔数：命中挑战页则轮换 Referer、
    短暂等待后重试；校验失败的旧缓存（此前可能存入了挑战页）会被删除重下。

    限流：所有封面下载共用模块级默认限流器（画廊多图并发加载时统一节奏）；
    proxy 沿用系统设置的豆瓣代理。
    """
    parsed = urlparse(url)
    if not parsed.netloc.endswith(".doubanio.com"):
        return None

    # 以豆瓣 URL 摘要作为缓存文件名，同一封面只会下载一次；命中缓存直接返回
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]
    cached = _cached_cover_url(url)
    if cached:
        return cached

    import httpx

    # 可选参数 is_disconnected：客户端断开检查回调（如 starlette 的 request.is_disconnected）。
    # 在每次（重）试前检查：客户端已断开则停止下载，释放共享封面限流器槽位给其他用户。
    # 注意：正在进行的下载仍会完成并写入缓存（对未来用户有益），不会在此处被丢弃。
    for attempt in range(3):
        if is_disconnected is not None and await is_disconnected():
            return None
        headers = {
            "Referer": COVER_REFERERS[attempt % len(COVER_REFERERS)],
            "User-Agent": random.choice(USER_AGENTS),
        }
        try:
            # 跟随重定向：豆瓣 CDN 偶尔返回 301/302，不跟随会误判为失败
            async with _cover_default_limiter:
                async with httpx.AsyncClient(
                    timeout=10.0, follow_redirects=True, proxy=proxy or None
                ) as client:
                    resp = await client.get(url, headers=headers)
        except httpx.HTTPError:
            # 网络异常（超时/断连）也短暂等待后重试
            resp = None

        if resp is not None and resp.status_code == 200:
            ext = _detect_image_ext(resp.content)
            if ext:
                # 尺寸保护：/cover 为公开接口，拒绝异常大文件防止磁盘被填满
                if len(resp.content) > 5 * 1024 * 1024:
                    return None
                filename = f"{digest}{ext}"
                COVERS_DIR.mkdir(parents=True, exist_ok=True)
                await asyncio.to_thread((COVERS_DIR / filename).write_bytes, resp.content)
                return f"{COVERS_PREFIX}/{filename}"
            # 200 但非图片（JS 反爬挑战页）：轮换 Referer + 延迟后重试
        elif resp is not None and resp.status_code == 404:
            return None

        # 最后一次尝试后不再等待
        if attempt < 2:
            await asyncio.sleep(1.0 + attempt)

    return None


async def _fetch_cover_bytes(
    url: str,
    proxy: str = "",
    is_disconnected: Optional[Callable[[], Awaitable[bool]]] = None,
) -> Optional[bytes]:
    """返回封面图片原始字节（用于多模态分析），失败返回 None.

    优先从本地缓存 `static/covers/` 读取（前端经 /cover 展示封面时已下载过则直接命中）；
    缓存未命中时复用 `_download_douban_cover`（Referer 轮换重试 + 魔数校验 + 写缓存），
    与 /cover 代理路径同等可靠，避免单次直连被豆瓣反爬拒掉后分析静默降级。
    """
    parsed = urlparse(url)
    if not parsed.netloc.endswith(".doubanio.com"):
        return None

    # 优先读本地缓存
    cached = _cached_cover_url(url)
    if cached:
        filename = cached.split("/")[-1]  # /static/covers/abc123.jpg → abc123.jpg
        try:
            return await asyncio.to_thread((COVERS_DIR / filename).read_bytes)
        except OSError:
            pass  # 文件异常，回退到重新下载

    # 缓存未命中：复用封面下载器（含重试/Referer 轮换），下载成功后再读回字节
    local = await _download_douban_cover(
        url, proxy=proxy, is_disconnected=is_disconnected
    )
    if not local:
        return None
    filename = local.split("/")[-1]
    try:
        return await asyncio.to_thread((COVERS_DIR / filename).read_bytes)
    except OSError:
        return None


class AnalyzeImageRequest(BaseModel):
    """图片分析节点请求：上传参考图（base64 data URL）或豆瓣封面 URL 二选一。"""

    image: Optional[str] = None
    cover_url: Optional[str] = None
    # 节点配置 id（可选）：未绑定/未启用/类型不匹配时回退环境变量
    config_id: Optional[int] = None
    # 画布节点 id：Agent 模式下用作 FastClaw 会话 key 的一部分（同节点重试共享上下文）
    node_id: Optional[str] = None


class PromptRequest(BaseModel):
    """提示词生成节点请求：图书元数据 + 可选的上游图片分析文本。"""

    metadata: Dict[str, Any] = {}
    analysis: Optional[str] = None
    # 上游「文本」节点内容（可选）：随元数据一起注入提示词上下文
    text: Optional[str] = None
    # 节点配置 id（可选）：未绑定/未启用/类型不匹配时回退环境变量
    config_id: Optional[int] = None
    # 画布节点 id：Agent 模式下用作 FastClaw 会话 key 的一部分（同节点重试共享上下文）
    node_id: Optional[str] = None


class ImageGenRequest(BaseModel):
    """图像生成节点请求。"""

    prompt: str
    size: Optional[str] = None
    ratio: Optional[str] = None
    image: Optional[List[str]] = None
    # 节点配置 id（可选）：未绑定/未启用/类型不匹配时回退环境变量
    config_id: Optional[int] = None
    # 画布节点 id：Agent 模式下用作 FastClaw 会话 key 的一部分
    node_id: Optional[str] = None


class CalendarRequest(BaseModel):
    """万年历节点请求：查询指定日期的节假日 / 农历万年历（缺省今天）。"""

    date: Optional[str] = None


class WeatherRequest(BaseModel):
    """天气查询节点请求：查询指定城市当前天气（缺省按 IP 自动定位）。"""

    city: Optional[str] = None


class SaveImageRequest(BaseModel):
    """地图海报等客户端渲染图片的落盘请求：base64 data URL → 本地静态文件。"""

    image: str


class ChatRequest(BaseModel):
    """AI 对话节点请求：多轮对话。

    - messages: OpenAI 格式完整消息历史（LLM 模式，含本轮 user 消息；不含 system）
    - message: 本轮用户消息文本（Agent 模式；FastClaw 以 session key 服务端维护多轮历史）
    - images: 本轮携带的图片（data URL，可为空）。LLM 模式随 user 消息构造多模态
      content；Agent 模式经 imageUrls 传给 FastClaw（物化到 workspace 供视觉模型使用）
    """

    messages: List[Dict[str, Any]] = []
    message: str = ""
    images: List[str] = []
    # 节点配置 id（可选）：未绑定/未启用/类型不匹配时回退环境变量
    config_id: Optional[int] = None
    # 画布节点 id：Agent 模式下用作 FastClaw 会话 key 的一部分（同节点多轮共享上下文）
    node_id: Optional[str] = None
    # 对话纪元：清空对话后递增，让 FastClaw 服务端会话随之重置（多轮语义正确性）
    epoch: int = 0
    # Skill Agent 模式：上游「Skill 检索」节点选中的 skill 名称列表；
    # 非空时仅加载这些 skill（空 = 加载该用户工作区全部已安装 skill）
    skills: List[str] = []
    # Skill Agent 模式：节点工作区标识（前端首轮生成的 {node_id}_{timestamp}，持久化在
    # node.data.workspaceId）。同节点同 workspaceId 多轮复用同一工作区（产物跨轮保留）；
    # 清空对话后前端重新生成 -> 干净工作区。缺省回退 node_id 派生（兼容旧前端）。
    workspace_id: Optional[str] = None


def _decode_uploaded_image(data_url: str) -> Optional[bytes]:
    """解析前端上传图片的 base64 data URL，返回原始图片字节。

    非法 base64 / 非图片魔数 / 超过体积上限时返回 None，由调用方跳过分析，
    仅基于图书元数据生成提示词，不阻断整个流程。
    """
    try:
        meta, _, b64 = data_url.partition(",")
        if "image/" not in meta or not b64:
            return None
        image_bytes = base64.b64decode(b64, validate=False)
    except (ValueError, binascii.Error):
        return None
    if not image_bytes or len(image_bytes) > MAX_UPLOAD_IMAGE_BYTES:
        return None
    if not _detect_image_ext(image_bytes[:12]):
        return None
    return image_bytes


# ---------------------------------------------------------------------------
# 节点配置 → 运行时配置解析（按节点实例的 config_id 解析，而非全局阶段）
# ---------------------------------------------------------------------------


def _resolve_node_config(
    db: Session, config_id: Optional[int], node_type: str
) -> Optional[NodeConfig]:
    """按 config_id 解析指定节点模板类型的配置；未传/不存在/类型不符/未启用时返回 None。"""
    if config_id is None:
        return None
    nc = db.query(NodeConfig).filter(NodeConfig.id == config_id).first()
    if not nc or nc.node_type != node_type or not nc.is_active:
        return None
    return nc


def _text_config_from(nc: Optional[NodeConfig]) -> Optional[TextModelConfig]:
    """从节点配置解析文本模型运行时配置（未绑定则 None，由调用方回退环境变量）。"""
    if not nc or not nc.llm_config or not nc.llm_config.api_key or not nc.llm_config.is_active:
        return None
    system_prompt = nc.prompt.content if nc.prompt and nc.prompt.is_active else ""
    return TextModelConfig(
        api_key=nc.llm_config.api_key,
        base_url=nc.llm_config.base_url or "",
        model_name=nc.llm_config.model_name or "gpt-3.5-turbo",
        system_prompt=system_prompt,
    )


def _vision_config_from(nc: Optional[NodeConfig]) -> Optional[VisionModelConfig]:
    """从节点配置解析多模态模型运行时配置（未绑定则 None）。"""
    if not nc or not nc.llm_config or not nc.llm_config.api_key or not nc.llm_config.is_active:
        return None
    system_prompt = nc.prompt.content if nc.prompt and nc.prompt.is_active else ""
    return VisionModelConfig(
        api_key=nc.llm_config.api_key,
        base_url=nc.llm_config.base_url or "",
        model_name=nc.llm_config.model_name or "gpt-4o-mini",
        system_prompt=system_prompt,
    )


def _image_config_from(nc: Optional[NodeConfig]) -> Optional[ImageModelConfig]:
    """从节点配置解析图片模型运行时配置（未绑定则 None）。

    仅返回模型三要素（api_key / base_url / model_name），其余图像参数
    （size / ratio / response_format / image）由请求体按次传入。
    """
    if not nc or not nc.llm_config or not nc.llm_config.api_key or not nc.llm_config.is_active:
        return None
    return ImageModelConfig(
        api_key=nc.llm_config.api_key,
        base_url=nc.llm_config.base_url or "",
        model_name=nc.llm_config.model_name or "",
    )


def _agent_config_from(
    nc: Optional[NodeConfig], user_id: int
) -> Optional[FastClawRuntimeConfig]:
    """从节点配置解析 FastClaw Agent 运行时配置（未绑定/未启用/无 Key 则 None）。"""
    if (
        not nc
        or not nc.agent_config
        or not nc.agent_config.is_active
        or not nc.agent_config.api_key
    ):
        return None
    return FastClawRuntimeConfig(
        base_url=nc.agent_config.base_url or "",
        api_key=nc.agent_config.api_key,
        agent_id=nc.agent_config.agent_id or "",
        end_user=f"bookplate-{user_id}",
    )


def _skill_agent_config_from(
    nc: Optional[NodeConfig], user_id: int
) -> Optional[SkillRuntimeConfig]:
    """从节点配置解析 Skill Agent 运行时配置（未绑定/未启用/无 Key 则 None）。

    模型接入参数（base_url / api_key / model_name）优先来自引用的「模型配置」
    （llm_config_id），系统提示词来自引用的「提示词模板」（prompt_id）；
    引用缺失时回退旧字段（存量数据兼容）。
    """
    if not nc or not nc.skill_agent_config or not nc.skill_agent_config.is_active:
        return None
    sac = nc.skill_agent_config
    llm = sac.llm_config
    if llm and llm.is_active and llm.api_key:
        base_url = llm.base_url or ""
        api_key = llm.api_key
        model_name = llm.model_name or ""
        system_prompt = sac.prompt.content if sac.prompt and sac.prompt.is_active else ""
    elif sac.api_key:
        # 旧字段回退（存量配置未引用模型配置时）
        base_url = sac.base_url or ""
        api_key = sac.api_key
        model_name = sac.model_name or ""
        system_prompt = sac.system_prompt or ""
    else:
        return None
    return SkillRuntimeConfig(
        base_url=base_url,
        api_key=api_key,
        model_name=model_name,
        system_prompt=system_prompt,
        user_id=user_id,
        agent_id=nc.skill_agent_config.id,
    )


def _agent_session_key(
    user_id: int, node_id: Optional[str], epoch: int = 0
) -> str:
    """构造确定性的 FastClaw 会话 key：同一用户同一节点重试共享上下文。

    epoch 为对话纪元：AI 对话节点清空对话时递增，使 FastClaw 服务端会话
    （历史轮次）一并重置，保证「清空后首轮重新注入上下文」真正生效。
    """
    return f"bookplate-{user_id}-{node_id or 'anon'}-{epoch}"


def _sse_from_agent_event(
    evt: Dict[str, Any], content_event: str = "prompt"
) -> Optional[Dict[str, str]]:
    """把归一化的 agent 事件映射为 SSE 事件（中间步骤透传给前端展示）。

    content/content_delta 统一映射为 content_event（默认 prompt；AI 对话节点传
    "message"）：run_agent 已对「流式增量 + 末尾完整文本」去重，能到达这里的
    content 说明本轮未流式（非流式 provider），直接作为完整文本透传。
    """
    etype = evt.get("type", "")
    data = evt.get("data", {}) or {}
    if etype in ("content_delta", "content"):
        return {"event": content_event, "data": data.get("delta", "")}
    if etype == "reasoning_delta":
        # 模型思考过程（Skill Agent 的 reasoning 增量）：独立事件，前端折叠展示、不混入正文
        return {"event": "reasoning", "data": data.get("delta", "")}
    if etype == "tool_call":
        return {
            "event": "agent_tool_call",
            "data": json.dumps({"id": data.get("id", ""), "name": data.get("name", ""), "arguments": data.get("arguments", "")}, ensure_ascii=False),
        }
    if etype == "tool_result":
        return {
            "event": "agent_tool_result",
            "data": json.dumps({"id": data.get("id", ""), "name": data.get("name", ""), "result": data.get("result", "")}, ensure_ascii=False),
        }
    if etype == "status":
        return {"event": "agent_status", "data": json.dumps({"message": data.get("message", "")}, ensure_ascii=False)}
    if etype == "subagent_progress":
        return {"event": "agent_status", "data": json.dumps({"message": "子任务: " + str(data.get("phase", ""))}, ensure_ascii=False)}
    if etype == "error":
        return {"event": "error", "data": data.get("message", "Agent 执行失败")}
    return None


def _agent_prompt_message(
    metadata: Dict[str, Any], analysis: str = "", text: str = ""
) -> str:
    """把图书元数据 + 可选图片分析文本 + 可选文本节点内容组装为 Agent 模式的用户消息。

    Agent 只接收文本（元数据 + 图片分析结果 + 文本节点内容），不传图片——模型服务商
    需回源下载图片，本机/内网 URL 会被其 SSRF 防护拒绝（报 port not allowed）。
    """
    lines = []
    for k, v in metadata.items():
        if k in ("cover_image", "cover_image_local", "coverUrl", "image_url", "image_url_local"):
            continue
        lines.append(f"{k}: {v}")
    meta_text = "\n".join(lines) if lines else str(metadata)
    message = meta_text
    if analysis:
        message += "\n\n图片分析结果：\n" + analysis
    if text:
        message += "\n\n文本节点内容：\n" + text
    return message


def _douban_client_config(db: Session) -> ClientConfig:
    """按系统设置组装豆瓣客户端配置（代理 / 基础地址 / 速率）。"""
    settings_map = {
        s.key: s.value for s in db.query(AppSetting).all()
    }
    config = ClientConfig()
    if settings_map.get("douban.base_url"):
        config.base_url = settings_map["douban.base_url"]
    if settings_map.get("douban.proxy"):
        config.proxy = settings_map["douban.proxy"]
    try:
        qps = float(settings_map.get("douban.qps", "0.5"))
        if qps > 0:
            config.qps = min(qps, 2.0)  # 上限保护，防止管理员误设过高触发反爬
    except (TypeError, ValueError):
        pass
    return config


@router.get("/cover")
async def proxy_cover(
    url: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """代理豆瓣封面：首次下载缓存到本地，之后 302 重定向到本地静态文件.

    该接口必须公开（不要求登录）：<img> 标签无法携带 Authorization 头，
    若仍要求 Bearer 鉴权，封面将始终 401 无法显示。仅允许 doubanio.com
    域名，SSRF 面受控。限流走模块级默认限流器，代理沿用系统设置。
    """
    parsed = urlparse(url)
    if not parsed.netloc.endswith(".doubanio.com"):
        raise HTTPException(status_code=400, detail="Only douban image URLs are allowed")

    # 命中缓存直接重定向，避免每次请求（含画廊大量缩略图）都查询数据库配置
    cached = _cached_cover_url(url)
    if cached:
        return RedirectResponse(cached)

    config = _douban_client_config(db)
    # 透传 is_disconnected：客户端已断开则停止下载与重试（释放共享限流器），
    # 正在飞行的下载仍会完成并写入缓存，不影响后续用户命中缓存
    local = await _download_douban_cover(
        url, proxy=config.proxy, is_disconnected=request.is_disconnected
    )
    if local:
        return RedirectResponse(local)
    raise HTTPException(status_code=502, detail="Failed to fetch cover image")


@router.get("/isbn/{isbn}")
async def get_book_by_isbn(
    isbn: str,
    request: Request,
    background_tasks: BackgroundTasks,
    force: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """按 ISBN 获取图书元数据，内置 book_cache 持久化缓存。

    - 非 force：先查 book_cache，命中直接读库返回（减少豆瓣 API 请求与限流/反爬风险）。
      缓存封面缺失时，后台任务补图并回写 cover_image_local，同时用代理 URL 兜底展示。
    - 未命中或 force：调用豆瓣 API，成功后写库（isbn 唯一约束 + IntegrityError 兜底，
      避免并发检索重复写入；force 覆盖更新同一条），封面经后台任务异步下载补图。

    客户端已断开（删除节点 / 清空画布 / 关闭页面）时不发起豆瓣抓取，直接放弃。
    豆瓣为免费只读接口，预检查覆盖「尚未开始抓取」的窗口即可，不值得为中途取消改造抓取循环。
    """
    if await request.is_disconnected():
        raise HTTPException(status_code=499, detail="客户端已断开连接")
    client_config = _douban_client_config(db)
    proxy = client_config.proxy

    # 非强制更新：先查库，命中即返回缓存
    if not force:
        row = db.query(BookCache).filter(BookCache.isbn == isbn).first()
        if row:
            book = _row_to_book(row)
            book["isbn"] = isbn
            if book.get("cover_image") and _local_cover_missing(row):
                # 本地封面缺失：先用代理 URL 兜底展示，同时后台补图回写静态路径
                book["cover_image_local"] = (
                    str(request.url_for("proxy_cover")) + "?url=" + quote(book["cover_image"])
                )
                background_tasks.add_task(
                    _background_cover_task, isbn, book["cover_image"], proxy
                )
            return book

    # 未命中缓存或强制更新：调用豆瓣 API
    async with DoubanIsbnClient(client_config) as client:
        book = await client.fetch(isbn)
        if not book:
            raise HTTPException(status_code=404, detail="Book not found")

    # 写库：force 覆盖更新；否则以唯一 isbn 查重插入（并发时 IntegrityError 兜底）。
    # cover_image_local 保持空，由后台任务下载成功后回写静态路径。
    existing = db.query(BookCache).filter(BookCache.isbn == isbn).first()
    if existing:
        _apply_book_to_row(existing, book)
        row = existing
        db.commit()
    else:
        row = BookCache(isbn=isbn)
        _apply_book_to_row(row, book)
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            # 并发写入同一 isbn：放弃本次插入，采用已存在的行
            db.rollback()
            row = db.query(BookCache).filter(BookCache.isbn == isbn).first()
            if row is None:
                raise HTTPException(status_code=500, detail="Failed to cache book info")

    # 返回给前端：cover_image_local 用代理 URL 以立即展示封面（豆瓣图带防盗链不可直连）
    if book.get("cover_image"):
        book["cover_image_local"] = (
            str(request.url_for("proxy_cover")) + "?url=" + quote(book["cover_image"])
        )
        background_tasks.add_task(
            _background_cover_task, isbn, book["cover_image"], proxy
        )
    book["isbn"] = isbn
    return book


@router.get("/fastclaw-probe")
async def probe_fastclaw_agents(
    base_url: str = "",
    api_key: str = "",
    config_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """探测 FastClaw：列出该 API Key 可访问的 agent（admin 配置页「拉取」用）。

    - 新建场景：传 base_url + api_key；
    - 编辑场景：api_key 留空（前端拿不到已保存的 Key）时传 config_id，
      服务端用库中保存的 base_url/api_key 探测；显式传入的 base_url/api_key 优先。

    该接口会以调用者提供的 base_url/api_key 向任意地址发起服务端请求，
    存在 SSRF 面，因此仅允许 admin 调用。api_key 经 query 参数传递，
    仅用于服务端立即探测，不落库不回传。

    注意：探测**不能**带 X-Fastclaw-End-User 头（end_user 留空）。FastClaw
    对带该头的 api_key 请求会 SwitchToAppUser 切到懒创建的 app-user 空间，
    其 UserSpace 没有任何 Agent，列表必然为空——无论 Key 是
    admin/user/agent 类型。列表现只由 API Key 自身作用域决定：
    admin/user 列所属账号的 Agent，agent 类型只列 ACL 绑定的 Agent。

    名字来源：优先走 dashboard `GET /api/agents`（返回 AgentRecord 的真实
    name）；上游 `/v1/agents` 的 name 字段与 id 相同，仅作兼容回退。
    """
    if not api_key and config_id is not None:
        cfg = db.query(FastClawAgentConfig).filter(FastClawAgentConfig.id == config_id).first()
        if not cfg:
            raise HTTPException(status_code=404, detail="Agent 配置不存在")
        if not base_url:
            base_url = cfg.base_url
        api_key = cfg.api_key
    if not base_url or not api_key:
        raise HTTPException(status_code=400, detail="请填写 Base URL 与 API Key")
    try:
        agents = await fastclaw_agent_service.list_agents(
            base_url=base_url,
            api_key=api_key,
        )
    except FastClawAgentError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return {"agents": agents}


@router.get("/node-registry")
async def get_node_registry(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """返回画板可用节点列表：内置节点模板 + 各模板的已启用配置（节点变体）。

    画板「+」菜单据此渲染：基础节点（不可配置模板）直接可用；
    可配置模板的每条启用配置作为一个节点变体；无配置时由前端提供「默认配置」项（回退环境变量）。
    """
    configs = db.query(NodeConfig).order_by(NodeConfig.id.asc()).all()
    items = []
    for nc in configs:
        if not nc.is_active or nc.node_type not in {t["type"] for t in NODE_TEMPLATES}:
            continue
        if _skill_agent_config_from(nc, current_user.id):
            mode = "skill_agent"
        elif _agent_config_from(nc, current_user.id):
            mode = "agent"
        else:
            mode = "llm"
        items.append(
            {
                "id": nc.id,
                "node_type": nc.node_type,
                "name": nc.name,
                "group": nc.group,
                "group_order": nc.group_order,
                "mode": mode,
                "agent_name": (
                    nc.agent_config.agent_name or nc.agent_config.name
                    if nc.agent_config
                    else None
                ),
                "skill_agent_config_name": (
                    nc.skill_agent_config.name if nc.skill_agent_config else None
                ),
                "llm_config_name": nc.llm_config.name if nc.llm_config else None,
                "is_active": nc.is_active,
            }
        )
    return {"templates": NODE_TEMPLATES, "configs": items}


@router.post("/analyze-image")
async def analyze_image(
    request: Request,
    payload: AnalyzeImageRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """图片分析节点：多模态分析图片，SSE 返回分析文本（LLM 模式）或 agent 中间步骤 + 分析文本。

    执行模式由该节点的节点配置决定（agent_config 非空 => Agent 模式；否则看 LLM 配置；
    未绑定任何配置时回退环境变量 / Mock）。图片来源：上传 base64（优先）> 豆瓣封面 URL。
    """
    nc = _resolve_node_config(db, payload.config_id, NODE_IMAGE_ANALYSIS)
    agent_config = _agent_config_from(nc, current_user.id)
    vision_config = _vision_config_from(nc)

    if await request.is_disconnected():
        raise HTTPException(status_code=499, detail="客户端已断开连接")

    # 图片来源：上传 base64 data URL > 豆瓣封面 URL
    image_bytes: Optional[bytes] = None
    if payload.image:
        image_bytes = _decode_uploaded_image(payload.image)
    elif payload.cover_url:
        proxy = _douban_client_config(db).proxy
        image_bytes = await _fetch_cover_bytes(
            payload.cover_url, proxy, is_disconnected=request.is_disconnected
        )
    if not image_bytes:
        raise HTTPException(status_code=400, detail="未提供可分析的图片（上传或封面 URL 均无效）")

    ext = _detect_image_ext(image_bytes[:12]) or "jpg"
    data_url = f"data:image/{ext};base64," + base64.b64encode(image_bytes).decode("ascii")

    if agent_config:
        session_key = _agent_session_key(current_user.id, payload.node_id)

        async def agent_generator():
            text_parts: List[str] = []
            try:
                async for evt in fastclaw_agent_service.run_agent(
                    agent_config,
                    "",
                    session_key=session_key,
                    images=[data_url],
                    params={"module": "bookplate", "node_type": NODE_IMAGE_ANALYSIS},
                ):
                    if await request.is_disconnected():
                        break
                    sse = _sse_from_agent_event(evt)
                    if not sse:
                        continue
                    if sse["event"] == "prompt":
                        text_parts.append(sse["data"])
                        continue
                    yield sse
                text = "".join(text_parts).strip()
                if text and not await request.is_disconnected():
                    yield {"event": "analysis", "data": text}
            except FastClawAgentError as exc:
                if not await request.is_disconnected():
                    yield {"event": "error", "data": str(exc)}

        return EventSourceResponse(agent_generator())

    async def llm_generator():
        try:
            analysis = await llm_service.analyze_cover(image_bytes, vision_config)
            if analysis and not await request.is_disconnected():
                yield {"event": "analysis", "data": analysis}
        except LLMGenerationError as exc:
            if not await request.is_disconnected():
                yield {"event": "error", "data": str(exc)}

    return EventSourceResponse(llm_generator())


@router.post("/generate-prompt")
async def generate_prompt(
    request: Request,
    payload: PromptRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """提示词生成节点：基于图书元数据 + 上游图片分析文本流式生成提示词。

    **执行模式（LLM API / FastClaw Agent）完全由该节点的节点配置决定，代码不写死：**
    - 绑定 Agent：把「元数据 + 图片分析文本」交给 Agent 流式生成（**不传图片**——
      模型服务商需回源下载图片，本机/内网 URL 会被其 SSRF 防护拒绝，报 "port not allowed"）；
    - 绑定模型：走 LLM API 流式生成；
    - 未绑定配置：回退环境变量 / Mock。
    客户端在开流前断开（删除节点 / 超时放弃 / 关闭页面）时直接返回，不做无谓调用。
    """
    metadata = payload.metadata or {}
    analysis = payload.analysis or ""
    text = payload.text or ""
    nc = _resolve_node_config(db, payload.config_id, NODE_PROMPT)
    agent_config = _agent_config_from(nc, current_user.id)
    text_config = _text_config_from(nc)

    if await request.is_disconnected():
        raise HTTPException(status_code=499, detail="客户端已断开连接")

    if agent_config:
        session_key = _agent_session_key(current_user.id, payload.node_id)

        async def agent_event_generator():
            try:
                async for evt in fastclaw_agent_service.run_agent(
                    agent_config,
                    _agent_prompt_message(metadata, analysis, text),
                    session_key=session_key,
                    params={"module": "bookplate", "node_type": NODE_PROMPT},
                ):
                    if await request.is_disconnected():
                        break
                    sse = _sse_from_agent_event(evt)
                    if sse:
                        yield sse
            except FastClawAgentError as exc:
                if not await request.is_disconnected():
                    yield {"event": "error", "data": str(exc)}

        return EventSourceResponse(agent_event_generator())

    async def event_generator():
        try:
            async for chunk in llm_service.generate_prompt_stream(
                metadata, text_config, analysis, text
            ):
                if await request.is_disconnected():
                    break
                yield {"event": "prompt", "data": chunk}
        except LLMGenerationError as exc:
            # 流式生成失败：发独立 error 事件，前端切换到错误态（重试横幅），
            # 不再把错误文本当提示词内容注入
            if not await request.is_disconnected():
                yield {"event": "error", "data": str(exc)}

    return EventSourceResponse(event_generator())


@router.post("/chat")
async def chat(
    request: Request,
    payload: ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """AI 对话节点：多轮对话，SSE 流式返回助手回复。

    执行模式由该节点的节点配置决定：
    - 绑定 Skill Agent：openai-agents-python 多步执行（skill 工具调用），
      流式透传 content_delta（映射为 message 事件）+ 中间步骤 + agent_file 事件；
    - 绑定 FastClaw Agent：以 node_id 派生确定性会话 key，交给 FastClaw 服务端维护多轮历史，
      流式透传 content_delta（映射为 message 事件）+ 中间步骤（工具调用/状态）；
    - 绑定模型：多轮流式调用 LLM（messages 数组，system 提示词来自绑定的提示词模板）；
    - 未绑定配置：回退环境变量 / Mock。
    """
    nc = _resolve_node_config(db, payload.config_id, NODE_CHAT)
    skill_agent_config = _skill_agent_config_from(nc, current_user.id)
    agent_config = _agent_config_from(nc, current_user.id)
    text_config = _text_config_from(nc)

    if await request.is_disconnected():
        raise HTTPException(status_code=499, detail="客户端已断开连接")

    if skill_agent_config:
        # 节点工作区标识：前端首轮生成并持久化的 workspaceId；缺省回退 node_id 派生（兼容旧前端），
        # 两者皆缺时按「用户+纪元」派生（旧前端 + 无 node_id 的极端场景，清空对话仍得干净工作区）
        workspace_id = payload.workspace_id or (
            f"node_{payload.node_id}"
            if payload.node_id
            else f"node_{current_user.id}_{payload.epoch or 0}"
        )
        workspace = prepare_runtime_workspace(
            current_user.id,
            workspace_id,
            nc.skill_agent_config.id,
            payload.skills or None,
        )

        async def skill_chat_generator():
            try:
                # Skill Agent 以 messages（OpenAI 格式完整历史）驱动多步执行；
                # 图片经 _multimodal_messages 转为多模态 content（与 LLM 模式一致）；
                # skills 为上游 Skill 检索节点选中的 skill 名（空 = 全部已装 skill）；
                # workspace 为装配好的节点工作区（软链 skill / AGENTS.md）
                async for evt in run_skill_agent(
                    skill_agent_config,
                    _multimodal_messages(payload.messages or []),
                    skills=payload.skills or None,
                    workspace=workspace,
                    workspace_id=workspace_id,
                ):
                    if await request.is_disconnected():
                        break
                    sse = _sse_from_agent_event(evt, content_event="message")
                    if sse:
                        yield sse
                        continue
                    # agent_file 事件：skill 执行产生的文件（图片缩略 + 下载）
                    if evt.get("type") == "agent_file":
                        yield {
                            "event": "agent_file",
                            "data": json.dumps(
                                evt.get("data", {}), ensure_ascii=False
                            ),
                        }
            except SkillAgentError as exc:
                if not await request.is_disconnected():
                    yield {"event": "error", "data": str(exc)}

        return EventSourceResponse(skill_chat_generator())

    if agent_config:
        session_key = _agent_session_key(current_user.id, payload.node_id, payload.epoch)

        async def agent_chat_generator():
            try:
                async for evt in fastclaw_agent_service.run_agent(
                    agent_config,
                    payload.message or "",
                    session_key=session_key,
                    images=payload.images or None,
                    params={"module": "bookplate", "node_type": NODE_CHAT},
                ):
                    if await request.is_disconnected():
                        break
                    sse = _sse_from_agent_event(evt, content_event="message")
                    if sse:
                        yield sse
            except FastClawAgentError as exc:
                if not await request.is_disconnected():
                    yield {"event": "error", "data": str(exc)}

        return EventSourceResponse(agent_chat_generator())

    async def llm_chat_generator():
        try:
            async for chunk in llm_service.chat_stream(
                payload.messages or [], text_config
            ):
                if await request.is_disconnected():
                    break
                # chat_stream 产出 {type: content|reasoning, delta}：
                # content -> message（拼入正文）；reasoning -> 独立事件（折叠展示）
                if chunk.get("type") == "reasoning":
                    yield {"event": "reasoning", "data": chunk.get("delta", "")}
                else:
                    yield {"event": "message", "data": chunk.get("delta", "")}
        except LLMGenerationError as exc:
            if not await request.is_disconnected():
                yield {"event": "error", "data": str(exc)}

    return EventSourceResponse(llm_chat_generator())


@router.post("/generate-image")
async def generate_bookplate_image(
    request: Request,
    payload: ImageGenRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """图像生成节点：根据提示词生成藏书票图片（无 API Key 时返回 Mock 占位图）。

    执行模式由该节点的节点配置决定：绑定 FastClaw Agent 时走 SSE 流式
    （中间步骤 + 最终 image_url 事件）；否则走 LLM 图像 API（请求体可携带
    size / ratio / image 等参数按次覆盖模型三要素之外的图像参数）。

    客户端断开（前端超时放弃 / 删除节点 / 关闭页面）时，在调用图像 API 前直接放弃，
    并透传 is_disconnected 回调让底层在落盘前再检查一次，省掉昂贵的图像 API 调用。
    """
    prompt = payload.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt 不能为空")

    nc = _resolve_node_config(db, payload.config_id, NODE_IMAGE)
    agent_config = _agent_config_from(nc, current_user.id)

    # Agent 模式：SSE 流式透传中间步骤 + 最终 image_url 事件
    if agent_config:
        session_key = _agent_session_key(current_user.id, payload.node_id)

        async def agent_image_generator():
            try:
                image_url = None
                final_text = ""
                async for evt in fastclaw_agent_service.run_agent(
                    agent_config,
                    prompt,
                    session_key=session_key,
                    # 上游「图片上传」节点的参考图（data URL）随提示词一并传给 Agent
                    images=payload.image or None,
                    params={"module": "bookplate", "node_type": NODE_IMAGE, "prompt": prompt},
                ):
                    if await request.is_disconnected():
                        break
                    etype = evt.get("type", "")
                    data = evt.get("data", {}) or {}
                    if etype in ("content_delta", "content"):
                        final_text += data.get("delta", "")
                    elif etype == "tool_result":
                        # 图像工具返回的 markdown 里通常直接带图片地址，先记下来
                        candidate = extract_image_url(data.get("result", ""))
                        if candidate and not image_url:
                            image_url = candidate
                    sse = _sse_from_agent_event(evt)
                    if sse and sse["event"] != "prompt":
                        # 图片阶段不流式展示提示词文本，只透传中间步骤
                        yield sse
                # 最终回复内容里提取图片地址（优先级：工具结果 > 最终内容）
                if not image_url:
                    image_url = extract_image_url(final_text)
                if not image_url:
                    yield {"event": "error", "data": "Agent 未返回图片地址"}
                    return
                try:
                    local_url = await image_service.save_remote_image(image_url)
                except ImageGenerationError as exc:
                    yield {"event": "error", "data": str(exc)}
                    return
                yield {"event": "image_url", "data": json.dumps({"image_url": local_url, "mock": False}, ensure_ascii=False)}
            except FastClawAgentError as exc:
                if not await request.is_disconnected():
                    yield {"event": "error", "data": str(exc)}

        return EventSourceResponse(agent_image_generator())

    # 客户端已断开：不发起图像 API 调用，直接放弃本次生成
    if await request.is_disconnected():
        raise HTTPException(status_code=499, detail="客户端已断开连接")
    image_config = _image_config_from(nc) or ImageModelConfig()
    # 请求体参数按次覆盖（仅当提供了才覆盖，未提供则保留 None）
    image_config.size = payload.size or image_config.size
    image_config.ratio = payload.ratio or image_config.ratio
    image_config.image = payload.image or image_config.image
    try:
        return await image_service.generate_image(
            prompt, image_config, is_disconnected=request.is_disconnected
        )
    except ImageGenerationError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


# ---------------------------------------------------------------------------
# 小工具节点：万年历 / 天气查询（无需配置，直接调用第三方公开 API）
# ---------------------------------------------------------------------------

_WEEKDAYS = ("周一", "周二", "周三", "周四", "周五", "周六", "周日")

# wttr.in weatherCode → 中文天气描述（收录常用代码；未收录回退英文原文）
_WEATHER_CODE_ZH = {
    "113": "晴", "116": "局部多云", "119": "多云", "122": "阴", "143": "薄雾",
    "176": "局部有雨", "263": "局部小雨", "266": "小雨",
    "293": "零星小雨", "296": "小雨", "299": "中雨", "302": "中雨",
    "305": "大雨", "308": "大雨", "311": "冻雨", "314": "冻雨",
    "317": "雨夹雪", "320": "雨夹雪", "323": "小雪", "326": "小雪",
    "329": "中雪", "332": "中雪", "335": "大雪", "338": "大雪",
    "350": "冰粒", "353": "阵雨", "356": "中阵雨", "359": "大阵雨",
    "362": "阵性雨夹雪", "365": "阵性雨夹雪", "368": "阵雪", "371": "大阵雪",
    "374": "冰粒", "377": "冰粒", "386": "雷阵雨", "389": "强雷阵雨",
    "392": "雷阵雪", "395": "强雷阵雪",
}

# wttr.in 十六方位风向 → 中文
_WIND_DIR_ZH = {
    "N": "北风", "NNE": "北北东风", "NE": "东北风", "ENE": "东北偏东风",
    "E": "东风", "ESE": "东南偏东风", "SE": "东南风", "SSE": "南南东风",
    "S": "南风", "SSW": "南南西风", "SW": "西南风", "WSW": "西南偏西风",
    "W": "西风", "WNW": "西北偏西风", "NW": "西北风", "NNW": "北北西风",
}

# wttr.in 月相 → 中文
_MOON_PHASE_ZH = {
    "New Moon": "新月", "Waxing Crescent": "蛾眉月", "First Quarter": "上弦月",
    "Waxing Gibbous": "盈凸月", "Full Moon": "满月", "Waning Gibbous": "亏凸月",
    "Last Quarter": "下弦月", "Waning Crescent": "残月",
}


def _to_24h(value: Optional[str]) -> str:
    """12 小时制（如 "02:56 AM"）→ 24 小时制；无法解析原样返回。"""
    if not value:
        return ""
    m = re.fullmatch(r"(\d{1,2}):(\d{2})\s*(AM|PM)", value.strip(), re.IGNORECASE)
    if not m:
        return value.strip()
    hour = int(m.group(1)) % 12
    if m.group(3).upper() == "PM":
        hour += 12
    return f"{hour:02d}:{m.group(2)}"


def _format_calendar(data: Dict[str, Any], date_str: str) -> str:
    """万年历数据 → 对外文本输出（Markdown 列表，仅含非空字段）。"""
    lines = [f"# 万年历 · {data.get('date') or date_str}"]
    week_day = data.get("weekDay")
    if isinstance(week_day, int) and 1 <= week_day <= 7:
        lines.append(f"星期：{_WEEKDAYS[week_day - 1]}")
    rows = (
        ("农历", "lunarCalendar"),
        ("天干地支", "yearTips"),
        ("属相", "chineseZodiac"),
        ("节气", "solarTerms"),
        ("星座", "constellation"),
        ("类型", "typeDes"),
        ("宜", "suit"),
        ("忌", "avoid"),
        ("一年第几天", "dayOfYear"),
        ("一年第几周", "weekOfYear"),
    )
    for label, key in rows:
        value = data.get(key)
        if value not in (None, ""):
            lines.append(f"- **{label}**：{value}")
    return "\n".join(lines)


def _format_weather(city: str, body: Dict[str, Any]) -> str:
    """wttr.in format=j1 JSON → 对外文本输出（结构化中文，人类可读）。"""
    conditions = body.get("current_condition") or []
    if not conditions:
        raise HTTPException(status_code=502, detail="未找到该城市的天气信息，请检查城市名")
    cc = conditions[0]
    nearest = (body.get("nearest_area") or [{}])[0]
    area_name = ((nearest.get("areaName") or [{}])[0] or {}).get("value", "")
    country = ((nearest.get("country") or [{}])[0] or {}).get("value", "")
    title = city or "，".join(x for x in (area_name, country) if x) or "当前位置"

    desc_en = ((cc.get("weatherDesc") or [{}])[0] or {}).get("value", "")
    condition = _WEATHER_CODE_ZH.get(str(cc.get("weatherCode", "")), desc_en) or "未知"
    feels = f"（体感 {cc.get('FeelsLikeC')}°C）" if cc.get("FeelsLikeC") else ""
    lines = [
        f"# {title} · 当前天气",
        "",
        f"**{condition}，{cc.get('temp_C') or '--'}°C{feels}**",
    ]

    rows = []
    wind = _WIND_DIR_ZH.get(cc.get("winddir16Point", ""), cc.get("winddir16Point") or "")
    if wind and cc.get("windspeedKmph") is not None:
        rows.append(("风向风速", f"{wind} {cc['windspeedKmph']} km/h"))
    if cc.get("humidity") is not None:
        rows.append(("湿度", f"{cc['humidity']}%"))
    if cc.get("visibility") is not None:
        rows.append(("能见度", f"{cc['visibility']} km"))
    if cc.get("cloudcover") is not None:
        rows.append(("云量", f"{cc['cloudcover']}%"))
    if cc.get("precipMM") is not None:
        rows.append(("降水", f"{cc['precipMM']} mm"))
    if cc.get("pressure") is not None:
        rows.append(("气压", f"{cc['pressure']} hPa"))
    if cc.get("uvIndex") is not None:
        rows.append(("紫外线指数", str(cc["uvIndex"])))
    obs = _to_24h(cc.get("observation_time"))
    if obs:
        rows.append(("观测时间", obs))
    for label, value in rows:
        lines.append(f"- **{label}**：{value}")

    day = (body.get("weather") or [{}])[0]
    summary = []
    if day:
        temps = []
        if day.get("maxtempC") is not None:
            temps.append(f"最高 {day['maxtempC']}°C")
        if day.get("mintempC") is not None:
            temps.append(f"最低 {day['mintempC']}°C")
        if temps:
            summary.append("今日：" + " / ".join(temps))
        astro = (day.get("astronomy") or [{}])[0]
        if astro:
            parts = []
            sunrise = _to_24h(astro.get("sunrise"))
            sunset = _to_24h(astro.get("sunset"))
            if sunrise:
                parts.append(f"日出 {sunrise}")
            if sunset:
                parts.append(f"日落 {sunset}")
            moon_phase = astro.get("moon_phase")
            if moon_phase:
                parts.append(f"月相：{_MOON_PHASE_ZH.get(moon_phase, moon_phase)}")
            if parts:
                summary.append(" · ".join(parts))
    if summary:
        lines.extend(["", "> " + " · ".join(summary)])
    return "\n".join(lines)


def _mxnzp_config(db: Session) -> Dict[str, str]:
    """按系统设置组装 MXNZP 配置（/admin/settings 优先，.env 回退）。"""
    settings_map = {s.key: s.value for s in db.query(AppSetting).all()}
    return {
        "app_id": (settings_map.get("mxnzp.app_id") or "").strip() or settings.MXNZP_APP_ID,
        "app_secret": (settings_map.get("mxnzp.app_secret") or "").strip() or settings.MXNZP_APP_SECRET,
        "base_url": (settings_map.get("mxnzp.base_url") or "").strip() or "https://www.mxnzp.com",
    }


@router.post("/calendar")
async def calendar_query(
    payload: CalendarRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """万年历节点：查询指定日期的节假日 / 农历万年历（MXNZP API）。"""
    import httpx

    cfg = _mxnzp_config(db)
    if not cfg["app_id"] or not cfg["app_secret"]:
        raise HTTPException(
            status_code=503,
            detail="万年历服务未配置：请在管理端「系统设置」配置 mxnzp.app_id / mxnzp.app_secret（或设置 .env 的 MXNZP_APP_ID / MXNZP_APP_SECRET 后重启后端）",
        )
    normalized = re.sub(r"[-/]", "", payload.date or "")
    if not re.fullmatch(r"\d{8}", normalized):
        raise HTTPException(status_code=400, detail="日期格式无效，应为 yyyy-MM-dd 或 yyyyMMdd")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{cfg['base_url'].rstrip('/')}/api/holiday/single/{normalized}",
                params={
                    "app_id": cfg["app_id"],
                    "app_secret": cfg["app_secret"],
                    "ignoreHoliday": "false",
                },
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"万年历查询失败: {exc}") from exc
    try:
        body = resp.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="万年历服务返回了无法解析的内容")
    if body.get("code") != 1 or not body.get("data"):
        raise HTTPException(status_code=502, detail=body.get("msg") or "万年历查询失败，请检查 MXNZP 凭据是否有效")
    return {
        "output": _format_calendar(body["data"], normalized),
        "date": normalized,
    }


@router.post("/weather")
async def weather_query(
    payload: WeatherRequest,
    current_user: User = Depends(get_current_active_user),
):
    """天气查询节点：查询指定城市当前天气（wttr.in，结构化中文输出）。"""
    import httpx

    city = (payload.city or "").strip()
    path = f"/{quote(city)}" if city else ""
    # wttr.in 按 User-Agent 区分客户端：浏览器 UA 返回 HTML 页面，curl 返回纯文本。
    # 服务端请求伪装 curl + Accept: application/json 以稳定拿到 JSON 结构。
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(
                f"https://wttr.in{path}?format=j1&lang=zh",
                headers={"User-Agent": "curl/8.5.0", "Accept": "application/json"},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"天气查询失败: {exc}") from exc
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"天气查询失败（HTTP {resp.status_code}）")
    try:
        body = resp.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="未找到该城市的天气信息，请检查城市名")
    return {"output": _format_weather(city, body), "city": city}


@router.post("/save-image")
async def save_image(
    payload: SaveImageRequest,
    current_user: User = Depends(get_current_active_user),
):
    """多模态工具节点：把客户端渲染导出的图片（base64 data URL）落盘到 static/generated，
    返回本地访问 URL（供下游节点 / 历史记录使用）。

    复用 image_service.save_remote_image（已支持 data URL 解码 + 魔数/体积不校验场景），
    与 Agent 模式图片落盘同一物理目录与 URL 格式。
    """
    image = (payload.image or "").strip()
    if not image or not image.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="image 必须为 base64 data URL")
    try:
        local_url = await image_service.save_remote_image(image)
    except ImageGenerationError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return {"image_url": local_url}


# ---------------------------------------------------------------------------
# Skill 工作区（Skill Agent 的 skill 来源）
# ---------------------------------------------------------------------------

class SkillInstallRequest(BaseModel):
    """从 Bifrost 安装 skill：按 skill 的 name（非 id）下载 zip 并安装到用户工作区。"""

    name: str


@router.get("/skills")
async def list_user_skills(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """列出当前用户工作区已安装的 skill（含 name/description/文件树）。"""
    return {"skills": list_installed_skills(current_user.id)}


@router.get("/skills/bifrost-search")
async def search_skills(
    q: str = "",
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """检索 Bifrost Skills 仓库（普通用户可用，供 Skill 检索节点 / Skill Agent 管理弹层）。"""
    from app.services.bifrost_service import (
        BifrostError,
        BifrostNotConfiguredError,
        search_bifrost_skills,
    )

    try:
        skills = await search_bifrost_skills(db, q=q, limit=limit)
    except BifrostNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except BifrostError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"skills": skills}


@router.post("/skills/install")
async def install_bifrost_skill(
    payload: SkillInstallRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """从 Bifrost 下载 skill zip 并安装到当前用户工作区（校验 SKILL.md 结构）。"""
    from app.services.bifrost_service import (
        BifrostError,
        BifrostNotConfiguredError,
        BifrostNotFoundError,
        download_bifrost_skill_zip,
    )

    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="skill 名称不能为空")
    # 缓存命中：共享区 runtime/.agent/skills/{name} 已有该 skill 包 → 跳过网络下载，
    # 仅在该用户登记区建软链（毫秒级）。未命中返回 None，才走 Bifrost 下载。
    try:
        meta = register_existing_bifrost_skill(current_user.id, name)
    except SkillValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if meta is None:
        try:
            zip_bytes = await download_bifrost_skill_zip(db, name)
        except BifrostNotConfiguredError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except BifrostNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except BifrostError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        if not zip_bytes or len(zip_bytes) > 20 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="skill 压缩包为空或超过 20MB 上限")
        try:
            meta = install_skill_zip(current_user.id, zip_bytes)
        except SkillValidationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return meta


@router.post("/skills/upload")
async def upload_skill_zip(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """上传本地 skill zip 并安装到当前用户工作区。

    校验：zip 根目录必须有 SKILL.md，且 SKILL.md 开头必须有 name / description
    的 YAML frontmatter；不合法返回 400 及中文原因。
    """
    try:
        form = await request.form()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"表单解析失败: {exc}") from exc
    file = form.get("file")
    if not file or not hasattr(file, "read"):
        raise HTTPException(status_code=400, detail="缺少上传文件（字段名 file）")
    try:
        zip_bytes = await file.read()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"读取上传文件失败: {exc}") from exc
    if not zip_bytes or len(zip_bytes) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="文件为空或超过 20MB 上限")
    try:
        # 用户上传路径：私有登记目录（真实解压），不进入跨用户共享区
        meta = install_user_skill_zip(current_user.id, zip_bytes)
    except SkillValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return meta


@router.delete("/skills/{skill_name}")
async def remove_user_skill(
    skill_name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """从用户工作区移除一个已安装的 skill。"""
    import shutil

    from app.services.skill_agent_service import skills_dir as _skills_dir

    # skill 名称即顶层目录名：拒绝路径分隔符，防止误删嵌套路径
    if not skill_name or "/" in skill_name or "\\" in skill_name:
        raise HTTPException(status_code=400, detail="非法 skill 名称")
    d = _skills_dir(current_user.id)
    target = d / skill_name
    if not target.exists() and not target.is_symlink():
        raise HTTPException(status_code=404, detail="skill 不存在")
    if target.is_symlink() or target.is_file():
        # Bifrost 登记是软链：只移除登记条目，不动共享真实包（Q5：共享区由运维定期 GC）
        target.unlink()
    else:
        # 用户上传是真实目录：完整删除
        shutil.rmtree(target)
    return {"message": f"已移除 skill：{skill_name}"}


@router.get("/skill-files")
async def get_skill_file(
    path: str,
    workspace_id: str = "",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """下载 skill 执行产生的文件（工作区内相对路径）。

    workspace_id 为可选参数：agent_file 事件 URL 会携带（前端首轮生成的节点工作区标识），
    用于定位具体节点工作区；缺省回退该用户工作区根目录（旧 URL 兼容）。
    鉴权：仅当前登录用户可访问自己工作区的文件；
    路径防护：resolve 后必须位于工作区内或共享/登记前缀内（软链穿透放行），拒绝 ../ 越界。
    用于 ChatNode 的文件卡片下载与图片缩略图（前端 fetch 带 token → blob）。
    """
    from fastapi.responses import FileResponse

    workspace = node_workspace(current_user.id, workspace_id) if workspace_id else None
    target = resolve_skill_abs(current_user.id, path, workspace=workspace)
    if target is None or not target.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(
        str(target),
        media_type="application/octet-stream",
        filename=target.name,
    )
