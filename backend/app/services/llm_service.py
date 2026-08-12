import os
import asyncio
import base64
import logging
from pathlib import Path
from typing import AsyncGenerator, Dict, Optional
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


def _multimodal_messages(messages: list) -> list:
    """把携带 images 字段的 user 消息转换为 OpenAI 多模态 content 数组（text + image_url）。

    AI 对话节点前端随历史一并发送图片（data URL），此处拆解为标准多模态消息格式
    （与 analyze_cover 已验证的格式一致）；不携带图片的消息原样透传，assistant 消息
    保持字符串 content。模型需支持视觉输入，否则由模型服务商返回错误并透传到前端。
    """
    result: list = []
    for m in messages or []:
        if not isinstance(m, dict) or m.get("role") != "user":
            result.append(m)
            continue
        images = m.get("images")
        if not images:
            result.append(m)
            continue
        parts: list = []
        content = m.get("content")
        if content:
            parts.append({"type": "text", "text": str(content)})
        for img in images:
            if isinstance(img, str) and img:
                parts.append({"type": "image_url", "image_url": {"url": img}})
        clean = {k: v for k, v in m.items() if k != "images"}
        result.append({**clean, "content": parts})
    return result


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


    async def chat_stream(
        self,
        messages: list,
        config: Optional[TextModelConfig] = None,
    ) -> AsyncGenerator[Dict[str, str], None]:
        """多轮对话流式生成（AI 对话节点用）。

        messages 为 OpenAI 格式的消息数组（不含 system，由 config 的提示词模板注入）；
        每个元素形如 {"role": "user" | "assistant", "content": str}。
        每个增量产出 {"type": "content" | "reasoning", "delta": str}：
        content = 回答正文（前端拼入消息内容）；reasoning = 思考过程（DeepSeek 等
        端点的 reasoning_content，前端独立折叠展示，不混入正文）。
        无 API Key 时启用 Mock 流式回复，便于无配置环境下演示节点链路。
        """
        api_key = (config.api_key if config else "") or self.env_api_key
        if not api_key:
            last_user = ""
            for m in reversed(messages or []):
                if isinstance(m, dict) and m.get("role") == "user":
                    last_user = str(m.get("content", ""))
                    break
            yield {"type": "content", "delta": "【Mock 对话】\n"}
            await asyncio.sleep(0.4)
            yield {
                "type": "content",
                "delta": (
                    "当前未配置 LLM API Key / Agent，以下为演示回复。\n\n"
                    "你刚才说：\n\n"
                    f"> {last_user[:200]}\n\n"
                    "在管理后台「节点管理」为 AI 对话节点绑定模型（+提示词）或 FastClaw Agent 后，"
                    "即可获得真实的多轮对话回复。\n"
                ),
            }
            return

        model_name = (config.model_name if config and config.model_name else "") or "gpt-3.5-turbo"
        system_prompt = (
            config.system_prompt if config and config.system_prompt else ""
        ).strip()
        base_url = config.base_url if config and config.base_url else None

        # system 提示词（即节点绑定的提示词模板，充当助手人设）注入到消息开头；
        # 未绑定提示词模板时不注入，保持通用助手行为
        # 携带图片的 user 消息经 _multimodal_messages 转为多模态 content（text + image_url）
        full_messages: list = []
        if system_prompt:
            full_messages.append({"role": "system", "content": system_prompt})
        full_messages.extend(_multimodal_messages(messages or []))
        if not any(
            isinstance(m, dict) and m.get("role") == "user" for m in full_messages
        ):
            raise LLMGenerationError("AI 对话缺少用户消息")

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
                messages=full_messages,
                stream=True,
            )
            async for chunk in stream:
                if not chunk.choices or not chunk.choices[0].delta:
                    continue
                delta = chunk.choices[0].delta
                if delta.content is not None:
                    yield {"type": "content", "delta": delta.content}
                # DeepSeek 兼容端点的推理增量在 delta.reasoning_content（SDK 以 extra 字段透传）
                reasoning = getattr(delta, "reasoning_content", None)
                if isinstance(reasoning, str) and reasoning:
                    yield {"type": "reasoning", "delta": reasoning}
        except Exception as e:
            logger.error("AI 对话失败: %s", e)
            raise LLMGenerationError(f"AI 对话失败: {e}") from e


llm_service = LLMService()
