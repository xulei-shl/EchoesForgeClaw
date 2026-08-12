"""多轮对话契约测试（升级 openai/openai-agents SDK 前必须先跑）。

回归点：assistant 历史消息必须以 input_text 呈现。output_text 是输出类型，
ChatCompletions 转换器（Converter.extract_all_content）只认输入类型，
第二轮起含 assistant 历史时曾抛：
    Skill Agent 执行失败: Unknown content: {'type': 'output_text', ...}

运行：cd backend && PYTHONPATH=. .venv/bin/python tests/test_multiturn_history.py
"""
import asyncio
import json
import shutil
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from app.services.skill_agent_service import (
    RUNTIME_ROOT,
    SkillRuntimeConfig,
    _to_input_items,
    run_skill_agent,
)

USER = 99971
ROOT = RUNTIME_ROOT / str(USER)


def sse_chunk(payload: dict) -> bytes:
    return f"data: {json.dumps(payload)}\n\n".encode()


def text_stream(handler: BaseHTTPRequestHandler):
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-cache")
    handler.end_headers()
    base = {"id": "chatcmpl-mt", "object": "chat.completion.chunk", "created": 0, "model": "mock-model"}
    handler.wfile.write(sse_chunk({
        **base, "choices": [{"index": 0, "delta": {"role": "assistant", "content": ""}, "finish_reason": None}]
    }))
    handler.wfile.flush()
    handler.wfile.write(sse_chunk({
        **base, "choices": [{"index": 0, "delta": {"content": "第二轮回答"}, "finish_reason": None}]
    }))
    handler.wfile.flush()
    handler.wfile.write(sse_chunk({**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}))
    handler.wfile.flush()
    handler.wfile.write(sse_chunk({**base, "choices": [], "usage": {"total_tokens": 10}}))
    handler.wfile.flush()
    handler.wfile.write(b"data: [DONE]\n\n")
    handler.wfile.flush()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        # 验证发送给端点的消息：assistant 历史应出现在 messages 中
        roles = [m.get("role") for m in body.get("messages", [])]
        print(f"[mock] messages roles: {roles}")
        assert "assistant" in roles, f"assistant 历史未发送: {roles}"
        text_stream(self)

    def log_message(self, *args):
        pass


async def main():
    shutil.rmtree(ROOT, ignore_errors=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    cfg = SkillRuntimeConfig(
        base_url=f"http://127.0.0.1:{server.server_address[1]}/v1",
        api_key="sk-mock",
        model_name="mock-model",
        user_id=USER,
    )
    # 多轮历史：第一轮 user + assistant 回复
    messages = [
        {"role": "user", "content": "第一轮提问"},
        {"role": "assistant", "content": "第一轮回答"},
        {"role": "user", "content": "第二轮提问"},
    ]
    # 1) _to_input_items 单元断言：assistant 必须以 input_text 呈现
    items = _to_input_items(messages)
    asst = [i for i in items if i.get("role") == "assistant"]
    assert asst, "缺少 assistant 消息"
    assert asst[0]["content"][0]["type"] == "input_text", f"assistant 类型错误: {asst}"
    print("[unit] assistant ->", asst[0]["content"][0]["type"], "OK")
    # 1b) system 角色原样透传 / 多段 assistant 合并
    mixed = _to_input_items([
        {"role": "system", "content": "你是助手"},
        {"role": "assistant", "content": [{"type": "output_text", "text": "第一段"}, {"type": "output_text", "text": "第二段"}]},
    ])
    sys_msgs = [i for i in mixed if i.get("role") == "system"]
    assert sys_msgs and sys_msgs[0]["content"] == "你是助手", f"system 透传失败: {mixed}"
    asst2 = [i for i in mixed if i.get("role") == "assistant"][0]
    assert asst2["content"][0]["text"] == "第一段\n第二段", f"多段合并失败: {asst2}"
    print("[unit] system 透传 + 多段 assistant 合并 OK")

    # 2) 端到端：多轮历史必须正常流式（此前抛 Unknown content）
    events = []
    async for evt in run_skill_agent(cfg, messages):
        events.append(evt["type"])
        if evt["type"] == "content_delta":
            events.append(evt["data"]["delta"])
    print("[e2e]", events)
    assert "done" in events, f"事件流未完成: {events}"
    assert "第二轮回答" in events, f"第二轮文本缺失: {events}"
    print("\n=== ALL OK: 多轮对话正常（assistant 历史以 input_text 呈现）===")
    server.shutdown()
    shutil.rmtree(ROOT, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(main())
