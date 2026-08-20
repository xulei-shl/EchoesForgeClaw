# Lessons Learned

## 2026-08-20: 地图海报生成失败 — 错误被吞掉

**问题：** `create_map_poster.py` 中 `fetch_graph()` 的 `except Exception` 只 `print` 了原始错误并返回 `None`，导致调用方只能看到"Failed to retrieve street network data."，看不到根本原因（如网络不通、Overpass API 超时、代理问题等）。

**规则：** 不要吞掉异常。如果函数不能处理某个异常，让它传播出去，或至少把原始错误信息包含在重新抛出的异常中。

**修复：** `fetch_graph()` 中 `return None` → `raise RuntimeError(...) from e`，保留原始异常链。