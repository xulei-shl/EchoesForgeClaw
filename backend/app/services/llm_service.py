import os
import asyncio
import base64
import logging
from pathlib import Path
from typing import AsyncGenerator, Optional
from dataclasses import dataclass

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

# 单次 LLM 请求超时（秒）。openai SDK 默认 600s 过长，且流式场景会无限挂起；
# 显式收紧并关闭 SDK 自带重试（max_retries=0）：超时后直接失败、不自动重试，
# 错误通过既有契约（封面分析返回空串 / 流式生成抛 LLMGenerationError）传导到前端。
LLM_REQUEST_TIMEOUT = 60.0


class LLMGenerationError(Exception):
    """提示词流式生成失败（由 SSE 端点捕获后以独立 error 事件传导到前端）。"""


# 默认提示词文件目录：backend/prompts/
_PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts"


def _load_default_prompt(filename: str) -> str:
    """从 prompts/ 目录加载默认提示词文件内容，文件不存在或读取失败返回空字符串。"""
    path = _PROMPTS_DIR / filename
    try:
        if path.is_file():
            return path.read_text(encoding="utf-8").strip()
    except OSError:
        pass
    return ""


DEFAULT_SYSTEM_PROMPT = _load_default_prompt("藏书票图像提示词.md")
DEFAULT_COVER_SYSTEM_PROMPT = _load_default_prompt("藏书票封面图分析.md")


@dataclass
class TextModelConfig:
    """一次调用所需的文本模型运行时配置（由 NodeConfig 解析而来）。"""

    api_key: str = ""
    base_url: str = ""
    model_name: str = "gpt-3.5-turbo"
    system_prompt: str = DEFAULT_SYSTEM_PROMPT


@dataclass
class VisionModelConfig:
    """多模态（视觉）模型运行时配置，用于封面图分析。"""

    api_key: str = ""
    base_url: str = ""
    model_name: str = "gpt-4o-mini"
    system_prompt: str = DEFAULT_COVER_SYSTEM_PROMPT


def _detect_mime(head: bytes) -> str:
    """通过文件头魔数推测图片 MIME 类型。"""
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if head[:4] == b"\x89PNG":
        return "image/png"
    return "image/png"


class LLMService:
    """大模型调用代理。

    支持两种配置来源（优先级从高到低）：
    1. 管理后台 NodeConfig 解析出的 TextModelConfig / VisionModelConfig
    2. 环境变量 OPENAI_API_KEY（无 Key 时启用 Mock 响应）
    """

    def __init__(self):
        self.env_api_key = os.getenv("OPENAI_API_KEY", "")

    async def analyze_cover(
        self,
        image_bytes: bytes,
        config: Optional[VisionModelConfig] = None,
    ) -> str:
        """多模态分析封面图片，返回主题色/设计风格/核心元素分析文本。"""
        api_key = (config.api_key if config else "") or self.env_api_key
        if not api_key:
            return "Mock 分析：主题色 #D4945A 和 #2C1810，复古文艺风格，核心元素为书名、作者和装饰纹样。"
        model_name = (config.model_name if config and config.model_name else "") or "gpt-4o-mini"
        system_prompt = (
            config.system_prompt if config and config.system_prompt else DEFAULT_COVER_SYSTEM_PROMPT
        )
        base_url = config.base_url if config and config.base_url else None

        mime = _detect_mime(image_bytes[:12])
        data_url = f"data:{mime};base64,{base64.b64encode(image_bytes).decode('utf-8')}"

        # 显式超时并关闭 SDK 自带重试：超时后直接失败，不自动重试
        client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=LLM_REQUEST_TIMEOUT,
            max_retries=0,
        )
        try:
            resp = await client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": data_url}},
                        ],
                    },
                ],
                # 封面分析要求输出完整 JSON（art_style + 配色 + 核心元素 + 构图），
                # 中文每个字约占 1~2 token，300 上限常被截断导致 JSON 残缺，放宽到 800
                max_tokens=800,
            )
            return resp.choices[0].message.content or ""
        except Exception as exc:
            logger.warning("封面分析失败: %s", exc)
            return ""

    async def generate_prompt_stream(
        self,
        metadata: dict,
        config: Optional[TextModelConfig] = None,
        cover_analysis: str = "",
        text: str = "",
    ) -> AsyncGenerator[str, None]:
        api_key = (config.api_key if config else "") or self.env_api_key
        if not api_key:
            # Mock 打字机流
            yield "【Mock 响应开始】\n"
            await asyncio.sleep(0.5)
            yield "基于您提供的图书元数据：\n"
            for key, value in metadata.items():
                yield f"- {key}: {value}\n"
                await asyncio.sleep(0.3)
            if cover_analysis:
                yield f"\n封面分析结果：\n{cover_analysis}\n"
                await asyncio.sleep(0.5)
            if text:
                yield f"\n文本节点内容：\n{text}\n"
                await asyncio.sleep(0.5)
            yield "\n为您生成以下提示词片段：\n"
            await asyncio.sleep(0.5)
            yield "1. 柔和的灯光\n"
            await asyncio.sleep(0.3)
            yield "2. 细腻的笔触\n"
            await asyncio.sleep(0.3)
            yield "3. 高清 4K 画质\n"
            yield "【Mock 响应结束】"
            return

        model_name = (config.model_name if config and config.model_name else "") or "gpt-3.5-turbo"
        system_prompt = (
            config.system_prompt if config and config.system_prompt else DEFAULT_SYSTEM_PROMPT
        )
        base_url = config.base_url if config and config.base_url else None

        # 用户消息只携带数据（图书元数据 + 封面分析结果 + 文本节点内容），不含任何指令；
        # 图像提示词生成的指令来自阶段配置绑定的系统提示词模板。
        parts = []
        for k, v in metadata.items():
            if k in ("cover_image", "cover_image_local", "coverUrl"):
                continue
            parts.append(f"{k}: {v}")
        if cover_analysis:
            parts.append(f"封面分析结果：\n{cover_analysis}")
        if text:
            parts.append(f"文本节点内容：\n{text}")
        prompt = "\n".join(parts) if parts else ""

        # 显式超时并关闭 SDK 自带重试：超时后直接失败，不自动重试
        client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=LLM_REQUEST_TIMEOUT,
            max_retries=0,
        )
        try:
            stream = await client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": system_prompt or DEFAULT_SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                stream=True,
            )
            async for chunk in stream:
                if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content is not None:
                    yield chunk.choices[0].delta.content
        except Exception as e:
            logger.error("生成提示词失败: %s", e)
            raise LLMGenerationError(f"提示词生成失败: {e}") from e


llm_service = LLMService()
