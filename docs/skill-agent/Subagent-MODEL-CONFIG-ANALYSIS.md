# pi-subagents 模型配置机制分析

> 基于源码分析，用于升级时参考。

## 模型解析优先级

从高到低：

1. **Per-run override** — 调用 `subagent()` 时传入的 `model` 参数
2. **Agent frontmatter** — `.md` 代理定义文件中的 `model` 字段
3. **Provider-scoped override** — `agentOverridesByProvider.<provider>.<name>.model`
4. **`agentOverrides.<name>.model`** — settings 中的按角色覆盖
5. **`subagents.defaultModel`** — 全局默认模型
6. **Parent session model** — 继承父会话模型（默认行为）

## 核心代码位置

### 模型解析

| 文件 | 行号 | 函数/逻辑 |
|------|------|-----------|
| `src/runs/shared/model-fallback.ts` | 37 | `INHERIT_MODEL = "inherit"` 哨兵值 |
| `src/runs/shared/model-fallback.ts` | 39-51 | `ParentModel` 接口 + `normalizeParentModel` |
| `src/runs/shared/model-fallback.ts` | 157-180 | `fuzzyResolveModel` 模糊匹配（容忍拼写变体、日期戳） |
| `src/runs/shared/model-fallback.ts` | 296-337 | `resolveSubagentModelOverride` 核心解析 |
| `src/runs/shared/model-fallback.ts` | 339-363 | `resolveEffectiveSubagentModel` 多层降级解析 |
| `src/runs/shared/model-fallback.ts` | 373-381 | `inheritsParentModel` 判断是否继承父模型 |
| `src/runs/shared/model-fallback.ts` | 383-421 | `buildModelCandidates` 构建 fallback 候选列表 |
| `src/runs/shared/model-fallback.ts` | 423-498 | `isRetryableModelFailure` 可重试失败检测 |

### Settings 解析与 Agent 配置

| 文件 | 行号 | 逻辑 |
|------|------|------|
| `src/agents/agents.ts` | 124-177 | `AgentConfig` 接口（含 `model`, `modelProvider`, `fallbackModels`） |
| `src/agents/agents.ts` | 181-192 | `SubagentSettings` 接口 |
| `src/agents/agents.ts` | 1095-1101 | 解析 `defaultModel` |
| `src/agents/agents.ts` | 1139-1175 | 解析 `agentOverrides` / `agentOverridesByProvider` |
| `src/agents/agents.ts` | 1178-1187 | `selectProviderOverrides` provider 级覆盖合并 |
| `src/agents/agents.ts` | 1198-1211 | `resolveSubagentDefaultModel` project > user 优先级 |
| `src/agents/agents.ts` | 1213-1226 | `applySubagentDefaultModel` 应用默认模型到无模型的 agent |
| `src/agents/agents.ts` | 1306-1348 | `applyBuiltinOverride` 应用 per-agent 覆盖 |

### 执行时模型选择

| 文件 | 行号 | 逻辑 |
|------|------|------|
| `src/runs/foreground/subagent-executor.ts` | 3573-3581 | 前台执行时调用 `resolveEffectiveSubagentModel` |
| `src/runs/foreground/execution.ts` | 1805-1846 | `buildModelCandidates` + fallback 重试循环 |
| `src/runs/background/async-execution.ts` | — | 后台执行的模型解析 |

### Fallback 与排除

| 文件 | 行号 | 逻辑 |
|------|------|------|
| `src/runs/shared/model-exclusions.ts` | 144-161 | `recordModelFailure` 持久化失败模型（默认 TTL 24h） |
| `src/runs/shared/model-scope.ts` | 76-98 | `checkModelScope` 白名单/glob 强制执行 |

### 其他

| 文件 | 逻辑 |
|------|------|
| `src/extension/config.ts:23-36` | `forkContext.model` 验证 |
| `src/profiles/profiles.ts:125-157` | Profile 加载与验证 |
| `src/watchdog/model-selection.ts` | Watchdog 推荐互补模型 |
| `src/extension/schemas.ts` | Tool 参数 schema（`model` 字段） |

## 配置结构

### settings.json

```json
{
  "subagents": {
    "defaultModel": "deepseek-v4-flash",
    "defaultProvider": "gpu-a",
    "defaultThinking": "medium",
    "maxThinking": "xhigh",
    "agentOverrides": {
      "oracle": { "model": "deepseek-v4-pro", "thinking": "high" },
      "worker": { "defaultProvider": "gpu-b" },
      "reviewer": { "model": false }
    },
    "agentOverridesByProvider": {
      "github-copilot": {
        "worker": { "model": "github-copilot/gpt-5-mini" }
      }
    },
    "modelScope": {
      "enforce": true,
      "strict": true,
      "allow": ["inherit", "openai/gpt-5-*"],
      "agents": {
        "worker": { "allow": ["openai-codex/gpt-5.6-luna"] }
      }
    }
  }
}
```

### Agent frontmatter（.md 定义文件）

```yaml
---
name: reviewer
model: anthropic/claude-sonnet-4
thinking: high
fallbackModels: openai-codex/gpt-5.6-luna:low
---
```

### Extension config（`~/.pi/agent/extensions/subagent/config.json`）

```json
{
  "modelExclusions": { "defaultTtlMs": 300000 },
  "forkContext": { "mode": "pruned", "model": "openai-codex/gpt-5.6-luna:max" }
}
```

## 关键行为

- **`"inherit"` 哨兵值**：设为 `"inherit"` 时强制继承父会话模型，即使 agent 有自己的 model 配置
- **`model: false`**：在 `agentOverrides` 中设为 `false` 可删除 agent 的 model 配置，使其回退到继承
- **Fuzzy matching**：模型名支持模糊匹配（分隔符归一化、大小写不敏感、日期戳剥离），但不会跨 provider 匹配
- **Fallback 重试**：失败时按 `fallbackModels` 数组顺序尝试，匹配 `RETRYABLE_MODEL_FAILURE_PATTERNS`（429、quota、auth、5xx 等）
- **Model exclusions**：失败模型被持久化缓存（默认 TTL 24h，最多 200 条），后续调用自动跳过
- **Model scope**：可配置白名单 glob 模式，`strict: true` 时直接报错，否则 warn
- **Project > User**：项目级 `defaultModel` 优先于用户级
