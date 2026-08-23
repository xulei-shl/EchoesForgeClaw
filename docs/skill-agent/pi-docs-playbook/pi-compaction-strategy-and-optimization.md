# 上下文压缩优化方案

> 基于 `earendil-works/pi` 镜像快照 `f429ddb`（2026-06-01）的官方文档整理。
> 主要参考：`source/packages/coding-agent/docs/compaction.md`、`source/packages/coding-agent/docs/session-format.md`、`source/packages/coding-agent/docs/extensions.md`。
> 结论以镜像快照为准；若上游已更新，请以 `packages/coding-agent/src/core/compaction/` 最新实现核对。

---

## 第一部分：pi Agent 的上下文自动压缩策略

### 1. 机制总览

pi 有两种基于 LLM 的摘要机制（`compaction.md` §Overview）：

| 机制 | 触发 | 目的 |
|------|------|------|
| **Compaction（压缩）** | 上下文超阈值，或 `/compact` | 摘要旧消息以释放 context |
| **Branch summarization（分支摘要）** | `/tree` 切换分支 | 切走分支时保留其上下文 |

两者使用**同一套结构化摘要格式**，并**累积追踪文件操作**。本方案聚焦 Compaction。

### 2. 触发条件（`compaction.md` §When It Triggers）

- **自动**：`contextTokens > contextWindow - reserveTokens`，`reserveTokens` 默认 `16384`（给 LLM 回复预留空间）。
- **手动**：`/compact [instructions]`，可选指令聚焦摘要方向。
- 配置位于 `~/.pi/agent/settings.json` 或 `<project>/.pi/settings.json`。

### 3. 自动压缩算法（`compaction.md` §How It Works）

1. **找切点**：从最新消息向前累加 token 估算，直到达到 `keepRecentTokens`（默认 `20000`），其边界即 `firstKeptEntryId`。
2. **抽取消息**：收集 `firstKeptEntryId` 之前（或会话起点）到切点的消息。
3. **生成摘要**：调用 LLM 生成结构化 summary；若已有上一轮摘要，则作为迭代上下文并入。
4. **追加 entry**：写入 `CompactionEntry { summary, firstKeptEntryId, tokensBefore, details? }`。
5. **重载会话**：LLM 实际只看到 `summary + firstKeptEntryId 起的消息`。

```
Before compaction:
  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool│
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴─────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize          kept messages
                                    ↑
                           firstKeptEntryId (entry 4)

After compaction (new entry appended):
  entry:  ...  9    10
              └──┬─────┐
            cmp │ (summary replaces 0-3; 4-9 sent verbatim)
                └─────┘

What the LLM sees:
  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   from cmp          messages from firstKeptEntryId
```

### 4. 切点规则与 Split Turn（`compaction.md` §Cut Point Rules / §Split Turns）

- **合法切点**：User / Assistant / BashExecution / Custom 消息。
- **绝不**在 tool result 处切（必须与 tool call 成对保留）。
- **Split turn**：当单个 turn 超过 `keepRecentTokens` 时，切在 assistant 消息（mid-turn），生成两条摘要——历史摘要 + 该 turn 前缀摘要——再合并。

### 5. 摘要格式（`compaction.md` §Summary Format）

```
## Goal
[What the user is trying to accomplish]

## Constraints & Preferences
- [Requirements mentioned by user]

## Progress
### Done
- [x] [Completed tasks]
### In Progress
- [ ] [Current work]
### Blocked
- [Issues, if any]

## Key Decisions
- **[Decision]**: [Rationale]

## Next Steps
1. [What should happen next]

## Critical Context
- [Data needed to continue]

<read-files>
path/to/file1.ts
</read-files>

<modified-files>
path/to/changed.ts
</modified-files>
```

### 6. 序列化与截断（`compaction.md` §Message Serialization）

摘要前，`serializeConversation()`（`utils.ts`）把消息转成纯文本：

```
[User]: What they said
[Assistant thinking]: Internal reasoning
[Assistant]: Response text
[Assistant tool calls]: read(path="foo.ts"); edit(path="bar.ts", ...)
[Tool result]: Output from tool
```

- 前缀化避免模型把它当成"待继续的对话"。
- **Tool result 截断到 2000 字符**，超出部分替换为截断标记，控制摘要请求本身的 token 预算。

### 7. 跨多次压缩的迭代（`compaction.md` 第 79 行）

重复压缩时，新一轮待摘要区间从**上一轮 `firstKeptEntryId`** 开始（而非从 compaction entry 本身），并回退到"上一轮 compaction 之后的 entry"。这样上一轮被保留的消息也会进入下一轮摘要，避免信息在多次压缩中逐步流失。同时 `tokensBefore` 从**重建后的会话上下文**反算，反映真实被替换的预压缩上下文。

### 8. 累积文件追踪（`compaction.md` §Cumulative File Tracking）

compaction 与 branch summarization 都从"待摘要消息中的工具调用"和"上一轮 `details`"中提取 read/modified 文件，跨多次压缩或嵌套分支摘要累积，保留完整文件操作史。`CompactionEntry.details` 默认结构：

```typescript
interface CompactionDetails {
  readFiles: string[];
  modifiedFiles: string[];
}
```

扩展可存任意 JSON-serializable 数据。

### 9. 与 Session 树的集成（`session-format.md` §Context Building）

`buildSessionContext()` 沿 leaf→root 走树，遇到 `CompactionEntry` 时：先吐 summary → 再吐 `firstKeptEntryId` 起的消息 → 再吐之后的消息。`CompactionEntry` 类型定义（`session-manager.ts`）：

```typescript
interface CompactionEntry<T = unknown> {
  type: "compaction";
  id: string;
  parentId: string;
  timestamp: number;
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  fromHook?: boolean;
  details?: T;
}
```

### 10. 扩展定制（`compaction.md` §Custom Summarization / `extensions.md` §session_before_compact）

- `session_before_compact` 事件可 `return { cancel: true }` 取消，或返回自定义 `{ compaction: { summary, firstKeptEntryId, tokensBefore, details } }`。
- 自定义摘要时，用 `serializeConversation(convertToLlm(preparation.messagesToSummarize))` 把消息转文本再喂给自己的模型。
- 触发入口：`ctx.compact({ customInstructions, onComplete, onError })`。

### 11. 配置（`compaction.md` §Settings）

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

| 设置 | 默认 | 说明 |
|------|------|------|
| `enabled` | `true` | 自动压缩开关；关闭后仍可 `/compact` 手动触发 |
| `reserveTokens` | `16384` | 为 LLM 回复预留的 token |
| `keepRecentTokens` | `20000` | 保留不压缩的近距 token 量 |

### 12. 关键上游源码（`pi-mono`）

- `packages/coding-agent/src/core/compaction/compaction.ts` — `prepareCompaction()` / `compact()`
- `packages/coding-agent/src/core/compaction/branch-summarization.ts` — 分支摘要
- `packages/coding-agent/src/core/compaction/utils.ts` — `serializeConversation()`
- `packages/coding-agent/src/core/session-manager.ts` — `CompactionEntry` / `buildSessionContext()`

---

## 第二部分：可借鉴的优化（针对你的网关方案）

### A. 现有方案回顾（待优化点）

| 现有设计 | 风险 |
|---------|------|
| `reserve_turns = 2`（固定轮数保留） | 单轮含长文档/长输出时会撑爆窗口 |
| 每次 `_compress_history(compressible_pairs)` 从头重算摘要 | 旧摘要被丢弃，多轮持续丢信息 |
| 整段历史压平为单段 query 文本 | 近距轮次也被二次摘要，信息损耗 |
| `_compress_history` 产自由文本 | 回填质量不稳定，无关键事实承载位 |
| 切点为 user/assistant 对 | 未显式约束"工具结果成对保留" |
| tiktoken 估算后直接发送 | 压缩后真实占用未回填，阈值漂移 |
| `context_threshold = 0.7` | 语义合理，但触发与算法未解耦 |

### B. 优化点（逐条对应 pi 策略）

**优化 1：`reserve_turns`（固定轮数）→ `reserve_tokens`（token 预算）**
- 对应 `compaction.md` `keepRecentTokens`（默认 20000）。
- 从最新消息向前累加 token 至 `reserve_tokens` 再切，避免固定轮数在大消息下爆窗。

**优化 2：每次重建摘要 → 迭代合并 `running_summary`**
- 对应 `compaction.md` 第 79 行：新一轮摘要纳入上一轮 `firstKeptEntryId` 之前的内容。
- 维护 `running_summary`，每轮只对"上一摘要之后、保留窗口之前"的**新增**历史做摘要并合并，避免信息逐步流失。

**优化 3：压平单文本 → 区分"摘要区 / 近距原样区"**
- 对应 `compaction.md` LLM 视图：summary 只替换远端历史，近距消息原样呈现。
- 即便 HiAgent 只收单个 `query`，也把 `[历史摘要]` 与 `[最近对话]`（原样、结构化）分开；近距轮次**不再过压缩 LLM**。

**优化 4：自由文本摘要 → 结构化模板**
- 对应 `compaction.md` §Summary Format。
- `_compress_history` 的 prompt 改为固定 schema（Goal / Constraints / Progress / Key Decisions / Next Steps / Critical Context + read/modified files），提升回填质量与关键事实承载。

**优化 5：切点安全约束**
- 对应 `compaction.md` §Cut Point Rules：绝不切 tool result。
- 若未来接工具调用，须保证 tool call 与 result 成对保留在保留区内。

**优化 6：超大单轮 split turn**
- 对应 `compaction.md` §Split Turns：单轮超预算则切在 assistant 消息，生成 history+prefix 两条摘要合并。
- 作为边界 case 补充，避免单轮爆窗时硬截断。

**优化 7：压缩后真实占用回填**
- 对应 `compaction.md` 第 79 行：`tokensBefore` 从重建上下文反算。
- 压缩后用真实 query 的 token 数回填，作为下一轮触发判断，避免阈值漂移。

**优化 8：触发与算法解耦**
- 对应 `compaction.md` `/compact` 手动 + 自动双路径。
- 保留 `context_threshold` 自动触发，另支持手动/被动触发（如客户端带 `X-Force-Compact` 或网关侧信号），解耦"何时压"与"怎么压"。

**优化 9：累积文件/实体追踪**
- 对应 `compaction.md` §Cumulative File Tracking。
- 若对话含文件路径/业务实体，在 `details` 累积 read/modified 列表并注入摘要，保持下游连贯。

### C. 优化后的配置与算法（建议形态）

`AgentConfig` 调整：

| 原字段 | 新字段 | 默认值 | 说明 |
|--------|--------|--------|------|
| `max_history_turns` | 保留（历史纳入上限） | `10` | 仍作硬上限 |
| `reserve_turns` | **`reserve_tokens`** | `20000` | 按 token 保留近距内容（替代固定轮数） |
| `context_threshold` | 保留 | `0.7` | 触发阈值（= pi `reserveTokens` 语义） |
| `model_context_window` | 保留 | `128000` | 窗口 |

`Settings` 保留 5 个压缩字段不变（压缩模型来源：HiAgent SDK / OpenAI 兼容 API）。

`build_multi_turn_query()` 伪代码（整合优化 1–4、7）：

```python
def build_multi_turn_query(pairs, latest_text, state, cfg):
    # 1) token 预算保留近距（优化 1）
    recent, compressible = [], []
    budget = 0
    for p in reversed(pairs):
        t = estimate_tokens(p)
        if budget + t <= cfg.reserve_tokens:
            recent.insert(0, p); budget += t
        else:
            compressible.insert(0, p)

    # 2) 迭代合并旧摘要（优化 2）
    new_summary = ""
    if compressible:
        chunk = f"{state.running_summary}\n\n{serialize(compressible)}"
        new_summary = await _compress_history(chunk)   # 结构化模板（优化 4）
        state.running_summary = merge(state.running_summary, new_summary)

    # 3) 摘要区 + 近距原样区（优化 3）
    query = ""
    if state.running_summary:
        query += f"[历史摘要]\n{state.running_summary}\n\n"
    query += f"[最近对话]\n{serialize(recent)}\n\n"   # 原样，不过压缩 LLM
    query += f"[最新问题]\n{latest_text}"

    # 7) 压缩后真实占用回填
    state.last_query_tokens = estimate_tokens(query)
    return query
```

`_compress_history()` 结构化模板（优化 4）：

```
## Goal
<从 compressible 中抽取用户意图>

## Progress
### Done / In Progress / Blocked
<按状态归类>

## Key Decisions
- **<决策>**: <理由>

## Next Steps
1. <下一步>

## Critical Context
- <继续所需的硬事实：ID/路径/约束>

<read-files> ... </read-files>
<modified-files> ... </modified-files>
```

`state` 需新增字段：`running_summary: str`、`last_query_tokens: int`（持久化到 `conversation_id` 侧，使其在后续无 `conversation_id` 的重建请求中可复用）。

### D. 适用边界与注意事项

- **架构差异（硬约束）**：pi 存真实 `AgentMessage` 对象树，重载后 LLM 看到的是"摘要 + 原样消息列表"；你的网关因 HiAgent 只收单 `query`，只能退化为文本拼接。优化 3 的"原样区"是在文本层面尽量模拟，效果弱于 pi 原生消息级保留——须如实告知下游调用方。
- **tokenizer 偏差**：tiktoken 仅是查询侧代理；若 HiAgent 返回真实 usage，优先用 `usage`（对应 `extensions.md` `ctx.getContextUsage()` 优先用真实 provider usage 的哲学）。
- **摘要非业务真相**：压缩摘要只是上下文，不是审计/业务事实（见 `AGENTS.md` Common Boundaries）。网关侧的业务审计仍需独立日志。
- **递归/阻塞风险**：你已选"独立压缩模型"避免与主链路排队，保持该决策；`running_summary` 的合并调用同样走独立压缩通道。

### E. 校验清单（落地后自测）

- [ ] 单轮含 >`reserve_tokens` 长文本时，存活近距内容不超限（优化 1 / 6）
- [ ] 连续 5 轮超窗口请求后，`running_summary` 不出现早期事实丢失（优化 2）
- [ ] 近距 `recent` 轮次未被再次送入压缩 LLM（优化 3）
- [ ] 摘要输出符合结构化 schema，含 `Critical Context` 与 read/modified files（优化 4）
- [ ] 压缩后 `last_query_tokens` 被用于下一轮阈值判断（优化 7）
- [ ] 手动/被动触发路径与自动触发解耦（优化 8）
