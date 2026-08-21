# 中国传统纹样检索 API 服务（Chinese Traditional Patterns Service）启动与维护指南

本服务为 EchoesForgeClaw 平台中的「中国传统纹样」多模态画板节点提供后端数据检索、详情读取与高清卡片原图的静态文件服务。

---

## 1. 服务架构与交互链路

```text
┌─────────────────────────────────────────────────────────────┐
│ 前端画布节点 (PatternSearchNode.tsx)                        │
│ - 分类筛选、关键词检索、随机换一批、全屏灯箱大图、连线输出  │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP /api/modules/bookplate/pattern-search/*
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 主后端网关 (backend-ts Fastify - 端口 8010)                 │
│ - 鉴权校验 (preHandler: app.authenticate)                   │
│ - 选中图片落盘保存到 search-images 目录 (imageService)      │
│ - 读取 process.env.PATTERNS_API (默认 http://127.0.0.1:8102)│
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP 转发代理
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 纹样微服务 (FastAPI / Uvicorn - 端口 8102)                  │
│ - 内存索引 100 款传统纹样数据                               │
│ - 静态文件服务：/static/patterns/* (PNG 高清原图)           │
│ - 详情读取：读取各子目录下的 _详情页.md Markdown 正文       │
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
cd services/chinese-traditional-patterns
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
cd services/chinese-traditional-patterns

# 方式一：直接运行脚本（默认 0.0.0.0:8102）
python api.py

# 方式二：使用 uvicorn 启动（支持热重载）
uvicorn api:app --host 0.0.0.0 --port 8102 --reload
```

### 3.2 生产环境后台启动（nohup）
```bash
cd services/chinese-traditional-patterns
nohup python -m uvicorn api:app --host 0.0.0.0 --port 8102 --workers 2 > patterns-api.log 2>&1 &
```

### 3.3 生产环境 Systemd 服务配置（推荐）

在 Linux 服务器上创建 systemd 服务文件 `/etc/systemd/system/chinese-traditional-patterns.service`：

```ini
[Unit]
Description=Chinese Traditional Patterns FastAPI Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/EchoesForgeClaw/services/chinese-traditional-patterns
ExecStart=/usr/bin/python3 -m uvicorn api:app --host 127.0.0.1 --port 8102 --workers 2
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

# 启动并设置开机自启
sudo systemctl start chinese-traditional-patterns
sudo systemctl enable chinese-traditional-patterns

# 查看运行状态
sudo systemctl status chinese-traditional-patterns

# 查看实时日志
sudo journalctl -u chinese-traditional-patterns -f
```

---

## 4. API 接口规范与测试

服务启动后，内置交互式 API 文档地址：
- Swagger UI：`http://localhost:8102/docs`
- ReDoc：`http://localhost:8102/redoc`

### 4.1 接口列表

| 方法 | 路由 | 说明 | 示例请求 |
|---|---|---|---|
| `GET` | `/health` | 服务健康检查与纹样总数 | `curl http://localhost:8102/health` |
| `GET` | `/categories` | 获取 6 大传统纹样分类列表 | `curl http://localhost:8102/categories` |
| `POST` | `/patterns/search` | 检索/筛选/随机分页获取纹样 | 见下文 |
| `GET` | `/patterns/{id}` | 获取单款纹样元数据及 Markdown 详情 | `curl http://localhost:8102/patterns/001` |
| `GET` | `/static/...` | 静态访问高清卡片原图 | `curl http://localhost:8102/static/patterns/...` |

### 4.2 `/patterns/search` 请求体参数说明

```json
{
  "category": "植物花卉纹",  // 可选：分类精确过滤（空字符串或"全部"表示不限）
  "query": "莲花",          // 可选：关键词检索（匹配名称、题材、寓意、拼音等）
  "page": 1,               // 可选：页码，默认 1
  "per_page": 24,          // 可选：每页数量，默认 24
  "random": true           // 可选：无关键词时是否随机打乱顺序返回
}
```

响应示例：
```json
{
  "items": [
    {
      "id": "001",
      "name_cn": "缠枝莲纹",
      "name_en": "Interlocking Lotus Scroll Pattern",
      "category": "植物花卉纹",
      "summary": "以莲花与卷曲藤蔓连续展开，常见于瓷器、织锦与建筑装饰。",
      "meaning": "清雅、连绵、生生不息",
      "visual_keywords": ["莲花", "卷草", "连续藤蔓", "青绿白描"],
      "card_image_url": "/static/patterns/001-020_植物花卉纹/001_缠枝莲纹/001_缠枝莲纹_卡片图.png",
      "image_size": "1086x1448"
    }
  ],
  "total": 1,
  "page": 1,
  "per_page": 24
}
```

---

## 5. 配置与主系统对接

主系统 `backend-ts` 通过环境变量 `PATTERNS_API` 与本微服务通信。

在 `backend-ts/.env` 中配置：
```env
# 传统纹样服务地址（默认即为 http://127.0.0.1:8102）
PATTERNS_API=http://127.0.0.1:8102
```

---

## 6. 日常维护与数据扩充

### 6.1 目录结构说明
```text
services/chinese-traditional-patterns/
├── api.py                       # FastAPI 入口服务
├── requirements.txt             # Python 依赖
├── data/
│   ├── patterns.json            # 汇总索引数据（必须与 patterns/ 保持一致）
│   └── patterns.csv             # CSV 格式汇总表格
└── patterns/                    # 纹样目录
    ├── 001-020_植物花卉纹/
    │   └── 001_缠枝莲纹/
    │       ├── 001_缠枝莲纹_卡片图.png     # 1086×1448 PNG 卡片图
    │       ├── 001_缠枝莲纹_meta.json     # 单款纹样元数据
    │       └── 001_缠枝莲纹_详情页.md     # 详尽的 Markdown 纹样解析
    └── ...
```

### 6.2 扩充新纹样流程
1. 在 `patterns/` 对应的分类目录下创建新纹样文件夹 `{id}_{中文名}`。
2. 放入高清卡片图 `{id}_{中文名}_卡片图.png`。
3. 编写 `{id}_{中文名}_详情页.md`（包含构成、寓意、配色建议、现代应用等标准段落）。
4. 生成 `{id}_{中文名}_meta.json` 并同步将条目追加至 `data/patterns.json`。
5. 重启 FastAPI 服务或调用重新加载，接口将自动识别并更新分类与检索索引。

---

## 7. 常见问题与排查 (Troubleshooting)

### Q1: 节点检索时提示「纹样检索服务未启动」
- **排查**：检查 8102 端口是否正常监听：
  ```bash
  ss -tulnp | grep 8102
  curl http://127.0.0.1:8102/health
  ```
- **解决**：根据第 3 节说明启动微服务。

### Q2: 端口 8102 被占用
- **修改端口**：启动时指定新端口（例如 `8109`）：
  ```bash
  uvicorn api:app --host 0.0.0.0 --port 8109
  ```
- 并在 `backend-ts/.env` 中更新 `PATTERNS_API=http://127.0.0.1:8109` 后重启 `backend-ts`。

### Q3: 纹样详情 Markdown 读取为空
- **排查**：检查 `data/patterns.json` 中的 `detail_page` 相对路径是否与文件系统中的实际文件名完全一致（包含中文字符与下划线）。
