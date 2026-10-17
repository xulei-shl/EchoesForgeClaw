# Agent 对话 UI/UX 设计最佳实践（画板助手 / 画布 AI 对话节点）

> 目的：把本项目 `AgentChatPanel`（画板助手）与 `ChatNode`（画布 AI 对话节点）沉淀出的对话交互设计，
> 抽成可迁移到其他项目的规范文档。**只覆盖 UI/UX 与前端状态组织**，不涉及后端协议与 RPC 细节。
>
> 主要参考实现：
>
> | 关注点 | 文件 |
> | --- | --- |
> | 面板骨架 / 流式装配 / 会话抽屉 | `frontend/src/canvas/components/mascot/AgentChatPanel.tsx` |
> | 单条消息渲染（颜文字、复制/重试、编辑重发） | `frontend/src/canvas/nodes/ai/chat/ChatMessageItem.tsx` |
> | 思考 + 工具步骤折叠卡 | `frontend/src/canvas/nodes/ai/chat/StepActivityCard.tsx` |
> | 流式光标颜文字 + 光晕动效 | `frontend/src/index.css`（`streamdown-kaomoji-breathe` 一节） |
> | 等待/思考动效 keyframes | `frontend/src/canvas/nodes/ai/chatStyles.ts` |
> | 颜文字候选池 | `frontend/src/canvas/nodes/ai/utils/kaomoji.ts` |
> | 输入区（附件 / @ 引用 / 发送停止） | `frontend/src/canvas/nodes/ai/chat/ChatNodeComposer.tsx` |
> | 流式状态机（纯 reducer） | `frontend/src/canvas/nodes/ai/infra/piStream.ts` |
> | 编辑重发 / 删除的服务端对齐 | `frontend/src/canvas/nodes/ai/infra/ChatNodeHost.tsx` |

---

## 0. 一句话总纲

对话流的 UX 质量几乎全部体现在**三个"空窗期"和三个"纠错入口"**上：

1. 用户按下发送后、首字到达前（等待态）——给不动的反馈；
2. 正文流式输出中（生成态）——让"还在动"可见；
3. 流结束后到历史水合之间（提交态）——不要闪空；
4. AI 输出：能**复制**、能**重试**；
5. 用户输入：能**改**、能**重发**、能**删**；
6. 用户主动**中断**要有明确痕迹和恢复入口。

其余都是这六件事的载体。

---

## 1. 等待与流式输出：颜文字 + 光晕动效

### 1.1 设计意图

纯三点 loading 无法传达"谁在思考"和"情绪"。本项目用**一条消息专属的俏皮颜文字**（kaomoji）
承担"这是 AI 的第 N 个想法"的拟人化标识，并在三个位置复用同一个颜文字，形成一条连贯的动线：

| 位置 | 组件 | 呈现 |
| --- | --- | --- |
| 等待首字 | `ChatMessageItem` 正文气泡 | 颜文字胶囊徽章 + 三点波浪 + 光晕 |
| 思考 / 工具执行中 | `StepActivityCard` | 标题栏内小号颜文字胶囊（呼吸光晕）；工具列表末行"Agent 执行中…" |
| 正文流式末尾 | Streamdown 光标 | 颜文字替换原生块状光标，呼吸光晕胶囊 |

**同一条消息在三个位置用同一个颜文字**，用户能通过颜文字把"等待→思考→输出"串起来，这是这套动效真正的价值；
如果每个位置随机取，视觉上会碎掉。

### 1.2 候选池与稳定性

`frontend/src/canvas/nodes/ai/utils/kaomoji.ts`：

```ts
export const KAOMOJI_PRESETS = ['(｡•ㅅ•｡)', "('•_•')", '(¬‿¬)', /* …共 16 个… */] as const;
export function getRandomKaomoji(): string { /* 随机 */ }
export function getStableKaomoji(seed: string | number): string { /* 按 id / 轮次索引哈希 */ }
```

选池标准：**跨平台字符集安全 + 不折行**。避免 emoji、避免宽字符、避免组合符号（部分终端/字体渲染成豆腐块）。
需要可复现（如按消息 id 派生）时用 `getStableKaomoji`。

`ChatMessageItem` 用 lazy `useState` 在**挂载时取一次**，保证流式生命周期内颜文字稳定不跳变：

```tsx
const [kaomoji] = useState(() => getRandomKaomoji());
```

> 注意：`useState(getRandomKaomoji)`（传函数引用而非调用）会在每次渲染时求值并导致抖动，必须写成 `useState(() => getRandomKaomoji())`。

### 1.3 等待首字态（Waiting for first token）

判定条件在 `ChatMessageItem`：

```ts
const hasContent = Boolean(msg.content && msg.content.trim().length > 0);
const isWaitingInitialToken = Boolean(
  msg.streaming && !hasContent && !msg.reasoning && (!msg.agentSteps || msg.agentSteps.length === 0)
);
// 有正文 / 等首字 / 被中断 → 才渲染气泡；否则中间步骤不出现空白矩形
const shouldRenderBubble = hasContent || isWaitingInitialToken || Boolean(msg.interrupted);
```

渲染（胶囊颜文字 + 三点波浪，全部用 accent 色，不引入第二种强调色）：

```tsx
{isWaitingInitialToken ? (
  <div className="flex items-center gap-2 py-0.5 select-none">
    <span className="text-[11px] font-medium text-accent inline-flex items-center px-1.5 py-0.5
                     rounded-full bg-accent/15 border border-accent/25 animate-pulse
                     shadow-[0_0_8px_rgba(var(--color-accent),0.25)]">
      {kaomoji}
    </span>
    <div className="flex items-center gap-1.5 h-3 pl-0.5">
      <div className="w-1.5 h-1.5 rounded-full bg-accent/75 animate-thinking-wave" style={{ animationDelay: '0ms' }} />
      <div className="w-1.5 h-1.5 rounded-full bg-accent/75 animate-thinking-wave" style={{ animationDelay: '180ms' }} />
      <div className="w-1.5 h-1.5 rounded-full bg-accent/75 animate-thinking-wave" style={{ animationDelay: '360ms' }} />
    </div>
  </div>
) : (
  <MarkdownContent content={stripUnrenderableImages(msg.content, workspaceId) || (msg.interrupted ? '已中断' : '')}
                    isAnimating={!!msg.streaming} />
)}
```

要点：
- 等待态**复用正文气泡容器**，只换内部内容 → 不会出现"内容往下跳"的重排；
- 三点错峰 0 / 180 / 360ms，位移只有 `-2px` + `scale 0.92→1.05`，幅度小才不刺眼；
- `isWaitingInitialToken` 严格要求"无 reasoning、无 agentSteps"——一旦模型开始思考或调工具，等待点自然消失，转由步骤卡接管，**避免两个 loading 同时存在**。

### 1.4 思考 / 工具执行中的颜文字

`StepActivityCard`：

- 「思考推理」标题行：`streaming && !hasContent && kaomoji` 时追加 8.5px 小胶囊，带 `animate-pulse` + `shadow-[0_0_6px_...]`；
- 工具明细末行：旋转 `Loader2` + 颜文字胶囊（此处不加 pulse，避免整屏多元素同时闪）+「Agent 执行中…」。

### 1.5 正文末尾的流式光标（颜文字替换块状光标）

Streamdown 自带 `caret="block"`，实测是一个黑色方块。本项目在全局 CSS 里把它替换成颜文字胶囊，
**不动第三方组件、不改 Markdown 渲染管线**：

```css
@keyframes streamdown-kaomoji-breathe {
  0%, 100% { opacity: 1; transform: scale(1);
             box-shadow: 0 0 10px color-mix(in srgb, var(--color-accent) 45%, transparent),
                         0 0 3px  color-mix(in srgb, var(--color-accent) 30%, transparent);
             background-color: color-mix(in srgb, var(--color-accent) 14%, transparent);
             border-color:     color-mix(in srgb, var(--color-accent) 32%, transparent); }
  50%      { opacity: 0.65; transform: scale(0.96);
             box-shadow: 0 0 4px color-mix(in srgb, var(--color-accent) 20%, transparent);
             background-color: color-mix(in srgb, var(--color-accent) 7%, transparent);
             border-color:     color-mix(in srgb, var(--color-accent) 18%, transparent); }
}

[style*="--streamdown-caret"] > *:last-child::after {
  content: var(--kaomoji-caret, "(｡•ㅅ•｡)") !important;
  display: inline-block !important;
  font-size: 0.78em; font-weight: 500; line-height: 1;
  color: var(--color-accent);
  background-color: color-mix(in srgb, var(--color-accent) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
  border-radius: 9999px;
  padding: 0.12rem 0.38rem;
  margin-left: 0.35rem;
  vertical-align: 0.12em;
  white-space: nowrap;          /* 关键：颜文字不许折行 */
  user-select: none;            /* 关键：不被复制进剪贴板 */
  pointer-events: none;
  animation: streamdown-kaomoji-breathe 1.4s ease-in-out infinite !important;
}
```

每条消息把该条的颜文字通过 **CSS 变量注入到气泡元素**，因此光标与等待徽章、步骤卡天然同源：

```tsx
<div style={{ '--kaomoji-caret': `"${kaomoji}"` } as React.CSSProperties}>
```

呼吸周期 1.4s：比常见的 1s 慢，"慢慢呼吸"比"快速闪烁"更接近"正在思考"的直觉，且不会造成阅读干扰。

### 1.6 无障碍与降级

`chatStyles.ts`（由 `ChatNode` 通过 `<style dangerouslySetInnerHTML>` 注入）包含 reduced-motion 分支：

```css
@media (prefers-reduced-motion: reduce) {
  .animate-thinking-wave { animation: thinking-glow 1.4s ease-in-out infinite; transform: none !important; }
  .msg-enter-anim, .pop-enter-anim { animation: none !important; opacity: 1 !important; transform: none !important; }
}
```

即：降级为"只淡入淡出、不位移"。复刻时不要省这段。

> ⚠️ 复刻注意：`chatStyles.ts` 的 keyframes 当前由 `ChatNode` 局部注入，而 `AgentChatPanel` 自身**没有**注入。
> 新面板若独立渲染，需要把 `msg-enter-anim` / `pop-enter-anim` / `animate-thinking-wave` / `animate-thinking-glow`
> 提到全局样式表，否则等待动效会退化成静止的三点。

---

## 2. AI 输出：复制 / 重试 / 删除

### 2.1 操作栏的时机与位置

操作栏不是常驻的，它和 token 用量共用一行，**流式结束后才出现**，且平时 `opacity-0`、hover 才显形：

```tsx
{!msg.streaming && (msg.tokenUsage || hasContent || canDelete) && (
  <div className="flex items-center justify-between w-full max-w-[92%] text-[10px] pl-1 mt-0.5 select-none min-h-[22px]">
    <div className="flex items-center gap-1.5 font-mono text-ink-faint/60">{/* token 用量 */}</div>
    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
      {/* 复制 / 重新生成 / 删除 */}
    </div>
  </div>
)}
```

三点设计判断：

1. **左信息、右操作**：token 是常驻低频信息，复制/重试/删除是偶发动作，视觉权重天然分离；
2. **hover 显形**：`group-hover` 让历史消息保持干净，同时 `focus-visible:opacity-100` 保证键盘可达；
3. **hover 时不位移**：用 `opacity` 过渡而非位移/宽度过渡，避免整列抖动。

按钮规格统一：`p-1` + 12px 图标 + `active:scale-[0.96]` + `focus-visible:ring-1`；hover 色按语义分（复制=中性、重试=accent、删除=error）。

### 2.2 复制

```tsx
const handleCopy = useCallback(async (content: string, idx: number) => {
  try {
    await copyTextToClipboard(content);
    setCopiedId(idx);
    setTimeout(() => setCopiedId(null), 2000);
    showToast('已复制回复内容', { type: 'success' });
  } catch {
    showToast('复制失败，请手动选择文本复制', { type: 'error' });
  }
}, [showToast]);
```

- 图标在 `Copy` / `Check` 之间切换（`isCopied`），2 秒自动复原——**双通道反馈**：局部图标给确认感，toast 给明确结果；
- 复制的是**原始正文**（`msg.content`），不是渲染后的纯文本，不做任何清洗；
- 失败必须给可执行的降级提示（"请手动选择文本复制"），不要静默。

### 2.3 重试 AI 回复（截断式重生成）

语义不是"再问一次同样的问题"，而是**回退到本轮 user 输入，丢弃这条及其后续回复后重发**：

```tsx
// ChatNode：倒序找到本轮 user 输入，复用编辑重发通道
const handleRetryAssistant = useCallback((assistantIdx: number) => {
  let targetUserIdx = -1;
  for (let i = assistantIdx - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { targetUserIdx = i; break; }
  }
  if (targetUserIdx >= 0) onEditResend?.(id, targetUserIdx, messages[targetUserIdx].content);
}, [id, messages, onEditResend]);
```

要点：
- **重试 = 截断重发**，一个动作同时解决"重生成"和"删掉后面几轮"；
- 只在能力可用时渲染：`{Boolean(onRetryAssistant) && !isGenerating && ...}`——生成中不允许改历史，避免状态机打架；
- tooltip 必须说明副作用：「重新生成此回复（删除当前回复及后续消息）」。

### 2.4 用户中断（停止）的痕迹

```tsx
{msg.interrupted && !msg.streaming && isLast && (
  <div className="flex items-center gap-1.5 text-[10px] text-ink-faint pl-1">
    <span className="flex items-center gap-1"><Square size={8} strokeWidth={2} fill="currentColor" />已中断</span>
    <button onClick={onRetry} …><RefreshCw size={9} />重试</button>
  </div>
)}
```

- 中断态用「■ 已中断」文本标记 + 边框按钮「重试」，而不是只在气泡里塞一个 `已中断` 字样；
- 中断内容为空时，正文回退渲染 `已中断` 文字（`msg.interrupted ? '已中断' : ''`），保证有可见痕迹；
- 重试入口只在 `isLast` 时出现（更早的中断轮次由各自消息的常规操作栏负责）。

### 2.5 Token 透明化

`formatTokenCount` 做单位归并（≥1M → `1.2M`，≥1k → `3.4k`），同一行展示：
`3.4k tokens (↑2.1k ↓1.3k) · 42% 窗口 · 缓存命中 68%`。

- 用等宽字体 + 最淡色，字号 10px，`select-none`——它是"给 interested 的人看"的信息；
- `percent` 与 `cacheRead` 都配 `title` 悬浮解释（上下文窗口大小、缓存命中计算口径）；
- 空值用 `<span />` 占位保持左右两端对齐。

---

## 3. 用户输入：编辑重发 / 重发 / 删除

### 3.1 气泡形态

- 右对齐，`max-w-[85%]`，accent 底色 + `rounded-2xl rounded-br-sm`（右下角收紧，指向"发出去了"）；
- 文字 `whitespace-pre-wrap break-words [text-wrap:pretty]`，允许长文换行又不破坏末行；
- 附件（图片缩略图 / 上传文件卡片）**排在气泡上方**，右对齐同一基线，不塞进气泡文本；
- 发送后立即以"乐观消息"上屏（见 §4.1），不等服务端回包。

### 3.2 hover 纠错入口

控件放在气泡**左侧外部**（`items-start justify-end gap-1`），hover 消息组时淡入：

```tsx
{canEdit && !isGenerating && (
  <div className="opacity-0 group-hover/user:opacity-100 flex items-center gap-0.5 shrink-0 mt-1 transition-opacity duration-150">
    <button onClick={() => onEditResend?.(idx, rawContent)} title="重新发送此轮对话（删除后续消息）" …><RefreshCw size={13} /></button>
    <button onClick={handleStartEdit}                title="编辑并重新发送"                             …><Pencil size={13} /></button>
  </div>
)}
```

- **重发**（RefreshCw）：原文不变，直接重发这一轮；**编辑**（Pencil）：进入编辑态；
- 两个动作都带 tooltip 明确副作用；
- 生成中整体隐藏（`!isGenerating`），不做"禁用但可见"——禁用态按钮在 hover 区里只会制造噪音。

### 3.3 行内编辑态

编辑态**原地替换气泡**，不弹窗、不跳到底部：

```tsx
<textarea
  value={editText}
  onChange={…}
  onKeyDown={(e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleConfirmResend(); }
    else if (e.key === 'Escape') { e.preventDefault(); handleCancelEdit(); }
  }}
  className="w-full min-h-[64px] max-h-[220px] p-2 … resize-y"
  placeholder="编辑此条消息..."
  autoFocus
/>
<div className="flex items-center gap-1.5 text-xs">
  <span className="text-[10px] text-ink-faint/60 mr-1 select-none">Ctrl+Enter 发送 · Esc 取消</span>
  <button onClick={handleCancelEdit} …>取消</button>
  <button onClick={handleConfirmResend} disabled={!editText.trim() || isGenerating}
          className="px-2.5 py-1 text-white bg-accent disabled:opacity-50 …">重新发送</button>
</div>
```

要点：
- 编辑框**复用气泡的视觉容器**（accent 描边 + 圆角），用户心智上"我还在改这条消息"；
- `autoFocus` + 光标落在文本末尾（`handleStartEdit` 用展示层原文回填）；
- `Ctrl/Cmd+Enter` 发送、`Esc` 取消，hint 用 10px 灰字常驻显示——快捷键不写出来等于不存在；
- 空文本或生成中禁用「重新发送」，避免空消息与并发发送；
- 文案用「重新发送」而不是「保存」，明确点击后会发生什么。

### 3.4 编辑重发的状态语义（截断 + 重发）

`ChatNodeHost.handleEditResend`：

```ts
const preserved = curStore.slice(0, index);            // 1. 截断该条之后的所有消息
const updatedUser = { ...curStore[index], content: newText };  // 2. 只改正文，保留原 images / 上下文
const targetHistory = [...preserved, updatedUser];
setMessages(storeToUI(preserved));                     // 3. 先把 UI 裁到 preserved
void sendMessage({ text: newText }, { metadata: { bookplate: { images: updatedUser.images,
                                syncHistory: true, history: targetHistory } } });
                                // 4. 显式透传 history，避免 React 异步 setState 造成的错位
```

同时 `syncChatSessionMessages(curWs, next)` 把裁剪结果落回服务端会话文件，**防止刷新/载入后"被删的消息复活"**。

> 这是复刻时最容易漏的一环：UI 截断 ≠ 持久化截断。凡是"改历史"型交互，都必须同步服务端会话文件，
> 否则刷新后时间线会自我矛盾。

---

## 4. 面板级：让长对话不累

### 4.1 乐观上屏 + 流式结束原子水合

三段式数据合成（`AgentChatPanel`）：

```
展示列表 = 服务端水合历史 sessionMsgs
         + 本轮乐观 user 消息 optimisticUser
         + 本轮流式 assistant 步骤 liveAssistantMsgs（streamState.steps 拆分）
```

流结束（`finally`）时：先 `settle`（停流式标记但**保留 steps**），再拉一次 `fetchPiSession` 原子替换历史，最后 `end` 复位。

> 关键：`settle` 与 `end` 分离。`settle` 只停 spinner、不清内容；`end` 在水合成功后才清。
> 否则会出现"流刚结束内容先清空、历史还没到"的空窗闪烁。

### 4.2 流式状态机用纯 reducer

`piStreamReducer` 的三条不变量（复刻时照抄即可）：

1. **一条 assistant 消息 = 思考 + 正文 + 工具步骤**，`steps` 是列表而非单对象——一次回复可能多次调工具并分段输出；
2. `tool_result` 标记 `sealed`：此后第一条正文/思考增量**开启新气泡**，而非继续追加；
3. `turn_start`（后台子代理完成自动续轮）**强制**开新步骤，不等 sealed 边界。

纯函数归约的好处：流式 UI 可以整体重放调试，SSE 解析与渲染彻底解耦。

### 4.3 步骤卡片：自动展开 / 自动收起

```ts
const [userToggledOpen, setUserToggledOpen] = useState<boolean | null>(null);
const open = userToggledOpen ?? (streaming && !hasContent);   // null = 跟随系统
```

- 三态：`null`（自动）/ `true`（用户展开）/ `false`（用户收起），**用户显式操作后永久优先**；
- `hasContent` 由 false→true 时自动收起一次（`sawContentRef` 保证只做一次）；
- 折叠动画用 `grid-rows-[0fr]→[1fr]` + `overflow-hidden`，无需测高；
- 步骤序号由渲染时按"距上一条 user 的 assistant 计数"得出（`stepNumber`），标题形如「步骤 2 · Canvas Agent」，折叠态尾部用 `reasoning` 末 40 字或最后一个工具名做摘要。

### 4.4 滚动：贴底要有迟滞

`ChatNode` 的实现值得照抄（面板形态可只取前两条）：

```ts
// 迟滞区间：离底 ≤24px 恢复吸附，>48px 稳定保持自由阅览
if (distFromBottom <= 24) stickBottom = true;
else if (distFromBottom > 48) stickBottom = false;
// 用户主动上滚（滚轮 deltaY<0 / 触摸下滑 >8px）立即解除贴底，防止被流式高频拉底干扰阅读
```

配套：`contain: content`（`.chat-scroll-container`）限制布局抖动；滚动监听走 `requestAnimationFrame` 节流；
贴底时自动 `scrollIntoView({ behavior: 'smooth' })`。

### 4.5 渲染性能

- `ChatMessageItem` 用 `memo`——流式期间只有最后一条的 `msg` 对象是新的，历史消息 props 不变即跳过渲染；
- `StepActivityCard`、侧边面板各个 Tab 同样 `memo`；
- Markdown 渲染统一走 `MarkdownContent`：**插件对象单例化**（避免每次渲染重新注册 Streamdown 插件），
  大文档/含代码块时首帧只用 `cjk` 轻量插件，**静默 240ms 后**再升级 Shiki 高亮——流式期间内容持续变化会不断重置计时器，
  于是"整段流式都是极速渲染"，流结束后自动获得高亮。

### 4.6 输入区（Composer）

- **发送/停止同位形变**：同一个按钮位，`isGenerating` 时换成 `error` 色实心方块（停止），否则 accent 发送键；
- 生成中 `textarea` 禁用且 placeholder 变「回复生成中…」，附件按钮同步禁用；
- 拖拽上传用 `dragenter/leave` **成对计数**（`dragDepthRef`）判断是否仍在区域内，避免子元素触发时闪烁；
- `@` 工作区文件引用：portal 弹层 + `role="combobox"/"listbox"/"option"` + `aria-activedescendant`，
  ↑↓ 选择、Enter/Tab 补全、Esc 关闭；弹层优先底对齐向上弹出，空间不足自动翻转；
- `@path` **原子删除**：光标落在引用文件名任意位置时 Backspace/Delete 一整块删掉（含尾随空格），不会删出半截路径；
- 上传成功后把 `@path` 插入光标处并高亮（镜像 backdrop 层用 `<mark>` 染色，textarea 文字透明）；
- 附件 chip 的「×」同时从草稿文本里移除对应路径——**展示态与草稿态永远一致**。

### 4.7 面板骨架

- 顶栏：图标块 + 标题 + **状态点**（emerald 小圆点表示就绪）；右侧一排 15px 图标按钮
  （快捷灵感 / 侧边抽屉 / 宽屏切换 / 新会话 / 关闭），均配 `title` + `aria-label`；
- 侧边抽屉（`ChatSidePanelDrawer`，向左吸附）：AI 产物 / 我的上传 / 对话历史 / 全部文件 四个 Tab，
  对话历史支持置顶、重命名、单删、批量删除；**列表口径必须写明**（如"仅画板助手自身的对话"），否则用户会误判删到别人的对话；
- 空态：一句人格化欢迎语 + 能力边界说明 + 3 条「你可以试试」快捷 prompt（点击即发）；
- 「清空」的真实语义是**开启新会话**（旧对话进历史），确认框要说明"当前对话会保留在对话历史中"，
  且绝不能顺手调用"彻底删除会话"的后端接口，否则该对话会从历史列表里消失；
- 快捷灵感用 `absolute bottom-full` 向上弹出的浮层，不挤压消息区。

---

## 5. 视觉与微交互清单

| 维度 | 规范 |
| --- | --- |
| 强调色 | 全程只用 `accent` 一个强调色；错误用 `error`，正文层级用 `ink` / `ink-light` / `ink-faint` |
| 字号阶梯 | 步骤卡与操作栏 10–10.5px / 元信息 9.5px mono / 正文 14px / 引用块 11px |
| 圆角 | 气泡 `rounded-2xl` + 单角收紧（user `rounded-br-sm`，assistant `rounded-bl-sm`）/ 卡片 `rounded-lg` / 徽章 `rounded-full` |
| 面板进场 | `animate-in slide-in-from-right-4 duration-200`，`transform-origin: bottom right` |
| 消息进场 | `msg-enter-anim`（180ms，`cubic-bezier(0.16,1,0.3,1)`，仅 3px 上移） |
| 弹层进场 | `pop-enter-anim`（`scale 0.96→1`，`--pop-origin` 控制缩放原点） |
| 按钮反馈 | `active:scale-[0.96] transition-[color,background-color,transform] duration-150` |
| 焦点可见 | 所有可交互元素 `focus-visible:ring-1/2 ring-accent`，**不要 outline:none 了事** |
| 降级 | `prefers-reduced-motion` 下取消位移，仅保留淡入淡出 |

---

## 6. 反模式（不要在复刻时照抄的地方）

1. **重试 ≠ 再发一遍同样的问题**。必须截断到本轮 user，否则会出现"同一提问的多个回答堆在一起"。
2. **UI 截断后必须落库**。只改前端 state 会在刷新后复活已删消息。
3. **等待态复用正文气泡**。新起一个 loading 块会造成内容跳变。
4. **不要在每个 loading 位置各随机一个颜文字**。同一条消息共用一个，视觉才连贯。
5. **生成中不要禁用"看起来能禁用"的 hover 操作**。直接隐藏，避免噪音与状态竞争。
6. **token 信息不要做成 tooltip-only**。常驻低对比展示是给"想知道的人"的，不是给所有人的。
7. **气泡里不要预渲染空态**。用 `shouldRenderBubble` 判定，杜绝中间步骤出现空白矩形。
8. **纯 CSS 覆盖第三方组件要带兜底变量**：`var(--kaomoji-caret, "(｡•ㅅ•｡)")`。

---

## 7. 已知缺口与复刻时的补齐点

现状（阅读代码所得，未做运行时验证）：

- `AgentChatPanel` 只向 `ChatMessageItem` 传了 `onCopy` / `isCopied` / `onRetry`，
  **未传** `onEditResend` / `onRetryAssistant` / `canEdit` / `canDelete` / `onDelete`，
  因此画板助手当前**没有**"编辑重发 / 删除消息 / 对任意历史轮次重试"，其 `onRetry` 仅能重发刚发出的那一轮原文
  （`handleSend(optimisticUser?.content || '')`），且不截断历史。
- `ChatNode` 侧（`mode === 'llm'`）才具备完整的编辑重发 / 重试 / 删除能力，可直接作为复刻参考实现。
- 若要在 `AgentChatPanel`（pi 工作区会话模型）补齐编辑重发，需要服务端提供"截断到某条消息"的能力，
  因为其历史真相源是 `fetchPiSession` 水合而非前端 state——与 LLM 模式的 `syncChatSessionMessages` 路径不同。
- `chatStyles.ts` 的 keyframes 目前由 `ChatNode` 局部注入；独立渲染的新面板需自带或改为全局。

---

## 8. 最小复刻清单

要在一个新项目里复刻这套交互，按此顺序落地：

1. **数据层**：一个纯 reducer 管理 `isStreaming / steps / error / pendingUi`，`steps` 按 assistant 消息拆分，`settle` 与 `end` 分离；
2. **动效层**：全局 CSS 注入 `msg-enter` / `pop-enter` / `thinking-wave` / `thinking-glow` + reduced-motion 分支，
   以及光标颜文字替换规则 + `will-change` 提示；
3. **颜文字层**：候选池 + 每条消息 lazy `useState` 固定一个 + `--kaomoji-caret` 变量下发；
4. **消息层**：`memo` 化单条消息，四个区块（步骤卡 / 正文气泡 / 附件 / 底部信息+操作栏），
   `shouldRenderBubble` 门控，行内编辑态与 hover 纠错入口；
5. **输入层**：发送/停止同位形变 + 附件 + `@` 引用（可先只做附件）+ Enter 发送；
6. **面板层**：顶栏状态点与动作区、侧边抽屉（产物/历史）、空态快捷 prompt、乐观上屏 + 结束水合；
7. **无障碍**：`aria-label` / `title` / `focus-visible` / `prefers-reduced-motion` / 键盘可达的 hover 专属操作。