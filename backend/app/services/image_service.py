import asyncio
import base64
import binascii
import logging
import os
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional
from dataclasses import dataclass

from openai import AsyncOpenAI

from app.core.config import settings

logger = logging.getLogger(__name__)

# 单次图片生成请求超时（秒）。图片生成常见耗时 30~120s；超时后直接失败，
# 由前端展示错误，不自动重试（SDK 自带重试也一并关闭）。
IMAGE_REQUEST_TIMEOUT = 120.0

# 生成的图片保存目录: backend/static/generated
GENERATED_DIR = Path(__file__).resolve().parents[2] / "static" / "generated"
STATIC_PREFIX = "/static/generated"

# 地图海报（多模态工具）中间结果目录: backend/static/map-posters（与 generated 分开，不写历史记录）
MAP_POSTER_DIR = Path(__file__).resolve().parents[2] / "static" / "map-posters"
MAP_POSTER_PREFIX = "/static/map-posters"


@dataclass
class ImageModelConfig:
    """一次图片生成所需的运行时配置（由 NodeConfig 解析而来）。

    所有字段均无硬编码默认值，由调用方（NodeConfig / 请求体）提供。
    size 示例 "1K"、"2K"、"1024x1024"；ratio 示例 "1:1"、"16:9"；
    image 为图生图参考图 URL 列表（传入即走图生图）。
    """

    api_key: str = ""
    base_url: str = ""
    model_name: str = ""
    size: Optional[str] = None
    ratio: Optional[str] = None
    image: Optional[List[str]] = None

# Mock SVG 中使用的字体（CSS font-family 逗号列表，无需内嵌引号）
FONT_SERIF = "LXGW WenKai, Noto Serif SC, serif"
FONT_LATIN = "Georgia, 'Times New Roman', serif"
FONT_MONO = "Consolas, Menlo, monospace"


class ImageGenerationError(Exception):
    """图片生成失败（对外暴露为 502）。"""


class ImageService:
    def __init__(self) -> None:
        # 优先使用独立的图像 API Key，未配置时回退到文本模型 Key（与 llm_service 读取方式一致）
        self.api_key = settings.OPENAI_IMAGE_API_KEY or os.getenv("OPENAI_API_KEY", "")
        self.base_url = settings.OPENAI_IMAGE_BASE_URL or None

    @staticmethod
    def _filename(ext: str) -> str:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        rand = int(time.time() * 1000) % 100000
        return f"bookplate_{stamp}_{rand}.{ext}"

    @staticmethod
    def _write_bytes(filename: str, content: bytes) -> None:
        GENERATED_DIR.mkdir(parents=True, exist_ok=True)
        (GENERATED_DIR / filename).write_bytes(content)

    @staticmethod
    def _write_text(filename: str, content: str) -> None:
        GENERATED_DIR.mkdir(parents=True, exist_ok=True)
        (GENERATED_DIR / filename).write_text(content, encoding="utf-8")

    @staticmethod
    def delete_file(url_path: str) -> bool:
        if not url_path or not url_path.startswith(STATIC_PREFIX):
            return False
        filename = url_path[len(STATIC_PREFIX):].lstrip("/")
        if not filename:
            return False
        file_path = GENERATED_DIR / filename
        if file_path.exists() and file_path.is_file():
            file_path.unlink()
            logger.info("已删除静态文件: %s", file_path)
            return True
        return False

    async def generate_image(
        self,
        prompt: str,
        config: Optional[ImageModelConfig] = None,
        is_disconnected: Optional[Callable[[], Awaitable[bool]]] = None,
    ) -> Dict[str, Any]:
        """生成藏书票图片。

        配置优先级：运行时 config（NodeConfig）> 环境变量（回退）。
        无 API Key 时返回 Mock 占位图；否则调用 OpenAI 兼容图像 API。
        图像参数（model / size / ratio / image）均来自 config，无硬编码默认值。

        底层 API 请求区别：
        - 文生图（无 image）：extra_body 内传入 return_base64: true
        - 图生图（有 image）：extra_body 内传入 image（response_format 不传，避免 litellm 拦截）

        返回: {"image_url": "/static/generated/xxx.png", "mock": bool}

        可选参数 is_disconnected：客户端断开检查回调（如 starlette 的 request.is_disconnected）。
        非 None 时，在 API 调用完成后、下载/落盘前检查一次；客户端已断开则直接失败，
        避免生成无人使用的图片文件。
        """
        api_key = (config.api_key if config else "") or self.api_key
        if not api_key:
            return await asyncio.to_thread(self._mock_image, prompt)

        base_url = (config.base_url if config else "") or self.base_url
        model_name = config.model_name if config else ""
        if not model_name:
            raise ImageGenerationError("未配置图像模型名称（model_name）")

        size = config.size if config else None
        ratio = config.ratio if config else None
        ref_images = config.image if config else None

        try:
            # 显式超时并关闭 SDK 自带重试：超时后直接失败，不自动重试
            client = AsyncOpenAI(
                api_key=api_key,
                base_url=base_url or None,
                timeout=IMAGE_REQUEST_TIMEOUT,
                max_retries=0,
            )
            api_kwargs: Dict[str, Any] = {
                "model": model_name,
                "prompt": prompt[:4000],
            }
            if size:
                api_kwargs["size"] = size
            if ratio:
                api_kwargs["ratio"] = ratio

            # 文生图 vs 图生图：extra_body 参数不同
            extra_body: Dict[str, Any] = {}
            if ref_images:
                extra_body["image"] = ref_images
            else:
                extra_body["return_base64"] = True
            api_kwargs["extra_body"] = extra_body

            response = await client.images.generate(**api_kwargs)
            data = response.data[0]

            # 客户端已断开（前端超时/删除节点/关闭页面）：跳过下载与落盘，
            # 避免生成无人使用的图片文件（进行中的 API 调用无法被中断，仅能省掉收尾）
            if is_disconnected is not None and await is_disconnected():
                raise ImageGenerationError("客户端已断开，生成结果已丢弃")

            if data.b64_json:
                image_bytes = base64.b64decode(data.b64_json)
            elif data.url:
                image_bytes = await self._download(data.url)
            else:
                raise ImageGenerationError("图片生成 API 未返回有效数据（b64_json 或 url）")

            filename = self._filename("png")
            await asyncio.to_thread(self._write_bytes, filename, image_bytes)
            return {"image_url": f"{STATIC_PREFIX}/{filename}", "mock": False}
        except ImageGenerationError:
            raise
        except Exception as exc:
            logger.warning("图片生成失败: %s", exc)
            raise ImageGenerationError(f"图片生成失败: {exc}") from exc

    async def _download(self, url: str) -> bytes:
        """下载外部图片 URL 的字节内容（用于 url 格式响应的落盘）。"""
        import httpx

        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.content

    async def save_map_poster_image(self, data_url: str) -> str:
        """保存地图海报图片（多模态工具中间结果，不写历史记录）：
        data URL → static/map-posters/，返回本地访问 URL。"""
        if not data_url.startswith("data:"):
            raise ImageGenerationError("image 必须为 base64 data URL")
        try:
            _, _, b64 = data_url.partition(",")
            image_bytes = base64.b64decode(b64)
        except (ValueError, binascii.Error) as exc:
            raise ImageGenerationError(f"地图海报图片 data URL 无效: {exc}") from exc
        if not image_bytes:
            raise ImageGenerationError("地图海报图片为空")
        filename = self._filename("png")
        MAP_POSTER_DIR.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread((MAP_POSTER_DIR / filename).write_bytes, image_bytes)
        return f"{MAP_POSTER_PREFIX}/{filename}"

    async def save_remote_image(self, url: str) -> str:
        """下载外部图片 URL 并落盘到 static/generated，返回本地访问 URL。

        用于 Agent 模式：FastClaw 的 image_gen 工具把生成图片以远程 URL（或 data URL）
        写进最终回复，这里下载到本地静态目录，前端无需直连 FastClaw 即可展示。
        """
        image_bytes: bytes
        if url.startswith("data:"):
            # data URL（base64）：直接解码
            meta, _, b64 = url.partition(",")
            try:
                image_bytes = base64.b64decode(b64)
            except (ValueError, binascii.Error) as exc:
                raise ImageGenerationError(f"Agent 返回的图片 data URL 无效: {exc}") from exc
        else:
            image_bytes = await self._download(url)
        if not image_bytes:
            raise ImageGenerationError("Agent 返回的图片为空")

        filename = self._filename("png")
        await asyncio.to_thread(self._write_bytes, filename, image_bytes)
        return f"{STATIC_PREFIX}/{filename}"

    # ------------------------------------------------------------------
    # Mock：无 API Key 时生成一张「纸面文具风」藏书票占位 SVG
    # ------------------------------------------------------------------

    @staticmethod
    def _wrap_text(text: str, width: int = 18) -> List[str]:
        """按字符宽度折行（SVG 无原生自动换行）。"""
        lines: List[str] = []
        for para in text.splitlines() or [""]:
            para = para.strip() or " "
            while len(para) > width:
                lines.append(para[:width])
                para = para[width:]
            lines.append(para)
        return lines

    @staticmethod
    def _svg_escape(text: str) -> str:
        return (
            text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&apos;")
        )

    def _mock_image(self, prompt: str) -> Dict[str, Any]:
        filename = self._filename("svg")
        all_lines = self._wrap_text(prompt, 20)
        lines = all_lines[:8]

        prompt_lines = "".join(
            f'    <text x="400" y="{600 + i * 34}" text-anchor="middle" '
            f'font-family="{FONT_SERIF}" font-size="21" fill="#2B2926">'
            f"{self._svg_escape(line)}</text>\n"
            for i, line in enumerate(lines)
        )
        if len(all_lines) > 8:
            prompt_lines += (
                f'    <text x="400" y="878" text-anchor="middle" '
                f'font-family="{FONT_SERIF}" font-size="21" fill="#6B665E">…</text>\n'
            )

        svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
  <rect width="800" height="1000" fill="#F8F6F1"/>
  <!-- 外框：赭石虚线 -->
  <rect x="44" y="44" width="712" height="912" fill="none" stroke="#A0622B" stroke-width="2" stroke-dasharray="9 7"/>
  <!-- 内框：浅灰细线 -->
  <rect x="60" y="60" width="680" height="880" fill="none" stroke="#E4E1DA" stroke-width="1.5"/>
  <!-- 四角装饰 -->
  <path d="M 44 74 L 44 44 L 74 44" fill="none" stroke="#8A4F1D" stroke-width="3"/>
  <path d="M 756 74 L 756 44 L 726 44" fill="none" stroke="#8A4F1D" stroke-width="3"/>
  <path d="M 44 926 L 44 956 L 74 956" fill="none" stroke="#8A4F1D" stroke-width="3"/>
  <path d="M 756 926 L 756 956 L 726 956" fill="none" stroke="#8A4F1D" stroke-width="3"/>
  <!-- 标题 -->
  <text x="400" y="150" text-anchor="middle" font-family="{FONT_SERIF}" font-size="52" fill="#2B2926">藏书票</text>
  <text x="400" y="196" text-anchor="middle" font-family="{FONT_LATIN}" font-size="19" letter-spacing="8" fill="#6B665E">BOOKPLATE · EX LIBRIS</text>
  <!-- 分隔线 -->
  <line x1="240" y1="228" x2="560" y2="228" stroke="#E4E1DA" stroke-width="1.5" stroke-dasharray="4 4"/>
  <!-- 翻开的书本线描 -->
  <path d="M 400 320 C 350 302 290 300 250 308 L 250 452 C 290 444 350 446 400 464 Z" fill="none" stroke="#A0622B" stroke-width="2"/>
  <path d="M 400 320 C 450 302 510 300 550 308 L 550 452 C 510 444 450 446 400 464 Z" fill="none" stroke="#A0622B" stroke-width="2"/>
  <line x1="400" y1="318" x2="400" y2="466" stroke="#E4E1DA" stroke-width="1.5"/>
  <line x1="336" y1="330" x2="282" y2="344" stroke="#D3CFC7" stroke-width="1.2"/>
  <line x1="336" y1="350" x2="282" y2="364" stroke="#D3CFC7" stroke-width="1.2"/>
  <line x1="464" y1="330" x2="518" y2="344" stroke="#D3CFC7" stroke-width="1.2"/>
  <line x1="464" y1="350" x2="518" y2="364" stroke="#D3CFC7" stroke-width="1.2"/>
  <text x="400" y="510" text-anchor="middle" font-family="{FONT_SERIF}" font-size="22" fill="#6B665E">提示词节选</text>
  <!-- 提示词折行文本 -->
{prompt_lines}  <!-- 底部标记 -->
  <text x="400" y="952" text-anchor="middle" font-family="{FONT_MONO}" font-size="15" letter-spacing="4" fill="#A19D96">MOCK · NO IMAGE API KEY</text>
</svg>
"""
        self._write_text(filename, svg)
        return {"image_url": f"{STATIC_PREFIX}/{filename}", "mock": True}


image_service = ImageService()
