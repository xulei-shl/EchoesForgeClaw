# 多模态工具模块

## 地图海报生成

地图海报节点基于 [maptoposter](../../../../services/maptoposter/) 项目，通过 Python 后端服务生成高质量的艺术风格地图海报。

### 架构

```
前端 (MapPosterNode)
  ↓  POST /api/modules/bookplate/map-poster/generate
后端 TS (map-poster.ts)
  ↓  代理请求
Python FastAPI (api.py :8100)
  ↓  调用 create_map_poster.py
OSMnx + matplotlib → PNG 图片
  ↓  返回图片字节
后端 TS → 落盘 runtime/{userId}/map-posters/
  ↓  返回 /static/map-posters/{userId}/{file}
前端 → 展示静态图片
```

### 启动 Python 服务

```bash
cd services/maptoposter

# 方式一：uvicorn 直接启动
uvicorn api:app --host 0.0.0.0 --port 8100

# 方式二：python 直接运行
python api.py
```

> 首次运行会自动安装依赖并下载 Roboto 字体。需要 Python >= 3.11。

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MAPTOPoster_API` | `http://127.0.0.1:8100` | Python 服务地址（后端 TS 使用） |

### API 端点

**生成海报**

```
POST /api/modules/bookplate/map-poster/generate
Authorization: Bearer <token>

{
  "city": "Paris",
  "country": "France",
  "theme": "noir",
  "latitude": 48.8566,
  "longitude": 2.3522,
  "distance": 12000,
  "width": 12,
  "height": 16
}

→ { "image_url": "/static/map-posters/1/map_poster_20260819-143000_12345.png" }
```

**获取主题列表**

```
GET /api/modules/bookplate/map-poster/themes

→ { "themes": [{ "name": "terracotta", "display_name": "Terracotta", "description": "..." }] }
```

### 可用主题

| 主题 | 风格 |
|------|------|
| `terracotta` | 地中海暖色调（默认） |
| `noir` | 纯黑背景，白色道路 |
| `midnight_blue` | 深蓝底色，金色道路 |
| `sunset` | 暖橙与粉色 |
| `warm_beige` | 复古米色 |
| `neon_cyberpunk` | 暗底霓虹 |
| `japanese_ink` | 水墨极简 |
| `copper_patina` | 氧化铜绿 |
| `emerald` | 深绿 |
| `forest` | 森林绿 |
| `ocean` | 蓝绿色系 |
| `blueprint` | 建筑蓝图风 |
| `pastel_dream` | 柔和粉彩 |
| `autumn` | 秋季暖色 |
| `contrast_zones` | 高对比度 |
| `monochrome_blue` | 单色蓝 |
| `gradient_roads` | 渐变道路 |

### 尺寸预设

| 名称 | 宽×高（英寸） | 300 DPI 像素 |
|------|--------------|-------------|
| 竖版 A4 | 12 × 16 | 3600 × 4800 |
| 方形 | 12 × 12 | 3600 × 3600 |
| 横版 | 16 × 12 | 4800 × 3600 |
| Instagram | 3.6 × 3.6 | 1080 × 1080 |
| 手机壁纸 | 3.6 × 6.4 | 1080 × 1920 |
| HD 壁纸 | 6.4 × 3.6 | 1920 × 1080 |

### 依赖

Python 服务依赖（`requirements.txt`）：
- `osmnx` — OpenStreetMap 数据获取
- `matplotlib` — 海报渲染
- `geopandas` / `shapely` — 地理数据处理
- `geopy` — 地理编码
- `fastapi` / `uvicorn` — HTTP 服务

### 前端文件结构

```
modules/multimodal/
├── components/
│   └── MapPosterNode.tsx    # 地图海报节点组件
└── map/
    └── defaults.ts          # 默认值配置
```
