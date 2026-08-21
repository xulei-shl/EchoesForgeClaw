# 中国传统配色 API 服务（Chinese Traditional Colors Service）启动与维护指南

本服务为 EchoesForgeClaw 平台中的「中国传统配色」多模态画板节点提供后端色彩检索、742 款传统色数据查询、5 色智能调色板生成、设计场景灵感与高清色卡静态文件服务。

---

## 1. 服务架构与交互链路

```text
┌─────────────────────────────────────────────────────────────┐
│ 前端画布节点 (ColorSearchNode.tsx)                          │
│ - 双核心 Tab：色彩检索 / 5色配色生成器                     │
│ - 742 色色系与冷暖精准筛选、全屏放大灯箱、独立锁定、单色/整组替换│
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP /api/modules/bookplate/color-search/*
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 主后端网关 (backend-ts Fastify - 端口 8010)                 │
│ - 鉴权校验 (preHandler: app.authenticate)                   │
│ - 选中色卡落盘到 search-images 目录并生成 Markdown 方案     │
│ - 代理转发至 process.env.COLORS_API (默认 http://127.0.0.1:8103) │
│ - 🛡️ 双模降级：微服务未启动时自动平滑降级走本地 CSV / TS 引擎 │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP 转发代理 (微服务就绪时)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 传统色微服务 (FastAPI / Uvicorn - 端口 8103)                │
│ - 内存索引 742 款中国传统色与精准冷暖/色相校准算法            │
│ - 5 种智能调色板算法：auto / analogous / complementary /     │
│   triadic / neutral                                         │
│ - 静态文件服务：/static/images/* (高清色卡) 与 thumbnails/* │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 环境准备与依赖安装

### 2.1 环境要求
- **Python**：>= 3.10
- **操作系统**：Linux / macOS / Windows

### 2.2 安装依赖
进入服务目录并安装所需 Python 包：

```bash
cd services/zhongguo-traditional-colors
pip install -r requirements.txt
```

`requirements.txt` 内容：
```text
fastapi>=0.100.0
uvicorn>=0.23.0
```

---

## 3. 服务启动方式

### 3.1 开发环境直接启动
```bash
cd services/zhongguo-traditional-colors

# 方式一：直接运行脚本（默认 0.0.0.0:8103）
python api.py

# 方式二：使用 uvicorn 启动（支持热重载）
uvicorn api:app --host 0.0.0.0 --port 8103 --reload
```

### 3.2 生产环境后台启动（nohup）
```bash
cd services/zhongguo-traditional-colors
nohup python -m uvicorn api:app --host 0.0.0.0 --port 8103 --workers 2 > colors-api.log 2>&1 &
```

### 3.3 生产环境 Systemd 服务配置（推荐）

在 Linux 服务器上创建 systemd 服务文件 `/etc/systemd/system/zhongguo-traditional-colors.service`：

```ini
[Unit]
Description=Chinese Traditional Colors FastAPI Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/EchoesForgeClaw/services/zhongguo-traditional-colors
ExecStart=/usr/bin/python3 -m uvicorn api:app --host 127.0.0.1 --port 8103 --workers 2
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

**管理命令**：
```bash
# 重载 systemd 配置
sudo systemctl daemon-reload

# 启动服务并设置开机自启
sudo systemctl start zhongguo-traditional-colors
sudo systemctl enable zhongguo-traditional-colors

# 查看运行状态
sudo systemctl status zhongguo-traditional-colors

# 查看实时日志
journalctl -u zhongguo-traditional-colors -f
```

---

## 4. API 接口规范与参数说明

### 4.1 健康检查与统计

- **请求方式**：`GET /health`
- **说明**：检查微服务运行状态及内存中加载的色彩总数与色系分类总数。
- **响应示例**：
```json
{
  "status": "ok",
  "total_colors": 742,
  "total_categories": 8
}
```

---

### 4.2 获取分类列表与冷暖属性

- **请求方式**：`GET /categories`
- **说明**：返回 8 大色系分类与冷暖属性列表。
- **响应示例**：
```json
{
  "categories": [
    "黄色系",
    "橙色系",
    "红色系",
    "绿色系",
    "青色系",
    "蓝色系",
    "紫色系",
    "中性色"
  ],
  "temperatures": [
    "暖",
    "冷",
    "中性"
  ]
}
```

---

### 4.3 检索传统色列表（分页与多维筛选）

- **请求方式**：`POST /colors/search`
- **Content-Type**：`application/json`
- **请求体参数**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `category` | string | 否 | `null` | 色系筛选（如 `"黄色系"`、`"青色系"` 等，传 `"全部"` 或空表示不限） |
| `temperature` | string | 否 | `null` | 冷暖筛选（`"暖"` / `"冷"` / `"中性"`） |
| `query` | string | 否 | `null` | 搜索关键词（支持色名、编号、HEX、寓意模糊搜索） |
| `page` | integer | 否 | `1` | 页码，从 1 开始 |
| `per_page` | integer | 否 | `24` | 每页数量（最大 100） |
| `random` | boolean | 否 | `false` | 是否随机打乱返回 |

- **响应示例**：
```json
{
  "items": [
    {
      "id": "001",
      "name": "乳白",
      "hex": "#F9F4DC",
      "h": 50,
      "s": 71,
      "l": 92,
      "hsl": { "h": 50, "s": 71, "l": 92 },
      "rgb": { "r": 249, "g": 244, "b": 220 },
      "hue_category": "黄色系",
      "temperature": "暖",
      "full_image_url": "/static/images/001-乳白.png",
      "thumb_url": "/static/thumbnails/color-card-001.jpg",
      "preview_url": "/static/images/001-乳白.png",
      "harmonies": {
        "curated_plan": "主色：001-乳白 #F9F4DC；辅色：053-蚌肉白 #F9F1DB | 098-粉白 #FBF2E3；点缀色：576-绀青 #4F84FF | 597-霜华 #D0E7F9"
      }
    }
  ],
  "total": 1,
  "page": 1,
  "per_page": 24
}
```

---

### 4.4 获取单个色彩详情与场景搭配

- **请求方式**：`GET /colors/{color_id}`
- **说明**：获取指定编号（如 `001`）或色名的完整色彩数据，包含同类色、邻近色、互补色、分裂互补、三角色、四角色、冷暖对照、明暗搭配、灰调与中性色搭配，以及落地设计指南与避坑清单。
- **响应示例**：
```json
{
  "id": "001",
  "name": "乳白",
  "hex": "#F9F4DC",
  "h": 50,
  "s": 71,
  "l": 92,
  "hsl": { "h": 50, "s": 71, "l": 92 },
  "rgb": { "r": 249, "g": 244, "b": 220 },
  "hue_category": "黄色系",
  "temperature": "暖",
  "full_image_url": "/static/images/001-乳白.png",
  "thumb_url": "/static/thumbnails/color-card-001.jpg",
  "harmonies": {
    "same": [
      { "id": "053", "name": "蚌肉白", "hex": "#F9F1DB" },
      { "id": "098", "name": "粉白", "hex": "#FBF2E3" }
    ],
    "analogous": [
      { "id": "184", "name": "初桃粉红", "hex": "#F6DCCE" }
    ],
    "complementary": [
      { "id": "691", "name": "云峰灰", "hex": "#C1C8D6" },
      { "id": "576", "name": "绀青", "hex": "#4F84FF" }
    ],
    "curated_plan": "主色：001-乳白 #F9F4DC；辅色：053-蚌肉白 #F9F1DB | 098-粉白 #FBF2E3；点缀色：576-绀青 #4F84FF | 597-霜华 #D0E7F9",
    "algorithm_note": "基于真实 742 色库；按 HSL 色相角度推导关系，再用 Lab 感知距离、明度与饱和度排序；中性色按低饱和逻辑处理"
  },
  "use_cases": [
    {
      "logic": "同类",
      "intent": "统一",
      "directions": "保持同一种气质，让画面稳定、安静、低风险。",
      "typical_scenes": "品牌延展、资料页背景、系列封面、文化内容、长文配图、低干扰界面模块。",
      "ratio_advice": "主色 60-80%，同类关系色 15-35%，强调色控制在 5% 以内。",
      "risk_warning": "容易过于平，建议用字号、留白、明暗或材质建立层级；如果主色本身很浅，必须另选深色保证文字可读。"
    }
  ]
}
```

---

### 4.5 智能 5 色调色板生成

- **请求方式**：`POST /colors/palette/generate`
- **说明**：基于基准主色与算法模式生成一组 5 色调色盘，支持保留已锁定色块。
- **请求体参数**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `anchor_id` | string | 否 | 随机色 | 基准色彩编号（如 `"001"`） |
| `method` | string | 否 | `"auto"` | 配色模式：`"auto"` (自动) / `"analogous"` (近似) / `"complementary"` (对比) / `"triadic"` (三分) / `"neutral"` (中性) |
| `locked` | array[bool] | 否 | `null` | 5 个色块的锁定状态布尔数组，如 `[true, false, false, false, false]` |
| `previous_palette` | array[obj] | 否 | `null` | 上一轮的 5 色调色板列表 |

- **响应示例**：
```json
{
  "anchor_id": "001",
  "method": "auto",
  "palette": [
    { "id": "001", "name": "乳白", "hex": "#F9F4DC", "h": 50, "s": 71, "l": 92 },
    { "id": "053", "name": "蚌肉白", "hex": "#F9F1DB", "h": 46, "s": 73, "l": 92 },
    { "id": "184", "name": "初桃粉红", "hex": "#F6DCCE", "h": 20, "s": 72, "l": 88 },
    { "id": "576", "name": "绀青", "hex": "#4F84FF", "h": 222, "s": 100, "l": 65 },
    { "id": "597", "name": "霜华", "hex": "#D0E7F9", "h": 206, "s": 77, "l": 90 }
  ]
}
```

---

### 4.6 静态图片资源访问

微服务通过 FastAPI 的 `StaticFiles` 挂载服务目录：
- **高清原图（PNG）**：`GET /static/images/{id}-{name}.png`（例如：`http://127.0.0.1:8103/static/images/001-乳白.png`）
- **色卡缩略图（JPG）**：`GET /static/thumbnails/color-card-{id}.jpg`（例如：`http://127.0.0.1:8103/static/thumbnails/color-card-001.jpg`）

---

## 5. 主后端（backend-ts）集成与降级机制

### 5.1 环境变量配置
在 `backend-ts/.env` 中配置微服务地址（可选，默认即为 `http://127.0.0.1:8103`）：
```env
COLORS_API=http://127.0.0.1:8103
```

### 5.2 零依赖本地自动降级机制
`backend-ts` 在 `src/modules/bookplate/routes/color-search.ts` 中内置了完整的本地 CSV 解析与 5 色调色板 TS 算法引擎：
- 当 Python 微服务正常运行时：通过 HTTP 高速代理并享受微服务的高性能响应；
- 当 Python 微服务未启动或网络超时（>2000ms）时：**自动无缝降级走本地 CSV 直读与内存 TS 算法**，前端完全无感，确保系统 100% 可用。

---

## 6. 故障排查与运维诊断

1. **端口被占用**：
   ```bash
   # Windows 查看端口占用
   netstat -ano | findstr 8103

   # Linux 查看端口占用
   lsof -i :8103
   ```
2. **CORS 跨域异常**：
   微服务已在 `api.py` 中默认开启全部 CORS 支持（`allow_origins=["*"]`）。
3. **数据文件丢失**：
   微服务依赖 `docs/chinese-color-harmony.csv` 与 `docs/chinese-color-harmony-use-cases.csv`，请确保未误删 `docs/` 目录。
