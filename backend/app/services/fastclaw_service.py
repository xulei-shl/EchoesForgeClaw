import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

# FastClaw /api/chat/stream 请求超时（秒）。agent 思考/工具执行可能很久，
# 连接阶段给 15s，读阶段不设上限（由调用方按空闲超时自行中止）。
CONNECT_TIMEOUT = 15.0

# agent_id → FastClaw 真实名字的进程内 TTL 缓存（key: (base_url, api_key, agent_id)）。
# 用于给存量配置回填可读名字：成功缓存 5 分钟，失败（FastClaw 不可达）30 秒内不重试。
_AGENT_NAME_CACHE: Dict[Tuple[str, str, str], Tuple[Optional[str], float]] = {}
_AGENT_NAME_CACHE_TTL = 300.0
_AGENT_NAME_FAIL_TTL = 30.0


class FastClawAgentError(Exception):
    """FastClaw Agent 调用失败（由 SSE 端点捕获后以 error 事件传导到前端）。"""


@dataclass
class FastClawRuntimeConfig:
    """一次 Agent 调用所需的运行时配置（由 StageConfig 解析而来）。"""

    base_url: str = ""
    api_key: str = ""
    agent_id: str = ""
    # 上游 end-user 标识（FastClaw 据此隔离会话/记忆/用量）；建议传「应用名-本地用户ID」
    end_user: str = ""


_IMAGE_URL_RE = re.compile(r"!\[[^\]]*\]\((https?://[^)\s]+)\)|(https?://[^\s)\]]+\.(?:png|jpe?g|webp|gif)[^\s)\]]*)")


def extract_image_url(text: str) -> Optional[str]:
    """从 agent 最终文本中提取第一张图片 URL（支持 markdown 图片语法与裸 URL）。"""
    if not text:
        return None
    m = _IMAGE_URL_RE.search(text)
    if not m:
        return None
    return m.group(1) or m.group(2)


class FastClawAgentService:
    """FastClaw Agent 调用代理。

    调用 FastClaw 仪表盘 SSE 接口 `POST /api/chat/stream`（Bearer API Key 鉴权），
    将内部的富事件流（content_delta / tool_call / tool_result / status /
    subagent_progress / error / done）归一化为统一的 dict 事件流。
    """

    async def run_agent(
        self,
        config: FastClawRuntimeConfig,
        message: str,
        session_key: str,
        images: Optional[List[str]] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """调用 agent 并产出归一化事件流。

        每个事件为 dict：
        - {"type": "content_delta", "data": {"delta": str}}
        - {"type": "tool_call", "data": {"id", "name", "arguments"}}
        - {"type": "tool_result", "data": {"id", "name", "result"}}
        - {"type": "status", "data": {"message": str}}
        - {"type": "subagent_progress", "data": {...}}
        - {"type": "error", "data": {"message": str}}
        - {"type": "done", "data": {}}
        """
        if not config.base_url or not config.api_key or not config.agent_id:
            raise FastClawAgentError("FastClaw Agent 配置不完整（base_url / api_key / agent_id）")

        url = config.base_url.rstrip("/") + "/api/chat/stream"
        body: Dict[str, Any] = {
            "agentId": config.agent_id,
            "sessionId": session_key,
            "message": message,
        }
        if images:
            body["imageUrls"] = images
        if params:
            body["params"] = params

        headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }
        if config.end_user:
            # 上游 end-user：让 FastClaw 将会话/记忆/用量按「应用用户」隔离
            headers["X-Fastclaw-End-User"] = config.end_user

        timeout = httpx.Timeout(connect=CONNECT_TIMEOUT, read=None, write=30.0, pool=30.0)
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                async with client.stream("POST", url, headers=headers, json=body) as resp:
                    if resp.status_code != 200:
                        detail = ""
                        try:
                            payload = await resp.aread()
                            detail = payload.decode("utf-8", errors="replace")[:300]
                        except Exception:
                            pass
                        raise FastClawAgentError(
                            f"FastClaw /api/chat/stream 返回 HTTP {resp.status_code}: {detail}"
                        )
                    saw_delta = False
                    async for event in _iter_sse(resp.aiter_lines()):
                        async for norm in _normalize_event(event):
                            # FastClaw 会先流式发 content_delta，再在本轮结束补发一条完整 content；
                            # 若本轮已收到增量，跳过该条完整 content，避免前端重复拼接文本。
                            # 工具调用/状态事件意味着新一轮助手回复开始（可能走非流式路径），
                            # 此时重置标记，让新一轮的完整 content 正常透传。
                            if norm["type"] == "content_delta":
                                saw_delta = True
                            elif norm["type"] in ("tool_call", "tool_result", "status", "subagent_progress"):
                                saw_delta = False
                            if norm["type"] == "content" and saw_delta:
                                continue
                            yield norm
        except httpx.HTTPError as exc:
            logger.warning("FastClaw Agent 调用失败: %s", exc)
            raise FastClawAgentError(f"FastClaw Agent 调用失败: {exc}") from exc

    async def list_agents(
        self,
        base_url: str,
        api_key: str,
        end_user: str = "",
        timeout: float = CONNECT_TIMEOUT,
    ) -> List[Dict[str, Any]]:
        """列出该 API Key 可访问的 FastClaw agent（供 admin 页面拉取候选）。

        优先调 FastClaw dashboard 接口 `GET /api/agents`——它返回 agent 的真实
        名字（AgentRecord.name）；上游 `GET /v1/agents` 的 name 字段与 id 相同
        （buildAgentList 硬编码 `"name": ag.Name()`），对人不可读。

        兼容性回退：/api/agents 不存在（旧版本）、报错或返回空列表时回退到
        /v1/agents（此时 name=id）。两者都**不能**带 X-Fastclaw-End-User 头，
        否则 FastClaw 会切到无 Agent 的 app-user 空间导致列表为空。
        """
        base = base_url.rstrip("/")
        headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
        if end_user:
            headers["X-Fastclaw-End-User"] = end_user
        async with httpx.AsyncClient(timeout=timeout) as client:
            # 1) dashboard 接口：带真实名字。仅当返回 200 且列表非空才采用，
            #    空列表不信任（agent 类型 Key 的「所属账号」可能没有 agent，
            #    但 /v1/agents 仍能按 ACL 列出绑定的 agent）。
            try:
                resp = await client.get(base + "/api/agents", headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    agents = data.get("agents") if isinstance(data, dict) else None
                    if agents:
                        return [
                            {
                                "id": a.get("id", "") if isinstance(a, dict) else "",
                                "name": (a.get("name") or a.get("id") or "") if isinstance(a, dict) else "",
                                # 该接口的 model 仅来自 agent 级配置（通常为空），
                                # 与 /v1/agents 的全量解析结果口径不同；前端暂不使用
                                "model": a.get("model", "") if isinstance(a, dict) else "",
                            }
                            for a in agents
                        ]
            except (httpx.HTTPError, ValueError):
                pass  # 网络/JSON 解析失败走回退分支
            # 2) 上游接口回退：name 与 id 相同
            try:
                resp = await client.get(base + "/v1/agents", headers=headers)
            except httpx.HTTPError as exc:
                raise FastClawAgentError(f"连接 FastClaw 失败: {exc}") from exc
            if resp.status_code != 200:
                raise FastClawAgentError(f"FastClaw /v1/agents 返回 HTTP {resp.status_code}")
            data = resp.json()
            return data.get("agents", []) if isinstance(data, dict) else []

    async def resolve_agent_name(
        self,
        base_url: str,
        api_key: str,
        agent_id: str,
        timeout: float = 3.0,
    ) -> Optional[str]:
        """解析 agent_id 对应的 FastClaw 真实名字（AgentRecord.name，如 "Xulei"）。

        带进程内 TTL 缓存（成功 5 分钟 / 失败 30 秒）；FastClaw 不可达或未找到时
        返回 None 且短时间内不重试，用于给存量配置回填可读名字（best-effort，不抛错）。
        """
        if not agent_id:
            return None
        key = (base_url.rstrip("/"), api_key, agent_id)
        now = time.monotonic()
        cached = _AGENT_NAME_CACHE.get(key)
        if cached and cached[1] > now:
            return cached[0]
        name: Optional[str] = None
        try:
            agents = await self.list_agents(
                base_url=base_url, api_key=api_key, timeout=timeout
            )
            for a in agents:
                if isinstance(a, dict) and a.get("id") == agent_id:
                    candidate = a.get("name")
                    # 仅接受与 id 不同的可读名字：/v1/agents 回退路径 name==id，
                    # 此时视为未解析（返回 None），避免把 agt_xxx 当名字持久化
                    if isinstance(candidate, str) and candidate and candidate != agent_id:
                        name = candidate
                    break
        except Exception:
            name = None
        _AGENT_NAME_CACHE[key] = (
            name,
            now + (_AGENT_NAME_CACHE_TTL if name else _AGENT_NAME_FAIL_TTL),
        )
        return name


async def _iter_sse(lines):
    """按 SSE 块累积解析 data: 行（忽略 id:/event:/注释行，支持多行 data）。"""
    data_lines: List[str] = []
    async for line in lines:
        line = line.rstrip("\r")
        if line == "":
            if data_lines:
                payload = "\n".join(data_lines)
                data_lines = []
                yield payload
            continue
        if line.startswith("data:"):
            data_lines.append(line[5:].lstrip(" "))
        # 其他行（id: / event: / : ping）忽略


async def _normalize_event(payload: str):
    """解析 FastClaw 事件 JSON 并归一化为内部事件 dict。"""
    try:
        evt = json.loads(payload)
    except (ValueError, TypeError):
        # 非 JSON 行（如代理注入的杂讯）直接忽略，不中断流
        return
    if not isinstance(evt, dict):
        return
    etype = evt.get("type", "")
    data = evt.get("data") or {}
    if not isinstance(data, dict):
        data = {}

    if etype == "content_delta":
        delta = data.get("delta") or ""
        if delta:
            yield {"type": "content_delta", "data": {"delta": delta}}
    elif etype in ("content", "message"):
        content = data.get("content") or data.get("text") or ""
        if content:
            # 与 content_delta 区分：标记为 content（完整文本），由调用方按需去重
            yield {"type": "content", "data": {"delta": content}}
    elif etype == "tool_call":
        yield {
            "type": "tool_call",
            "data": {
                "id": data.get("id", ""),
                "name": data.get("name", ""),
                "arguments": data.get("arguments", ""),
            },
        }
    elif etype == "tool_result":
        yield {
            "type": "tool_result",
            "data": {
                "id": data.get("id", ""),
                "name": data.get("name", ""),
                "result": data.get("result", ""),
            },
        }
    elif etype in ("tool_progress", "status"):
        yield {"type": "status", "data": {"message": data.get("message") or data.get("tool") or str(data)}}
    elif etype == "subagent_progress":
        yield {"type": "subagent_progress", "data": data}
    elif etype == "error":
        yield {"type": "error", "data": {"message": data.get("message") or str(data)}}
    elif etype == "done":
        yield {"type": "done", "data": {}}
    # 其余事件（turn_pending / steer 等）忽略


fastclaw_agent_service = FastClawAgentService()
