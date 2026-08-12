"""Skill Agent 事件流契约测试（升级 openai/openai-agents SDK 前必须先跑）。

用本地 mock OpenAI 兼容端点端到端验证 run_skill_agent 的事件流契约：
- 工具必须以 function 形式下发（LocalShellTool 是 hosted tool，ChatCompletions
  端点转换器会直接报错 → 曾导致「对话超时」的根因）；
- 事件流完整：tool_call → tool_result → content_delta（含 DeepSeek 风格
  reasoning_content，以独立 reasoning_delta 事件产出，不得混入正文）→ done；
- 工具调用参数 JSON 不得泄漏进 content_delta（曾渲染进聊天气泡）。

运行：cd backend && PYTHONPATH=. .venv/bin/python tests/test_skill_agent_stream.py
"""
import asyncio
import io
import json
import shutil
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from app.services.llm_service import _multimodal_messages
from app.services.skill_agent_service import (
    RUNTIME_ROOT,
    SkillRuntimeConfig,
    install_user_skill_zip,
    run_skill_agent,
)

USER = 99997
ROOT = RUNTIME_ROOT / str(USER)

CALLS = {"n": 0}


def sse_chunk(payload: dict) -> bytes:
    return f"data: {json.dumps(payload)}\n\n".encode()


def tool_call_stream(handler: BaseHTTPRequestHandler):
    """第一轮：返回一次 tool_call（local_shell, 参数 ls）"""
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-cache")
    handler.end_headers()
    base = {"id": "chatcmpl-1", "object": "chat.completion.chunk", "created": 0, "model": "mock-model"}
    handler.wfile.write(sse_chunk({
        **base, "choices": [{"index": 0, "delta": {"role": "assistant", "content": ""}, "finish_reason": None}]
    }))
    handler.wfile.flush()
    handler.wfile.write(sse_chunk({
        **base, "choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "id": "call_1", "type": "function", "function": {"name": "local_shell", "arguments": ""}}]}, "finish_reason": None}]
    }))
    handler.wfile.flush()
    handler.wfile.write(sse_chunk({
        **base, "choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "function": {"arguments": "{\"command\": [\"ls\", \"-la\"]}"}}]}, "finish_reason": None}]
    }))
    handler.wfile.flush()
    handler.wfile.write(sse_chunk({
        **base, "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]
    }))
    handler.wfile.flush()
    handler.wfile.write(sse_chunk({**base, "choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}))
    handler.wfile.flush()
    handler.wfile.write(b"data: [DONE]\n\n")
    handler.wfile.flush()


def text_stream(handler: BaseHTTPRequestHandler):
    """第二轮：返回纯文本（内容分两个 chunk + 一个 DeepSeek 风格 reasoning chunk）"""
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-cache")
    handler.end_headers()
    base = {"id": "chatcmpl-2", "object": "chat.completion.chunk", "created": 0, "model": "mock-model"}
    handler.wfile.write(sse_chunk({
        **base, "choices": [{"index": 0, "delta": {"role": "assistant", "content": ""}, "finish_reason": None}]
    }))
    handler.wfile.flush()
    # DeepSeek 风格：reasoning_content（应被产出为事件，不能静默）
    handler.wfile.write(sse_chunk({
        **base, "choices": [{"index": 0, "delta": {"reasoning_content": "让我思考一下"}, "finish_reason": None}]
    }))
    handler.wfile.flush()
    handler.wfile.write(sse_chunk({
        **base, "choices": [{"index": 0, "delta": {"content": "执行结果"}, "finish_reason": None}]
    }))
    handler.wfile.flush()
    handler.wfile.write(sse_chunk({
        **base, "choices": [{"index": 0, "delta": {"content": "是：目录内容如下"}, "finish_reason": None}]
    }))
    handler.wfile.flush()
    handler.wfile.write(sse_chunk({**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}))
    handler.wfile.flush()
    handler.wfile.write(sse_chunk({**base, "choices": [], "usage": {"prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30}}))
    handler.wfile.flush()
    handler.wfile.write(b"data: [DONE]\n\n")
    handler.wfile.flush()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        CALLS["n"] += 1
        # 记录请求体（诊断 tools / stream_options 等参数）
        req = {
            "stream": body.get("stream"),
            "stream_options": body.get("stream_options"),
            "tools": body.get("tools"),
            "tool_choice": body.get("tool_choice"),
            "parallel_tool_calls": body.get("parallel_tool_calls"),
            "n_messages": len(body.get("messages", [])),
            "last_role": body.get("messages", [{}])[-1].get("role"),
        }
        CALLS["last_request"] = req
        print(f"[mock] request #{CALLS['n']}: {json.dumps(req, ensure_ascii=False)}")
        # 断言：工具必须以 function 形式下发（这是根因修复的验收点）
        tools = body.get("tools") or []
        assert tools, "请求缺少 tools（LocalShellTool 曾导致 Hosted tools 报错）"
        for t in tools:
            assert t.get("type") == "function", f"工具必须是 function 类型，实际: {t}"
        if CALLS["n"] == 1:
            tool_call_stream(self)
        else:
            text_stream(self)

    def log_message(self, *args):
        pass


async def main():
    shutil.rmtree(ROOT, ignore_errors=True)
    # 安装一个 skill（让 instructions 非空）
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("demo/SKILL.md", "---\nname: demo\ndescription: 演示 skill\n---\n\n# demo\n列出目录内容")
        z.writestr("demo/scripts/run.sh", "echo hi")
    install_user_skill_zip(USER, buf.getvalue())  # 用户私有安装（不污染共享区）

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    port = server.server_address[1]
    print(f"[mock] server on :{port}")

    cfg = SkillRuntimeConfig(
        base_url=f"http://127.0.0.1:{port}/v1",
        api_key="sk-mock",
        model_name="mock-model",
        user_id=USER,
    )
    # 与 router /chat 一致：原始 wire 消息（content 字符串 + 可选 images）经
    # _multimodal_messages 转为多模态 content，再进入 run_skill_agent
    wire = [
        {
            "role": "user",
            "content": "请用 skill 列出工作区目录内容",
            "images": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="],
        }
    ]
    messages = _multimodal_messages(wire)

    events = []
    tool_calls = []
    reasoning_texts = []
    try:
        async for evt in run_skill_agent(cfg, messages):
            events.append(evt["type"])
            if evt["type"] in ("content_delta",):
                events.append(evt["data"]["delta"][:20])
            elif evt["type"] == "reasoning_delta":
                reasoning_texts.append(evt["data"]["delta"])
            elif evt["type"] == "tool_call":
                events.append(evt["data"]["name"])
                tool_calls.append(evt["data"])
            elif evt["type"] == "agent_file":
                events.append(evt["data"]["name"])
    finally:
        server.shutdown()

    print("\n[events]", events)
    assert "tool_call" in events, "缺少 tool_call 事件"
    assert "tool_result" in events, "缺少 tool_result 事件"
    assert "content_delta" in events, "缺少 content_delta 事件（这是超时根源！）"
    assert "done" in events, "缺少 done 事件"
    # 思考过程契约：reasoning 增量必须以独立 reasoning_delta 事件产出（前端折叠展示）
    assert "reasoning_delta" in events, "缺少 reasoning_delta 事件（思考过程应独立事件）"
    assert "让我思考一下" in "".join(reasoning_texts), f"思考文本缺失: {reasoning_texts}"
    content_text = "".join(
        e for e in events if isinstance(e, str) and e.startswith(("执行", "是"))
    )
    assert "让我思考一下" not in content_text, "思考过程混入了回答正文（content_delta）"
    # 工具调用参数契约：local_shell 且参数含 ls（此前仅断言事件存在）
    assert tool_calls, "缺少 tool_call 数据"
    assert tool_calls[0]["name"] == "local_shell", f"工具名异常: {tool_calls[0]}"
    assert '"ls"' in tool_calls[0]["arguments"], f"工具参数异常: {tool_calls[0]}"
    # 回归防护：工具参数 JSON 不得泄漏进 content_delta（曾渲染进聊天气泡）
    leaks = [e for e in events if isinstance(e, str) and e.lstrip().startswith('{"command"')]
    assert not leaks, f"工具参数泄漏为 content_delta: {leaks}"
    text = "".join(e for e in events if isinstance(e, str) and e.startswith("执行"))
    print("\n=== ALL OK: 事件流完整且无工具参数泄漏 ===")
    shutil.rmtree(ROOT, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(main())
