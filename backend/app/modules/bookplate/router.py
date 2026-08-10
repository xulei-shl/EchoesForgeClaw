import asyncio
import base64
import binascii
import hashlib
import json
import logging
import random
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional
from urllib.parse import urlparse, quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .douban_client import (
    DoubanIsbnClient,
    ClientConfig,
    USER_AGENTS,
    AsyncRateLimiter,
    COVER_REFERERS,
)
from app.core.database import get_db
from app.core.deps import get_current_active_user, get_current_admin_user
from app.models.user import User
from app.models.stage_config import StageConfig
from app.models.app_setting import AppSetting
from app.models.fastclaw_agent_config import FastClawAgentConfig
from app.services.llm_service import (
    llm_service,
    TextModelConfig,
    VisionModelConfig,
    LLMGenerationError,
)
from app.services.image_service import image_service, ImageModelConfig, ImageGenerationError
from app.services.fastclaw_service import (
    fastclaw_agent_service,
    FastClawRuntimeConfig,
    FastClawAgentError,
    extract_image_url,
)
from sse_starlette.sse import EventSourceResponse

router = APIRouter(prefix="/api/modules/bookplate", tags=["bookplate"])

logger = logging.getLogger(__name__)

# bookplate 模块的语义阶段标识
STAGE_TEXT = "stage2"       # 文本提示词生成（合并元数据+封面分析）
STAGE_COVER = "stage2.cover"  # 封面图多模态分析
STAGE_IMAGE = "stage3"      # 图片生成

# 豆瓣封面本地缓存目录: backend/static/covers（复用 main.py 的 /static 挂载，无需额外配置）
COVERS_DIR = Path(__file__).resolve().parents[3] / "static" / "covers"
COVERS_PREFIX = "/static/covers"

# 编辑模式上传参考图的体积上限（字节）。8MB 足以覆盖普通参考图，
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


class PromptRequest(BaseModel):
    metadata: Dict[str, Any] = {}
    # 编辑模式「重新生成」：上传参考图的 base64 data URL（data:image/...;base64,...）。
    # 提供时优先于豆瓣封面执行 Stage 2 封面分析，随后与图书元数据合并生成提示词。
    image: Optional[str] = None
    # 画布节点 id：Agent 模式下用作 FastClaw 会话 key 的一部分（同节点重试共享上下文）
    node_id: Optional[str] = None


class ImageGenRequest(BaseModel):
    prompt: str
    size: Optional[str] = None
    ratio: Optional[str] = None
    image: Optional[List[str]] = None
    # 画布节点 id：Agent 模式下用作 FastClaw 会话 key 的一部分
    node_id: Optional[str] = None


def _decode_uploaded_image(data_url: str) -> Optional[bytes]:
    """解析前端上传图片的 base64 data URL，返回原始图片字节。

    非法 base64 / 非图片魔数 / 超过体积上限时返回 None，由调用方跳过分析、
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


def _resolve_text_config(db: Session) -> Optional[TextModelConfig]:
    """解析 bookplate stage2 的文本模型运行时配置（未绑定则回退环境变量）。"""
    sc = (
        db.query(StageConfig)
        .filter(StageConfig.module == "bookplate", StageConfig.stage == STAGE_TEXT)
        .first()
    )
    if not sc or not sc.llm_config or not sc.llm_config.api_key or not sc.llm_config.is_active:
        return None
    system_prompt = sc.prompt.content if sc.prompt and sc.prompt.is_active else ""
    return TextModelConfig(
        api_key=sc.llm_config.api_key,
        base_url=sc.llm_config.base_url or "",
        model_name=sc.llm_config.model_name or "gpt-3.5-turbo",
        system_prompt=system_prompt,
    )


def _resolve_cover_config(db: Session) -> Optional[VisionModelConfig]:
    """解析 bookplate stage2.cover 的封面多模态模型运行时配置（未绑定则 None）。"""
    sc = (
        db.query(StageConfig)
        .filter(StageConfig.module == "bookplate", StageConfig.stage == STAGE_COVER)
        .first()
    )
    if not sc or not sc.llm_config or not sc.llm_config.api_key or not sc.llm_config.is_active:
        return None
    system_prompt = sc.prompt.content if sc.prompt and sc.prompt.is_active else ""
    return VisionModelConfig(
        api_key=sc.llm_config.api_key,
        base_url=sc.llm_config.base_url or "",
        model_name=sc.llm_config.model_name or "gpt-4o-mini",
        system_prompt=system_prompt,
    )


def _resolve_image_config(db: Session) -> Optional[ImageModelConfig]:
    """解析 bookplate stage3 的图片模型运行时配置（未绑定则回退环境变量）。

    仅返回模型三要素（api_key / base_url / model_name），其余图像参数
    （size / ratio / response_format / image）由请求体按次传入。
    """
    sc = (
        db.query(StageConfig)
        .filter(StageConfig.module == "bookplate", StageConfig.stage == STAGE_IMAGE)
        .first()
    )
    if not sc or not sc.llm_config or not sc.llm_config.api_key or not sc.llm_config.is_active:
        return None
    return ImageModelConfig(
        api_key=sc.llm_config.api_key,
        base_url=sc.llm_config.base_url or "",
        model_name=sc.llm_config.model_name or "",
    )


def _resolve_agent_config(db: Session, stage: str, user_id: int) -> Optional[FastClawRuntimeConfig]:
    """解析指定阶段的 FastClaw Agent 运行时配置（未绑定/未启用/无 Key 则 None）。"""
    sc = (
        db.query(StageConfig)
        .filter(StageConfig.module == "bookplate", StageConfig.stage == stage)
        .first()
    )
    if (
        not sc
        or not sc.agent_config
        or not sc.agent_config.is_active
        or not sc.agent_config.api_key
    ):
        return None
    return FastClawRuntimeConfig(
        base_url=sc.agent_config.base_url or "",
        api_key=sc.agent_config.api_key,
        agent_id=sc.agent_config.agent_id or "",
        end_user=f"bookplate-{user_id}",
    )


def _agent_session_key(user_id: int, node_id: Optional[str]) -> str:
    """构造确定性的 FastClaw 会话 key：同一用户同一节点重试共享上下文。"""
    return f"bookplate-{user_id}-{node_id or 'anon'}"


def _sse_from_agent_event(evt: Dict[str, Any]) -> Optional[Dict[str, str]]:
    """把归一化的 agent 事件映射为 bookplate SSE 事件（中间步骤透传给前端展示）。"""
    etype = evt.get("type", "")
    data = evt.get("data", {}) or {}
    # content 与 content_delta 都映射为 prompt 事件：run_agent 已对「流式增量 + 末尾完整文本」
    # 去重，能到达这里的 content 说明本轮未流式（非流式 provider），直接作为完整提示词透传
    if etype in ("content_delta", "content"):
        return {"event": "prompt", "data": data.get("delta", "")}
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


def _agent_prompt_message(metadata: Dict[str, Any], cover_analysis: str = "") -> str:
    """把图书元数据 + 可选封面分析文本组装为 Agent 模式的用户消息。

    Agent 只接收文本（元数据 + stage2.cover 的分析结果），不传图片——模型服务商
    需回源下载图片，本机/内网 URL 会被其 SSRF 防护拒绝（报 port not allowed）。
    """
    lines = []
    for k, v in metadata.items():
        if k in ("cover_image", "cover_image_local", "coverUrl", "image_url", "image_url_local"):
            continue
        lines.append(f"{k}: {v}")
    meta_text = "\n".join(lines) if lines else str(metadata)
    message = meta_text
    if cover_analysis:
        message += "\n\n封面图分析结果：\n" + cover_analysis
    return message


async def _run_cover_analysis_agent(
    agent_config: FastClawRuntimeConfig,
    image_data_url: str,
    session_key: str,
    should_stop: Optional[Callable[[], Awaitable[bool]]] = None,
    timeout: float = 120.0,
) -> str:
    """用 Agent 模式执行封面分析（stage2.cover 配置为 Agent 时）。

    图片以 base64 data URL 内联传给 FastClaw，用户消息为空（仅携带图片数据）；
    封面分析的指令由 FastClaw Agent 侧配置的系统提示词负责。调用失败 / 客户端
    断开 / 超时返回空串，不阻断后续生成。
    """
    text_parts: List[str] = []
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    try:
        async for evt in fastclaw_agent_service.run_agent(
            agent_config,
            "",  # 用户消息为空，仅通过 images 参数传递图片数据
            session_key=session_key,
            images=[image_data_url],
            params={"module": "bookplate", "stage": STAGE_COVER},
        ):
            if should_stop is not None and await should_stop():
                break
            if loop.time() > deadline:
                logger.warning("封面分析 Agent 超时（%.0fs），截断", timeout)
                break
            etype = evt.get("type", "")
            data = evt.get("data", {}) or {}
            if etype in ("content_delta", "content"):
                text_parts.append(data.get("delta", ""))
    except Exception as exc:
        logger.warning("封面分析 Agent 调用失败: %s", exc)
        return ""
    return "".join(text_parts).strip()



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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    # 客户端已断开（删除节点 / 清空画布 / 关闭页面）：不发起豆瓣抓取，直接放弃。
    # 豆瓣为免费只读接口，预检查覆盖「尚未开始抓取」的窗口即可，不值得为中途取消改造抓取循环。
    if await request.is_disconnected():
        raise HTTPException(status_code=499, detail="客户端已断开连接")
    client_config = _douban_client_config(db)
    async with DoubanIsbnClient(client_config) as client:
        book = await client.fetch(isbn)
        if not book:
            raise HTTPException(status_code=404, detail="Book not found")
        if book.get("cover_image"):
            # cover_image 保持豆瓣 API 返回的原始 URL（供 JSON 下载 / 归档使用）；
            # cover_image_local 为前端可展示的 URL（代理 → 本地缓存）。封面不在此处同步下载：
            # 元数据必须立即返回，封面由前端通过公开的 /cover 在展示时按需下载并缓存
            # （内置限流、重试与魔数校验），下载失败则由前端降级为占位图
            book["cover_image_local"] = (
                str(request.url_for("proxy_cover")) + "?url=" + quote(book["cover_image"])
            )
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


@router.get("/effective-config")
async def get_effective_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """返回 bookplate 各阶段的生效模式（agent / llm），供前端决定画布节点的调用方式与展示。

    模式判定：阶段绑定了可用（is_active + 已配 Key）的 FastClaw Agent 即为 agent 模式；
    否则为 llm 模式（含未绑定回退环境变量）。
    """
    scs = db.query(StageConfig).filter(StageConfig.module == "bookplate").all()
    mode_map = {"stage2": "llm", "stage2.cover": "llm", "stage3": "llm"}
    agent_names: Dict[str, Optional[str]] = {}
    for sc in scs:
        if (
            sc.agent_config
            and sc.agent_config.is_active
            and sc.agent_config.api_key
            and sc.stage in mode_map
        ):
            mode_map[sc.stage] = "agent"
            # 优先展示 FastClaw agent 真实名字（如 Xulei），未回填时退回配置名
            agent_names[sc.stage] = sc.agent_config.agent_name or sc.agent_config.name
    return {
        "stage2": {"mode": mode_map.get("stage2", "llm"), "agent_name": agent_names.get("stage2")},
        "stage2.cover": {"mode": mode_map.get("stage2.cover", "llm"), "agent_name": agent_names.get("stage2.cover")},
        "stage3": {"mode": mode_map.get("stage3", "llm"), "agent_name": agent_names.get("stage3")},
    }


@router.post("/generate-prompt")
async def generate_prompt(
    request: Request,
    payload: PromptRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """第二阶段：封面图多模态分析（可跳过）+ 基于元数据与封面分析流式生成提示词。

    **每个阶段的执行模式（LLM API / FastClaw Agent）完全由 `/admin/stage-configs`
    的阶段绑定决定，代码不写死：**
    - stage2.cover（封面分析）：绑定 Agent 走 Agent，绑定模型走 LLM API；
      封面不可得 / 未绑定任何配置 / 分析失败时跳过，仅基于元数据生成提示词。
    - stage2（提示词生成）：绑定 Agent 时把「元数据 + 封面分析文本」交给 Agent
      流式生成（**不传图片**——模型服务商需回源下载图片，本机/内网 URL 会被其
      SSRF 防护拒绝，报 "port xxxx is not allowed"）；否则走 LLM API 流式生成。
    - 封面分析为同步一次性调用，完成后才开启 SSE 流式返回最终提示词。
    - 客户端在开流前的分析阶段断开（删除节点 / 超时放弃 / 关闭页面）时，
      跳过抓取与视觉分析，直接返回，不做无谓的 LLM / Agent 调用。
    """
    metadata = payload.metadata or {}
    session_key = _agent_session_key(current_user.id, payload.node_id)
    # 各阶段执行模式由阶段配置决定（agent_config 非空 => Agent 模式；否则看 LLM 配置）
    agent_config = _resolve_agent_config(db, STAGE_TEXT, current_user.id)          # stage2
    text_config = _resolve_text_config(db)                                        # stage2 (LLM)
    cover_agent_config = _resolve_agent_config(db, STAGE_COVER, current_user.id)  # stage2.cover
    cover_config = _resolve_cover_config(db)                                      # stage2.cover (LLM)

    # ---- 封面分析（stage2.cover）：按该阶段配置决定走 Agent 还是 LLM API ----
    # 分析前先查断开，避免为已离开的客户端做昂贵的封面下载/分析
    if await request.is_disconnected():
        raise HTTPException(status_code=499, detail="客户端已断开连接")
    cover_analysis = ""
    cover_session_key = _agent_session_key(current_user.id, f"{payload.node_id or 'anon'}-cover")
    uploaded = _decode_uploaded_image(payload.image) if payload.image else None
    if uploaded and (cover_agent_config or cover_config):
        if cover_agent_config:
            cover_analysis = await _run_cover_analysis_agent(
                cover_agent_config,
                payload.image,
                cover_session_key,
                should_stop=request.is_disconnected,
            )
        else:
            cover_analysis = await llm_service.analyze_cover(uploaded, cover_config)
    elif not payload.image:
        # 仅当未提供上传图时才回退豆瓣封面分析：上传图非法/超限时不静默改用封面，
        # 以免生成的提示词基于错误的图片（此时分析留空，仅按元数据生成）
        cover_url = metadata.get("cover_image")
        if cover_url and (cover_agent_config or cover_config):
            proxy = _douban_client_config(db).proxy
            cover_bytes = await _fetch_cover_bytes(
                cover_url, proxy, is_disconnected=request.is_disconnected
            )
            if cover_bytes:
                if cover_agent_config:
                    ext = _detect_image_ext(cover_bytes[:12]) or "jpg"
                    data_url = (
                        f"data:image/{ext};base64,"
                        + base64.b64encode(cover_bytes).decode("ascii")
                    )
                    cover_analysis = await _run_cover_analysis_agent(
                        cover_agent_config,
                        data_url,
                        cover_session_key,
                        should_stop=request.is_disconnected,
                    )
                else:
                    cover_analysis = await llm_service.analyze_cover(cover_bytes, cover_config)

    # 开流前检查：分析阶段客户端已断开则放弃，不发起生成调用
    if await request.is_disconnected():
        raise HTTPException(status_code=499, detail="客户端已断开连接")

    # ---- 提示词生成（stage2）：按该阶段配置决定走 Agent 还是 LLM API ----
    if agent_config:
        async def agent_event_generator():
            # 与 LLM 模式一致：先透传封面分析结果（非流式），再流式输出提示词
            if cover_analysis:
                yield {"event": "analysis", "data": cover_analysis}
            try:
                async for evt in fastclaw_agent_service.run_agent(
                    agent_config,
                    _agent_prompt_message(metadata, cover_analysis),
                    session_key=session_key,
                    params={"module": "bookplate", "stage": STAGE_TEXT},
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
        # Phase 1: 发送封面分析结果（非流式；无分析结果时不发空事件，与 Agent 模式一致）
        if cover_analysis:
            yield {"event": "analysis", "data": cover_analysis}
        # Phase 2: 流式生成提示词
        try:
            async for chunk in llm_service.generate_prompt_stream(
                metadata, text_config, cover_analysis
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


@router.post("/generate-image")
async def generate_bookplate_image(
    request: Request,
    payload: ImageGenRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """根据提示词生成藏书票图片（无 API Key 时返回 Mock 占位图）。

    请求体可携带 size / ratio / image（图生图参考图）等图像参数，按次覆盖
    StageConfig 中的模型三要素；未传则保持 None，由底层按需构建请求。

    Agent 模式（阶段绑定 FastClaw Agent）：调用 Agent 的图像生成工具，实时透传
    中间步骤事件，最终以 image_url 事件返回本地化图片地址（SSE 流）。

    客户端断开（前端超时放弃 / 删除节点 / 关闭页面）时，在调用图像 API 前直接放弃，
    并透传 is_disconnected 回调让底层在落盘前再检查一次，省掉昂贵的图像 API 调用。
    """
    prompt = payload.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt 不能为空")

    # Agent 模式：SSE 流式透传中间步骤 + 最终 image_url 事件
    agent_config = _resolve_agent_config(db, STAGE_IMAGE, current_user.id)
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
                    params={"module": "bookplate", "stage": STAGE_IMAGE, "prompt": prompt},
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
    image_config = _resolve_image_config(db) or ImageModelConfig()
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
