# Lessons Learned

## 2026-08-20: 地图海报生成失败 — 错误被吞掉

**问题：** `create_map_poster.py` 中 `fetch_graph()` 的 `except Exception` 只 `print` 了原始错误并返回 `None`，导致调用方只能看到"Failed to retrieve street network data."，看不到根本原因（如网络不通、Overpass API 超时、代理问题等）。

**规则：** 不要吞掉异常。如果函数不能处理某个异常，让它传播出去，或至少把原始错误信息包含在重新抛出的异常中。

**修复：** `fetch_graph()` 中 `return None` → `raise RuntimeError(...) from e`，保留原始异常链。

## 2026-08-20: 25KM 距离超时

**问题：** 选择 25KM 距离时，OSMnx 的 Overpass API 查询大范围路网需要较长时间（3-5 分钟），但前端 axios 超时仅 120 秒，导致超时中断。

**规则：** 大范围数据查询需要匹配的超时时间。前端、后端代理、Python 服务三层的超时设置需保持一致。

**修复：** 前端超时 120s → 300s（`MapPosterNode.tsx:182`），后端 fetch 增加 `AbortSignal.timeout(300000)`（`map-poster.ts:31`）。

## 2026-08-20: 图书小票纸色主题不一致 — 硬编码颜色导致主题失效

**问题：** `LibraryCardPaper.tsx` 大量硬编码 Tailwind 颜色类（`text-gray-800`、`text-blue-800`、`border-blue-200` 等），切换纸色时只有借阅人姓名响应 `theme.text`；`libraryCardRenderer.ts` 同样硬编码 Canvas 颜色（`#1f2937`、`#1e40af`、`#1e3a8a` 等），导致导出 PNG 与预览不一致。

**规则：** 所有模板组件必须统一使用 `theme.text`、`theme.faint`、`theme.dashed`、`theme.accent` 四个语义变量，禁止硬编码颜色类。Canvas 导出渲染器必须与前端组件使用相同的主题变量，保证所见即所得。

**修复：** `LibraryCardPaper.tsx` 中所有 `text-gray-*` → `theme.text` / `theme.faint`，`text-blue-*` → `theme.accent`，`border-blue-*` / `border-gray-*` → `theme.dashed`；`libraryCardRenderer.ts` 中 `#1f2937` → `theme.text`，`#1e40af` / `#1e3a8a` → `theme.accent`，`#bfdbfe` → `theme.dashed`，`#4b5563` → `theme.faint`。