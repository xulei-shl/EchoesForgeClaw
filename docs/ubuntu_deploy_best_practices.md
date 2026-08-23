# BookForge 生产部署与运维最佳实践（Ubuntu，TypeScript 后端）

本文档记录 BookForge（书海回响素材工坊）在 Ubuntu 服务器上的生产部署、启动与运维的完整最佳实践，汇总了真实部署过程中踩过的坑与对应的根治方案，避免每次重新部署重复排障。

> 项目当前已部署于 `10.40.92.18`，后端端口 `8010`，前端端口 `5180`。
> 后端已由 Python（FastAPI/uvicorn）迁移为 **TypeScript（Fastify + Drizzle + better-sqlite3 + AI SDK，目录 `backend-ts/`）**，主后端**不再需要 Python / venv / pip / uvicorn / Alembic**。
> **例外**：以下两个功能依赖独立的 Python 微服务，需 Python ≥ 3.11，仅当使用对应功能时才需要启动：
> - **地图海报节点**（`frontend/src/modules/multimodal`）：代码位于 `services/maptoposter/`，部署方式见「第 13 节」。
> - **中国传统纹样检索节点**（画布节点 `PatternSearchNode`）：代码位于 `services/chinese-traditional-patterns/`，部署方式见「第 14 节」。

---

## 1. 架构概览

| 组件 | 技术 | 生产运行方式 |
|------|------|--------------|
| 后端 | Node.js 22.9+ · Fastify 5 · Drizzle · better-sqlite3 · AI SDK | `npm run start`（tsx 直跑 TS），systemd 托管 |
| 前端 | React 19 · Vite · TS | `npm run build` 产物 + `vite preview`，systemd 托管 |
| 数据库 | SQLite（默认文件 `backend-ts/bookforge.db`） | 后端启动时**幂等建表**（表缺失才创建，无需迁移工具） |
| 通信 | REST + SSE（AI SDK UI Message Stream） | 前端 Vite 代理 `/api`、`/static` 到后端 |

---

## 2. 环境准备

### 2.1 必需软件

```bash
# Node.js >= 22.9（本机使用 nvm，v22.23.1）
# 使用 nvm 安装：curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 22
nvm use 22

# 防火墙
sudo apt install -y ufw
```

> `backend-ts` 的启动脚本使用 `--env-file-if-exists` 加载 `.env`，需 Node ≥ 22.9；`better-sqlite3` 为原生模块，Node 版本尽量保持 LTS（22/24），切换大版本后需重新 `npm install`。

### 2.2 端口占用的先验检查（重要）

> 部署前**必须**确认新端口未被占用，且从未在 ufw 放行过。已占用端口会导致绑定失败或 502。

```bash
# 查看当前监听端口
ss -tuln

# 确认目标端口空闲
ss -tuln | grep -E ':(8000|5173|8010|5180|8100|8102)\b' || echo "端口空闲"
```

本项目默认端口存在冲突风险，因此生产环境使用**自定义端口**：后端 `8010`、前端 `5180`（均需确认空闲）。

---

## 3. 代码层面的必要约定（部署前了解）

以下约定已在源码中完成，重新部署**不要**回退这些改动。

### 3.1 后端 npm scripts 自动加载 `.env`

`backend-ts/package.json` 的 `start` / `dev` 脚本带 `--env-file-if-exists=.env`（tsx 转发 Node flag），启动时自动读取 `backend-ts/.env`，无需手动 export。要求 Node ≥ 22.9。

### 3.2 端口与 CORS 全部由 `.env` 管理（不再改代码）

- 后端端口：`backend-ts/.env` 的 `PORT`（默认 8010）；
- CORS 来源：`CORS_ORIGINS`（默认 `http://localhost:5173,http://localhost:5180`），前端端口变更时同步写入；
- 前端代理：`frontend/vite.config.ts` 的 `/api`、`/static` target 指向后端端口（一键脚本自动同步）。

### 3.3 数据库

- 默认 `DATABASE_URL=sqlite:///./bookforge.db`，按 systemd `WorkingDirectory`（`backend-ts/`）解析为 `backend-ts/bookforge.db`；
- **存量 Python 数据迁移**：表结构与旧库一致（已验证可直接读取）。若需复用旧数据，设 `DATABASE_URL=sqlite:///../backend/bookforge.db`，或把旧 `backend/bookforge.db` 拷贝到 `backend-ts/` 下；
- 启动时**幂等建表**：`users` 表不存在才执行建表 DDL（对应旧版 Alembic 迁移），**无需任何迁移工具 / 手工建表**。

---

## 4. 后端部署步骤

```bash
cd /opt/EchoesForgeClaw/backend-ts

# 1. 安装依赖（含 better-sqlite3 原生模块的预编译二进制）
npm install

# 2. 创建 .env（至少需 SECRET_KEY；管理员账号密码；端口/CORS）
cp .env.example .env

# 生成随机 SECRET_KEY：
node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'
```

`backend-ts/.env` 内容：

```ini
SECRET_KEY=<随机 64 位 hex>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<你的强密码>
PORT=8010
CORS_ORIGINS=http://localhost:5180,http://localhost:5173
# DATABASE_URL=sqlite:///./bookforge.db        # 默认；存量数据迁移见 3.3
# OPENAI_API_KEY=                              # 文本模型 Key（无 Key 时 Mock）
# OPENAI_IMAGE_API_KEY=                        # 图像生成 Key（无 Key 时占位图）
# BIFROST_USERNAME= / BIFROST_PASSWORD=        # Bifrost 管理 API Basic Auth（种子化到系统设置）
```

> 表结构、默认管理员、默认设置、默认提示词均在首次启动时由后端自动创建（幂等），无需手工建表。

---

## 5. 前端部署步骤

```bash
cd /opt/EchoesForgeClaw/frontend

npm install
npm run build        # 类型检查 + 生产构建，产物输出到 dist/
```

> `vite preview` 会复用 `vite.config.ts` 中的代理配置，因此 `dist/` 的直接服务即可代理 `/api` 到后端。

### 5.1 代码更新后重新部署（增量更新）

Git 拉取新代码后，按"最小可用"原则重新部署，**无需重装依赖**：

```bash
cd /opt/EchoesForgeClaw
git pull

# 后端：重启即触发幂等建表（表缺失才创建；新增表无需手工处理）
sudo systemctl restart bookforge-backend

# 前端：只要前端源码有改动，必须重建 dist，否则部署的是旧逻辑
cd frontend && npm run build && cd ..
sudo systemctl restart bookforge-frontend
```

要点：

- **新增/变更数据库表无需手工建表**：后端启动时自动执行幂等建表（见 `backend-ts/src/config/database.ts` 的 `applyInitialSchema`）。
- **前端改动必须 `npm run build`**：`vite preview` 只服务 `dist/`，不编译源码；漏构建会把旧页面当作最新逻辑部署。
- **后端依赖一般不用重装**：除非 `backend-ts/package.json` 或 Node 版本有变动（`better-sqlite3` 原生模块对 Node 版本敏感，切换 Node 大版本后必须 `npm install`）。

---

## 6. Systemd 服务（开机自启 + 崩溃自愈）

### 6.1 后端 `/etc/systemd/system/bookforge-backend.service`

```ini
[Unit]
Description=BookForge Backend (TypeScript/Fastify)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/EchoesForgeClaw/backend-ts
EnvironmentFile=/opt/EchoesForgeClaw/backend-ts/.env
ExecStart=/root/.nvm/versions/node/v22.23.1/bin/npm run start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

> - `WorkingDirectory` **必须**设为 `backend-ts` 目录：`src/` 模块解析、相对路径 `.env`、`bookforge.db`（默认 `DATABASE_URL`）都以此为基准。
> - `EnvironmentFile` 指向 `backend-ts/.env`：systemd 注入的环境变量优先于 `.env` 文件，二者内容一致时无冲突。
> - `ExecStart` 中的 node/npm 路径需替换为服务器实际的 nvm 路径（`which npm` 查看）。也可改为 `ExecStart=/usr/bin/npm run start`。

### 6.2 前端 `/etc/systemd/system/bookforge-frontend.service`

```ini
[Unit]
Description=BookForge Frontend (Vite Preview)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/EchoesForgeClaw/frontend
ExecStart=/root/.nvm/versions/node/v22.23.1/bin/npm run preview -- --host 0.0.0.0 --port 5180
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

> `ExecStart` 中的 node 路径需替换为服务器实际的 nvm 路径（`which node` 查看）。也可改为 `ExecStart=/usr/bin/npm ...`。

### 6.3 启用并启动

```bash
sudo systemctl daemon-reload
sudo systemctl enable bookforge-backend bookforge-frontend
sudo systemctl start bookforge-backend bookforge-frontend
```

---

## 7. 防火墙放行（局域网访问）

```bash
sudo ufw allow 8010/tcp comment 'BookForge Backend'
sudo ufw allow 5180/tcp comment 'BookForge Frontend'
sudo ufw reload
sudo ufw status
```

---

## 8. 启动验证

```bash
# 服务状态
systemctl is-active bookforge-backend bookforge-frontend   # 期望 active active

# 后端根路径
curl -s http://localhost:8010/
# {"message":"Welcome to BookForge API (TypeScript)"}

# 健康检查（部署探针）
curl -s http://localhost:8010/health
# {"status":"ok","project":"BookForge"}

# 登录接口（验证管理员账号与 JWT）
curl -s -X POST http://localhost:8010/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<你的密码>"}'
# 返回 token 与 user 即成功

# 前端页面
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5180/   # 200

# 前端代理到后端是否打通（应返回 JSON 而非 502）
curl -s -X POST http://localhost:5180/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<你的密码>"}' | head -c 100
```

---

## 9. 运维命令速查

```bash
# 查看状态
systemctl status bookforge-backend bookforge-frontend

# 查看实时日志
journalctl -u bookforge-backend -f
journalctl -u bookforge-frontend -f

# 查看最近日志
journalctl -u bookforge-backend -n 50

# 重启
sudo systemctl restart bookforge-backend bookforge-frontend

# 停止 / 禁用自启
sudo systemctl stop bookforge-backend bookforge-frontend
sudo systemctl disable bookforge-backend bookforge-frontend
```

---

## 10. 常见问题排查（FAQ）

### 10.1 后端启动即崩溃（exit-code 3 / 4）
**排查**：查看日志确认具体错误。
```bash
journalctl -u bookforge-backend -n 50
```
常见原因：
- `WorkingDirectory` 错误 → 找不到 `src/server.ts` / `.env` / `bookforge.db`
- Node 版本过低（< 22.9）→ `--env-file-if-exists` 不被支持，`npm run start` 直接报错 → 升级 Node 并重装依赖
- `better-sqlite3` 原生模块缺失/版本不匹配（切换 Node 版本后未重装）→ 在 `backend-ts` 下 `npm install` 重新拉取预编译二进制
- 端口被占用 → 换端口并同步（见 10.5）

### 10.2 前端打不开 / 502 Bad Gateway
**原因**：后端未启动，或前端代理目标端口错误。
**排查**：
```bash
systemctl is-active bookforge-backend      # 必须 active
ss -tuln | grep 8010                       # 后端必须监听
cat backend-ts/.env | grep PORT            # 必须与前端代理 target 一致（8010）
cat frontend/vite.config.ts                # target 必须为 8010
```

### 10.3 登录 401 / 管理员密码不对
**原因**：`.env` 中 `ADMIN_PASSWORD` 与种子创建时不一致（首次启动后修改 `.env` 不会回写已建库）。
**解决**：部署前先写好 `.env` 再首次启动；或删除数据库重建（见 10.4）。

### 10.4 数据库被破坏 / 需要重置
删除数据库文件后重启服务，后端会自动重建全部表并重建管理员：
```bash
sudo systemctl stop bookforge-backend
rm -f /opt/EchoesForgeClaw/backend-ts/bookforge.db
sudo systemctl start bookforge-backend
```

### 10.5 修改端口后需要同步改动
修改端口时，以下 4 处**必须**同步：
1. `backend-ts/.env` 的 `PORT`（后端监听）
2. `backend-ts/.env` 的 `CORS_ORIGINS`（前端来源，若改的是前端端口）
3. `frontend/vite.config.ts` 的代理 `target`（后端端口；一键脚本会自动同步）
4. `ufw` 放行新端口（systemd 服务无硬编码端口，无需改）

### 10.6 代码更新后新增的数据库表未生效
**原因**：只重启了服务但忘了处理迁移，或误以为需要手动建表。
**解决**：本项目**无需手动建表、无需迁移工具**。后端每次启动都会执行幂等建表（`backend-ts/src/config/database.ts` 的 `applyInitialSchema`，`users` 表缺失时才建）。只需 `sudo systemctl restart bookforge-backend` 即可。若仍缺表，查看日志确认建表是否报错：`journalctl -u bookforge-backend -n 50`。

### 10.7 从旧 Python 后端迁移存量数据
- **直接复用**：`backend-ts/.env` 设 `DATABASE_URL=sqlite:///../backend/bookforge.db`（相对 `backend-ts/` 解析到旧库），表结构一致，已验证可读；
- **拷贝**：`cp /opt/EchoesForgeClaw/backend/bookforge.db /opt/EchoesForgeClaw/backend-ts/`；
- 迁移后首次启动会幂等补建缺失表（如有），并保留已有用户/生成记录/收藏。

---

## 11. 一键部署脚本

为减少重复排障，提供一键部署/启动脚本 `scripts/deploy.sh`（见仓库根目录），完成：

- 环境自检（node ≥ 22.9 / npm / ss / ufw）
- 端口自动选型
- 依赖安装（`npm install`；默认仅首次 `--install` 或 `node_modules` 缺失时安装）
- `.env` 自动生成（随机 `SECRET_KEY`、`PORT`、`CORS_ORIGINS`；管理员密码**仅在未设置时**写入，避免每次部署覆盖已有密码）
- **每次都执行前端生产构建 `npm run build`**（修复点：旧版仅在 `--install` 时构建，导致代码更新后部署了旧前端）
- 后端重启时自动幂等建表（表缺失才创建，无需迁移工具，见 5.1）
- 重启前自动备份 SQLite 数据库（读取 `backend-ts/.env` 的 `DATABASE_URL`，cp 快照，保留最近 5 份）
- systemd 服务生成与启动（后端 `EnvironmentFile` + `npm run start`）、ufw 放行、启动自检

```bash
# 首次部署（安装依赖 + 构建 + 启动）
sudo bash scripts/deploy.sh --install

# 代码更新后重新部署（跳过依赖安装，但前端仍会重新构建）
sudo bash scripts/deploy.sh
```

> 脚本幂等，可重复执行。无 `--install` 时只重建前端并重启服务，适合日常增量更新。

---

## 12. 安全与配置注意

- `.env` 含 `SECRET_KEY` 与管理员密码，**不要提交到 git**（`backend-ts/.gitignore` 已忽略 `.env` 与 `*.db`）。
- 生产环境建议将 `SECRET_KEY` 换成随机值，避免使用默认值（`scripts/deploy.sh` 会自动生成）。
- 管理员账号首次创建后请勿在代码中硬编码，全部通过 `.env` 管理。

---

## 13. 地图海报 Python 服务（地图海报节点依赖）

地图海报节点依赖一个独立的 Python 微服务（`services/maptoposter/`）生成艺术风格地图海报。它**不属于** Node.js 后端，需单独用 Python 启动，并由 `backend-ts` 通过环境变量 `MAPTOPoster_API`（默认 `http://127.0.0.1:8100`）代理调用。代码由 git 管理，部署时随 `git pull` 一同拉取到 `/opt/EchoesForgeClaw/services/maptoposter`。

> 仅当需要使用「地图海报」功能时才需要该服务；不启动它时，点击生成会报 `Python API not running`，其余功能不受影响。

### 13.1 安装依赖（首次）

```bash
cd /opt/EchoesForgeClaw/services/maptoposter
pip install -r requirements.txt
```

> 需要 Python ≥ 3.11。首次运行会自动安装依赖并下载 Roboto 字体。

### 13.2 手动启动（验证用）

```bash
cd /opt/EchoesForgeClaw/services/maptoposter
uvicorn api:app --host 0.0.0.0 --port 8100
```

- 启动成功标志：`Uvicorn running on http://0.0.0.0:8100`
- 健康检查：`curl -s http://localhost:8100/health` → `{"status":"ok"}`

### 13.3 Systemd 服务（推荐，开机自启 + 崩溃自愈）

`/etc/systemd/system/bookforge-maptoposter.service`：

```ini
[Unit]
Description=BookForge Map Poster Python Service (maptoposter)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/EchoesForgeClaw/services/maptoposter
ExecStart=/usr/bin/uvicorn api:app --host 0.0.0.0 --port 8100
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

> `ExecStart` 中的 `uvicorn` 路径用 `which uvicorn` 确认（虚拟环境下替换为对应绝对路径）。

启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable bookforge-maptoposter
sudo systemctl start bookforge-maptoposter
systemctl is-active bookforge-maptoposter   # 期望 active
```

### 13.4 端口与集成

- 端口固定 **8100**，与 `backend-ts` 的 `MAPTOPoster_API` 默认值（`backend-ts/src/modules/bookplate/routes/map-poster.ts`）一致；**同机部署无需额外配置**即可被后端代理。
- 跨机部署时，在 `backend-ts/.env` 设置 `MAPTOPoster_API=http://<maptoposter-host>:8100` 并随 `backend-ts` 服务读取生效。

---

## 14. 中国传统纹样检索 Python 服务（纹样检索节点依赖）

画布节点「中国传统纹样检索」（`PatternSearchNode`）依赖一个独立的 Python（FastAPI/Uvicorn）微服务，提供纹样检索、详情读取与高清卡片原图的静态文件服务。它**不属于** Node.js 后端，需单独用 Python 启动，并由 `backend-ts` 通过环境变量 `PATTERNS_API`（默认 `http://127.0.0.1:8102`）代理调用。代码由 git 管理，部署时随 `git pull` 一同拉取到 `/opt/EchoesForgeClaw/services/chinese-traditional-patterns`。完整规范见仓库 `services/中国传统纹样API.md`。

> 仅当需要使用「中国传统纹样检索」节点时才需要该服务；不启动它时，节点检索会提示「纹样检索服务未启动」，其余功能不受影响。

### 14.1 安装依赖（首次）

```bash
cd /opt/EchoesForgeClaw/services/chinese-traditional-patterns
pip install -r requirements.txt
```

> 需要 Python ≥ 3.10。依赖仅 `fastapi`、`uvicorn`。

### 14.2 手动启动（验证用）

```bash
cd /opt/EchoesForgeClaw/services/chinese-traditional-patterns

# 方式一：直接运行脚本（默认 0.0.0.0:8102）
python api.py

# 方式二：uvicorn（支持热重载）
uvicorn api:app --host 0.0.0.0 --port 8102 --reload
```

- 启动成功标志：`Uvicorn running on http://0.0.0.0:8102`
- 健康检查：`curl -s http://localhost:8102/health` → `{"status":"ok","total_patterns":100}`
- 交互式 API 文档：`http://localhost:8102/docs`

### 14.3 Systemd 服务（推荐，开机自启 + 崩溃自愈）

`/etc/systemd/system/chinese-traditional-patterns.service`：

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
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

> `ExecStart` 中的 `python3` / `uvicorn` 路径用 `which python3` / `which uvicorn` 确认（虚拟环境下替换为对应绝对路径）。

启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable chinese-traditional-patterns
sudo systemctl start chinese-traditional-patterns
systemctl is-active chinese-traditional-patterns   # 期望 active
```

### 14.4 端口与集成

- 端口固定 **8102**，与 `backend-ts` 的 `PATTERNS_API` 默认值（`backend-ts/src/modules/bookplate/routes/pattern-search.ts`）一致；**同机部署无需额外配置**即可被后端代理调用（路由 `/api/modules/bookplate/pattern-search/*`）。
- 跨机部署时，在 `backend-ts/.env` 设置 `PATTERNS_API=http://<patterns-host>:8102` 后重启 `backend-ts` 服务生效。
- 端口冲突：若 8102 被占用，启动时换端口（如 `8109`），并同步 `PATTERNS_API=http://127.0.0.1:8109` 与后端重启。
- 端口冲突：若 8100 被占用（例如同时运行 `docs/fastclaw-dev/plugins/mem0` 的 Mem0 服务，其 `plugin.json` 默认也指向 `127.0.0.1:8100`），需为其中之一换端口，并同步 `MAPTOPoster_API` 或 Mem0 的 `config.url`。

---

## 15. 字体部署与最佳实践

项目使用三款本地中文字体：**上图东观体**、**又又意宋**、**汇文明朝体**。字体通过 `@font-face` 声明（`frontend/src/index.css`）以 `local()` 优先 + `url()` 回退的方式加载，确保已安装字体的客户端零延迟渲染，未安装的客户端从服务器下载字体文件。

同时，后端 Canvas 导出（手账合成、借书卡渲染等）依赖系统字体，因此**部署服务器也需安装这些字体**。

### 15.1 Server-Side Rendering 为何需要系统字体

后端渲染（如 `composeJournalPage`、`libraryCardRenderer`）使用 `node-canvas` 或浏览器 Canvas API 在服务端生成图片。这些 API 依赖操作系统字体注册表，**不会**加载 CSS `@font-face`。因此：

- 已安装字体 → Canvas 正确渲染
- 未安装字体 → Canvas 降级到后备字体（如 `Noto Serif SC`），字形与预览不一致

### 15.2 在 Ubuntu 上安装字体

将字体文件上传到服务器后，执行：

```bash
# 字体文件路径（从仓库复制）
# frontend/public/fonts/上图东观体-常规.ttf
# frontend/public/fonts/上图东观体-粗体.ttf
# frontend/public/fonts/上图东观体-细体.ttf
# frontend/public/fonts/又又意宋.ttf
# frontend/public/fonts/汇文明朝体.otf

# 安装到系统字体目录
sudo mkdir -p /usr/share/fonts/opentype/bookforge
sudo mkdir -p /usr/share/fonts/truetype/bookforge

sudo cp /opt/EchoesForgeClaw/frontend/public/fonts/汇文明朝体.otf /usr/share/fonts/opentype/bookforge/
sudo cp /opt/EchoesForgeClaw/frontend/public/fonts/上图东观体-*.ttf /usr/share/fonts/truetype/bookforge/
sudo cp /opt/EchoesForgeClaw/frontend/public/fonts/又又意宋.ttf /usr/share/fonts/truetype/bookforge/

# 刷新字体缓存
sudo fc-cache -fv

# 验证安装
fc-list | grep -E '上图东观|又又意宋|汇文明朝'
# 期望输出三条匹配记录
```

> 字体文件较大（合计约 89 MB），`git clone` / `git pull` 时注意网络耗时。如果使用 CI/CD 流水线，可考虑单独管理字体文件，避免每次构建重复下载。

### 15.3 字体文件优化（推荐）

原始 `.ttf` / `.otf` 文件未经 Web 优化，建议转换为 `.woff2` 格式以减小体积（可缩小 50-70%）：

```bash
# 安装转换工具（Ubuntu）
sudo apt install -y woff2

# 或使用 npm 包
npm install -g ttf2woff2

# 逐个转换
woff2_compress /opt/EchoesForgeClaw/frontend/public/fonts/上图东观体-常规.ttf
woff2_compress /opt/EchoesForgeClaw/frontend/public/fonts/上图东观体-粗体.ttf
woff2_compress /opt/EchoesForgeClaw/frontend/public/fonts/上图东观体-细体.ttf
woff2_compress /opt/EchoesForgeClaw/frontend/public/fonts/又又意宋.ttf
woff2_compress /opt/EchoesForgeClaw/frontend/public/fonts/汇文明朝体.otf
```

转换后更新 `frontend/src/index.css` 中的 `@font-face` 的 `src` 和 `format`：

```css
/* 示例：转换后更新 url 后缀和 format */
@font-face {
  font-family: '上图东观体';
  src: local('上图东观体 常规'), url('/fonts/上图东观体-常规.woff2') format('woff2');
  font-weight: normal;
  font-display: swap;
}
```

> `.woff2` 文件同样需要放入 `frontend/public/fonts/` 并提交到 git。转换后可删除对应的 `.ttf` / `.otf` 文件以节省仓库空间。

### 15.4 Git LFS 管理大字体文件（推荐）

字体文件较大（单文件 10-30 MB），建议使用 Git LFS 跟踪，避免 `git clone` 拉取所有历史版本时膨胀仓库体积：

```bash
# 安装 Git LFS（Ubuntu）
sudo apt install -y git-lfs

# 在项目根目录初始化
cd /opt/EchoesForgeClaw
git lfs install

# 跟踪字体文件扩展名
git lfs track "*.ttf"
git lfs track "*.otf"
git lfs track "*.woff2"

# 提交 .gitattributes
git add .gitattributes
git commit -m "chore: track font files with Git LFS"
```

> 如果已提交字体文件到 git 历史，需用 `git lfs migrate` 迁移历史。建议在首次提交字体前就配置好 LFS。

### 15.5 字体加载性能优化

- **`font-display: swap`**：已启用，确保字体加载期间文本以后备字体立即显示，避免 FOIT（Flash of Invisible Text）。
- **`local()` 优先**：已安装字体的客户端零延迟，不触发网络请求。
- **预加载提示**：如需进一步优化，可在 `index.html` 的 `<head>` 中添加 `<link rel="preload">` 提示浏览器尽早加载字体文件：

```html
<link rel="preload" href="/fonts/上图东观体-常规.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/又又意宋.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/汇文明朝体.woff2" as="font" type="font/woff2" crossorigin>
```

> 注意：`preload` 仅对网络加载生效，已安装字体的客户端不受影响。且只有转换为 `.woff2` 后才有意义，原始 `.ttf` 文件过大不推荐 preload。

### 15.6 增量代码更新时的字体处理

```bash
cd /opt/EchoesForgeClaw
git pull

# 字体文件变更也需要重新构建前端
cd frontend && npm run build && cd ..
sudo systemctl restart bookforge-frontend

# 字体文件变更后不需要重启后端，但安装/更新系统字体后需要重启涉及 Canvas 渲染的服务
# 如果只是新增/更新了 frontend/public/fonts/ 下的字体文件，只需重建前端即可
# 如果是安装/更新了系统字体，需要重启后端：
sudo systemctl restart bookforge-backend
```

### 15.7 验证字体正确渲染

```bash
# 1. 验证前端字体文件可访问
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5180/fonts/上图东观体-常规.ttf
# 期望 200

# 2. 验证后端 Canvas 渲染可用字体
# 启动后端后，通过 API 触发生成手账或借书卡，观察输出图片中的文字字形是否正确

# 3. 浏览器验证（开发机访问）
# 打开 F12 → Network 标签，确认字体请求状态：
#   - 已安装字体：无网络请求（local() 命中）
#   - 未安装字体：200 从服务器加载字体文件
# 打开 F12 → Console，确认无字体加载 warning
```
