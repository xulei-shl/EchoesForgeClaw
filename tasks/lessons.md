# Lessons Learned

## 2026-08-20: 城市地图海报失败 — 错误被吞掉

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
## 2026-08-22: 网点效果输出空白 — 输出画布污染采样源

**问题：** imageprocess/effects/halftone.ts 的 renderHalftone 在 xDrawingCanvas 画好源图后，先对同一画布 fillRect 铺白色纸底再进行旋转栅格化采样 —— 源图被白底覆盖，采样读到的全是白色（覆盖率 0），网点效果切换后预览为空白。

**规则：** Canvas 渲染管线中「采样源」与「输出目标」必须严格分离；任何铺底/清屏操作只能作用于输出画布，且多通道渲染时不得把上一通道的绘制结果当作下一通道的输入。交付前仅跑 build/lint 无法发现此类像素逻辑错误，涉及视觉效果的新效果必须先在浏览器实际验证预览再交付。

**修复：** 新建独立输出画布（纸底 + multiply 叠印），
xDrawingCanvas 结果只作采样源（
asterizeRotatedGrid(source, ...)），各通道从同一干净源采样。

## 2026-08-29: pi agent 新节点首轮静默无输出 + 上下文注入丢失 — 首发送自持 workspaceId 触发复位 effect

**问题（`PiChatNodeHost.tsx`）：** 新 chat 节点没有 `workspaceId`，首轮发送会在 `send()` 内生成并 `setNodes` 持久化 `${nodeId}_${ts}`。`[wsId]` 复位 effect（runSeqRef+1、`idleRef.controller.abort()`、`dispatchStream end`、`contextSentRef=false`）把这次转换当成「工作区切换」触发 → 首条消息的 SSE 被 abort、run 被 runSeqRef 判定作废 → 前端「无输出」；同时 `contextSentRef` 复位 + 服务端会话残留孤立的 user 消息（被水合 `some(user)→contextSent=true` 锁死）→ 重试时上下文不再注入。
**规则：** 「懒生成并持久化状态（workspaceId）」的副作用若等于复位 effect 的触发条件，必须在 effect 里区分「本次转换是当前在途 run 自产的」并跳过复位；任何「已有会话即视为上下文已注入」的水合判定必须验证该会话是否真的被 agent 处理过（有完整 assistant 回复才算）。
**修复：** `[wsId]` effect 加 `selfAssigned` 守卫（`activeRequestWsRef===wsId && status in submitted/streaming` 时跳过复位）；水合/缓存路径 `contextSentRef` 判定由 `some(user)` 改为 `some(role==='assistant')`。

## 2026-08-29: pi RPC 收尾循环重构教训 — kill 收尾后必须等子进程真正退出

**问题：** 优化 `runPiAgent` 出队循环时，把「终局判定（agent_settled/timeout/error）」直接用作 break 条件，在 killTree 后立即 break。两个后果：① settle/error 到达时若 finalize 块排在 break 之后会连 kill 都跳过（RPC 进程常驻不退出 → `await exitCode` 永久挂起、SSE 测试 120s 超时）；② 即使修正顺序，`settled`/`error` 立即 break 会让生成器在 Windows `taskkill` 文件句柄释放完成前返回（ci 下 rmSync 工作区撞 EPERM，拟合性测试失败）。
**规则：** kill 型收尾的循环形态必须是——先 finalize(killTree)，再**保持等待** `childClosed && stdoutEnded` 后 break，而不是改了终局信号就同时改掉退出信号；「不等待 stdout end 防挂起」的担心是假设性的，Node 保证被杀进程的管道 end 必发。给 pi 子进程 stdio 补 error 监听（无监听时管道断裂会把整个后端 worker 带崩）；注册表注销做 identity 校验并顶替时先杀旧进程，防双进程共写会话文件与过期轮误删新条目。
**修复：** 循环结构 = `isFinal()(settle|timeout|error) → finalize(killTree)` + `childClosed && stdoutEnded → break`；`registerPiProcess` 注销闭包校验 `=== entry`、顶替旧条目先 `prev.kill()`；`childStdin/stderr.on('error', ...)` + stdin 写入 try/catch + `sendExtensionUiResponse` 写防崩。
