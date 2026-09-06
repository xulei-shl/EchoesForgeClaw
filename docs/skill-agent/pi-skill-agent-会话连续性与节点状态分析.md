# pi Skill Agent 会话连续性与节点状态问题分析

> 状态：分析完成，修复方案已定，待实施。
> 涉及案例工作区：`runtime/1/workspace/chat-1787731128417-bdmpcw_1787731238599`
> 关联已合入修复：`e34bd394`（会话落点 `.pi-agent/run/chat.jsonl` + `chat/clear` 接口）、错误友好化与重试 status 推送（后端，未提交时以仓库为准）。

---

## 一、本会话已确认并修复的问题（背景）

| # | 问题 | 结论 / 修复 |
|---|------|------------|
| 1 | `.pi-agent/skills` 能否被 pi 自动加载 | **能**。后端设 `PI_CODING_AGENT_DIR=ws/.pi-agent`，pi 将 `{agentDir}/skills` 作为 user-scope 无条件扫描（package-manager.ts:2371/2463），无需授信 |
| 2 | 会话历史出现两份 chat.jsonl | pi 启动迁移 `migrateSessionsFromAgentRoot` 把 `{agentDir}` 根下散落的 `*.jsonl` 移入 `sessions/{cwd编码}/`，导致下一轮上下文静默重置一次。**已修**：落点改至子目录 `.pi-agent/run/chat.jsonl`（不在迁移扫描范围） |
| 3 | 清空对话无后端支撑 | **已加** `POST /api/modules/bookplate/chat/clear`（删 run/、根级遗留、sessions/；保留 skills/models/settings 与 outputs） |
| 4 | 图片是否把 base64 拼进上下文 | 否。前端 data URL → 后端落盘 `inputs/img-N.ext` → 以 `@路径` 传给 pi → pi 读文件生成 image block（缩图上限 2000×2000/4.5MB）。会话 jsonl 内联一份 base64 属多模态 API 必需；纯传路径对模型不可见 |
| 5 | 失败（如 429）在节点中零反馈 | **已加**：`auto_retry_start` → status「模型服务繁忙（限流），Ns 后自动重试（第 i/N 次）」；收尾 error 映射为友好中文+原始细节 |

---

## 二、本次事故还原（chat-1787731128417-bdmpcw_1787731238599）

### 2.1 会话文件时间线（.pi-agent/run/chat.jsonl，共 117 条）

| 时刻 | 条目 | 说明 |
|------|------|------|
| 16:01:57 | #3 user text[3018] | 第一轮：完整上下文（图书元数据+VuFind 馆藏）+ 提问 |
| 16:03–16:13 | #4–#23 | 大量工具调用（bifrost 检索等），最后停在 `stop=toolUse` + toolResult，**没有终局 assistant 文本** —— 进程在此窗口被终止（与前端断开传播一致）|
| 16:14:31 | #24 user text[2986] | 第二轮：**内容再次包含完整图书元数据上下文 + 「继续」** ← 关键证据 |
| 16:15:52 | #28 user text[4] | 「完成了吗」（无上下文 ✓，说明 hasContextInStore 已重新成立）|
| 16:20–16:26 | #54/#64/#76 | 中途 3 次模型错误：`Request timed out.` ×2、`520 provider API error` ×1，pi 自动重试恢复 |
| 16:40:32 | #115–#116 | 运行结束，产物 `dante-book-promo.html` 已产出 |

### 2.2 由证据推出的事实链

1. **第二轮消息重复注入了上级节点上下文**（#24 ≈ #3 的上下文头完全一致）→ 说明发送第二轮时前端认为这是「全新首轮」→ `hasContextInStore([])` 为 false → **node.data.messages 当时为空数组**。
2. **workspaceId 未变**（同一 chatid 目录、同一 chat.jsonl 继续）→ 排除「清空对话」按钮（它会同时重建 workspaceId）。
3. 第一轮进程恰在第二轮发出前后终止（客户端断开 → Fastify abort signal → killTree），UI 侧表现为「出错/清空」，后台由第二轮进程继续跑完并产出最终 html。
4. 中途的 timeout/520 因当时旧代码无任何 status 推送，节点长时间静默，加剧「卡死→刷新/离开」的行为。

---

## 三、根因分析（前端架构层）

### 3.1 直接根因：流式期间 store 镜像被刻意延迟

`ChatNodeHost.tsx` 镜像 effect：

```ts
// 仅在非流式状态时立即写入顶层 store；
// 流式进行期间仅在本地实时渲染，避免高频 setNodes 引发整板重绘
if (!streaming) { flushPendingPatch(); }
```

后果：**第一轮对话进行中，顶层 store 的 `data.messages` 始终是流开始前的快照（可能为空）**。此时任何导致 ChatNodeHost 卸载/重挂载的因素——页面刷新、Vite HMR、画布切换恢复——都会让 `useChat` 用空的 store 快照重新初始化，用户看到「节点内容被清空」。

而 `workspaceId` 是在请求发起时就立即写入 store 的（prepareSendMessagesRequest 内 setNodes），不受该延迟影响 → 于是形成「历史空了但 chat.jsonl 还在同一份」的状态。

### 3.2 二次伤害：外部变更检测把空历史当作新真相

```ts
// 外部变更检测：清空对话 / 撤销 / 恢复时 store 与 useChat 不同步
setMessages(storeToUI(storeMsgs));   // 空数组 → 本地会话被主动丢弃
```

该 effect 无法区分「用户主动清空」与「快照回退导致的意外清空」，一旦 store 为空就把本地仍持有的会话一并丢掉。随后下一轮触发上下文重新注入 → 同一 chat.jsonl 里出现重复的大块上下文（本次事故 #24 的 3018→2986 字节）。

### 3.3 次要残留缺陷（已在本轮顺带修复）

纯失败轮（零输出，如持续 429）会在 useChat 留下**空气泡 assistant 占位**；原镜像只在 error 态剥末尾一次，继续对话后它变成夹在中间的脏历史。已改为任意非流式结束态都剥离并同步清除 useChat 残留（ChatNodeHost.tsx）。

---

## 四、修复方案（待实施）

### A. 消息条数变化时立即落 store（消除长延迟窗口）

镜像 effect 中，除「非流式立即写」外，增加「**消息条数变化**也立即 flush」：

- 每条 user/assistant 消息落定时持久化一次，频率极低（每轮 2 次），不影响流式性能优化初衷；
- 效果：刷新/HMR/重挂载后，store 至少保有已完成的历史轮次，不再从零开始。

### B. 空 store 采纳保护（区分「主动清空」与「意外回滚」）

外部变更检测 effect 增加守卫：

- 新增 `mirroredWsRef` 记录最近一次镜像时的 workspaceId；
- 当 `store.messages 为空 && 本地 uiMessages 非空 && workspaceId 未变化` 时，判定为意外回滚：**不采纳空历史**，反向用本地 uiMessages 恢复 store；
- 真正的「清空对话」必然伴随 workspaceId 再生 → 守卫放行，行为不变；
- 附带效果：只要历史保住，`hasContextInStore` 成立，**上下文重复拼接问题自动消失**（无需额外去重逻辑）。

### C. 可选加固（暂不做，记录备查）

- 后端 pi 模式对重复上下文做前缀去重（魔法过多，不推荐）；
- 从 chat.jsonl 反向水合 UI（服务端为真相源），改造大，仅在 A+B 仍不够时考虑。

---

## 五、验证计划

1. `tsc -b`（frontend）+ `oxlint` 无新增告警；
2. 手工场景：
   - 第一轮流式中刷新页面 → 节点保留已完成轮次，继续对话不重复注入上下文；
   - 出错（可用持续 429 mock）→ 节点显示友好错误 + 重试按钮，历史完整，断点续聊正常追加同一 chat.jsonl；
   - 清空对话 → 仍按设计清空 + 新 workspaceId + 新会话；
3. 后端回归：`backend-ts` 全量 vitest（当前 105/105 通过基线）。

---

## 六、涉及文件清单

| 文件 | 变更 |
|------|------|
| frontend/src/modules/bookplate/ChatNodeHost.tsx | 方案 A/B + 空占位剥离同步 useChat（部分已落地） |
| backend-ts/src/services/pi-agent-service.ts | （已落地）会话落点 / clearPiSession / 友好错误 / 重试 status |
| backend-ts/src/modules/bookplate/routes/ai-nodes.ts | （已落地）chat/clear 路由 |
| backend-ts/tests/api/pi-agent-run.test.ts、pi-agent-workspace.test.ts | （已落地）新增/修正测试 |
