"""LLM 对话流推理/回答拆分契约测试。

验证 llm_service.chat_stream 的事件契约（DeepSeek 等兼容端点的 thinking 与正文分离）：
- reasoning_content 增量 -> {"type": "reasoning", "delta"}（不混入正文）；
- content 增量 -> {"type": "content", "delta"}；
- 无 API Key 的 Mock 路径全部为 content 事件；
- 推理为空串 / 未提供时不得产出多余事件。

运行：cd backend && PYTHONPATH=. .venv/bin/python tests/test_llm_reasoning_split.py
"""
import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from app.services.llm_service import LLMService, TextModelConfig


def sse_chunk(payload: dict) -> bytes:
    return f"data: {json.dumps(payload)}\n\n".encode()


class ReasoningHandler(BaseHTTPRequestHandler):
    """返回 reasoning_content（两段）-> content（两段）-> 结束的流式响应。"""

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        base = {"id": "chatcmpl-r", "object": "chat.completion.chunk", "created": 0, "model": "mock-model"}
        for delta in (
            {"reasoning_content": "think-a"},
            {"reasoning_content": "think-b"},
            {"content": "hello "},
            {"content": "world"},
        ):
            self.wfile.write(sse_chunk({**base, "choices": [{"index": 0, "delta": delta}]}))
            self.wfile.flush()
        self.wfile.write(sse_chunk({**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}))
        self.wfile.flush()
        self.wfile.write(sse_chunk({**base, "choices": [], "usage": {"total_tokens": 10}}))
        self.wfile.flush()
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

    def log_message(self, *args):
        pass


class PlainHandler(BaseHTTPRequestHandler):
    """无推理字段的普通端点：只返回 content，确保不产出多余 reasoning 事件。"""

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        base = {"id": "chatcmpl-p", "object": "chat.completion.chunk", "created": 0, "model": "mock-model"}
        self.wfile.write(sse_chunk({**base, "choices": [{"index": 0, "delta": {"content": "仅正文"}}]}))
        self.wfile.flush()
        self.wfile.write(sse_chunk({**base, "choices": [], "usage": {"total_tokens": 5}}))
        self.wfile.flush()
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

    def log_message(self, *args):
        pass


def start_server(handler_cls):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


async def main():
    service = LLMService()
    failures = []

    def check(name, cond, detail=""):
        tag = "OK " if cond else "FAIL"
        print(f"{tag} {name} {detail}")
        if not cond:
            failures.append(name)

    # 1) 推理与正文拆分（顺序 / 内容 / 类型）
    srv = start_server(ReasoningHandler)
    try:
        cfg = TextModelConfig(
            api_key="sk-mock",
            base_url=f"http://127.0.0.1:{srv.server_address[1]}/v1",
            model_name="mock-model",
        )
        events = [c async for c in service.chat_stream([{"role": "user", "content": "hi"}], cfg)]
        types = [e["type"] for e in events]
        check("事件类型顺序", types == ["reasoning", "reasoning", "content", "content"], f"-> {types}")
        check(
            "推理文本完整",
            "".join(e["delta"] for e in events if e["type"] == "reasoning") == "think-athink-b",
        )
        check(
            "正文文本完整",
            "".join(e["delta"] for e in events if e["type"] == "content") == "hello world",
        )
        check("推理不混入正文", all("think" not in e["delta"] for e in events if e["type"] == "content"))
    finally:
        srv.shutdown()

    # 2) 无推理字段的普通端点：不产出 reasoning 事件
    srv2 = start_server(PlainHandler)
    try:
        cfg2 = TextModelConfig(
            api_key="sk-mock",
            base_url=f"http://127.0.0.1:{srv2.server_address[1]}/v1",
            model_name="mock-model",
        )
        events2 = [c async for c in service.chat_stream([{"role": "user", "content": "hi"}], cfg2)]
        check("普通端点仅 content 事件", all(e["type"] == "content" for e in events2), f"-> {events2}")
    finally:
        srv2.shutdown()

    # 3) Mock 路径（无 API Key）：全部为 content 事件
    mock = [c async for c in service.chat_stream([{"role": "user", "content": "x"}], None)]
    check("Mock 路径均为 content", mock and all(e["type"] == "content" for e in mock), f"-> {mock}")

    print("\n=== RESULT:", "ALL PASS" if not failures else f"{len(failures)} FAILURES: {failures} ===")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
