# ExtensionWidgets 通用机制实现方案（服务端多租户版）

> **文档版本**：v2.0
> **创建日期**：2026-08-28（v2.0 修订）
> **目标读者**：接手升级项目的工程师
> **关联文件**：
> - 后端：`backend-ts/src/services/pi-agent-service.ts`
> - 后端（新）：`backend-ts/src/services/pi-widgets.ts`（工具事件桥 + widget 持久化）
> - 后端：`backend-ts/src/modules/bookplate/routes/ai-nodes.ts`
> - 前端：`frontend/src/modules/bookplate/PiChatNodeHost.tsx`
> - 前端：`frontend/src/modules/bookplate/components/ChatNode.tsx`
> - 前端：`frontend/src/modules/bookplate/piStream.ts`

---

## 0. 变更摘要（相对 v1）

v1 存在两处根本性错误前提，v2.0 已重写：

| 项目 | v1（错误） | v2.0（本方案） |
|------|-----------|---------------|
| 运行拓扑 | 隐含 pi-web 的「本地安装、本地渲染」 | **pi 安装在服务器、多账户共享**，每个用户从任意远程浏览器访问 |
| 数据获取 | `pi CLI` 在 JSON 模式 stdout 发出 `setWidget` 事件 | **结构化工具事件桥**：拦截 `tool_call` / `tool_result`（JSON 模式稳定事件），由注册表转为 widget |
| 渲染内容 | ANSI 文本行（服务端无 TUI 渲染器，不成立） | 纯文本行 `lines` + 可选结构化 `data`，服务端注册表精挑安全字段下发 |
| 生命周期 | `end` 清空 `widgets`，跨轮丢失 | **widget 以服务端为真相源**，随水合恢复；跨轮/刷新存活 |
| 兼容承诺 | "零前端代码，rpiv-todo 自动渲染" | 收敛为："**以工具定义能力的扩展**，后端注册一行生产者即可，前端零代码" |
| 安全 | 未考虑扩展=服务端代码执行 | 扩展仅管理员白名单、按工作区挂载、版本锁定 |

前端通用组件（`ExtensionWidgets`、reducer、样式）在 v1 中设计基本正确，v2.0 保留并修正，但**后端获取渠道与生命周期语义全部重写**。

---

## 1. 背景与动机

### 1.1 现状与目标问题

当前项目中，每个 pi package 的 UI 展示都需要手动集成：

| 功能 | 组件 | 状态管理 | 新增成本 |
|------|------|----------|----------|
| 工具执行步骤 | `AgentActivity` | `nodeSteps` | ~50 行 |
| 自动重试 | `RetryNoticeBanner` | `retryNotice` | ~30 行 |
| 工作区文件 | `WorkspaceFilesPanel` | `panelFiles` | ~80 行 |
| TodoList | 需新增 | 需新增 | ~100 行 |

**目标**：新增一个 pi extension package（如 `@juicesharp/rpiv-todo`），后端**注册一行生产者**、前端**零代码**，其状态自动以可折叠/可更新的面板出现在 Chat 节点上。（注意：此处"零前端代码"仅对**通过工具暴露能力**的扩展成立，原因见 §1.2 与 §2。）

### 1.2 运行拓扑：本项目 vs pi-web（关键前提）

**pi-web（参考项目）：**
```
用户本地电脑
  ├─ pi agent（本地安装）＋ 扩展包（本地安装）
  └─ 本地 TUI 进程内渲染 widget（setWidget factory / 字符串数组）
     widget 生命周期与本地会话强绑定，刷新/断线依赖本地持久化
```

**本项目（服务端多租户）：**
```
远程浏览器（任意电脑，多账户）
        ⇅ HTTPS/SSE
后端服务器（共享）
  └─ 按用户/工作区独立启停的 pi 子进程（--mode json）
     ├─ 扩展包：管理员审核后按工作区挂载（见 §4.3）
     └─ widget 只能以「数据」形式过 SSE 推到远端浏览器渲染
```

由此推导出四条**硬约束**（§2），v2.0 的所有设计选择都以这四条为前提。

---

## 2. 核心设计约束

### C1 — 服务端无 TUI，不能依赖 pi 的本地 UI 机制

验证事实（`@earendil-works/pi-coding-agent@0.84.2`）：
- JSON 模式 `ctx.hasUI === false`，`setWidget`/`notify`/`setStatus` 全部落在 `noOpUIContext` 上**静默丢弃**（`dist/core/extensions/runner.js:88-119`，文档 `docs/extensions.md:943,947`）。
- 即使切 `--mode rpc`：`setWidget` **只接受字符串数组，factory 被忽略**（`dist/modes/rpc/rpc-mode.js:123-136`）；而生态代表 `rpiv-todo` 正是用 factory 注册（其 `todo-overlay.ts`），RPC 下同样拿不到内容。
- `select/confirm/input/editor` 等 dialog 方法在 RPC 下会**阻塞等待 stdin 响应**，本项目是服务端无头多租户，无人应答通道，直接排除。

> **结论**：**不**以"订阅 pi 的 widget/UI 事件"为获取渠道。

### C2 — 多租户共享服务器，扩展即服务端代码执行

每个用户的 pi 子进程都在同一台服务器上运行；扩展（`-e` 加载的 ts/包）会**在服务端执行任意代码**——这与 pi-web"自己的电脑"完全不同。

> **结论**：扩展只能走**管理员白名单**，按工作区隔离挂载，禁止用户直接安装任意扩展到共享目录。（现有 skills 流程保留：纯提示词/工具声明的 skill 仍走 `userSkillsRoot`。）

### C3 — 服务端是会话真相源，widget 状态必须服务端持久化

本项目 Chat 节点以服务端水合（`pi-session-hydrate.ts` / GET `/chat/session`）为唯一真相源；刷新、多设备、进程重启都会重挂载。v1 的 `widgets` 只存在于前端 reducer，`end` 即清空——**生命周期与架构相悖**。

> **结论**：widget 状态落服务端（per-workspace 快照），随水合下发；前端 reducer 只做展示层归约。

### C4 — 只依赖 JSON 模式的稳定事件面，隔离 pi 内部协议

JSON 模式的事件集是文档化且相对稳定的（`docs/json.md`：`message_update / message_start|end / tool_execution_start|end / compaction_* / turn_* / agent_*`）。本项目已消费其中多个并在自己进程内归一化为 `ChatStreamEvent`。

> **结论**：widget 数据从**已有归一化事件**（`tool_call` / `tool_result`，pi-agent-service.ts:663-679）二次加工而来；pi 内部协议面（`extension_ui_request` 等）与未来可能改动的 UI 面**一律不碰**，全部收敛在一个 adapter 模块。

---

## 3. 架构设计

### 3.1 数据流（重写）

```
┌──────────────────────────────────────────────────────────────────┐
│ pi 子进程（每用户每工作区独立，--mode json，服务端）                  │
│   rpiv-todo 等扩展在进程内执行 → 其工具被调用                         │
│   stdout: {"type":"tool_execution_start", toolName:"todo", args}  │
│           {"type":"tool_execution_end", toolName:"todo", result}  │
└──────────────────────────────────────────────────────────────────┘
                          ↓（现有 runPiAgent 归一化，不改）
┌──────────────────────────────────────────────────────────────────┐
│ 后端 adapter：pi-widgets.ts（新）                                   │
│   withWidgetBridge() 包装事件流：                                  │
│   tool_call / tool_result → 按 toolName 查生产者注册表              │
│   → 产出 WidgetDraft（key/lines/placement/data）                  │
│   → 去重/节流/尺寸上限 → 发射 extension_widget / extension_widget_clear │
│   → 收尾把最终快照写入 per-workspace widgets store（真相源）          │
└──────────────────────────────────────────────────────────────────┘
                          ↓ ChatStreamEvent（现有 SSE 管线，不改）
┌──────────────────────────────────────────────────────────────────┐
│ SSE: data:{"type":"extension_widget","key":"rpiv-todos",          │
│           "lines":["Todos (1/3)","✓ 任务1","◐ 任务2",...]}        │
└──────────────────────────────────────────────────────────────────┘
                          ↓（现有 chatStreamToSseResponse）
┌──────────────────────────────────────────────────────────────────┐
│ 前端                                                        │
│   piStream parseSseStream → reducer（widget_update/clear）管理 state     │
│   水合 /chat/session 时以 widgets 快照 widget_set_all 对齐               │
│   ExtensionWidgets 通用组件渲染（折叠/展开、更新脉冲、placement 分组）    │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 内部数据模型与状态机

```typescript
// WidgetDraft - 生产者产出（后端内部）
interface WidgetDraft {
  key: string;                                    // widget 唯一标识（如 "rpiv-todos"）
  lines: string[];                                // 纯文本行（非 ANSI；服务端无渲染器）
  placement?: 'aboveEditor' | 'belowEditor';      // 布局提示（宿主可自行分组）
  data?: Record<string, unknown>;                 // 可选结构化载荷（前端按需消费）
}

// PiStreamEvent - 新增事件（线上形态）
type PiStreamEvent =
  | /* ...现有事件... */
  | { type: 'extension_widget'; key: string; lines: string[]; placement?: 'aboveEditor' | 'belowEditor' }
  | { type: 'extension_widget_clear'; key: string };

// WidgetState（服务端持久的每 key 快照）
interface WidgetSnapshot {
  key: string;
  lines: string[];
  placement: 'aboveEditor' | 'belowEditor';
  data?: Record<string, unknown>;
  updatedAt: number;              // 排序列 / 审计
  toolCallId?: string;            // 溯源：由哪次工具调用产生
}
```

**widget 状态机**（服务端为权威，前端仅展示）：

```
absent ──(生产者首次产出)──▶ live(streaming) ──(流收尾)──▶ settled(持久化快照)
   △                                                            │
   │                                                            │ 新轮 start
   └──────────(extension_widget_clear / 清空聊天)◀────────────────┘
        （刷新/重挂载：水合把 settled 快照推回前端）
```

### 3.3 兼容性策略：对齐「数据契约」而非「本地 UI 机制」

- **对齐的**：pi 的工具契约（tool schema / tool_call / tool_result），这是跨版本最稳定、且扩展能力的主要载体（rpiv-todo 的核心价值全在 `todo` 工具）。
- **不对齐的**：`extension_ui_request`、RPC 命令面、TUI factory/ANSI 渲染——这些是 pi 的本地 UI 实现细节，版本演进活跃且在本项目无渲染宿主。
- 含义：**pi 升级、扩展包升级都不会破坏本机制**，因为依赖面只有文档化的顶层稳定事件 ＋ 工具本身的 JSON 契约。

---

## 4. 后端实现

### 4.1 工具事件桥 `ToolWidgetBridge`（新文件 `pi-widgets.ts`）

**设计目标**：新增扩展只需「注册一个生产者」，不改 `mapPiJsonEvent`、不改 `runPiAgent`、不改 SSE。

```typescript
// pi-widgets.ts

export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: string;   // JSON 字符串（参数对象）
}
export interface ToolResultInfo {
  id: string;
  name: string;
  result: string;      // JSON 字符串（结果对象，可为 "null"）
  isError?: boolean;
}

/** 生产者：把一次工具调用映射为 widget 更新。返回 null = 本工具不产生 widget。 */
export type ToolWidgetProducer = (
  call: ToolCallInfo,
  result?: ToolResultInfo
) => WidgetDraft | null;

const producers = new Map<string, ToolWidgetProducer>();

export function registerToolWidgetProducer(toolName: string, p: ToolWidgetProducer): void {
  producers.set(toolName, p);
}

/** 内置注册（随模块加载） */
registerToolWidgetProducer('todo', todoWidgetProducer);
```

**内置生产者示例：rpiv-todo 的 `todo` 工具**

rpiv-todo 是扩展包（含 `todo` 工具 + 本地 TUI overlay）。服务端无 TUI，但其 `todo` 工具**调用/结果本身就是结构化数据**，可直接映射为面板行：

```typescript
// todo 工具 arguments（模型侧）示例：
//   { "action": "add", "task": "完成任务1", "id": 1 }
// todo 工具 result（工具侧）示例：
//   { "ok": true, "state": { "tasks": [
//       { "id": 1, "task": "完成任务1", "status": "pending" },
//       { "id": 2, "task": "进行中任务2", "status": "in_progress" }
//   ] } }
// 以 result.state.tasks 为权威快照；args 仅用于『无结果的调用』时增量推断当前行。

function todoWidgetProducer(call, result?) {
  const tasks = latestTodoTasks(call, result); // 解析 result.state.tasks ?? args
  if (!tasks || tasks.length === 0) return null; // 空列表 → 调用方发 clear

  const done = tasks.filter((t) => t.status === 'completed').length;
  const lines = [
    `Todos (${done}/${tasks.length})`,
    ...tasks.map((t) => ` ${statusIcon(t.status)} ${t.task}`),
  ];
  return { key: 'rpiv-todos', lines, placement: 'aboveEditor', data: { tasks } };
}
```

> 实际字段名需以安装的 rpiv-todo 版本 `tool-schema.md` 为准（`docs/tool-schema.md`）；本方案给出的是生产者的**形态约定**，字段解析属于生产者内部实现。

**流包装器（单一接缝）**

```typescript
/** 包装 ChatStreamEvent 流：聚合工具调用 → 驱动生产者 → 产出 widget 事件。
 *  流结束（或中止）时把最终快照持久化。不改 runPiAgent / mapPiJsonEvent。 */
export async function* withWidgetBridge(
  events: AsyncGenerator<ChatStreamEvent>,
  opts: { workspaceId: string; store: WidgetStore }
): AsyncGenerator<ChatStreamEvent> {
  const pending = new Map<string, ToolCallInfo>(); // callId → call
  const live = new Map<string, WidgetDraft>();      // key → 最新 draft

  for await (const evt of events) {
    if (evt.type === 'tool_call') {
      pending.set(evt.id, { id: evt.id, name: evt.name, arguments: evt.arguments });
      yield evt;
      continue;
    }
    if (evt.type === 'tool_result') {
      const call = pending.get(evt.id);
      if (call && call.name === evt.name) {
        yield* maybeEmitWidget(producers, call, evt, live, evt.name);
        pending.delete(evt.id);
        // 节流：同 key 最小间隔（见 §6.2），避免高频工具调用打爆 SSE
      }
      yield evt;
      continue;
    }
    yield evt;
  }
  await store.commit(live); // 收尾/中止都提交一次最终快照（真相源）
}

function* maybeEmitWidget(
  producers, call, resultEvt, live
): Generator<ChatStreamEvent> {
  const p = producers.get(call.name);
  if (!p) return;
  const draft = p(call, {
    id: resultEvt.id, name: resultEvt.name,
    result: resultEvt.result, isError: resultEvt.isError,
  });
  const prev = live.get(draft?.key ?? '');
  if (!draft) {
    if (prev) {
      live.delete(prev.key);
      yield { type: 'extension_widget_clear', key: prev.key };
    }
    return;
  }
  applyCap(draft); // 尺寸上限（§6.2）
  live.set(draft.key, draft);
  yield { type: 'extension_widget', key: draft.key, lines: draft.lines, placement: draft.placement };
}
```

接入点：`ai-nodes.ts` 的 skillAgentEvents 中，仅一行改动。

```typescript
// ai-nodes.ts（Skill Agent 分支内）
const widgetified = withWidgetBridge(runPiAgent({...}), {
  workspaceId,
  store: createWidgetStore(wsIdRef workspaces),
});
for await (const evt of widgetified) yield evt;
```

**明确不做的（否决方案，务必不要实施）**
- 在 `mapPiJsonEvent` 增加 `case 'setWidget'` / `case 'extension_ui_request'`：JSON 模式根本不会产生这类事件（C1）。
- 切 `--mode rpc`：需要重写 stdin 命令/响应协议、`prompt`/`abort` 关联，且 `setWidget` 只支持字符串数组、factory 被忽略；dialog 会阻塞子进程（C1、C4）。
- 依赖服务器全局 `~/.pi/agent/extensions` autoload：多租户共享环境串扰，且 json 模式 load 行为不可控（C2）。

### 4.2 widget 持久化与服务端真相源（`pi-widgets.ts` / 水合扩展）

**存储**：per-workspace 快照 JSON（last-value-wins），路径 `{ws}/.pi-agent/widgets.json`——复用现有 `.pi-agent/` 差分排除前缀（`DIFF_EXCLUDED_PREFIXES`），不污染产物清单。

```typescript
export interface WidgetStore {
  commit(live: ReadonlyMap<string, WidgetDraft>): Promise<void>; // 原子写（临时文件+rename）
  snapshot(): WidgetSnapshot[];                                   // 读最近快照
  clear(): void;
}
```

**水合**：`GET /api/modules/bookplate/chat/session` 返回体增加顶层 `widgets`（配 `type HydratedSession` 的 `widgets` 字段即可，不改消息 DTO）：

```json
{ "exists": true, "messages": [...], "widgets": [ { "key": "rpiv-todos", "lines": [...], "placement": "aboveEditor", "data": {...}, "updatedAt": 172... } ] }
```

**清理**：`POST /chat/clear`（清空对话）时随会话一起清除 widgets（`clearPiSession` 或该路由内顺带删除）。

### 4.3 扩展包装配与安全（多租户重点）

目前装配逻辑在 `preparePiWorkspace`（pi-agent-service.ts:217）：skills 挂到 `<ws>/.pi-agent/skills/`，模型/设置写入 `.pi-agent/`，仅 `-e pi-image-gen` 显式加载扩展。扩展挂载对齐同一模式**新增**：

```
{ws}/.pi-agent/extensions/{name}/
    ├─ index.ts / src  …（扩展本体；npm 依赖随包复制，自含 node_modules 或已解析）
```

- **来源与白名单**：只有**管理员审核通过的扩展**可挂载（服务端代码执行 = 最高风险，见 §6.3）。设计一个 `EXTENSIONS` 白名单表（DB）或配置文件：`{ name, version, path, enabled, perAgentAllowlist[] }`。用户技能（纯提示词/工具声明）继续走现有 skills 流程，二者互不混用。
- **挂载策略**：复用 `symlinkOrCopy`（Bifrost 共享包 → 软链共享区；本地上传 → 复制）。Windows 无权限时自动退化为复制（现有语义）。
- **启动参数**：对白名单内启用的扩展，逐个追加 `-e {ws}/.pi-agent/extensions/{name}`（`-e` 可重复，与现有 `-e pi-image-gen` 并列）。**优先显式 `-e` 而非 autoload**，保证确定性、不读共享目录。
- **版本锁定**：扩展版本写入白名单并固定；升级 = 管理员操作 + 回归验证（§8），不随 npm 最新版本漂移。
- 实现时核对项：扩展 autoload 目录是否随 `PI_CODING_AGENT_DIR`/`PI_AGENT_HOME` 解析到 `<ws>/.pi-agent/extensions/`；若解析不符，一律以显式 `-e` 为准。

### 4.4 事件流规模控制

见 §6.2（节流、体积上限、丢弃策略），在 `maybeEmitWidget` 内统一执行，保证 SSE 线不会被高频/超大工具调用打爆。

---

## 5. 前端实现

### 5.1 修改 `piStream.ts`

```typescript
// 新增事件类型
export type PiStreamEvent =
  | /* …现有… */
  | { type: 'extension_widget'; key: string; lines: string[]; placement?: 'aboveEditor' | 'belowEditor' }
  | { type: 'extension_widget_clear'; key: string };

// 新增状态与 action
export interface ExtensionWidgetItem {
  key: string;
  lines: string[];
  placement: 'aboveEditor' | 'belowEditor';
  data?: Record<string, unknown>;
}
export interface PiStreamState {
  isStreaming: boolean;
  content: string;
  reasoning: string;
  error: string | null;
  widgets: ExtensionWidgetItem[];          // 跨轮保留（服务端真相源；见 reducer 语义）
}
export type PiStreamAction =
  | /* …现有… */
  | { type: 'widget_update'; key: string; lines: string[]; placement?: 'aboveEditor' | 'belowEditor' }
  | { type: 'widget_clear'; key: string }
  | { type: 'widget_set_all'; widgets: ExtensionWidgetItem[] };  // 水合快照对齐

export const INITIAL_PI_STREAM: PiStreamState = {
  isStreaming: false, content: '', reasoning: '', error: null,
  widgets: [],
};

export function piStreamReducer(state: PiStreamState, action: PiStreamAction): PiStreamState {
  switch (action.type) {
    case 'start':
      // 保留 widgets：跨轮/widget 来自服务端快照，新轮开始不清（服务端会在水合时对齐）
      return { isStreaming: true, content: '', reasoning: '', error: null, widgets: state.widgets };
    case 'content': return { ...state, content: state.content + action.delta };
    case 'reasoning': return { ...state, reasoning: state.reasoning + action.delta };
    case 'error': return { ...state, isStreaming: false, error: action.message };
    case 'settle': return { ...state, isStreaming: false };
    case 'end':
      // ★修订：不清空 widgets。content/reasoning 复位，widgets 交给服务端快照维护
      return { ...INITIAL_PI_STREAM, widgets: state.widgets };
    case 'widget_update': {
      const idx = state.widgets.findIndex((w) => w.key === action.key);
      const next: ExtensionWidgetItem = {
        key: action.key, lines: action.lines,
        placement: action.placement ?? 'aboveEditor',
      };
      if (idx >= 0) {
        const arr = [...state.widgets];
        arr[idx] = next;
        return { ...state, widgets: arr };
      }
      return { ...state, widgets: [...state.widgets, next] };
    }
    case 'widget_clear':
      return { ...state, widgets: state.widgets.filter((w) => w.key !== action.key) };
    case 'widget_set_all': {
      const incoming = action.widgets.map((w) => ({ ...w, placement: w.placement ?? 'aboveEditor' }));
      const same =
        incoming.length === state.widgets.length &&
        incoming.every((w, i) => JSON.stringify(w) === JSON.stringify(state.widgets[i]));
      return same ? state : { ...state, widgets: incoming };
    }
    default: return state;
  }
}
```

> `widget_set_all` 做引用比较避免无谓重渲染；水合数组顺序与卡片渲染一致（按 `updatedAt` 排序）。

### 5.2 修改 `PiChatNodeHost.tsx`

```typescript
// 1) SSE 分发（现有 parseSseStream 循环的 switch 中新增）
case 'extension_widget':
  dispatchStream({ type: 'widget_update', key: evt.key, lines: evt.lines, placement: evt.placement });
  break;
case 'extension_widget_clear':
  dispatchStream({ type: 'widget_clear', key: evt.key });
  break;

// 2) 水合对齐：fetchPiSessionMessages 或独立请求取得 widgets 快照
const widgets = streamState.widgets;
// 在 finishRun 水合成功 / 挂载水合成功后：
//   dispatchStream({ type: 'widget_set_all', widgets: hyd.widgets ?? [] });

// 3) 传给 ChatNode
<ChatNode … widgets={widgets} />
```

### 5.3 新建 `ExtensionWidgets.tsx`（单实例，按 placement 分组）

基于 v1 的组件修正两处：
1. **单实例渲染**：不再在 `ChatNode` 中按 placement 拆成两个实例（v1 导致展开态/默认展开逻辑割裂）。组件内部按 placement 分组输出。
2. 内容为纯文本/结构化描述，`<pre>` 内放置，React 自带转义无 XSS 面；行数上限兜底渲染。

```tsx
"use client";
import { useEffect, useId, useRef, useState } from "react";

const DEFAULT_EXPANDED_WIDGET_LINES = 3;   // 默认展开的行数上限
const WIDGET_UPDATE_IDLE_MS = 1100;         // 更新脉冲时长
const MAX_WIDGET_LINES = 40;                // 单 widget 显示行数兜底

export interface ExtensionWidgetItem {
  key: string;
  lines: string[];
  placement: "aboveEditor" | "belowEditor";
  data?: Record<string, unknown>;
}

function snap(widgets: ExtensionWidgetItem[]): Map<string, string[]> {
  return new Map(widgets.map((w) => [w.key, [...w.lines]]));
}

function updatedKeys(
  prev: ReadonlyMap<string, readonly string[]> | null,
  next: ReadonlyMap<string, readonly string[]>
): string[] {
  if (!prev) return [];
  return Array.from(next, ([key, lines]) => {
    const p = prev.get(key);
    if (!p || p.length !== lines.length) return p ? key : null;
    return lines.some((l, i) => l !== p[i]) ? key : null;
  }).filter((k): k is string => k !== null);
}

function defaultExpanded(widgets: ExtensionWidgetItem[]): string | null {
  const w = widgets.find((x) => x.lines.length > 1 && x.lines.length <= DEFAULT_EXPANDED_WIDGET_LINES);
  return w?.key ?? null;
}

export function ExtensionWidgets({ widgets }: { widgets: ExtensionWidgetItem[] }) {
  const idPrefix = useId();
  const prev = useRef<Map<string, string[]> | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [expandedKey, setExpandedKey] = useState<string | null>(() => defaultExpanded(widgets));
  const [updating, setUpdating] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const next = snap(widgets);
    const changed = updatedKeys(prev.current, next);
    prev.current = next;
    for (const [k, t] of timers.current) if (!next.has(k)) { clearTimeout(t); timers.current.delete(k); }
    setUpdating((cur) => {
      const s = new Set(Array.from(cur).filter((k) => next.has(k)));
      for (const k of changed) s.add(k);
      return s.size === cur.size && Array.from(s).every((k) => cur.has(k)) ? cur : s;
    });
    for (const k of changed) {
      const t = timers.current.get(k);
      if (t) clearTimeout(t);
      timers.current.set(k, setTimeout(() => {
        timers.current.delete(k);
        setUpdating((cur) => { const s = new Set(cur); s.delete(k); return s; });
      }, WIDGET_UPDATE_IDLE_MS));
    }
  }, [widgets]);

  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t); timers.current.clear(); }, []);

  if (widgets.length === 0) return null;
  const above = widgets.filter((w) => w.placement !== "belowEditor");
  const below = widgets.filter((w) => w.placement === "belowEditor");

  const renderGroup = (group: ExtensionWidgetItem[]) => {
    const expanded = group.find((w) => w.key === expandedKey && w.lines.length > 0);
    return (
      <>
        {expanded && (
          <section className="extension-widget-panel" aria-label={expanded.key}>
            <div className="extension-widget-panel-heading">{expanded.key}</div>
            <pre className="extension-widget-content">
              {expanded.lines.slice(0, MAX_WIDGET_LINES).join("\n")}
            </pre>
          </section>
        )}
        <div className="extension-widget-triggers" aria-label="Extension widgets">
          {group.map((w) => (
            <Trigger
              key={w.key}
              widget={w}
              expanded={w.key === expandedKey}
              updating={updating.has(w.key)}
              onClick={() => setExpandedKey((c) => (c === w.key ? null : w.key))}
              idPrefix={idPrefix}
            />
          ))}
        </div>
      </>
    );
  };

  return (
    <>
      {above.length > 0 && <div className="extension-widget-group extension-widget-above">{renderGroup(above)}</div>}
      {below.length > 0 && <div className="extension-widget-group extension-widget-below">{renderGroup(below)}</div>}
    </>
  );
}
```

（`Trigger` 子组件为 v1 的按钮/指示形态裁剪，省略以控制篇幅；样式沿用 v1 §4.5 并微调类名。）

### 5.4 修改 `ChatNode.tsx`

在 `ChatNodeProps` 增加 `widgets?: ExtensionWidgetItem[]`，解构默认 `[]`；在渲染树**单处**（消息列表与输入区之间）渲染：

```tsx
{/* 输入框上/下的 ExtensionWidgets（单实例，组件内部按 placement 分组） */}
{widgets.length > 0 && (
  <div className="shrink-0 my-2 max-h-\[40\%\] overflow-y-auto">
    <ExtensionWidgets widgets={widgets} />
  </div>
)}
```

> 不再按 placement 拆成两个组件实例（v1 缺陷），展开态、默认展开、aria 分组统一。

### 5.5 新增样式

沿用 v1 §4.5 的 `.extension-widget-*` 样式，新增 `.extension-widget-group` 间距、展开面板 `max-height` 与滚动，删除对 `var(--font-mono)` 之外的硬依赖即可。

---

## 6. 多租户与鲁棒性设计（v2.0 新增重点）

### 6.1 隔离性

- **进程/工作区隔离（现状保持）**：每用户每工作区独立子进程与 `runtime/{userId}/{workspaceId}`；widget 快照落在各自 `.pi-agent/` 下，天然隔离。
- **环境隔离（新增）**：子进程 env **不得**注入服务器 `~/.pi`、服务器全局 `PI_AGENT_HOME` 等（只注入 `{ws}/.pi-agent`）；白名单扩展显式 `-e` 加载，屏蔽 autoload 目录（C2）。
- **水合隔离**：`chat/session` 只读当前用户当前工作区（现已有 `sanitizeWorkspaceId` + `nodeWorkspace` 防穿越），widgets 快照同路由同权限。

### 6.2 资源上限（防滥用/防崩）

| 维度 | 上限 | 策略 |
|------|------|------|
| 单 widget 行数 | 40 | `applyCap` 截断 + 尾部省略 |
| 单行长度 | 200 字符 | 截断 |
| 单 widget 字节 | ~4KB | 截断 |
| 每轮 widget 总数 | 16 | 超出丢弃新 key（保留已有） |
| 同 key 更新节流 | ≥250ms 间隔 | 合并中间帧，只发最终值（配合 `WIDGET_UPDATE_IDLE_MS` 脉冲） |
| 工具结果体积 | 透传前先 `JSON.parse` 提取白名单字段 | 注册表只下发结构化安全字段，**绝不透传原始 tool 参数/结果全文**（§6.3） |
| 每用户并发子进程 | 配额（如 2~3），管理员可调 | 超出排队/拒绝并提示（接入现有 idle/队列语义） |

### 6.3 安全

- **扩展 = 服务端代码执行**：管理员白名单 + 版本锁定 + 升级回归；用户不直接安装任意扩展（区别于本地 pi-web，这是硬性差异）。
- **数据面**：widget 内容只来自注册表挑选出来的字段；`applyCap` 顺带剥除控制字符/换行注入；前端 `<pre>` React 转义，无注入面。
- **凭证**：扩展/工具结果可能含密钥，注册表字段过滤默认**拒绝**（deny-list 提示符），不配置字段不下发。

### 6.4 失败容忍与一致性

- **子进程崩溃/超时/用户中止**：`withWidgetBridge` 在 `finally` 语义下仍 `store.commit(live)` 当前最佳快照；中止轮不产出新 widget，前端水合回落到最近的 settled 快照。
- **半截状态**：生产者只产出完整快照（last-value-wins），不产出增量碎片；`extension_widget` 天然幂等（同 key 覆盖）。
- **SSE 断线**：前端重挂载后由 `chat/session` 水合 `widget_set_all` 对齐，不依赖 SSE 补发。
- **consistency**：`widgets.json` 写入用「临时文件 + rename」原子替换；读失败返回空快照（不阻塞会话）。

---

## 7. 使用示例

### 7.1 rpiv-todo（真实包，扩展形态）

- 前提：管理员在扩展白名单启用 `@juicesharp/rpiv-todo@2.7.1`，挂载到 `<ws>/.pi-agent/extensions/rpiv-todo/`，`-e` 加载。
- 后端：内置 `todoWidgetProducer` 已注册；其 TUI overlay（factory 形式）在服务端无 host，自然不渲染——但 `todo` **工具调用/结果**被桥接为面板行。
- 前端：零代码，自动出现 `rpiv-todos` 面板（aboveEditor）。

自动渲染效果（纯文本行）：
```
Todos (1/3)
✓ 完成任务1
◐ 进行中任务2
○ 待办任务3
```

### 7.2 新增扩展包（扩展性验证）

假设新增 `rpiv-weather`（含 `weather` 工具，+ 本地 widget）。只需一步：

```typescript
// 后端内置/注册
registerToolWidgetProducer('weather', (call, result) => {
  const d = parseWeatherResult(result);        // result → {city, temp, cond}
  if (!d) return null;
  return {
    key: 'rpiv-weather',
    lines: [`${d.city} ${d.temp}°C`, `状态: ${d.cond}`],
    placement: 'aboveEditor',
    data: { city: d.city, temp: d.temp },
  };
});
```

前端零改动。**约束提醒**：该包若把价值放在“纯 UI/交互”（按钮、对话框）且工具不可提取，则本机制覆盖不了——那是 §10 的“何时才值得上 RPC”触发条件。

---

## 8. 测试策略

### 8.1 单元测试

- `ToolWidgetBridge`：`todoWidgetProducer` 对合法/空/错误 result 的解析；未知工具不产生事件；同 key 覆盖去重；`applyCap` 截断与节流合并。
- `WidgetStore`：快照原子写入、读回、clear；损坏文件回退空快照。
- `piStreamReducer`：`widget_update`/`widget_clear`/`widget_set_all`/`end`（断言 **widgets 保留**）/`start`（跨轮保留）。
- `ExtensionWidgets`：渲染、折叠展开切换、更新脉冲 class 切换。

### 8.2 集成 / 多租户

1. 多用户隔离：A、B 用户同一服务器，各自生成 widget，断言互不串扰、互不可读。
2. 并发配额：超限子进程正确排队/拒绝。
3. 中止与崩溃：用户停止 / 强制 kill → 未产半截 widget，水合回落正常。
4. 刷新/换设备：SSE 中断后重挂载 → `chat/session` 恢复 widgets 快照。
5. E2E：Playwright + Mock pi 工具流，验证 rpiv-todos 面板出现、更新脉冲、折叠/展开。

---

## 9. 迁移与兼容

- 现有 `tool_call`/`tool_result` 事件与 `AgentActivity`、`RetryNoticeBanner`、`WorkspaceFilesPanel` **全部保持不变**；`extension_widget` 是**新增**事件类型，向后兼容。
- 老会话无水合 widget：`widget_set_all` 收到空数组 → 面板自然不显示，无闪断。
- 自定义/未来改造选项：`RetryNoticeBanner`、`WorkspaceFilesPanel` 可各自迁移为“生产者 + 内置面板 key”，按需推进（不强制）。

---

## 10. 未来扩展

### 10.1 结构化 widget 类型（替代 factory 语义）

```typescript
// PiStreamEvent 扩展
| { type: 'extension_widget'; key; lines; placement; data?: { kind: 'interactive'; ... } }
// 前端注册渲染器
const widgetRenderers = new Map<string, (data: unknown) => React.ReactNode>();
```

保留 `lines` 兜底（未知类型退化纯文本），交互能力由前端按 `data.kind` 渐进增强。

### 10.2 Widget 通信（有限）

如必须支持“点击完成任务”类交互：新增 `extension_widget_action` 事件 → 后端经 `-e` 扩展的 RPC 式工具通道回写（或映射为一次定向 `bash/todo` 工具调用）。**方案层面默认不做**，避免重蹈 RPC dialog 的阻塞困境。

### 10.3 何时才值得评估 RPC 协议

明确触发条件（满足才算值得）：
1. 装到**纯 UI 型**扩展（无工具、或工具结果冷漠、价值全在自定义 widget）；
2. 且该扩展**以字符串数组**调用 `setWidget`（factory 形式在 RPC 下同样被忽略——改造包不可避免）。

到那天再实现 `--mode rpc` 的 `extension_ui_request`（`method==='setWidget'`）适配器，作为 `withWidgetBridge` 的**同接口替身**，前端零改动。

---

## 11. 风险清单与开放问题

| 风险/问题 | 等级 | 对策 |
|-----------|------|------|
| 扩展在服务端执行任意代码 | 高 | 管理员白名单 + 版本锁定 + 升级回归（§4.3/§6.3） |
| 工具结果是 widget 的权威数据源，但各扩展工具 schema 各异 | 中 | 生产者注册表按包适配；schema 变化仅影响该生产者实现 |
| 扩展 autoload 目录解析与 `PI_CODING_AGENT_DIR` 关系待实现时核对 | 中 | 统一以显式 `-e` 加载（§4.3），autoload 不作为依赖 |
| widget 数据可能承载敏感信息 | 中 | 注册表字段白名单 + 拒绝未配置字段（§6.3） |
| pi 升级改动 JSON 事件面 | 低 | 仅依赖文档化顶层事件；协议隔离在 `pi-widgets.ts`（C4） |
| 服务器 `~/.pi` 全局扩展被误加载/污染 | 中 | 子进程 env 收敛 + 白名单 `-e`（§6.1） |

**开放问题**
- rpiv-todo 等包随版本演进的 `todo` 工具 schema 约定以外字段（如 `state`/`order`）需要实现时以实际 `tool-schema.md` 校准。
- 扩展包依赖 `node_modules` 的处理方式（随包复制 vs 服务器共享 node_modules）需在实现时按服务器系统/权限定，倾向随包自含以保持隔离。

---

## 附录 A：参考资源

- pi 安装包：`backend-ts/node_modules/@earendil-works/pi-coding-agent/docs/{json,rpc,extensions,tui}.md`
- pi JSON 事件契约：`docs/json.md`（`JsonAgentSessionEvent`）
- pi 扩展 UI 协议（仅 RPC，**本项目不走**）：`docs/rpc.md` §Extension UI Protocol
- rpiv-todo（真实扩展，todo 工具 + TUI overlay）：`@juicesharp/rpiv-todo`（其 `docs/tool-schema.md` 为生产者字段依据）
- 本项目现有装配/水合模式：`pi-agent-service.ts`、`pi-session-hydrate.ts`、`skill-agent-service.ts`