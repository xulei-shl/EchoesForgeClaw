# 集成 prettymaps 作为画板独立节点 `map_art`

## 已确认决策

- **新建独立节点** `map_art`，不在 `map_poster` 或其他节点内增加逻辑。
- **方案 A**：服务器系统级 `pip install prettymaps`，仓库不包含库代码。
- 现有 `map_poster`（浏览器端瓦片渲染）与 `map_art`（服务端 Python 生成式艺术地图）互补并存。

## 架构

```
前端 MapArtNode → POST /api/modules/bookplate/generate-map-art
  → backend-ts (Fastify)
    → spawn python backend-ts/scripts/prettymaps-runner.py (stdio JSON)
      → prettymaps.plot() → PNG
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

### 后端（backend-ts）

1. `backend-ts/scripts/prettymaps-runner.py`
   - 读 stdin JSON：`{ query, radius, circle, preset, style? }`
   - 调用 `prettymaps.plot(..., show=False)` 渲染到临时 PNG
   - 写 stdout JSON：`{ image_path, error? }`
   - 头部设置 `matplotlib.use('Agg')`

2. `backend-ts/src/modules/bookplate/routes/map-art.ts`
   - `POST /api/modules/bookplate/generate-map-art`（auth 中间件）
   - 校验参数 → spawn python wrapper → 读结果 → `imageService.saveMapArtImage()` → `{ image_url }`

3. `backend-ts/src/modules/bookplate/router.ts`
   - `import { register as registerMapArt } from './routes/map-art.js';`
   - `await registerMapArt(app);`

4. `backend-ts/src/modules/bookplate/services/image-service.ts`
   - 新增 `saveMapArtImage(userId, buffer)` 方法，落盘到 `runtime/{userId}/map-arts/`

5. `scripts/deploy.sh`
   - `--install` 分支增加：`pip3 install prettymaps` + 依赖检查
   - 若 `python3` 或 `prettymaps` 缺失，打印明确错误并退出

### 前端

6. `frontend/src/modules/bookplate/nodeTypes.ts`
   - `NODE_DEFAULT_SIZES.map_art`
   - `NODE_COLORS.map_art`
   - `NODE_TEMPLATES` 加条目
   - `NODE_PORT_TYPES.map_art: { output: 'image', inputs: ['text'] }`

7. `frontend/src/modules/bookplate/nodeLayout.ts`
   - `NodeType` 联合类型加 `'map_art'`
   - `NODE_SIZES.map_art`

8. `frontend/src/modules/multimodal/components/MapArtNode.tsx`（新建）
   - 地点输入（文本）
   - 半径滑块（km）
   - 圆形/方形切换
   - 预设选择器（default / minimal / macao / tijuca 等，本地静态镜像）
   - 「生成」按钮 → POST → 展示结果 + 下载 PNG
   - 生成中 spinner + 错误展示

9. `frontend/src/modules/bookplate/CanvasNodeViews.tsx`
   - `case 'map_art'` 渲染 `MapArtNode`

10. `frontend/src/modules/bookplate/seedData.ts`
    - `case 'map_art'` 默认 data

11. `frontend/src/modules/bookplate/useNodeExecution.ts`
    - `case 'map_art': return '';`

### 文档

12. `docs/多模态工具/地图/地图艺术生成节点.md`（新建）
    - 节点说明、参数、接线示例、依赖安装说明

## API 契约

**请求** `POST /api/modules/bookplate/generate-map-art`

```json
{
  "node_id": "abc123",
  "query": "Stad van de Zon, Heerhugowaard, Netherlands",
  "radius": 0.75,
  "circle": false,
  "preset": "default"
}
```

**响应** `200`

```json
{ "image_url": "/static/runtime/123/map-arts/abc123.png" }
```

**错误** `4xx/5xx`

```json
{ "detail": "prettymaps 生成失败: ..." }
```

## Python 调用约定

- backend-ts 通过 `child_process.spawn` 调用 `python3 backend-ts/scripts/prettymaps-runner.py`
- 超时：60s（OSM 请求 + matplotlib 渲染）
- 临时文件清理：wrapper 执行完后删除临时 PNG（前端已通过 `imageService.saveMapArtImage` 持久化到独立目录）
- 错误处理：python 异常 → stderr → backend-ts 返回 502

## 部署要求

- Ubuntu 服务器需安装：`python3.12+`、`pip3`、`python3-pil`、`python3-cairo`（若 prettymaps 依赖）
- `scripts/deploy.sh --install` 时执行：`pip3 install prettymaps`
- 验证命令：`python3 -c "import prettymaps; print(prettymaps.__version__)"`

## 前端 MapArtNode 交互设计

### 地点输入方式

支持**城市名/地址文本输入**，但不在前端做预览地图（那是 `map_poster` 的职责）。

**交互流程**：
1. 用户在城市输入框输入名称（如「巴黎」/「Stad van de Zon, Heerhugowaard, Netherlands」）
2. 前端调用现有 `searchLocation(query)`（Nominatim，`geocoder.ts`）做即时搜索
3. 下拉展示候选结果（名称 + 国家）
4. 用户选中某一项 → 前端记录 `{ lat, lon, name }`
5. 点击「生成」时，将 `lat/lon` 以 `[lon, lat]` 元组传给 prettymaps（`plot()` 接受 `Tuple[float, float]`），同时传递 `radius` / `circle` / `preset`
6. prettymaps 直接用坐标生成，**不再做二次地理编码**

**为什么传坐标而非字符串**：
- prettymaps 内部用 osmnx，也会调 Nominatim；避免前端 + osmnx 两次请求同一服务
- 坐标确定性更强（同名地点歧义由用户选择消除）

**参数**：
- `query`：保留字段（用户输入的原始文本，用于展示/调试）
- `lat` / `lon`：选中地点的坐标（传给 prettymaps 的主参数）
- `radius`：半径 km
- `circle`：是否圆形边界
- `preset`：预设名称

若用户未选搜索结果，则回退为传 `query` 字符串给 prettymaps（由其自行 geocode）。

**数据流**：
```
用户输入城市名
    ↓
searchLocation() → 下拉候选
    ↓
用户选中 → 记录 lat/lon
    ↓
点击「生成」
    ↓
POST /generate-map-art
  { query, lat, lon, radius, circle, preset }
    ↓
backend-ts 构造 prettymaps kwargs：
  query = (lat, lon) 或 原始字符串
    ↓
prettymaps.plot() → PNG
```

prettymaps 为 **AGPL v3**。网络服务场景需披露源码。处理方式：
- 在 `docs/多模态工具/prettymaps-main/LICENSE` 保留原始 LICENSE
- 在输出图片中保留 OSM 致谢（prettymaps 默认行为）
- 在节点文档中注明 prettymaps 版权归属

## 不纳入范围

- 不修改 `map_poster` 节点
- 不实现 prettymaps 流式输出
- 不实现 multiplot / hillshade / keypoints 高级参数
- 不迁移 prettymaps 到纯前端
