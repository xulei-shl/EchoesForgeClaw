# 后端 TypeScript + AI SDK 重构设计文档

**文档版本：v1.0**
**日期：2026-08-16**
**状态：待评审**

------

# 一、重构目标

## 1.1 核心目标

本次重构主要完成以下工作：

| 序号 | 目标                                                         | 优先级 |
| ---- | ------------------------------------------------------------ | ------ |
| 1    | 后端代码全部迁移至 TypeScript                                | P0     |
| 2    | 核心 AI 能力统一迁移至 Vercel AI SDK                         | P0     |
| 3    | Chat、Streaming、Tool Calling、Structured Output、Embedding、Image 等现有 AI 能力统一使用 AI SDK | P0     |
| 4    | Skill Agent 模块延后至第二阶段独立重构                       | P1     |
| 5    | 清理冗余代码、合并重复逻辑                                   | P0     |
| 6    | 保持现有业务功能和对外 API 语义不变                          | P0     |
| 7    | 降低 AI Provider 与业务代码之间的耦合                        | P0     |
| 8    | 建立统一的 AI 能力抽象和模型配置机制                         | P0     |

## 1.2 核心原则

本次重构遵循：

> **业务代码面向 AI 能力编程，而不是面向具体 Provider 或具体 SDK 编程。**

整体关系：

**业务层 → AI 能力层 → AI SDK → Provider / Model**

AI SDK 是本项目统一的 AI 基础设施。

------

# 二、重构范围

## 2.1 AI 能力范围

本次重构以**现有项目实际使用的 AI 能力**为边界。

现有代码中已经使用的 AI 能力，统一迁移至 AI SDK。

主要包括：

| AI 能力                    | 重构要求                              |
| -------------------------- | ------------------------------------- |
| Text Generation            | 迁移至 AI SDK                         |
| Streaming                  | 迁移至 AI SDK                         |
| Tool Calling               | 迁移至 AI SDK                         |
| Multi-step Tool Execution  | 迁移至 AI SDK                         |
| Tool Approval              | 如现有业务涉及则采用 AI SDK           |
| Structured Output          | 迁移至 AI SDK                         |
| Embedding                  | 迁移至 AI SDK                         |
| Image Generation           | 迁移至 AI SDK                         |
| Speech / TTS               | 如果现有项目实际使用，则迁移至 AI SDK |
| Transcription / STT        | 如果现有项目实际使用，则迁移至 AI SDK |
| 其他当前实际使用的 AI 能力 | 迁移至 AI SDK                         |

### 范围边界

**项目当前未使用的 OpenAI API 能力不纳入本次重构。**

例如项目没有使用：

- Fine-tuning
- Moderation
- Speech
- Transcription
- 其他未使用的 OpenAI API

则不需要为了“完整覆盖 OpenAI API”而增加迁移工作。

因此，本次重构的判断标准是：

> **迁移项目实际存在的 AI 调用，而不是迁移 OpenAI API 的全部能力。**

------

# 三、AI SDK 技术选型

## 3.1 选型原则

采用：

- `ai`
- 对应的 AI SDK Provider

作为统一 AI 调用基础设施。

AI SDK 负责提供：

- Language Model 抽象
- Text Generation
- Streaming
- Tool Calling
- Multi-step Tool Execution
- Structured Output
- Embedding
- Image Generation
- Speech / Transcription 等当前实际需要的能力

Provider 层负责连接：

- OpenAI
- Anthropic
- DeepSeek
- Google
- 其他 AI SDK 支持或兼容的 Provider

具体 Provider 由模型配置决定。

------

# 四、AI SDK 架构原则

## 4.1 AI SDK 不直接暴露给业务模块

业务模块不得直接依赖：

- `ai`
- `@ai-sdk/*`
- Provider SDK 类型

AI SDK 必须封装在基础设施层。

推荐结构：

```text
业务层
  ↓
AI 能力服务
  ↓
AI SDK Adapter
  ↓
AI SDK
  ↓
Provider
  ↓
Model
```

## 4.2 AI 能力抽象

基础设施层按照业务能力划分，而不是按照 SDK 划分。

主要能力包括：

- Language Model
- Structured Output
- Tool
- Embedding
- Image Generation
- Speech
- Transcription
- 其他项目实际使用的 AI 能力

不应以：

- OpenAIService
- AISDKService
- DeepSeekService

作为业务层核心抽象。

------

# 五、Provider 与模型管理

## 5.1 Provider 解耦

业务代码不得直接判断：

- 当前使用 OpenAI
- 当前使用 DeepSeek
- 当前使用 Anthropic
- 当前使用其他 Provider

Provider 的选择必须在 AI 基础设施层完成。

业务只指定：

- 模型。
- 能力。
- 生成参数。
- Tool。
- Structured Output Schema。

------

## 5.2 模型配置

模型配置统一管理：

- Provider。
- Model ID。
- API Key。
- Base URL。
- 请求参数。
- Timeout。
- Retry。
- Provider-specific 配置。

模型配置与业务逻辑分离。

------

# 六、Chat 迁移规则

## 6.1 Chat Generation

现有 Chat Completion 调用统一迁移至 AI SDK 的文本生成能力。

必须保持：

- System Prompt 语义不变。
- User Message 语义不变。
- Assistant Message 语义不变。
- Tool Message 语义不变。
- Model 选择保持一致。
- 关键生成参数保持一致。
- Token Usage 能够继续统计。
- 错误能够进入统一错误处理体系。

------

## 6.2 Prompt

本次重构不修改 Prompt 语义。

除非因为 AI SDK 的消息结构要求进行必要的数据格式转换，否则：

> **不得借重构之机修改 Prompt。**

这样可以降低模型输出变化对测试结果的干扰。

------

# 七、Streaming 迁移规则

## 7.1 基本原则

Streaming 统一使用 AI SDK 原生 Stream。

整体架构：

```text
AI SDK
   ↓
streamText / 对应 Stream 能力
   ↓
AI SDK Stream
   ↓
API Response
   ↓
Frontend
```

不再设计：

```text
AI SDK Stream
   ↓
OpenAI-compatible SSE Adapter
   ↓
OpenAI SSE
```

也不再维护一套自定义的 OpenAI SSE 转换协议。

------

## 7.2 AI SDK Stream 作为内部标准

AI SDK Stream 是后端 AI 流式调用的标准形式。

Stream 中可能包含：

- Text
- Tool Call
- Tool Input
- Tool Result
- Reasoning
- Sources
- Usage
- Finish
- Error
- 其他 AI SDK Stream Parts

具体采用哪些 Part，以实际业务需求为准。

------

# 八、前端流式输出解析

## 8.1 不在后端重构文档中预设前端解析方案

前端流式输出解析不能仅根据后端代码判断。

必须结合现有前端代码进行评估，包括：

- 当前使用的 Chat 请求方式。
- 当前 SSE / Fetch Stream 实现。
- 当前流式数据解析方式。
- 当前消息状态结构。
- Tool Call 的前端处理方式。
- Markdown 渲染方式。
- Reasoning 展示方式。
- 错误处理方式。
- 是否已经使用 AI SDK UI。
- 是否存在 OpenAI-compatible API 依赖。

因此本次重构文档只规定：

> **后端统一输出 AI SDK Stream；前端最终采用何种消费方式，需要在检查现有前端代码后确定。**

------

## 8.2 前端评估任务

在后端 Streaming 重构完成之前，应增加一次前端兼容性评估。

评估内容：

| 项目          | 评估内容                     |
| ------------- | ---------------------------- |
| 请求协议      | 当前前端如何调用 Chat API    |
| Stream 类型   | SSE、Fetch Stream 或其他方式 |
| 数据格式      | 当前解析的数据结构           |
| Message Model | 当前消息对象结构             |
| Tool          | Tool Call 如何展示和执行     |
| Reasoning     | 是否支持思考过程             |
| Sources       | 是否存在引用/来源            |
| Markdown      | 当前如何处理增量 Markdown    |
| Error         | Stream 错误如何处理          |
| Abort         | 用户停止生成如何处理         |
| Retry         | 前端如何重试                 |
| State         | 流式状态如何维护             |

------

## 8.3 前端迁移方向

如果现有前端结构允许，优先采用 AI SDK 官方推荐的 Stream / UI Message 机制。

如果现有前端已有成熟的 Stream 解析机制，则应评估：

> 是否只需要调整后端返回格式，而不必全面重构前端。

最终方案以实际代码评估结果为准。

**在前端代码检查完成之前，不预先确定具体的 Stream Consumer 实现。**

------

# 九、Tool Calling 迁移规则

## 9.1 Tool 统一使用 AI SDK

所有现有 Tool Calling 统一迁移至 AI SDK。

Tool 必须包含：

- 名称。
- 描述。
- 输入 Schema。
- 输入验证。
- 执行逻辑。
- 输出结果。
- 错误处理。
- 权限控制。

Tool Schema 统一采用项目指定的 Schema 体系。

------

## 9.2 Tool 与业务逻辑分离

Tool 本身不承担业务 Service 的全部逻辑。

推荐：

```text
AI SDK Tool
    ↓
Tool Handler
    ↓
Business Service
    ↓
Repository / External Service
```

Tool 负责 AI 与业务之间的适配。

业务逻辑仍然位于业务 Service。

------

# 十、Multi-step Tool Execution

AI SDK 的 Tool Calling 不仅包括：

> Model → Tool

还包括：

> Model → Tool → Model → Tool → Model

因此必须明确支持 Multi-step Tool Execution。

## 10.1 执行规则

必须：

- 明确最大执行步数。
- 明确停止条件。
- 记录每个 Step。
- 记录 Tool 调用。
- 记录 Tool Result。
- 处理 Tool Error。
- 防止无限循环。

------

## 10.2 `onStepFinish` 的定位

`onStepFinish` 仅用于：

- Step 生命周期观察。
- 日志。
- Usage 记录。
- 调试。
- 监控。

不得将其定义为：

> Tool Loop 的执行机制。

Multi-step Tool 的继续执行应使用 AI SDK 官方提供的 Step / Stop 机制。

------

# 十一、Tool Approval

如果现有业务存在需要用户确认的 Tool：

例如：

- 修改数据。
- 删除数据。
- 发送消息。
- 执行外部操作。
- 访问敏感资源。

应使用 AI SDK 支持的 Tool Approval 机制。

必须能够表达：

```text
Tool Request
    ↓
Waiting Approval
    ↓
Approved / Rejected
    ↓
Execute / Cancel
```

前端需要能够根据 Tool 状态进行相应展示。

------

# 十二、Tool Streaming

不得将 Tool Calling 简化成：

> 模型一次性返回完整 Tool 参数。

AI SDK Stream 需要能够处理 Tool 输入、Tool 调用和 Tool 结果等不同阶段。

因此：

- 后端不得自行假定 Tool 参数一定一次性到达。
- 不得自行设计与 AI SDK 不一致的 Tool Stream 协议。
- Tool Stream 的内部处理应以当前锁定版本的 AI SDK Stream Part 定义为准。
- 如果前端需要实时显示 Tool 输入过程，应在前端评估阶段单独验证。

------

# 十三、Structured Output

Structured Output 统一使用 AI SDK。

## 13.1 基本规则

结构化输出必须：

- 使用明确 Schema。
- 进行运行时验证。
- 转换为明确 TypeScript 类型。
- 验证失败进入统一错误处理。

## 13.2 与 JSON Mode 的区别

不得简单将：

> Structured Output = JSON Mode

Structured Output 的目标是：

> **得到符合指定 Schema 的结构化业务数据。**

因此优先采用 Schema-based Structured Output，而不是简单依赖字符串 JSON。

------

# 十四、Embedding

Embedding 统一迁移至 AI SDK。

支持：

- 单条 Embedding。
- 批量 Embedding。

迁移前必须确认：

- 当前 Embedding Model。
- 向量维度。
- Batch Size。
- Vector Database 字段。
- Distance Metric。
- 数据类型。
- 返回结构。

------

## 14.1 向量兼容性

本次重构不得无意改变：

- Embedding Model。
- Vector Dimension。
- Vector Database Schema。

如果因为模型升级导致向量维度变化，应作为独立的模型迁移处理，而不是作为 TypeScript / SDK 重构的一部分。

------

# 十五、Image Generation

Image Generation 统一迁移至 AI SDK。

迁移时需要验证：

- Model。
- Prompt。
- Image Size。
- Image Count。
- 输出格式。
- MIME Type。
- URL。
- Binary。
- Base64。
- Provider-specific 参数。

不能简单认为：

> AI SDK Image API 与 OpenAI Images API 参数完全一一对应。

应以实际使用的 Provider / Model 为准进行验证。

------

# 十六、其他 AI 能力

如果现有代码实际使用：

- Speech / TTS
- Transcription / STT
- Moderation
- 其他 AI 能力

则统一评估并迁移至 AI SDK。

原则：

> **项目实际使用的 AI 能力统一由 AI SDK 承担。**

如果某项 OpenAI API 在当前项目中完全没有调用，则不纳入本次重构。

------

# 十七、错误处理

AI SDK 的异常必须转换为项目自己的错误体系。

不得让：

- AI SDK Error
- Provider Error
- HTTP Error

直接泄漏到业务层。

错误至少区分：

- 参数错误。
- Authentication。
- Rate Limit。
- Timeout。
- Network Error。
- Provider Error。
- Model Error。
- Tool Error。
- Stream Error。
- Structured Output Validation Error。

------

# 十八、Retry

Retry 统一在 AI Infrastructure 层管理。

必须区分：

### 可以重试

- 临时网络错误。
- Provider 临时错误。
- Rate Limit。
- 可恢复超时。

### 不应重试

- 参数错误。
- Schema 错误。
- Authentication 错误。
- Tool 业务错误。
- 权限错误。

不得对所有异常进行无条件 Retry。

------

# 十九、Timeout

至少区分：

- Model Request Timeout。
- Stream Timeout。
- Tool Execution Timeout。

不同 AI 能力可以拥有不同 Timeout。

不得使用一个固定的全局 Timeout 覆盖全部场景。

------

# 二十、Usage 与日志

AI SDK 返回的 Usage 信息必须纳入现有日志体系。

至少记录：

- Model。
- Provider。
- Input Tokens。
- Output Tokens。
- Total Tokens。
- Request Duration。
- First Token Duration。
- Tool Calls。
- Step Count。
- Error。
- Request ID / Trace ID，如 Provider 提供。

不得因为 SDK 更换而丢失现有成本统计和调用统计。

------

# 二十一、模型调用追踪

每次 AI 调用建议能够关联：

- Request ID。
- Session ID。
- User ID，如现有系统需要。
- Model。
- Provider。
- Prompt Version。
- Tool。
- Step。
- Token Usage。
- Duration。
- Error。

保持与现有日志和监控体系兼容。

------

# 二十二、TypeScript 规范

启用严格 TypeScript。

要求：

- `strict: true`
- 禁止业务层 `any`。
- AI SDK 返回类型不得直接丢弃。
- Tool Input 必须具有明确类型。
- Structured Output 必须具有 Schema。
- API DTO 与 AI SDK 内部类型分离。
- Stream 类型必须明确。
- Error 类型必须统一。

------

# 二十三、目录结构

建议：

```text
src/
├── api/
├── application/
├── domain/
├── infrastructure/
│   └── ai/
│       ├── models/
│       ├── providers/
│       ├── language-model/
│       ├── structured-output/
│       ├── embedding/
│       ├── image/
│       ├── tools/
│       ├── streaming/
│       └── index.ts
├── services/
├── repositories/
├── config/
└── shared/
```

其中：

```
infrastructure/ai/
```

是 AI SDK 的唯一主要入口。

------

# 二十四、AI SDK 依赖边界

允许：

```text
infrastructure/ai/*
        ↓
      AI SDK
```

不允许：

```text
Controller
Service
Repository
Domain
        ↓
      AI SDK
```

业务层必须通过项目自己的 AI Capability Interface 调用。

------

# 二十五、依赖管理

AI SDK 与 Provider 包版本必须锁定。

要求：

1. `ai` 与相关 Provider 包保持兼容版本。
2. 使用当前项目锁定版本的官方 API。
3. 不允许混用不同 AI SDK 大版本的代码示例。
4. SDK 升级必须单独建立 PR。
5. SDK 升级必须重新运行 Chat、Stream、Tool、Embedding、Image 测试。
6. SDK 升级不得与业务重构同时进行。

------

# 二十六、前后端 Stream 兼容性评估

这是本次重构的一个**待确认项**。

在后端开始全面替换 Streaming 之前，应检查前端实际代码。

需要回答：

1. 前端当前是否直接调用 OpenAI-compatible Chat API？
2. 是否使用 SSE？
3. 是否使用 Fetch ReadableStream？
4. 当前 Stream Chunk 的数据格式是什么？
5. 当前 Tool Call 如何解析？
6. 当前 Tool Result 如何展示？
7. 是否支持 Reasoning？
8. 是否支持 Sources？
9. 是否已经采用 AI SDK UI？
10. 是否需要保持现有接口 URL 不变？

根据检查结果决定：

### 方案 A：直接迁移

如果前端可以同步修改：

**AI SDK Stream → AI SDK 前端消费机制**

优先采用。

### 方案 B：最小前端适配

如果前端已有成熟的 Stream 解析：

保持前端主体结构，仅调整 Stream Consumer。

### 方案 C：兼容旧协议

只有在明确存在外部客户端依赖 OpenAI-compatible SSE、且无法同步修改时，才单独设计兼容层。

**当前文档默认采用方案 A，但最终方案必须以实际前端代码评估结果为准。**

------

# 二十七、测试策略

## 27.1 单元测试

重点测试：

- AI Capability Adapter。
- Tool。
- Schema。
- Error Mapping。
- Model Configuration。
- Stream Processing。

覆盖率目标：

> ≥ 80%

AI Infrastructure 核心模块：

> ≥ 90%

------

# 二十八、AI 能力集成测试

必须覆盖：

## Chat

- 普通 Chat。
- 长文本。
- 多轮对话。
- 中文。
- Markdown。
- Token Usage。

## Streaming

- 普通文本。
- 长文本。
- Stream 中断。
- Error。
- Abort。
- Usage。

## Tool

- 单 Tool。
- 多 Tool。
- Multi-step。
- Tool Error。
- Tool Approval。
- Tool Result。
- Tool Input Streaming。

## Structured Output

- 正常 Schema。
- Schema Validation Error。
- 复杂嵌套 Schema。

## Embedding

- 单条。
- Batch。
- 向量维度。
- 数据库写入。

## Image

- 单图。
- 多图。
- 不同 Size。
- 不同输出格式。
- Error。

------

# 二十九、前端 Stream 测试

前端代码评估完成后建立对应测试。

至少验证：

- 首 Token。
- 连续文本。
- Markdown。
- Tool 状态。
- Tool Result。
- Error。
- Abort。
- 多轮 Tool。
- Stream 完成。
- 页面刷新。
- 网络中断。

具体测试方案根据前端现有实现确定。

------

# 三十、性能指标

重构后与旧版本进行基准比较：

| 指标               | 目标         |
| ------------------ | ------------ |
| Chat 首 Token 延迟 | ±5%          |
| 完整 Chat 延迟     | ±5%          |
| Streaming 稳定性   | 不低于旧版本 |
| Embedding 延迟     | ±5%          |
| Image 延迟         | ±5%          |
| CPU                | ±10%         |
| Memory             | ±10%         |

同时关注：

- AI SDK 本身增加的调用开销。
- Stream 处理开销。
- Tool Loop 开销。
- Schema Validation 开销。

------

# 三十一、旧代码清理

完成迁移后必须删除：

- 旧 OpenAI Chat 调用。
- 旧 OpenAI Stream 实现。
- 重复的 Tool Calling 逻辑。
- 手动 JSON Schema 解析。
- 重复的 Embedding 封装。
- 重复的 Image Generation 封装。
- 无用 SDK 依赖。
- 无用 JavaScript 文件。

最终项目不得同时存在：

> 新 AI SDK 实现 + 旧 OpenAI 实现

两套并行代码。

除非明确属于灰度回滚机制。

------

# 三十二、灰度策略

建议采用：

```text
旧版本
  ↓
AI SDK Shadow Test
  ↓
小流量
  ↓
扩大流量
  ↓
全部切换
  ↓
删除旧代码
```

灰度阶段重点观察：

- Error Rate。
- Latency。
- Token Usage。
- Tool Success Rate。
- Stream Disconnect。
- Structured Output Validation。
- Provider Error。

------

# 三十三、回滚策略

如果出现：

- Chat 大面积失败。
- Stream 无法解析。
- Tool Loop 异常。
- Token 成本明显增加。
- Provider 参数错误。
- 前端无法消费 Stream。

则立即回滚到上一版本。

但旧实现只作为**短期回滚版本**保留，不作为长期双轨架构。

------

# 三十四、代码质量

使用：

- TypeScript Compiler。
- ESLint。
- Prettier。
- Vitest / Jest。
- Playwright。
- jscpd。
- depcheck。

要求：

- `tsc --noEmit` 通过。
- ESLint 无 Error。
- 单元测试通过。
- 核心 AI Adapter 测试通过。
- Stream 测试通过。
- Tool 测试通过。
- 前端集成测试通过。
- 重复率下降。
- 无无效依赖。

------

# 三十五、重构阶段

## Phase 0：代码审计

**目标：明确现有 AI 调用和前端 Stream 协议。**

任务：

- 搜索所有 OpenAI SDK 调用。
- 搜索所有 Chat 调用。
- 搜索所有 Stream 调用。
- 搜索所有 Tool。
- 搜索 Embedding。
- 搜索 Image。
- 搜索其他 AI API。
- 检查前端 Stream 解析代码。
- 确定实际使用的 AI 能力。

产出：

> AI 能力调用清单 + 前端 Stream 协议分析。

------

## Phase 1：TypeScript 基础设施

任务：

- TypeScript 配置。
- ESM。
- ESLint。
- 类型定义。
- Build。
- Test。
- CI。

------

## Phase 2：AI SDK 基础设施

任务：

- AI SDK Provider。
- Model Configuration。
- Language Model。
- Structured Output。
- Embedding。
- Image。
- Tool。
- Stream。

------

## Phase 3：Chat

迁移：

- Chat。
- Streaming。
- Session。
- Message。
- Usage。

------

## Phase 4：Tool / Agent

迁移：

- Tool Calling。
- Multi-step。
- Tool Result。
- Tool Approval。
- Agent。

Skill Agent 本身仍按照第二阶段计划处理。

------

## Phase 5：前端 Stream 联调

根据 Phase 0 对前端代码的评估结果：

- 确定 AI SDK Stream 消费方式。
- 修改必要的前端解析。
- 联调 Tool。
- 联调 Error。
- 联调 Abort。
- 联调 Markdown。
- 联调 Reasoning / Sources。

------

## Phase 6：清理

删除：

- 旧 OpenAI SDK 调用。
- 旧 Stream。
- 重复 Adapter。
- 重复工具。
- 无效依赖。
- JS 文件。

------

# 三十六、验收标准

## TypeScript

-  后端全部 TypeScript。
-  strict 模式通过。
-  无业务层 `any`。
-  Build 通过。

## AI SDK

-  Chat 已迁移。
-  Streaming 已迁移。
-  Tool Calling 已迁移。
-  Multi-step 已迁移。
-  Tool Approval 已完成必要验证。
-  Structured Output 已迁移。
-  Embedding 已迁移。
-  Image Generation 已迁移。
-  其他当前实际使用的 AI 能力已迁移。
-  项目不再依赖 OpenAI 原生 SDK。

## Streaming

-  后端使用 AI SDK Stream。
-  不再维护 OpenAI-compatible SSE Adapter。
-  前端代码已完成 Stream 兼容性评估。
-  前后端 Stream 联调通过。
-  Tool Stream 正常。
-  Error 正常。
-  Abort 正常。
-  Usage 正常。

## 架构

-  业务层不直接依赖 AI SDK。
-  AI SDK 集中于 Infrastructure。
-  Provider 与业务逻辑解耦。
-  Model 配置集中管理。
-  Tool 与业务 Service 解耦。

## 质量

-  单元测试通过。
-  AI Adapter 测试通过。
-  Tool 测试通过。
-  Stream 测试通过。
-  前端集成测试通过。
-  性能指标达标。
-  无旧 AI SDK 实现残留。
-  无无用 OpenAI SDK 依赖。

------

# 三十七、关键架构决策

| ADR     | 决策                                     | 理由                              |
| ------- | ---------------------------------------- | --------------------------------- |
| ADR-001 | 核心 AI 能力统一使用 AI SDK              | 统一 AI 能力抽象                  |
| ADR-002 | 不保留 OpenAI 原生 SDK                   | 当前项目实际 AI 能力均迁移 AI SDK |
| ADR-003 | 不迁移未使用的 OpenAI API                | 避免扩大无意义的重构范围          |
| ADR-004 | Chat 使用 AI SDK                         | 统一 Language Model               |
| ADR-005 | Streaming 使用 AI SDK                    | 使用 AI SDK 原生 Stream           |
| ADR-006 | 不主动构建 OpenAI SSE Adapter            | 避免重复实现协议转换              |
| ADR-007 | 前端 Stream 消费方案结合现有前端代码评估 | 避免脱离实际代码做错误设计        |
| ADR-008 | Tool Calling 使用 AI SDK                 | 统一 Tool Schema 与执行机制       |
| ADR-009 | Multi-step Tool 使用 AI SDK 官方机制     | 避免自行维护 Tool Loop            |
| ADR-010 | Tool Approval 使用 AI SDK                | 统一 Tool 生命周期                |
| ADR-011 | Structured Output 使用 AI SDK            | Schema 驱动、类型安全             |
| ADR-012 | Embedding 使用 AI SDK                    | 统一 Embedding Model              |
| ADR-013 | Image Generation 使用 AI SDK             | 统一 Image Model                  |
| ADR-014 | 业务层不直接依赖 AI SDK                  | 降低基础设施耦合                  |
| ADR-015 | Provider 与 Model 配置独立管理           | 支持多 Provider                   |
| ADR-016 | Skill Agent 延后第二阶段                 | 避免基础设施重构与 Agent 重构耦合 |
| ADR-017 | 锁定 AI SDK 版本                         | 避免 API 版本混用                 |

------

# 三十八、最终架构

本次重构最终形成：

```text
                         ┌─────────────────────┐
                         │       Frontend      │
                         │                     │
                         │ Stream Consumer     │
                         │ Message / Tool UI   │
                         └──────────┬──────────┘
                                    │
                              AI SDK Stream
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │     API Layer       │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   Application Layer │
                         │                     │
                         │ ChatService         │
                         │ ToolService         │
                         │ AgentService        │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   AI Capability     │
                         │       Layer         │
                         │                     │
                         │ Language Model      │
                         │ Structured Output   │
                         │ Tool                │
                         │ Embedding           │
                         │ Image               │
                         │ Speech              │
                         │ Transcription       │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │       AI SDK        │
                         │                     │
                         │ Text                │
                         │ Stream              │
                         │ Tool                │
                         │ Agent               │
                         │ Structured Output   │
                         │ Embedding           │
                         │ Image               │
                         │ Speech              │
                         │ Transcription       │
                         └──────────┬──────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
                 OpenAI         DeepSeek        Anthropic
                    │               │               │
                    └───────────────┼───────────────┘
                                    ▼
                                  Models
```

------

# 三十九、最终核心原则

本次重构最终遵循以下原则：

1. **项目实际使用的 AI 能力全部统一迁移至 AI SDK。**
2. **不保留 OpenAI 原生 SDK。**
3. **未使用的 OpenAI API 不纳入重构范围。**
4. **AI SDK 是项目统一 AI 基础设施。**
5. **业务层不直接依赖 AI SDK。**
6. **Provider 与业务逻辑解耦。**
7. **Chat、Streaming、Tool、Agent、Structured Output、Embedding、Image 等统一使用 AI SDK。**
8. **Multi-step Tool 使用 AI SDK 官方机制，不自行维护 Tool Loop。**
9. **Tool Approval 使用 AI SDK 官方能力。**
10. **Streaming 优先使用 AI SDK 原生 Stream，不额外转换为 OpenAI SSE。**
11. **前端 Stream 解析方案必须结合现有前端代码评估后确定，不在后端重构阶段凭空假设。**
12. **AI SDK 版本必须锁定，所有 API 以当前锁定版本官方文档为准。**
13. **重构重点是统一 AI 基础设施，而不是改变业务逻辑。**
14. **未使用能力不做无意义的技术迁移。**
15. **重构完成后删除旧 AI 调用实现，避免长期双轨维护。**

**最终目标不是“把 OpenAI SDK 换成 AI SDK”，而是建立一套以 AI SDK 为核心、Provider 无关、业务与模型解耦、Stream/Tool/Agent 原生统一的 AI 基础设施层。**