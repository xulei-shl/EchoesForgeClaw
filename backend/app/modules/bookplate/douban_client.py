#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""豆瓣 ISBN API 极简客户端（独立可运行，零项目依赖）.

功能：传入 ISBN → 调用豆瓣移动版 API → 返回图书元数据。

接口: GET https://m.douban.com/rexxar/api/v2/book/isbn/{isbn}
说明: 该接口为豆瓣移动版内部接口，必须携带 Referer: https://m.douban.com/，
      否则返回 403 / 业务错误码。

依赖:
    pip install httpx        # 异步版本
    pip install requests     # 同步版本（二选一即可）

用法:
    # 命令行
    python douban_isbn_api.py 9787532776870
    python douban_isbn_api.py 9787532776870 9787020002207 --raw

    # 代码引用（同步）
    from douban_isbn_api import fetch_book_sync
    book = fetch_book_sync("9787532776870")
    print(book["title"], book["rating"])

    # 代码引用（异步 / 批量）
    import asyncio
    from douban_isbn_api import DoubanIsbnClient
    async def main():
        async with DoubanIsbnClient() as client:
            results = await client.fetch_batch(["9787532776870", "9787020002207"])
    asyncio.run(main())
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import re
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional

# ---------------------------------------------------------------------------
# 常量配置
# ---------------------------------------------------------------------------

BASE_URL = "https://m.douban.com/rexxar/api/v2/book/isbn"

# 移动端 User-Agent 池，逐次轮换以降低被识别风险
USER_AGENTS = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 11; Pixel 4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 12; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Mobile Safari/537.36",
]

# 必要请求头：Referer 缺失会被拒绝
BASE_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://m.douban.com/",
    "Accept-Language": "zh-CN,zh;q=0.9",
}

# 封面图片 CDN 请求头：豆瓣图片 CDN 接受以下任一 Referer（反爬/限流时轮换使用）
COVER_REFERERS = (
    "https://m.douban.com/",
    "https://book.douban.com/",
    "https://www.douban.com/",
)

# 有效 ISBN：10 位或 13 位纯数字
ISBN_PATTERN = re.compile(r"^(\d{10}|\d{13})$")

# 豆瓣业务错误码：请求被判定为非法（通常是反爬拦截）
INVALID_REQUEST_CODES = {1287, 1284}

# 可重试的 HTTP 状态码
RETRYABLE_STATUS = {429, 500, 502, 503}


# ---------------------------------------------------------------------------
# ISBN 标准化
# ---------------------------------------------------------------------------

def normalize_isbn(isbn: Any) -> Optional[str]:
    """标准化 ISBN，返回 10 位或 13 位纯数字；无效返回 None.

    兼容常见脏数据：
    - 带分隔符：``978-7-5327-7687-0``
    - Excel 浮点：``9787532776870.0``
    - Excel 科学计数法：``9.78753e+12``
    - None / 空字符串
    """
    if isbn is None:
        return None

    # float 先转 int，避免小数点与科学计数法
    if isinstance(isbn, float):
        if isbn != isbn:  # NaN
            return None
        try:
            text = str(int(isbn))
        except (ValueError, OverflowError):
            text = str(isbn)
    elif isinstance(isbn, int):
        text = str(isbn)
    else:
        text = str(isbn).strip()

    if not text:
        return None

    cleaned = re.sub(r"[^0-9]", "", text)
    return cleaned if ISBN_PATTERN.match(cleaned) else None


# ---------------------------------------------------------------------------
# 响应字段映射
# ---------------------------------------------------------------------------

def _join(value: Any) -> str:
    """列表拼接为 ``a / b / c``，其他类型转字符串."""
    if isinstance(value, list):
        return " / ".join(str(item).strip() for item in value if item)
    return str(value or "").strip()


def _first(value: Any) -> str:
    """取列表首项，其他类型转字符串."""
    if isinstance(value, list):
        return str(value[0]).strip() if value else ""
    if value in (None, [], {}):
        return ""
    return str(value).strip()


def map_book_payload(payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """将豆瓣原始响应映射为扁平的统一字段."""
    if not payload:
        return {}

    rating = payload.get("rating") or {}
    series = payload.get("book_series") or {}

    data: Dict[str, Any] = {
        "title": payload.get("title") or "",
        "subtitle": _join(payload.get("subtitle") or []),
        "original_title": payload.get("origin_title") or "",
        "author": _join(payload.get("author") or []),
        "translator": _join(payload.get("translator") or []),
        "publisher": _first(payload.get("press")),
        "producer": _first(payload.get("producers")),
        "pub_year": _first(payload.get("pubdate")),
        "isbn": payload.get("isbn") or "",
        "pages": _first(payload.get("pages")),
        "price": _first(payload.get("price")),
        "binding": payload.get("binding") or "",
        "series": series.get("title") or "",
        "series_link": series.get("url") or "",
        "rating": rating.get("value") or 0,
        "rating_count": rating.get("count") or 0,
        "cover_image": (payload.get("cover") or {}).get("url") or payload.get("cover_url") or "",
        "summary": payload.get("intro") or "",
        "author_intro": payload.get("author_intro") or "",
        "catalog": payload.get("catalog") or "",
        "url": payload.get("url") or payload.get("share_url") or "",
    }

    try:
        data["rating"] = float(data["rating"])
    except (TypeError, ValueError):
        data["rating"] = 0.0
    try:
        data["rating_count"] = int(data["rating_count"])
    except (TypeError, ValueError):
        data["rating_count"] = 0

    return data


def _check_business_error(data: Dict[str, Any]) -> bool:
    """判断响应体是否为豆瓣业务错误（被拦截）."""
    try:
        code = int(data.get("code", 0) or 0)
    except (TypeError, ValueError):
        code = 0
    msg = str(data.get("msg", "") or "")
    return code in INVALID_REQUEST_CODES or "invalid_request" in msg


# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------

@dataclass
class ClientConfig:
    """客户端配置（默认值为稳妥的低频抓取策略）."""

    base_url: str = BASE_URL
    timeout: float = 15.0
    proxy: str = ""             # HTTP 代理，如 http://127.0.0.1:7890（留空不使用）

    # 限流
    max_concurrent: int = 2          # 最大并发
    qps: float = 0.5                 # 每秒请求数，建议 <= 0.5

    # 每次请求前的随机延迟，模拟人工节奏
    random_delay: bool = True
    delay_min: float = 1.5
    delay_max: float = 3.5

    # 批次冷却：每处理 N 条长休息一次
    cooldown_enabled: bool = True
    cooldown_interval: int = 20
    cooldown_min: float = 30.0
    cooldown_max: float = 60.0

    # 重试：退避秒数按尝试次数取用，超出则复用末位
    retry_times: int = 3
    retry_backoff: List[float] = field(default_factory=lambda: [2, 5, 10])

    def backoff_at(self, attempt: int) -> float:
        if not self.retry_backoff:
            return float(min(attempt, 5))
        idx = min(max(attempt - 1, 0), len(self.retry_backoff) - 1)
        return float(self.retry_backoff[idx])


# ---------------------------------------------------------------------------
# 异步限流器
# ---------------------------------------------------------------------------

class AsyncRateLimiter:
    """并发信号量 + QPS 节流."""

    def __init__(self, max_concurrent: int = 2, qps: float = 0.5):
        self._semaphore = asyncio.Semaphore(max(1, int(max_concurrent or 1)))
        self._qps = max(qps or 0, 0)
        self._last_ts = 0.0
        self._lock = asyncio.Lock()

    async def __aenter__(self):
        await self._semaphore.acquire()
        if self._qps > 0:
            async with self._lock:
                wait = (1.0 / self._qps) - (time.monotonic() - self._last_ts)
                if wait > 0:
                    await asyncio.sleep(wait)
                self._last_ts = time.monotonic()
        return self

    async def __aexit__(self, exc_type, exc, tb):
        self._semaphore.release()


# ---------------------------------------------------------------------------
# 异步客户端
# ---------------------------------------------------------------------------

class DoubanIsbnClient:
    """豆瓣 ISBN API 异步客户端.

    内置限流、随机延迟、UA 轮换、批次冷却与指数退避重试。
    """

    def __init__(self, config: Optional[ClientConfig] = None):
        import httpx  # 延迟导入，便于同步用户只装 requests

        self.config = config or ClientConfig()
        self._client = httpx.AsyncClient(
            timeout=self.config.timeout,
            headers={**BASE_HEADERS, "User-Agent": random.choice(USER_AGENTS)},
            proxy=self.config.proxy or None,
        )
        self._limiter = AsyncRateLimiter(self.config.max_concurrent, self.config.qps)
        self._count = 0
        self._ua_index = 0

    async def __aenter__(self) -> "DoubanIsbnClient":
        return self

    async def __aexit__(self, exc_type, exc, tb):
        await self.close()

    async def close(self) -> None:
        await self._client.aclose()

    def _rotate_ua(self) -> None:
        self._ua_index = (self._ua_index + 1) % len(USER_AGENTS)
        self._client.headers["User-Agent"] = USER_AGENTS[self._ua_index]

    async def _pace(self) -> None:
        """请求前节奏控制：随机延迟 + 批次冷却."""
        if self.config.random_delay:
            await asyncio.sleep(random.uniform(self.config.delay_min, self.config.delay_max))

        if (
            self.config.cooldown_enabled
            and self._count > 0
            and self._count % self.config.cooldown_interval == 0
        ):
            cooldown = random.uniform(self.config.cooldown_min, self.config.cooldown_max)
            print(f"[cooldown] 已处理 {self._count} 条，休息 {cooldown:.1f}s", file=sys.stderr)
            await asyncio.sleep(cooldown)

    async def fetch_raw(self, isbn: str) -> Optional[Dict[str, Any]]:
        """获取豆瓣原始响应 JSON；未找到或失败返回 None."""
        import httpx

        normalized = normalize_isbn(isbn)
        if not normalized:
            print(f"[warn] 无效 ISBN: {isbn}", file=sys.stderr)
            return None

        self._count += 1
        self._rotate_ua()
        await self._pace()

        for attempt in range(1, self.config.retry_times + 1):
            try:
                async with self._limiter:
                    response = await self._client.get(f"{self.config.base_url}/{normalized}")
            except httpx.HTTPError as exc:
                print(f"[warn] 请求异常 isbn={normalized} attempt={attempt}: {exc}", file=sys.stderr)
                await asyncio.sleep(self.config.backoff_at(attempt))
                continue

            if response.status_code == 200:
                try:
                    data = response.json()
                except Exception:
                    print(f"[warn] JSON 解析失败 isbn={normalized}", file=sys.stderr)
                    return None
                if _check_business_error(data):
                    print(f"[warn] 业务错误（可能被反爬拦截） isbn={normalized}", file=sys.stderr)
                    return None
                return data

            if response.status_code == 404:
                print(f"[info] 未收录 isbn={normalized}", file=sys.stderr)
                return None

            if response.status_code in RETRYABLE_STATUS:
                delay = self.config.backoff_at(attempt)
                print(
                    f"[warn] HTTP {response.status_code}，{delay}s 后重试 isbn={normalized}",
                    file=sys.stderr,
                )
                await asyncio.sleep(delay)
                continue

            print(f"[error] 异常状态 {response.status_code} isbn={normalized}", file=sys.stderr)
            return None

        print(f"[error] 重试耗尽仍失败 isbn={normalized}", file=sys.stderr)
        return None

    async def fetch(self, isbn: str) -> Optional[Dict[str, Any]]:
        """获取图书信息并映射为统一字段；失败返回 None."""
        payload = await self.fetch_raw(isbn)
        return map_book_payload(payload) if payload else None

    async def fetch_batch(
        self,
        isbn_list: Iterable[Any],
        raw: bool = False,
    ) -> Dict[str, Optional[Dict[str, Any]]]:
        """批量获取（顺序执行以保持反爬节奏）.

        Args:
            isbn_list: ISBN 集合，自动标准化并去重
            raw: True 返回原始 JSON，False 返回映射后字段

        Returns:
            ``{标准化ISBN: 数据或 None}``
        """
        targets: List[str] = []
        seen = set()
        for item in isbn_list:
            normalized = normalize_isbn(item)
            if normalized and normalized not in seen:
                seen.add(normalized)
                targets.append(normalized)

        results: Dict[str, Optional[Dict[str, Any]]] = {}
        total = len(targets)
        for i, isbn in enumerate(targets, 1):
            data = await (self.fetch_raw(isbn) if raw else self.fetch(isbn))
            results[isbn] = data
            print(f"[{i}/{total}] {isbn} {'OK' if data else 'MISS'}", file=sys.stderr)
        return results


# ---------------------------------------------------------------------------
# 同步便捷函数（仅需 requests，适合一次性查询）
# ---------------------------------------------------------------------------

def fetch_book_sync(
    isbn: Any,
    timeout: float = 15.0,
    raw: bool = False,
) -> Optional[Dict[str, Any]]:
    """同步获取单本图书信息；失败返回 None.

    Args:
        isbn: 任意格式 ISBN
        timeout: 请求超时秒数
        raw: True 返回原始 JSON，False 返回映射后字段
    """
    import requests

    normalized = normalize_isbn(isbn)
    if not normalized:
        return None

    headers = {**BASE_HEADERS, "User-Agent": random.choice(USER_AGENTS)}
    try:
        response = requests.get(
            f"{BASE_URL}/{normalized}", headers=headers, timeout=timeout
        )
    except requests.RequestException as exc:
        print(f"[error] 请求失败 isbn={normalized}: {exc}", file=sys.stderr)
        return None

    if response.status_code != 200:
        print(f"[error] HTTP {response.status_code} isbn={normalized}", file=sys.stderr)
        return None

    try:
        data = response.json()
    except ValueError:
        return None

    if _check_business_error(data):
        print(f"[warn] 业务错误（可能被反爬拦截） isbn={normalized}", file=sys.stderr)
        return None

    return data if raw else map_book_payload(data)


# ---------------------------------------------------------------------------
# 命令行入口
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="豆瓣 ISBN API 查询工具",
        epilog="示例: python douban_isbn_api.py 9787532776870 --raw",
    )
    parser.add_argument("isbn", nargs="+", help="一个或多个 ISBN")
    parser.add_argument("--raw", action="store_true", help="输出豆瓣原始 JSON")
    parser.add_argument("--sync", action="store_true", help="使用同步模式（requests，单条快查）")
    parser.add_argument("--qps", type=float, default=0.5, help="每秒请求数（默认 0.5）")
    parser.add_argument("--no-delay", action="store_true", help="关闭随机延迟与批次冷却")
    args = parser.parse_args()

    if args.sync:
        output = {
            isbn: fetch_book_sync(isbn, raw=args.raw) for isbn in args.isbn
        }
    else:
        config = ClientConfig(qps=args.qps)
        if args.no_delay:
            config.random_delay = False
            config.cooldown_enabled = False

        async def run() -> Dict[str, Optional[Dict[str, Any]]]:
            async with DoubanIsbnClient(config) as client:
                return await client.fetch_batch(args.isbn, raw=args.raw)

        output = asyncio.run(run())

    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0 if any(output.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
