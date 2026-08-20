# 集成 prettymaps 作为画板独立节点 `map_art`

## 已确认决策

- **新建独立节点** `map_art`，不在 `map_poster` 或其他节点内增加逻辑。
- **方案 B**：FastAPI 服务模式（与 `maptoposter` 一致），在 `services/prettymaps/api.py` 启动独立服务。
- 现有 `map_poster`（浏览器端瓦片渲染）与 `map_art`（服务端 Python 生成式艺术地图）互补并存。

## 架构

```
前端 MapArtNode → POST /api/modules/bookplate/generate-map-art
  → backend-ts (Fastify)
    → fetch(Python FastAPI :8101) → PNG bytes
    → imageService.saveMapArtImage() → 返回 { image_url }
  → 前端 updateNodeData({ imageUrl })
```

## 节点契约

| 字段 | 值 |
|---|---|
| 类型 | `map_art` |
| category | `multimodal` |
| output_type | `image` |
| input_types | `['text']`（可选关键词） |
| configurable | `false` |
| 手动运行 | 是（点击「生成」） |

## 待实现文件清单

### 1. Python FastAPI 服务

`services/prettymaps/api.py`
- FastAPI 应用，端口 8101
- `POST /generate`：接受 JSON `{ lat, lon, radius, circle, preset, figsize }`，
  调用 `prettymaps.plot(query=(lon,lat), ...)`，返回 PNG 字节
- `GET /presets`：返回可用预设列表
- `GET /health`：健康检查

### 2. 后端 TS 路由

`backend-ts/src/modules/bookplate/routes/map-art.ts`
- `POST /api/modules/bookplate/generate-map-art`（auth 中间件）
  校验参数 → fetch prettymaps API → imageService.saveMapArtImage() → { image_url }
- `GET /api/modules/bookplate/map-art/presets`（auth 中间件）
  代理到 prettymaps API 获取预设列表

### 3. 后端图片落盘

`backend-ts/src/services/image-service.ts`
- 新增 `userMapArtDir(userId)` → `runtime/{userId}/map-arts/`
- 新增 `saveMapArtImage(userId, buffer)` → 返回 `/static/map-arts/{userId}/{file}`

### 4. 后端静态路由

`backend-ts/src/server.ts`
- 新增 `/static/map-arts/:userId/:file` → `runtime/{userId}/map-arts/{file}`

### 5. 后端节点模板 + 路由注册

`backend-ts/src/modules/bookplate/node-types.ts`
- 定义 `MAP_ART = "map_art"` 常量
- `NODE_TEMPLATES` 加条目（category: multimodal, output_type: image, input_types: ['text']）

`backend-ts/src/modules/bookplate/router.ts`
- 注册 `map-art` 路由

### 6. 前端类型 + 元数据

`frontend/src/platform/types/index.ts` — `CanvasNodeType` 加 `'map_art'`
`frontend/src/modules/bookplate/nodeTypes.ts` — `NODE_DEFAULT_SIZES` / `NODE_COLORS` / `NODE_TEMPLATES` / `NODE_PORT_TYPES`
`frontend/src/modules/bookplate/nodeLayout.ts` — `NodeType` + `NODE_SIZES`

### 7. 前端节点组件

`frontend/src/modules/multimodal/map/art-defaults.ts` — 默认值
`frontend/src/modules/multimodal/components/MapArtNode.tsx`（新建）
- 地点输入（文本，Nominatim 搜索）
- 半径滑块（km）
- 圆形/方形切换
- 预设选择器（本地静态镜像）
- 「生成」按钮 → POST → 展示结果 + 下载 PNG
- 生成中 spinner + 错误展示

### 8. 前端画板集成

`frontend/src/modules/bookplate/CanvasNodeViews.tsx` — `case 'map_art'` 渲染 `MapArtNode`
`frontend/src/modules/bookplate/seedData.ts` — `case 'map_art'` 默认 data
`frontend/src/modules/bookplate/useNodeExecution.ts` — `case 'map_art': return ''`
`frontend/src/modules/bookplate/useNodeHandlers.ts` — `handleGenerateMapArtFor` + `handleUpdateMapArtEditorFor`

### 9. 部署脚本

`scripts/deploy.sh` — `--install` 分支增加 `pip3 install prettymaps`

### 10. 文档

`docs/多模态工具/地图/艺术地图生成节点.md`

## API 契约

**请求** `POST /api/modules/bookplate/generate-map-art`

```json
{
  "lat": 48.8566,
  "lon": 2.3522,
  "query": "Paris, France",
  "radius": 0.75,
  "circle": false,
  "preset": "default"
}
```

**响应** `200`

```json
{ "image_url": "/static/map-arts/123/map_art_20260819-143000_12345.png" }
```

**错误** `4xx/5xx`

```json
{ "detail": "prettymaps 生成失败: ..." }
```

## Python 服务调用约定

- backend-ts 通过 `fetch` 调用 `http://127.0.0.1:8101/generate`
- 超时：120s（OSM 请求 + matplotlib 渲染）
- 环境变量：`PRETTYMAPS_API`（默认 `http://127.0.0.1:8101`）

## 前端 MapArtNode 交互设计

### 地点输入方式

支持**城市名/地址文本输入**，复用 `MapPosterNode` 的 Nominatim 搜索模式。

**交互流程**：
1. 用户在城市输入框输入名称
2. 前端调用 Nominatim（`searchLocation`）做即时搜索
3. 下拉展示候选结果
4. 用户选中某一项 → 前端记录 `{ lat, lon, name }`
5. 点击「生成」时，将 `lat/lon` 传给 prettymaps `plot()` 的 `query` 参数
6. prettmaps 直接用坐标生成，**不再做二次地理编码**

**参数**：
- `query`：保留字段（用户输入的原始文本，用于展示/调试）
- `lat` / `lon`：选中地点的坐标（传给 prettymaps 的主参数）
- `radius`：半径 km
- `circle`：是否圆形边界
- `preset`：预设名称

若用户未选搜索结果，则回退为传 `query` 字符串给 prettymaps（由其自行 geocode）。

### 预设列表（本地静态镜像）

| 预设 | 说明 |
|------|------|
| `default` | 默认暖色（10 个图层） |
| `minimal` | 黑白极简 |
| `macao` | 澳门风格（圆形容器） |
| `tijuca` | 提居卡风格 |

## 部署要求

- Ubuntu 服务器需安装：`python3.12+`、`pip3`、`libgl1`、`libgdal-dev`
- `scripts/deploy.sh --install` 时执行：`pip3 install prettymaps`
- 验证命令：`python3 -c "import prettymaps; print(prettymaps.__version__)"`

## 许可证

prettymaps 为 **AGPL v3**。网络服务场景需披露源码。处理方式：
- 在 `services/prettymaps/LICENSE` 保留原始 LICENSE
- 在输出图片中保留 OSM 致谢（prettymaps 默认行为）
- 在节点文档中注明 prettymaps 版权归属

## 不纳入范围

- 不修改 `map_poster` 节点
- 不实现 prettymaps 流式输出
- 不实现 hillshade / keypoints / GPX 等高级参数
- 不迁移 prettymaps 到纯前端