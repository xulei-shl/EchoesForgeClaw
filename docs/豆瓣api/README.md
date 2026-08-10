# 豆瓣 ISBN API 使用参考

> **用途**: 传入 ISBN → 调用豆瓣 API → 获取图书完整元数据
> **提炼来源**: `src/core/douban/api/isbn_client.py`、`src/core/douban/api/subject_mapper.py`、`src/core/douban/api/rate_limiter.py`
> **配套代码**: [`douban_isbn_api.py`](./douban_isbn_api.py)（独立可运行，零项目依赖）

---

## 目录

1. [接口说明](#1-接口说明)
2. [快速开始](#2-快速开始)
3. [核心实现要点](#3-核心实现要点)
4. [响应字段映射](#4-响应字段映射)
5. [反爬策略](#5-反爬策略)
6. [错误处理](#6-错误处理)
7. [最小实现片段](#7-最小实现片段)
8. [注意事项](#8-注意事项)

---

## 1. 接口说明

| 项目 | 内容 |
| --- | --- |
| 地址 | `https://m.douban.com/rexxar/api/v2/book/isbn/{isbn}` |
| 方法 | `GET` |
| 认证 | 无需 Token，但**必须携带 `Referer: https://m.douban.com/`** |
| ISBN | 10 位或 13 位纯数字，需先剔除 `-` 等分隔符 |
| 返回 | JSON，图书元数据 |

这是豆瓣移动版（rexxar）的内部接口。缺少 `Referer` 会被直接拒绝，这是最常见的接入失败原因。

### 最简验证

```bash
curl -H "Referer: https://m.douban.com/" \
     -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1" \
     "https://m.douban.com/rexxar/api/v2/book/isbn/9787532776870"
```

---

## 2. 快速开始

### 安装依赖

```bash
pip install httpx      # 异步 / 批量
pip install requests   # 同步单条（二选一即可）
```

### 命令行

```bash
# 单条查询（映射后字段）
python douban_isbn_api.py 9787532776870

# 多条 + 原始 JSON
python douban_isbn_api.py 9787532776870 9787020002207 --raw

# 同步快查，跳过延迟
python douban_isbn_api.py 9787532776870 --sync
```

### 同步调用（最简）

```python
from douban_isbn_api import fetch_book_sync

book = fetch_book_sync("978-7-5327-7687-0")   # 分隔符会自动清洗
if book:
    print(book["title"], book["author"], book["rating"])
```

### 异步批量调用

```python
import asyncio
from douban_isbn_api import DoubanIsbnClient, ClientConfig

async def main():
    config = ClientConfig(qps=0.5, max_concurrent=2)
    async with DoubanIsbnClient(config) as client:
        results = await client.fetch_batch(["9787532776870", "9787020002207"])
        for isbn, data in results.items():
            print(isbn, data["title"] if data else "未找到")

asyncio.run(main())
```

---

## 3. 核心实现要点

完整流程只有四步，其余代码都在做稳定性保障：

```
ISBN 标准化 → 构造请求头 → GET 请求 → 解析并映射响应
```

### 3.1 ISBN 标准化（必做）

Excel 来源的 ISBN 常见脏数据：

| 原始值 | 类型 | 标准化结果 |
| --- | --- | --- |
| `978-7-5327-7687-0` | str | `9787532776870` |
| `9787532776870.0` | float | `9787532776870` |
| `9.78753e+12` | float | `9787532776870` |
| `""` / `None` / `NaN` | - | `None`（跳过） |

处理顺序：**先按类型转文本，再剔除非数字字符，最后校验 10/13 位**。
若直接 `str(float_value)` 会残留 `.0` 或科学计数法，导致请求 404。

### 3.2 请求头

```python
headers = {
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://m.douban.com/",      # 必需
    "Accept-Language": "zh-CN,zh;q=0.9",
    "User-Agent": "<移动端 UA>",              # 建议轮换
}
```

---

## 4. 响应字段映射

豆瓣原始响应字段名与直觉不完全一致，需做一层映射：

| 统一字段 | 豆瓣原始字段 | 处理方式 |
| --- | --- | --- |
| `title` | `title` | 直接取值 |
| `subtitle` | `subtitle` | 列表用 ` / ` 拼接 |
| `original_title` | `origin_title` | 直接取值 |
| `author` | `author` | 列表用 ` / ` 拼接 |
| `translator` | `translator` | 列表用 ` / ` 拼接 |
| `publisher` | `press` | **取列表首项** |
| `producer` | `producers` | 取列表首项 |
| `pub_year` | `pubdate` | 取列表首项 |
| `isbn` | `isbn` | 直接取值 |
| `pages` | `pages` | 取列表首项 |
| `price` | `price` | 取列表首项 |
| `binding` | `binding` | 直接取值 |
| `series` | `book_series.title` | 嵌套对象 |
| `series_link` | `book_series.url` | 嵌套对象 |
| `rating` | `rating.value` | 嵌套 + 转 `float` |
| `rating_count` | `rating.count` | 嵌套 + 转 `int` |
| `cover_image` | `cover.url` 或 `cover_url` | 优先取嵌套对象 `cover.url`，兜底 `cover_url` 字符串 |
| `summary` | `intro` | 直接取值 |
| `author_intro` | `author_intro` | 直接取值 |
| `catalog` | `catalog` | 直接取值 |
| `url` | `url` 或 `share_url` | 取先存在者 |

**易错点**：
- `press`、`pubdate`、`pages`、`price` 返回的是**数组**，不是字符串。
- `rating` 是嵌套对象 `{"value": 8.5, "count": 1234}`，不是标量。
- 无人评分时 `rating.value` 可能为 `0` 或缺失，需兜底转换。

---

## 5. 反爬策略

豆瓣对该接口限制较严，高频请求会被封 IP。生产环境建议全部保留以下机制：

| 机制 | 推荐值 | 说明 |
| --- | --- | --- |
| QPS | `0.5`（即 2 秒 1 次） | 超过易触发限流 |
| 并发数 | `2` | 不建议再高 |
| 随机延迟 | `1.5 ~ 3.5s` | 每次请求前，打散固定节奏 |
| 批次冷却 | 每 `20` 条休息 `30 ~ 60s` | 长任务必备 |
| UA 轮换 | 每次请求切换 | 使用移动端 UA 池 |
| 重试退避 | `[2, 5, 10]` 秒，最多 3 次 | 指数退避 |

> 批量任务应**顺序执行**而非并发爆发。示例代码中 `fetch_batch` 即为顺序处理，
> 并发信号量只作为兜底保护。

---

## 6. 错误处理

### HTTP 状态码

| 状态码 | 含义 | 处理 |
| --- | --- | --- |
| `200` | 成功 | 继续检查业务错误码 |
| `404` | 豆瓣未收录该 ISBN | 直接返回 `None`，**不重试** |
| `429` | 触发限流 | 退避后重试 |
| `500/502/503` | 服务端异常 | 退避后重试 |
| 其他 | 异常 | 记录日志并放弃 |

### 业务错误码（HTTP 200 但实际失败）

即便返回 `200`，响应体也可能是错误结构：

```json
{ "code": 1287, "msg": "invalid_request" }
```

| 判定条件 | 含义 |
| --- | --- |
| `code` 为 `1287` 或 `1284` | 请求被判定非法，通常是反爬拦截 |
| `msg` 含 `invalid_request` | 同上 |

命中时应视为失败并**降低请求频率**，重试无益。

### 重试判定小结

```
无效 ISBN      → 不请求
404            → 不重试
1287/1284      → 不重试，降频
429/5xx        → 退避重试（最多 3 次）
网络异常        → 退避重试
```

---

## 7. 最小实现片段

若只需最核心逻辑，30 行即可（不含反爬）：

```python
import re
import requests

BASE_URL = "https://m.douban.com/rexxar/api/v2/book/isbn"
HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://m.douban.com/",          # 必需
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
                  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 "
                  "Mobile/15E148 Safari/604.1",
}

def fetch_douban_book(isbn):
    """传入 ISBN，返回豆瓣图书信息 dict；失败返回 None."""
    cleaned = re.sub(r"[^0-9]", "", str(isbn))
    if not re.match(r"^(\d{10}|\d{13})$", cleaned):
        return None

    resp = requests.get(f"{BASE_URL}/{cleaned}", headers=HEADERS, timeout=15)
    if resp.status_code != 200:
        return None

    data = resp.json()
    if data.get("code") in (1287, 1284):     # 反爬拦截
        return None

    rating = data.get("rating") or {}
    return {
        "title": data.get("title", ""),
        "author": " / ".join(data.get("author") or []),
        "publisher": (data.get("press") or [""])[0],
        "pub_year": (data.get("pubdate") or [""])[0],
        "isbn": data.get("isbn", ""),
        "rating": float(rating.get("value") or 0),
        "rating_count": int(rating.get("count") or 0),
        "cover_image": (data.get("cover") or {}).get("url") or data.get("cover_url", ""),
        "summary": data.get("intro", ""),
        "url": data.get("url", ""),
    }
```

---

## 8. 注意事项

1. **`Referer` 不可省略**，这是接入失败率最高的原因。
2. **QPS 保持在 0.5 以下**，批量任务务必加随机延迟与批次冷却。
3. **404 表示豆瓣未收录**，属正常结果，不要当作错误重试。
4. **响应中的数组字段**（`press` / `pubdate` / `pages` / `price`）需取首项。
5. 该接口为豆瓣内部接口，**无官方稳定性承诺**，字段与限制可能随时变更；建议对结果做数据库缓存，避免重复请求。
6. 大批量抓取建议配合本地缓存/数据库去重，仅对新增或过期记录发起请求。
