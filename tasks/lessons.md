# Lessons Learned

## 2026-08-20: 地图海报生成失败 — 错误被吞掉

**问题：** `create_map_poster.py` 中 `fetch_graph()` 的 `except Exception` 只 `print` 了原始错误并返回 `None`，导致调用方只能看到"Failed to retrieve street network data."，看不到根本原因（如网络不通、Overpass API 超时、代理问题等）。

**规则：** 不要吞掉异常。如果函数不能处理某个异常，让它传播出去，或至少把原始错误信息包含在重新抛出的异常中。

**修复：** `fetch_graph()` 中 `return None` → `raise RuntimeError(...) from e`，保留原始异常链。

## 2026-08-20: 25KM 距离超时

**问题：** 选择 25KM 距离时，OSMnx 的 Overpass API 查询大范围路网需要较长时间（3-5 分钟），但前端 axios 超时仅 120 秒，导致超时中断。

**规则：** 大范围数据查询需要匹配的超时时间。前端、后端代理、Python 服务三层的超时设置需保持一致。

**修复：** 前端超时 120s → 300s（`MapPosterNode.tsx:182`），后端 fetch 增加 `AbortSignal.timeout(300000)`（`map-poster.ts:31`）。