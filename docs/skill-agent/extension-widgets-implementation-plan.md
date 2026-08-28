# ExtensionWidgets 通用机制实现方案

> **文档版本**：v1.0  
> **创建日期**：2026-08-28  
> **目标读者**：接手升级项目的工程师  
> **关联文件**：
> - 后端：`backend-ts/src/services/pi-agent-service.ts`
> - 前端：`frontend/src/modules/bookplate/PiChatNodeHost.tsx`
> - 前端：`frontend/src/modules/bookplate/components/ChatNode.tsx`
> - 前端：`frontend/src/modules/bookplate/piStream.ts`

---

## 1. 背景与动机

### 1.1 现状问题

当前项目中，每个 pi package 的 UI 展示都需要手动集成：

| 功能 | 组件 | 状态管理 | 新增成本 |
|------|------|----------|----------|
| 工具执行步骤 | `AgentActivity` | `nodeSteps` | ~50 行 |
| 自动重试 | `RetryNoticeBanner` | `retryNotice` | ~30 行 |
| 工作区文件 | `WorkspaceFilesPanel` | `panelFiles` | ~80 行 |
| TodoList | 需新增 | 需新增 | ~100 行 |

**问题**：每新增一个 pi package（如 `rpiv-timer`, `rpiv-notepad`），需要：
1. 后端识别新的事件类型
2. 前端新增状态 + 组件
3. 修改 `PiChatNodeHost` 传递 props
4. 修改 `ChatNode` 渲染位置

### 1.2 目标

借鉴 pi-web 的 `ExtensionWidgets` 机制，实现**通用的 pi package UI 集成框架**：

- ✅ 新增 pi package **零前端代码**（自动渲染）
- ✅ 统一的折叠/展开、更新脉冲、位置管理
- ✅ 与 pi-web 生态兼容
- ✅ 不破坏现有功能

---

## 2. 架构设计

### 2.1 数据流

```
┌─────────────────────────────────────────────────────────────────┐
│                        pi CLI 子进程                              │
│  rpiv-todo 扩展调用 uiCtx.setWidget("rpiv-todos", factory)     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    后端 pi-agent-service.ts                       │
│  mapPiJsonEvent() 识别 "setWidget" 事件                          │
│  → 提取 key, lines, placement                                   │
│  → 发射 extension_widget / extension_widget_clear 事件           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      SSE 推流                                    │
│  data: {"type":"extension_widget","key":"rpiv-todos",           │
│         "lines":["✓ 任务1","◐ 任务2"],"placement":"aboveEditor"}│
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    前端 piStream.ts                               │
│  parseSseStream() 解析事件                                       │
│  → piStreamReducer 管理 widgets 状态                             │
│  → 按 placement 分组渲染                                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    ExtensionWidgets 组件                          │
│  通用渲染：折叠/展开、更新脉冲、位置管理                            │
│  → 自动适配所有注册 widget 的 pi package                         │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 核心数据结构

```typescript
// ExtensionWidgetItem - 通用 widget 数据结构（与 pi-web 对齐）
interface ExtensionWidgetItem {
  key: string;                    // widget 唯一标识（如 "rpiv-todos"）
  lines: string[];                // 渲染内容（ANSI 文本行）
  placement: 'aboveEditor' | 'belowEditor';  // 渲染位置
}

// PiStreamEvent - 新增事件类型
type PiStreamEvent =
  | { type: 'content_delta'; delta: string }
  | { type: 'reasoning_delta'; delta: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'tool_result'; id: string; name: string; result: string }
  | { type: 'status'; message: string }
  | { type: 'agent_retry'; attempt: number; maxAttempts: number; delaySec: number; reason: string }
  | { type: 'agent_file'; file: AgentFile }
  | { type: 'agent_image'; url: string }
  | { type: 'error'; message: string }
  // ✨ 新增
  | { type: 'extension_widget'; key: string; lines: string[]; placement: 'aboveEditor' | 'belowEditor' }
  | { type: 'extension_widget_clear'; key: string };

// PiStreamState - 新增 widgets 状态
interface PiStreamState {
  isStreaming: boolean;
  content: string;
  reasoning: string;
  error: string | null;
  // ✨ 新增
  widgets: ExtensionWidgetItem[];
}
```

---

## 3. 后端实现

### 3.1 修改 `pi-agent-service.ts`

**文件位置**：`backend-ts/src/services/pi-agent-service.ts`

**修改点**：在 `mapPiJsonEvent()` 函数中新增 `setWidget` 事件处理

```typescript
// 在 mapPiJsonEvent 函数的 switch 语句中新增

case 'setWidget': {
  // pi CLI 的 setWidget 事件格式：
  // { type: "setWidget", widgetKey: "rpiv-todos", widgetLines: ["line1", "line2"], widgetPlacement: "aboveEditor" }
  const key = String(evt.widgetKey ?? '');
  const lines = Array.isArray(evt.widgetLines) 
    ? evt.widgetLines.map(String) 
    : [];
  const placement = evt.widgetPlacement === 'belowEditor' 
    ? 'belowEditor' 
    : 'aboveEditor';
  
  if (key && lines.length > 0) {
    // 有内容：发射 widget 更新事件
    yield { 
      type: 'extension_widget', 
      key, 
      lines, 
      placement 
    };
  } else {
    // 无内容或清除：发射 widget 清除事件
    yield { 
      type: 'extension_widget_clear', 
      key 
    };
  }
  break;
}
```

### 3.2 修改 `stream.ts`（可选）

**文件位置**：`backend-ts/src/modules/bookplate/stream.ts`

如果需要支持 `extension_widget` 事件的 AI SDK UI Message Stream 映射（当前项目使用原始 SSE，可跳过）：

```typescript
// 在 chatStreamToResponse 的 switch 中新增（可选）

case 'extension_widget':
  writer.write({
    type: 'data-extension_widget',
    data: { key: evt.key, lines: evt.lines, placement: evt.placement },
    transient: true,
  });
  break;
case 'extension_widget_clear':
  writer.write({
    type: 'data-extension_widget_clear',
    data: { key: evt.key },
    transient: true,
  });
  break;
```

---

## 4. 前端实现

### 4.1 修改 `piStream.ts`

**文件位置**：`frontend/src/modules/bookplate/piStream.ts`

#### 4.1.1 新增事件类型

```typescript
// 在 PiStreamEvent 类型定义中新增

export type PiStreamEvent =
  | { type: 'content_delta'; delta: string }
  | { type: 'reasoning_delta'; delta: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'tool_result'; id: string; name: string; result: string }
  | { type: 'status'; message: string }
  | {
      type: 'agent_retry';
      attempt: number;
      maxAttempts: number;
      delaySec: number;
      reason: string;
    }
  | { type: 'agent_file'; file: AgentFile }
  | { type: 'agent_image'; url: string }
  | { type: 'error'; message: string }
  // ✨ 新增
  | { 
      type: 'extension_widget'; 
      key: string; 
      lines: string[]; 
      placement: 'aboveEditor' | 'belowEditor' 
    }
  | { type: 'extension_widget_clear'; key: string };
```

#### 4.1.2 新增 state 接口

```typescript
// ExtensionWidgetItem - 通用 widget 数据结构
export interface ExtensionWidgetItem {
  key: string;
  lines: string[];
  placement: 'aboveEditor' | 'belowEditor';
}

// 修改 PiStreamState
export interface PiStreamState {
  isStreaming: boolean;
  content: string;
  reasoning: string;
  error: string | null;
  // ✨ 新增
  widgets: ExtensionWidgetItem[];
}

// 修改 INITIAL_PI_STREAM
export const INITIAL_PI_STREAM: PiStreamState = {
  isStreaming: false,
  content: '',
  reasoning: '',
  error: null,
  widgets: [],  // ✨ 新增
};
```

#### 4.1.3 新增 action 类型

```typescript
// 修改 PiStreamAction
export type PiStreamAction =
  | { type: 'start' }
  | { type: 'content'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'error'; message: string }
  | { type: 'settle' }
  | { type: 'end' }
  // ✨ 新增
  | { type: 'widget_update'; key: string; lines: string[]; placement: 'aboveEditor' | 'belowEditor' }
  | { type: 'widget_clear'; key: string };
```

#### 4.1.4 修改 reducer

```typescript
export function piStreamReducer(state: PiStreamState, action: PiStreamAction): PiStreamState {
  switch (action.type) {
    case 'start':
      return { 
        isStreaming: true, 
        content: '', 
        reasoning: '', 
        error: null,
        widgets: state.widgets,  // ✨ 保留 widgets（跨轮持久）
      };
    case 'content':
      return { ...state, content: state.content + action.delta };
    case 'reasoning':
      return { ...state, reasoning: state.reasoning + action.delta };
    case 'error':
      return { ...state, isStreaming: false, error: action.message };
    case 'settle':
      return { ...state, isStreaming: false };
    case 'end':
      return INITIAL_PI_STREAM;
    // ✨ 新增
    case 'widget_update': {
      const idx = state.widgets.findIndex(w => w.key === action.key);
      const newWidget: ExtensionWidgetItem = {
        key: action.key,
        lines: action.lines,
        placement: action.placement,
      };
      if (idx >= 0) {
        // 更新现有 widget
        const newWidgets = [...state.widgets];
        newWidgets[idx] = newWidget;
        return { ...state, widgets: newWidgets };
      }
      // 新增 widget
      return { ...state, widgets: [...state.widgets, newWidget] };
    }
    case 'widget_clear':
      return { 
        ...state, 
        widgets: state.widgets.filter(w => w.key !== action.key) 
      };
    default:
      return state;
  }
}
```

### 4.2 修改 `PiChatNodeHost.tsx`

**文件位置**：`frontend/src/modules/bookplate/PiChatNodeHost.tsx`

#### 4.2.1 在 SSE 事件处理中新增 widget 事件分发

```typescript
// 在 parseSseStream 循环的 switch 语句中新增

case 'extension_widget':
  dispatchStream({ 
    type: 'widget_update', 
    key: evt.key, 
    lines: evt.lines, 
    placement: evt.placement 
  });
  break;
case 'extension_widget_clear':
  dispatchStream({ 
    type: 'widget_clear', 
    key: evt.key 
  });
  break;
```

#### 4.2.2 提取 widgets 状态并传递给 ChatNode

```typescript
// 在组件顶部新增 widgets 提取

const widgets = streamState.widgets;

// 在 ChatNode 组件调用中新增 prop

<ChatNode
  // ... 现有 props
  widgets={widgets}  // ✨ 新增
/>
```

### 4.3 新建 `ExtensionWidgets.tsx`

**文件位置**：`frontend/src/modules/bookplate/components/ExtensionWidgets.tsx`

```typescript
"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

// 默认展开的 widget 最大行数
const DEFAULT_EXPANDED_WIDGET_LINES = 3;
// 更新脉冲持续时间（ms）
const WIDGET_UPDATE_IDLE_MS = 1100;

// Widget 数据结构（与 pi-web 对齐）
export interface ExtensionWidgetItem {
  key: string;
  lines: string[];
  placement: "aboveEditor" | "belowEditor";
}

// 格式化 widget 内容（ANSI 文本行 → 单行字符串）
function formatExtensionWidgetContent(lines: string[]): string {
  return lines.join("\n");
}

// 快照 widget 内容（用于检测更新）
function snapshotExtensionWidgetContents(
  widgets: ExtensionWidgetItem[]
): Map<string, string[]> {
  return new Map(widgets.map((widget) => [widget.key, [...widget.lines]]));
}

// 检测哪些 widget 发生了更新
function getUpdatedExtensionWidgetKeys(
  previous: ReadonlyMap<string, readonly string[]> | null,
  next: ReadonlyMap<string, readonly string[]>
): string[] {
  if (!previous) return [];
  return Array.from(next, ([key, lines]) => {
    const previousLines = previous.get(key);
    if (!previousLines || previousLines.length !== lines.length) {
      return previousLines ? key : null;
    }
    return lines.some((line, index) => line !== previousLines[index]) ? key : null;
  }).filter((key): key is string => key !== null);
}

// 获取默认展开的 widget key
function getDefaultExpandedWidgetKey(widgets: ExtensionWidgetItem[]): string | null {
  return widgets.find((widget) => {
    const lineCount = widget.lines.length;
    return lineCount > 1 && lineCount <= DEFAULT_EXPANDED_WIDGET_LINES;
  })?.key ?? null;
}

// 获取下一个展开的 widget key（切换逻辑）
function getNextExpandedWidgetKey(
  currentKey: string | null,
  requestedKey: string
): string | null {
  return currentKey === requestedKey ? null : requestedKey;
}

// ExtensionWidgets 组件
export function ExtensionWidgets({ widgets }: { widgets: ExtensionWidgetItem[] }) {
  const idPrefix = useId();
  const previousContentsRef = useRef<Map<string, string[]> | null>(null);
  const updateClearTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [expandedWidgetKey, setExpandedWidgetKey] = useState<string | null>(
    () => getDefaultExpandedWidgetKey(widgets)
  );
  const [updatingWidgetKeys, setUpdatingWidgetKeys] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  // 检测更新并触发脉冲动画
  useEffect(() => {
    const nextContents = snapshotExtensionWidgetContents(widgets);
    const updatedKeys = getUpdatedExtensionWidgetKeys(
      previousContentsRef.current,
      nextContents
    );
    previousContentsRef.current = nextContents;

    // 清理已移除 widget 的定时器
    for (const [key, timer] of updateClearTimersRef.current) {
      if (nextContents.has(key)) continue;
      clearTimeout(timer);
      updateClearTimersRef.current.delete(key);
    }

    // 更新正在更新的 widget 集合
    setUpdatingWidgetKeys((current) => {
      const next = new Set(Array.from(current).filter((key) => nextContents.has(key)));
      for (const key of updatedKeys) next.add(key);
      if (
        next.size === current.size &&
        Array.from(next).every((key) => current.has(key))
      )
        return current;
      return next;
    });

    // 为更新的 widget 设置清除定时器
    for (const key of updatedKeys) {
      const currentTimer = updateClearTimersRef.current.get(key);
      if (currentTimer) clearTimeout(currentTimer);
      updateClearTimersRef.current.set(
        key,
        setTimeout(() => {
          updateClearTimersRef.current.delete(key);
          setUpdatingWidgetKeys((current) => {
            if (!current.has(key)) return current;
            const next = new Set(current);
            next.delete(key);
            return next;
          });
        }, WIDGET_UPDATE_IDLE_MS)
      );
    }
  }, [widgets]);

  // 清理所有定时器
  useEffect(
    () => () => {
      for (const timer of updateClearTimersRef.current.values()) clearTimeout(timer);
      updateClearTimersRef.current.clear();
    },
    []
  );

  if (widgets.length === 0) return null;

  const expandedWidget = widgets.find(
    (widget) => widget.key === expandedWidgetKey && widget.lines.length > 0
  );

  const toggleWidget = (widget: ExtensionWidgetItem) => {
    setExpandedWidgetKey((current) =>
      getNextExpandedWidgetKey(current, widget.key)
    );
  };

  return (
    <>
      {/* 展开的 widget 面板 */}
      {expandedWidget && (
        <div className="extension-widget-panels">
          {(() => {
            const widget = expandedWidget;
            const index = widgets.indexOf(widget);
            const triggerId = `${idPrefix}-trigger-${index}`;
            const panelId = `${idPrefix}-panel-${index}`;
            return (
              <section
                key={widget.key}
                id={panelId}
                className="extension-widget-panel"
                aria-labelledby={triggerId}
              >
                <div className="extension-widget-panel-heading">{widget.key}</div>
                <pre className="extension-widget-content">
                  {formatExtensionWidgetContent(widget.lines)}
                </pre>
              </section>
            );
          })()}
        </div>
      )}

      {/* Widget 触发器（折叠按钮） */}
      <div
        className="extension-widget-triggers"
        aria-label="Extension widgets"
      >
        {widgets.map((widget, index) => {
          const expandable = widget.lines.length > 0;
          const expanded = expandable && widget.key === expandedWidget?.key;
          const updating = updatingWidgetKeys.has(widget.key);
          const triggerId = `${idPrefix}-trigger-${index}`;
          const panelId = `${idPrefix}-panel-${index}`;
          const content = (
            <>
              <span className="extension-widget-update-pulse" aria-hidden="true" />
              <span className="extension-widget-placement" aria-hidden="true">
                <svg
                  className="extension-widget-placement-icon"
                  viewBox="0 0 8 6"
                  width="8"
                  height="6"
                  data-direction={widget.placement === "belowEditor" ? "down" : "up"}
                  focusable="false"
                >
                  <path
                    d={
                      widget.placement === "belowEditor"
                        ? "M0 0h8L4 6z"
                        : "M4 0l4 6H0z"
                    }
                  />
                </svg>
              </span>
              <span className="extension-widget-key">{widget.key}</span>
            </>
          );

          return expandable ? (
            <button
              key={widget.key}
              id={triggerId}
              type="button"
              className={`extension-widget-trigger${
                expanded ? " is-expanded" : ""
              }${updating ? " is-updating" : ""}`}
              aria-controls={panelId}
              aria-expanded={expanded}
              onClick={() => toggleWidget(widget)}
            >
              {content}
            </button>
          ) : (
            <div
              key={widget.key}
              className={`extension-widget-trigger${
                updating ? " is-updating" : ""
              }`}
            >
              {content}
            </div>
          );
        })}
      </div>
    </>
  );
}
```

### 4.4 修改 `ChatNode.tsx`

**文件位置**：`frontend/src/modules/bookplate/components/ChatNode.tsx`

#### 4.4.1 新增 props 类型

```typescript
// 在 ChatNodeProps 接口中新增

import type { ExtensionWidgetItem } from './ExtensionWidgets';

export interface ChatNodeProps {
  // ... 现有 props
  // ✨ 新增
  widgets?: ExtensionWidgetItem[];
}
```

#### 4.4.2 在组件解构中新增

```typescript
const ChatNodeInner: React.FC<ChatNodeProps> = ({
  // ... 现有 props
  widgets = [],  // ✨ 新增
}) => {
```

#### 4.4.3 在渲染中新增 ExtensionWidgets

```typescript
return (
  <CanvasNode ...>
    <div className="relative h-full flex flex-col flex-1 min-h-0">
      {/* 自动重试横幅 */}
      {retryNotice && isGenerating && <RetryNoticeBanner notice={retryNotice} />}
      
      {/* ✨ 新增：输入框上方的 ExtensionWidgets */}
      {widgets.filter(w => w.placement === 'aboveEditor').length > 0 && (
        <div className="shrink-0 mb-2">
          <ExtensionWidgets 
            widgets={widgets.filter(w => w.placement === 'aboveEditor')} 
          />
        </div>
      )}
      
      {/* 消息列表 */}
      <PhotoProvider ...>
        <div ref={listRef} ...>
          {/* ... 现有内容 */}
        </div>
      </PhotoProvider>
      
      {/* 工作区产物面板 */}
      {workspaceFiles && (...)}
      
      {/* 排队消息 */}
      {messageQueue && (...)}
      
      {/* 输入区 */}
      <div className="shrink-0 mt-2 pt-2 border-t ...">
        {/* ... 现有输入区内容 */}
      </div>
      
      {/* ✨ 新增：输入框下方的 ExtensionWidgets */}
      {widgets.filter(w => w.placement === 'belowEditor').length > 0 && (
        <div className="shrink-0 mt-2">
          <ExtensionWidgets 
            widgets={widgets.filter(w => w.placement === 'belowEditor')} 
          />
        </div>
      )}
    </div>
    
    {/* 设置弹层 */}
    {settingsOpen && (...)}
  </CanvasNode>
);
```

### 4.5 新增样式

**文件位置**：`frontend/src/modules/bookplate/components/ChatNode.tsx`（STYLE_INJECTIONS）

```typescript
const STYLE_INJECTIONS = `
/* ... 现有样式 */

/* ✨ 新增：ExtensionWidgets 样式 */
.extension-widget-panels {
  margin-bottom: 8px;
}

.extension-widget-panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  overflow: hidden;
}

.extension-widget-panel-heading {
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  border-bottom: 1px dashed var(--border);
  background: var(--bg-muted);
}

.extension-widget-content {
  padding: 8px 10px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
  margin: 0;
}

.extension-widget-triggers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 4px;
}

.extension-widget-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  cursor: pointer;
  font-size: 11px;
  color: var(--text-muted);
  transition: all 0.15s;
}

.extension-widget-trigger:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.extension-widget-trigger.is-expanded {
  border-color: var(--accent);
  background: var(--accent-muted);
  color: var(--accent);
}

.extension-widget-trigger.is-updating .extension-widget-update-pulse {
  opacity: 1;
}

.extension-widget-update-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0;
  animation: widget-pulse 0.6s ease-out;
}

@keyframes widget-pulse {
  0% { opacity: 1; transform: scale(1.5); }
  100% { opacity: 0; transform: scale(1); }
}

.extension-widget-placement-icon {
  flex-shrink: 0;
}

.extension-widget-key {
  font-family: var(--font-mono);
  font-weight: 500;
}
`;
```

---

## 5. 使用示例

### 5.1 rpiv-todo 扩展包

**无需任何前端代码**，rpiv-todo 扩展包会自动工作：

```typescript
// rpiv-todo 扩展包内部（无需修改）
uiCtx.setWidget("rpiv-todos", (tui, theme) => {
  return {
    render: (width: number) => {
      // 返回 ANSI 文本行
      return [
        `${theme.fg("accent", "Todos")} (${doneCount}/${totalCount})`,
        `${theme.fg("success", "✓")} 完成任务1`,
        `${theme.fg("warning", "◐")} 进行中任务2`,
      ];
    },
  };
}, { placement: "aboveEditor" });
```

**自动渲染效果**：
```
┌─────────────────────────────────┐
│ Todos (1/3)                     │
├─ ✓ 完成任务1                     │
├─ ◐ 进行中任务2                   │
└─ ○ 待办任务3                     │
```

### 5.2 新增其他 pi package

假设新增 `rpiv-timer` 扩展包：

```typescript
// rpiv-timer 扩展包内部（无需前端代码）
uiCtx.setWidget("rpiv-timer", (tui, theme) => {
  return {
    render: (width: number) => {
      return [
        `${theme.fg("accent", "⏱ Timer")} ${elapsedTime}`,
        `当前步骤: ${currentStep}`,
      ];
    },
  };
}, { placement: "belowEditor" });
```

**自动渲染效果**：
```
┌─────────────────────────────────┐
│ ⏱ Timer 02:35                   │
│ 当前步骤: 正在编译...             │
└─────────────────────────────────┘
```

---

## 6. 测试策略

### 6.1 单元测试

#### piStream.ts
```typescript
describe('piStreamReducer', () => {
  it('should handle widget_update', () => {
    const state = piStreamReducer(INITIAL_PI_STREAM, {
      type: 'widget_update',
      key: 'rpiv-todos',
      lines: ['✓ Task 1', '◐ Task 2'],
      placement: 'aboveEditor',
    });
    expect(state.widgets).toHaveLength(1);
    expect(state.widgets[0].key).toBe('rpiv-todos');
  });

  it('should handle widget_clear', () => {
    const state = piStreamReducer(
      { ...INITIAL_PI_STREAM, widgets: [{ key: 'rpiv-todos', lines: [], placement: 'aboveEditor' }] },
      { type: 'widget_clear', key: 'rpiv-todos' }
    );
    expect(state.widgets).toHaveLength(0);
  });
});
```

#### ExtensionWidgets.tsx
```typescript
describe('ExtensionWidgets', () => {
  it('should render widget triggers', () => {
    const widgets = [
      { key: 'rpiv-todos', lines: ['✓ Task 1'], placement: 'aboveEditor' as const },
    ];
    render(<ExtensionWidgets widgets={widgets} />);
    expect(screen.getByText('rpiv-todos')).toBeInTheDocument();
  });

  it('should toggle expand on click', async () => {
    const widgets = [
      { key: 'rpiv-todos', lines: ['✓ Task 1', '◐ Task 2'], placement: 'aboveEditor' as const },
    ];
    render(<ExtensionWidgets widgets={widgets} />);
    const trigger = screen.getByText('rpiv-todos');
    await userEvent.click(trigger);
    expect(screen.getByText('✓ Task 1')).toBeVisible();
  });
});
```

### 6.2 集成测试

1. **E2E 测试场景**：
   - 启动 pi CLI 子进程
   - 发送多步骤任务触发 rpiv-todo
   - 验证 TodoList 面板自动显示
   - 测试折叠/展开功能
   - 测试实时更新

2. **测试工具**：
   - Playwright 或 Cypress
   - Mock pi CLI 事件流

---

## 7. 迁移指南

### 7.1 现有组件迁移（可选）

如果需要将现有组件迁移到 ExtensionWidgets 机制：

| 组件 | 迁移难度 | 建议 |
|------|----------|------|
| `AgentActivity` | 高（复杂状态） | 保持现状 |
| `RetryNoticeBanner` | 低 | 可迁移为 extension_widget |
| `WorkspaceFilesPanel` | 中 | 可迁移为 extension_widget |

**迁移示例（RetryNoticeBanner）**：

```typescript
// 后端新增事件类型
case 'agent_retry': {
  // 保留现有逻辑
  yield { type: 'agent_retry', ... };
  
  // ✨ 新增：同时发射 widget 事件
  yield {
    type: 'extension_widget',
    key: 'retry-notice',
    lines: [`🔄 ${reason}，${delaySec}s 后自动重试`],
    placement: 'aboveEditor',
  };
  break;
}
```

### 7.2 向后兼容

- 现有 `tool_call`/`tool_result` 事件保持不变
- `AgentActivity` 组件继续用于显示工具执行步骤
- `extension_widget` 是**新增**事件类型，不影响现有功能

---

## 8. 未来扩展

### 8.1 Factory 模式支持

当前方案仅支持静态 `lines: string[]`。如果需要支持动态渲染（如交互式按钮），可以扩展：

```typescript
// 扩展 PiStreamEvent
| { 
    type: 'extension_widget_factory'; 
    key: string; 
    factoryId: string;  // 引用后端注册的工厂函数
    placement: 'aboveEditor' | 'belowEditor' 
  }

// 前端注册工厂
const widgetFactories = new Map<string, (data: unknown) => React.ReactNode>();
widgetFactories.set('rpiv-todo-interactive', (data) => <TodoInteractivePanel data={data} />);
```

### 8.2 Widget 通信

如果需要前端与 widget 交互（如点击完成任务）：

```typescript
// 新增事件类型
| { type: 'extension_widget_action'; key: string; action: string; payload: unknown }

// 后端处理
case 'extension_widget_action':
  // 转发给对应的 pi package 处理
  break;
```

### 8.3 跨会话持久化

当前 widget 状态随流结束清除。如果需要跨轮持久化：

```typescript
// 在 PiChatNodeHost 中新增
const [persistentWidgets, setPersistentWidgets] = useState<ExtensionWidgetItem[]>([]);

// 流结束后保留 widgets
useEffect(() => {
  if (!streamState.isStreaming && streamState.widgets.length > 0) {
    setPersistentWidgets(streamState.widgets);
  }
}, [streamState.isStreaming]);
```

---

## 9. 总结

### 9.1 改动清单

| 文件 | 改动类型 | 行数 |
|------|----------|------|
| `pi-agent-service.ts` | 修改 | ~20 行 |
| `piStream.ts` | 修改 | ~60 行 |
| `PiChatNodeHost.tsx` | 修改 | ~10 行 |
| `ChatNode.tsx` | 修改 | ~30 行 |
| `ExtensionWidgets.tsx` | **新建** | ~200 行 |
| 样式 | 新增 | ~100 行 |
| **总计** | | **~420 行** |

### 9.2 收益

- ✅ 新增 pi package **零前端代码**
- ✅ 统一的 UI 组件（折叠/展开、更新脉冲）
- ✅ 与 pi-web 生态兼容
- ✅ 不破坏现有功能
- ✅ 可扩展性强（支持 factory、通信、持久化）

### 9.3 风险

- ⚠️ 需要 pi CLI 支持 `setWidget` 事件（rpiv-todo 已支持）
- ⚠️ ANSI 文本渲染依赖终端模拟（可考虑后续升级为结构化数据）

---

## 附录 A：参考资源

- [pi-web ExtensionWidgets 源码](https://github.com/badlogic/pi-mono/tree/main/apps/web)
- [rpiv-todo 扩展包文档](https://www.npmjs.com/package/@juicesharp/rpiv-todo)
- [pi CLI JSON 模式文档](https://github.com/badlogic/pi-mono/blob/main/docs/json-mode.md)

---

## 附录 B：FAQ

**Q1：为什么不用 pi-web 的完整 RPC 机制？**

A：pi-web 使用 RPC（进程内通信），而您的项目使用 SSE（跨进程通信）。完整复刻 RPC 机制成本高且不必要，轻量级方案已满足需求。

**Q2：如果 pi CLI 不支持 `setWidget` 事件怎么办？**

A：可以在后端拦截 `tool_call`/`tool_result` 事件，解析 `todo` 工具的调用/结果，手动提取 widget 数据。这是降级方案。

**Q3：ExtensionWidgets 组件能否用于非 pi package 的场景？**

A：可以。任何符合 `ExtensionWidgetItem` 接口的数据都可以通过该组件渲染。

**Q4：如何调试 widget 渲染问题？**

A：在浏览器 DevTools 中搜索 `extension-widget` 类名，或在 `piStreamReducer` 中添加 `console.log` 输出 widget 状态。
