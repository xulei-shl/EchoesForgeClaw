# Subagent workflowScript 错误分析与解决方案

## 一、错误概述

在执行多子Agent并行任务时，首次尝试启动了 workflowScript，但验证失败：

```
Error: Run 'theme' failed: Unknown agent: generalist
Workflow '6984a203-249b-4ca9-80af-89e2f65a907b' validation failed before child launch; no children launched.
workflowScript does not support nested async functions. 
Use top-level await, plain helper functions that return runs.run(...), 
or explicit Promise chains so workflows stay portable across Node and Bun.
```

---

## 二、错误根因分析

### 2.1 根本原因

**问题代码（第一次尝试）**：
```javascript
async function run() {
  const results = await Promise.all([
    runs.run("theme", { agent: "generalist", task: "..." }),
    runs.run("books", { agent: "generalist", task: "..." }),
    runs.run("content", { agent: "generalist", task: "..." }),
    runs.run("promo", { agent: "generalist", task: "..." }),
    runs.run("timeline", { agent: "generalist", task: "..." })
  ]);
  return results;
}

return await run();
```

**错误点**：
1. **嵌套 async 函数** — 使用了 `async function run()` 作为辅助函数
2. **返回类型错误** — 应该返回对象 `{key: output}` 而非数组
3. **Agent名称不存在** — `"generalist"` 不是有效 agent

### 2.2 沙箱约束

`workflowScript` 运行在受限的 JavaScript 沙箱环境中，只支持：
- ✅ 顶层 `await`
- ✅ 普通辅助函数（返回 `runs.run(...)`）
- ✅ 显式 Promise 链
- ✅ `runs.run()`、`runs.all()`、`runs.status()` 等特定 API

**不支持**：
- ❌ 嵌套的 `async function` 辅助函数
- ❌ 异步箭头函数作为辅助函数
- ❌ 异步方法
- ❌ 非标准 agent 名称

---

## 三、正确写法

### 3.1 基础模式

**单个子任务**：
```javascript
return runs.run("key", { agent: "worker", task: "任务描述" })
```

**并行多个子任务**：
```javascript
const a = runs.run("theme", { agent: "researcher", task: "主题与框架设计" });
const b = runs.run("books", { agent: "researcher", task: "书目选择与推荐" });
const c = runs.run("content", { agent: "worker", task: "线上线下内容规划" });
const d = runs.run("promo", { agent: "worker", task: "宣传推广策略" });
const e = runs.run("timeline", { agent: "worker", task: "执行时间表与预算" });

const [aResult, bResult, cResult, dResult, eResult] = await Promise.all([a, b, c, d, e]);

return {
  theme: aResult.output,
  books: bResult.output,
  content: cResult.output,
  promo: dResult.output,
  timeline: eResult.output
};
```

### 3.2 顺序依赖模式

```javascript
const step1 = await runs.run("scan", { agent: "scout", task: "扫描目标" });
const step2 = await runs.run("review", { 
  agent: "reviewer", 
  task: "审查扫描结果: " + step1.output 
});
return step2.output;
```

### 3.3 带条件的分支模式

```javascript
const result = await runs.run("check", { agent: "scout", task: "检查状态" });

if (result.output.includes("need_fix")) {
  return runs.run("fix", { agent: "worker", task: "修复问题" });
} else {
  return { status: "ok", detail: result.output };
}
```

---

## 四、可用 Agent 列表

从系统日志中获取的有效 agent：

| Agent | 用途 |
|-------|------|
| `researcher` | 调研、搜索、收集信息 |
| `worker` | 执行、编写、实现 |
| `reviewer` | 审查、验证、审核 |
| `scout` | 侦察、探查、扫描 |
| `oracle` | 咨询、建议、分析 |
| `delegate` | 委托、协调 |
| `claude-code` | 代码编写（Claude Code） |
| `codex-exec` | 代码执行（OpenAI Codex） |
| `cursor-agent` | 代码编写（Cursor） |

**注意**：不存在 `generalist`、`assistant`、`agent` 等通用名称。

---

## 五、最佳实践清单

### 5.1 必须遵守

- ✅ 使用顶层 `await`，不要包装在 async 函数中
- ✅ 直接返回 `runs.run(...)` 或 Promise 结果
- ✅ 使用现有的 agent 名称（researcher/worker/reviewer 等）
- ✅ 每个子任务分配稳定的 key（如 `theme`、`books`）
- ✅ 返回结构化对象 `{key: output}` 便于聚合

### 5.2 禁止做法

- ❌ 不要使用 `async function helper() { ... }`
- ❌ 不要使用 `(async () => { ... })()`
- ❌ 不要假设 agent 存在而不验证
- ❌ 不要在子任务中再次启动 subagent（除非明确设计为 fanout agent）

---

## 六、成功案例

### 最终成功的 workflowScript

```javascript
const a = runs.run("theme", { agent: "researcher", task: "女性主义书目推广活动 - 主题与框架设计：设计活动主题、核心概念、目标受众和活动定位" });
const b = runs.run("books", { agent: "researcher", task: "女性主义书目推广活动 - 书目选择与推荐清单：调研并推荐适合的女性主义读物，覆盖经典与当代作品" });
const c = runs.run("content", { agent: "worker", task: "女性主义书目推广活动 - 线上线下内容规划：设计讲座、读书会、展览等具体活动内容" });
const d = runs.run("promo", { agent: "worker", task: "女性主义书目推广活动 - 宣传推广策略：制定社交媒体、线下海报、合作渠道等推广方案" });
const e = runs.run("timeline", { agent: "worker", task: "女性主义书目推广活动 - 执行时间表与预算：制定1个月内可执行的详细时间表和预算规划" });
const [aResult, bResult, cResult, dResult, eResult] = await Promise.all([a, b, c, d, e]);
return { theme: aResult.output, books: bResult.output, content: cResult.output, promo: dResult.output, timeline: eResult.output };
```

**结果**：5个子任务全部成功完成，生成完整方案文档。

---

## 七、调试技巧

### 7.1 检查 workflow 状态

```javascript
subagent({ action: "status", id: "<workflow-run-id>" })
```

### 7.2 查看子任务详情

```javascript
subagent({ action: "status", id: "<workflow-run-id>", view: "transcript", index: 0 })
```

### 7.3 列出所有可用 agent

```javascript
subagent({ action: "list" })
```

---

## 八、参考文档

- `@earendil-works/pi-coding-agent/docs/execution-controls.md`
- `@earendil-works/pi-coding-agent/docs/constraints-and-recipes.md`
- `.pi-agent/extensions/pi-subagents/skills/pi-subagents/SKILL.md`

---

*文档版本：v1.0*  
*生成时间：2026年9月3日*  
*应用场景：多子Agent并行任务编排*
