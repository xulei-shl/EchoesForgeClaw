# 网络搜索节点 (`web_search`) 实施计划

## 目标
从 `ZhihuSearchNode` 中提取「全网搜索(global)」为独立节点 `web_search`，集成 Tavily / Exa 检索源，支持随机模式与自动降级。

## 实施步骤

### Step 1: 后端 — 节点类型 + 服务 + 路由 + 种子配置
- [x] `backend-ts/src/modules/bookplate/node-types.ts`: 添加 `web_search` 到 NODE_TYPES + NODE_TEMPLATES
- [x] `backend-ts/src/services/web-search-service.ts`: 新建，实现 Tavily 和 Exa 搜索服务
- [x] `backend-ts/src/modules/bookplate/routes/tools.ts`: 添加 `POST /api/modules/bookplate/web-search` 路由
- [x] `backend-ts/src/config/seed.ts`: 添加 `tavily.api_key` 和 `exa.api_key` 默认种子配置

### Step 2: 前端 — 类型注册
- [x] `frontend/src/platform/types/index.ts`: 添加 `web_search` 到 `CanvasNodeType`
- [x] `frontend/src/modules/bookplate/nodeLayout.ts`: 添加 `web_search` 到 `NodeType` + `NODE_SIZES`
- [x] `frontend/src/modules/bookplate/nodeTypes.ts`: 添加 `NODE_DEFAULT_SIZES`, `NODE_COLORS`, `NODE_TEMPLATES`, `NODE_PORT_TYPES`
- [x] `frontend/src/modules/bookplate/seedData.ts`: 添加 `case 'web_search'`
- [x] `frontend/src/modules/bookplate/useNodeExecution.ts`: 添加 `case 'web_search'`
- [x] `frontend/src/platform/utils/generation.ts`: 添加 label

### Step 3: 前端 — WebSearchNode 组件
- [x] `frontend/src/modules/bookplate/components/WebSearchNode.tsx`: 新建组件，4 源（随机/知乎全网/Tavily/Exa），独立结果保存，上游文本输入

### Step 4: 前端 — 集成到画布
- [x] `frontend/src/modules/bookplate/CanvasNodeViews.tsx`: 添加 `case 'web_search'` + import
- [x] `frontend/src/modules/bookplate/useNodeHandlers.ts`: 添加 `handleFetchWebSearchFor` + `handleUpdateWebSearchEditorFor`

### Step 5: 前端 — 从 ZhihuSearchNode 移除 global 模式
- [x] `frontend/src/modules/bookplate/components/ZhihuSearchNode.tsx`: 移除 `'global'` 模式相关代码

### Step 6: 前端 — 管理后台设置项
- [x] `frontend/src/admin/pages/SettingsPage.tsx`: 添加 `tavily.api_key` 和 `exa.api_key` 到 `KNOWN_KEYS`