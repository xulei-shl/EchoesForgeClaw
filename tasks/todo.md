# 解除节点「有下级不可操作」限制 + 上下文注入实时化

## 背景

- 原模型：节点有下游时冻结一切影响输出的操作，改输出必须删连线重连。
- 新模型：源头随时可改；下游手动点「运行」时从连线现场读取上游最新输出（机制已存在：`resolveNodeRunInputs` 点击时实时收集，无需新增逻辑）。
- 上下文注入展示：非 chat 节点已实时（渲染期派生）；chat/PiChat 需从首条消息快照改为始终实时计算展示。

## 任务清单

### 阶段 1 — 解除限制
- [x] 1.1 `CanvasNodeViews.tsx`：删除 `hasDownstreamOf`（:219-223）及 ~30 处计算与传递
- [x] 1.2 `ChatNodeHost.tsx:584` / `PiChatNodeHost.tsx:669`：删除 import 与传递
- [x] 1.3 `useNodeHandlers.ts` `handleImageChangeFor`（:327-341）：移除自算 descendants 的「有下游禁替换图片」守卫

### 阶段 2 — 组件侧彻底清理
- [x] 2.1 `NodeActionBar.tsx`：删除 `hasDownstream/downstreamTooltip` 禁用管道与默认禁用文案
- [x] 2.2 bookplate 节点组件（~19 文件）：删 prop 接收与内部守卫（知乎提交守卫等）
- [x] 2.3 multimodal 节点组件（~7 文件）+ `useSearchNode.ts`：isLocked 移除 `hasDownstream &&`

### 阶段 3 — Chat 注入展示实时化
- [x] 3.1 `ChatNodeHost.tsx:536-561` / `PiChatNodeHost.tsx:627-660`：contextBlocks 始终实时计算，不再读首条消息快照
- [x] 3.2 保持不变：发送时首轮快照注入（attachContextToFirstUser）

### 阶段 4 — 验证
- [x] 4.1 `npm run build`（tsc 类型检查兜底）+ `npm run lint`（2026-08-26 均通过，exit 0）
- [ ] 4.2 手动场景：上游可运行/重试/编辑；下游重跑吃新值；chat 注入卡片同步；分支新建回归

## 边界（非缺陷）
- 下游旧结果不自动失效，需手动重跑（本次选择的模型）。
- chat 已开始对话的注入卡片显示最新值，但该会话实际用发送时快照；清空对话后下一轮注入最新。
- 分支新建行为（图像分析/图像生成已有结果时重试建兄弟节点）与 hasDownstream 正交，不受影响。

## 评审记录
- 2026-08-26：阶段 1-3 全部完成，8 个 multimodal 残留文件已清理，`frontend/src` 下 grep `hasDownstream`/`downstreamTooltip` 为 0。`npm run build` + `npm run lint` 通过（lint 仅 public/maplibre vendor 预存在警告）。
- 遗留：任务 4.2 手动场景验证（需在浏览器实测）。文档 `docs/多模态工具/图片处理/图片处理节点效果接入指南.md:105,188` 仍描述旧门禁行为，可顺手同步。

---

# pi Skill Agent 节点首轮慢优化：RPC 进程复用（配置代数 + 空闲回收 + LRU）

## 背景
- 原 `runPiAgent` 每轮 `spawn` 一个新 pi CLI 子进程（RPC 模式），settled 后即 `killTree`——进程从不复用，每轮都有 Node+CLI+扩展加载的冷启动开销；首轮体验最差。
- 目标：多用户 web 应用里既快（复用热进程）又省（空闲回收 + 并发上限）。

## 任务清单
### 阶段 1 — 配置代数
- [x] 1.1 新增 `pi/generation.ts`：`computeWorkspaceGeneration`（agentId + AGENTS.md 哈希 + 技能 SKILL.md 哈希 + 对话/绘图模型 + 扩展白名单的 sha256）
### 阶段 2 — 生命周期
- [x] 2.1 `config.ts`：`PI_PROCESS_IDLE_MS`（默认 5 分钟）、`PI_MAX_PROCESSES`（默认 20）
- [x] 2.2 `registry.ts`：`PiProcessEntry` 加 generation/lastUsed/round/child 等常驻字段；新增 `getPiProcess`/`touchPiProcess`/`countActivePiProcesses`/`reapIdlePiProcesses`/`evictLeastRecentlyUsedPiProcess`；后台定时器空闲回收；`killPiProcess` 改 async 并等待子进程退出（防 kill 后 rmSync 撞文件锁）
### 阶段 3 — 运行器改造
- [x] 3.1 `runner.ts`：spawn/解析/事件队列提升为跨轮常驻；`runPiAgent` 按代数判定复用/重拉；正常 settled 不杀进程，异常/超时/abort 才杀树；复用轮不重复注入上下文（每轮只发新消息，历史以会话文件为真相源）
### 阶段 4 — 接入与验证
- [x] 4.1 `ai-nodes.ts`：计算 generation 传入 runPiAgent；每轮仍全量 `preparePiWorkspace`（幂等、毫秒级），复用/重拉完全由 runner 内部判定——避免「跳过重装后又重拉」产生缺提示词/扩展的进程竞态
- [x] 4.2 `pi-agent-service.ts` 门面导出新增项；既有测试适配 async kill/clear
- [x] 4.3 新增 `pi-agent-reuse.test.ts`：同代数两轮回用同 pid 且上下文不重复（user 数 1→2）；代数变化重拉；空闲回收/LRU 生效；generation 稳定性/敏感性
- [x] 4.4 `npm run build`（仅预存在 2 个前端错误）+ pi 相关 6 测试文件 46 用例全过（fastclaw-artifacts 3 个失败为预存在、与本次无关）

## 设计要点 / 边界
- **上下文不重复**：进程复用/重拉只由配置代数决定；对话状态永远以 `.pi-agent/run/chat.jsonl` 为唯一真相源，多轮各写一次、不多不少。
- **配置变更即重拉**：上游节点改接提示词/skill/模型/扩展 → 代数变化 → 自动 kill 旧进程重拉，无需额外信号。
- **资源有界**：空闲超时 + 全局上限 LRU 驱逐，防多租户内存随活跃节点线性增长。
- 遗留：`PI_TIMING=1` 量化冷启动占比后再评估是否做「预拉起」增强（动态接上游场景收益有限）；`docs/skill-agent` 可补一段进程复用说明。

## 评审记录
- 2026-08-29：阶段 1-4 全部完成并验证。复用路径**未跳过 preparePiWorkspace**（保守偏差：每轮仍幂等重装配，换取「重拉竞态为零」的正确性；spawn 冷启动这一主导成本已消除）。生产代码 tsc 通过，pi 相关 46 用例全过。
- 2026-08-29：一并修复 2 个预存在编译错误——根因是 `frontend/src/platform/types` 是目录（`types/index.ts`）非文件：后端测试的 `types.js` 在 NodeNext 下解析不到、前端 `piQuestionnaireParser.ts` 无扩展名导入违反 NodeNext。改为 `types/index.js`，前后端 tsc 均通过。
- 遗留：`fastclaw-artifacts.test.ts` 3 个失败为**预存在 + Windows 环境相关**（`extractFastclawPathCandidates` 只认 POSIX `/` 开头绝对路径，而 Windows 测试临时目录是 `C:\...`），与本次改动无关，未纳入本次范围。
