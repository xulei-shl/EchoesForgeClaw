# 模块扩展指南 — BookForge

> **目标**：让开发者以最小成本新增一个创作模块。当前平台只有 `bookplate`（藏书票），本文档说明如何添加第二个、第三个模块。

---

## 一、总览：新增一个模块需要改什么

| 层 | 改动量 | 涉及文件 |
|----|--------|---------|
| 前端路由 | 1 处 | `app/App.tsx` — 添加一条 `<Route>` |
| 前端模块组件 | 2-3 个文件 | `modules/<module-id>/` 下新建目录 |
| 前端「开始创作」路由 | 1 处 | `platform/utils/creation.ts` — 更新模块列表 |
| 后端 API | 1 个 Router | `app/modules/<module-id>/router.py` + `service.py` |
| 数据库 | 0（若复用现有 schema） | 无需改表，`module` 字段天然支持多模块；若启用 Agent 模式则复用 `fastclaw_agent_configs` 表 |
| 阶段执行模式 | 可选 | 每个阶段可用「提示词+大模型」或「FastClaw Agent」（二选一，见 3.4） |

---

## 二、前端：新增模块

### 2.1 创建模块目录

```
src/modules/<module-id>/
├── components/
│   ├── InputNode.tsx        # 初始输入阶段（如 bookplate 的 ISBN 输入）
│   ├── ProcessingNode.tsx   # AI 处理阶段节点渲染
│   └── ResultNode.tsx       # 结果展示阶段节点渲染
├── services/
│   └── index.ts             # 模块 API 调用
├── definition.ts            # 模块注册定义（预留）
│── index.ts                 # 模块入口，导出页面组件
```

### 2.2 编写模块页面组件

`modules/<module-id>/index.ts` 默认导出页面组件，类似 `BookplatePage` 的职责：

- 使用平台层 `<Canvas>` 组件作为画布容器
- 定义本模块的阶段节点（使用平台层的 `<CanvasNode>` 组件）
- 调用平台层的 `useSSE` hook 处理流式响应

参考 `src/modules/bookplate/` 目录下的现有实现。

### 2.3 注册路由

在 `app/App.tsx` 中添加：

```tsx
import YourModulePage from '../modules/<module-id>';

// 在 <Routes> 内添加：
<Route
  path="/<module-id>"
  element={
    <PrivateRoute>
      <YourModulePage />
    </PrivateRoute>
  }
/>
```

### 2.4 更新「开始创作」按钮

`src/platform/utils/creation.ts` 是全局唯一的"开始创作"导航入口：

```ts
// 当前：单一模块，直接跳转
export function getStartCreationRoute(): string {
  return '/bookplate';
}

// 多模块时可选方案（视产品需求选择其一）：
//
// 方案 A：跳转模块选择页
//   export function getStartCreationRoute(): string {
//     return '/workspace';
//   }
//
// 方案 B：跳转用户最近使用的模块（需 localStorage 记录）
//   export function getStartCreationRoute(): string {
//     return localStorage.getItem('lastModule') ?? '/bookplate';
//   }
//
// 方案 C：跳转第一个可用模块（数组配置）
//   const MODULES = ['bookplate', 'poster', 'flyer'];
//   export function getStartCreationRoute(): string {
//     return '/' + MODULES[0];
//   }
```

这个函数被三处消费：

| 调用位置 | 登录态 | 行为 |
|---------|--------|------|
| `HomePage.tsx:38` | 未登录 → `/login`；已登录 → `getStartCreationRoute()` | 条件跳转 |
| `GenerationListPage.tsx:236` | 已登录（路由在 PrivateRoute 内） | 直接跳转 |
| `GenerationListPage.tsx:250` | 同上 | 同上 |

> 新增模块后，修改 `creation.ts` 一处即可影响所有入口。

---

## 三、后端：新增模块

### 3.1 创建模块目录

```
app/modules/<module-id>/
├── router.py          # API 路由（前缀 /api/modules/<module-id>）
├── service.py         # 业务逻辑
└── client.py          # 外部依赖客户端（可选，如 bookplate 的 douban_client.py）
```

### 3.2 注册路由

在 `app/main.py` 中：

```python
from app.modules.<module-id> import router as <module-id>_router
app.include_router(<module-id>_router.router)
```

### 3.3 数据模型

无需修改数据库 schema。现有 `Generation` 表的 `module` 字段通过字符串区分模块，`stage_results` JSON 字段可存储任意阶段结构。例如新模块的 `stage_results`：

```json
{
  "stage1": { "input_text": "...", "analysis": "..." },
  "stage2": { "image_url": "..." }
}
```

管理员后台的 `PromptTemplate` 和 `StageConfig` 通过 `module` 字段过滤，天然支持多模块配置；`FastClawAgentConfig`（Agent 接入参数）是**全局池**（无 module 字段），各模块的阶段配置按 `agent_config_id` 引用它即可复用同一批 Agent。

> **历史记录与 Agent 中间步骤**：`stage_results` 各阶段的 `agent_steps` 字段（`AgentStep[]`，即 `agent_tool_call / agent_tool_result / agent_status` 事件列表）会随记录持久化，历史详情面板与 Markdown 导出会自动展示；新模块若使用 Agent 模式，把中间步骤放进对应阶段的 `agent_steps` 即可获得同样的历史展示能力。

### 3.4 阶段执行模式：LLM 或 Agent（二选一）

`StageConfig` 在「提示词 + 大模型」之外，还支持绑定 FastClaw Agent（`agent_config_id`）。两者**互斥**（admin API 创建/更新时校验，同时设置返回 400）：

- **LLM 模式**：绑定 `llm_config_id` + `prompt_id`（或留空回退环境变量），由 `app/services/llm_service.py` 执行；
- **Agent 模式**：绑定 `agent_config_id`（指向 `fastclaw_agent_configs` 表），由 `app/services/fastclaw_service.py` 调用 FastClaw `/api/chat/stream`，中间步骤实时透传。

> 新模块需要 Agent 模式时：
> 1. 在 `app/api/admin/` 的 `stage_configs.py` 复用既有互斥校验（`_validate_mode`）；
> 2. 在 `app/modules/<module-id>/router.py` 仿照 bookplate 的 `_resolve_agent_config` 解析 Agent 运行时配置（base_url / api_key / agent_id / end_user）；
> 3. Agent 事件归一化 / 文本去重 / 图片 URL 提取已封装在 `fastclaw_service.py`，直接复用 `fastclaw_agent_service.run_agent` 与 `_sse_from_agent_event` 同款映射（bookplate/router.py 有参考实现）。
> 4. Agent 配置管理（增删改 + 探测）由全局 admin「Agent 配置」页提供，新模块无需重复开发；相关接入细节见 `docs/fastclaw-agent-guide.md`。

---

## 四、历史页模块筛选

历史记录页（`/history`，组件 `app/routes/GenerationListPage.tsx`）已支持按模块下拉框筛选：

- **数据源**：模块选项硬编码在 `MODULE_OPTIONS` 常量中（当前仅 `全部模块` / `bookplate`）。
- **触发逻辑**：`moduleFilter` 状态变化时，通过 `fetchPage` 的 `useCallback` 依赖链自动重置到第一页并重新拉取。
- **后端**：`GET /api/generations` 已支持可选的 `module` 查询参数（`backend/app/api/generations.py:87`）。
- **三模式共享**：历史记录、收藏、公开画廊三个页面均显示该下拉框。
- **后端**：
  - `GET /api/generations`（历史）已支持 `module` 参数（`backend/app/api/generations.py:87`）
  - `GET /api/favorites`（收藏）已支持 `module` 参数，通过 `Favorite.generation` 关联过滤（`backend/app/api/favorites.py:54`）
  - `GET /api/public`（画廊）已支持 `module` 参数，通过 `PublicShare.generation` 关联过滤（`backend/app/api/public.py:41`）

> **新增模块时**：务必同步更新 `MODULE_OPTIONS`，否则历史页无法筛选出新模块的记录。若后续需要收藏/画廊也支持按模块筛选，需先在对应后端接口补充 `module` 参数。

### 4.1 题名关键词检索

三个列表页面（历史 / 收藏 / 画廊）均支持按题名关键词检索：

- **数据来源**：`generations` 表新增 `name` 列，创建记录时从 `stage_results` 元数据自动提取题名（bookplate 为 `stage1.metadata.title`），见 `backend/app/api/generations.py` 的 `_extract_generation_name`。
- **迁移**：老库在 `main.py` lifespan 中通过 `ALTER TABLE` 补列并回填已有记录（`PRAGMA table_info` 检查 + `ALTER TABLE ... ADD COLUMN name` + 索引 `ix_generations_name`）。
- **检索**：三个列表接口均支持可选 `keyword` 参数，对 `Generation.name` 做 `ilike '%keyword%'` 子串匹配。
- **前端**：搜索框输入 400ms 防抖后触发重新加载，与模块下拉框可组合使用。

> **新增模块时**：若新模块的元数据结构不同，需同步扩展 `_extract_generation_name`（现仅识别 `stage1.metadata.title`），否则新模块记录的 `name` 为空、无法被检索。

> **注意**：`ilike '%keyword%'` 是前导通配子串匹配，无法利用 B 树索引（仅前缀 `keyword%` 可用索引）。当前数据量下性能足够；若未来数据量大，可改用 FTS5 全文索引。

---

## 五、验证清单

新增模块后确认以下功能正常：

- [ ] 未登录访问 `/module-id` → 跳转 `/login`，登录后回到原页面
- [ ] 首页「开始创作」按钮 → 未登录跳登录，已登录进创作页
- [ ] 历史记录 / 画廊空态「开始创作」按钮 → 进创作页
- [ ] 管理员后台可配置本模块的 `PromptTemplate` 和 `StageConfig`
- [ ] （若用 Agent 模式）管理员后台「Agent 配置」可建配置，阶段配置可选择 Agent 且与提示词+大模型互斥
- [ ] （若用 Agent 模式）Agent 中间步骤实时显示在画布节点，并随历史记录持久化
- [ ] 生成记录带有正确的 `module` 字段值
- [ ] 历史页下拉框包含新模块选项（需同步更新 `MODULE_OPTIONS`）
- [ ] 历史页按新模块筛选后，列表正确显示对应模块的记录

---

## 五、参考实现

| 当前模块 | 前端 | 后端 |
|---------|------|------|
| bookplate | `src/modules/bookplate/` | `app/modules/bookplate/` |
| 平台层 | `src/platform/`（画布、节点、SSE、认证） | `app/core/` + `app/api/` + `app/services/` |