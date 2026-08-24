# BookForge 生产部署与运维最佳实践（Ubuntu，TypeScript 后端）

本文档记录 BookForge（书海回响素材工坊）在 Ubuntu 服务器上的生产部署、启动与运维的完整最佳实践，汇总了真实部署过程中踩过的坑与对应的根治方案，避免每次重新部署重复排障。

> 项目当前已部署于 `10.40.92.18`，后端端口 `8010`，前端端口 `5180`。
> 后端已由 Python（FastAPI/uvicorn）迁移为 **TypeScript（Fastify + Drizzle + better-sqlite3 + AI SDK，目录 `backend-ts/`）**，主后端**不再需要 Python / venv / pip / uvicorn / Alembic**。
> **例外**：以下功能依赖独立的 Python（FastAPI）微服务，需 Python ≥ 3.11，仅当使用对应功能时才需要启动（服务总览见「第 13 节」，部署运维见 `docs/fastapi_services_deploy.md`）：
> - **地图海报节点**：`services/maptoposter/`（端口 8100）
> - **艺术地图生成节点**：`services/prettymaps/`（端口 8101）
> - **中国传统纹样检索节点**：`services/chinese-traditional-patterns/`（端口 8102）
> - **中国传统配色节点**：`services/zhongguo-traditional-colors/`（端口 8103）

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

## 13. FastAPI 微服务（Python 附属服务）

项目包含 **4 个独立 Python 微服务**，由 `backend-ts` 按端口代理调用，systemd 托管自启动：

| 服务 | 端口 | systemd 单元 | 后端环境变量 |
|------|------|--------------|--------------|
| maptoposter（地图海报） | 8100 | `bookforge-maptoposter` | `MAPTOPoster_API` |
| prettymaps（艺术地图生成） | 8101 | `bookforge-prettymaps` | `PRETTYMAPS_API` |
| chinese-traditional-patterns（纹样检索） | 8102 | `chinese-traditional-patterns` | `PATTERNS_API` |
| zhongguo-traditional-colors（传统配色） | 8103 | `zhongguo-traditional-colors` | `COLORS_API` |

> 仅当使用对应画布节点功能时才必须启动；未启动不影响其余功能。
>
> **首次部署、增量升级、排障 FAQ 见独立文档 [`docs/fastapi_services_deploy.md`](./fastapi_services_deploy.md)**（含每服务独立 venv 隔离方案与已知依赖坑）。

---

## 14. 字体部署与最佳实践

项目内置 **24 款本地中文字体**（含上图东观体、又又意宋、汇文明朝体、寒蝉活宋体/仿宋、仓耳玉楷、青柳隶书等，合计约 159 MB），全部已转换为 `.woff2` 格式存放于 `frontend/public/fonts/`。字体通过 `@font-face` 声明（`frontend/src/index.css`）以 `local()` 优先 + `url()` 回退的方式加载，确保已安装字体的客户端零延迟渲染，未安装的客户端从服务器下载字体文件。

同时，后端 Canvas 导出（手账合成、借书卡渲染等）依赖系统字体，因此**部署服务器也需安装这些字体**。

### 14.1 Server-Side Rendering 为何需要系统字体

后端渲染（如 `composeJournalPage`、`libraryCardRenderer`）使用 `node-canvas` 或浏览器 Canvas API 在服务端生成图片。这些 API 依赖操作系统字体注册表，**不会**加载 CSS `@font-face`。因此：

- 已安装字体 → Canvas 正确渲染
- 未安装字体 → Canvas 降级到后备字体（如 `Noto Serif SC`），字形与预览不一致

### 14.2 在 Ubuntu 上安装字体

> **重要**：仓库 `frontend/public/fonts/` 只保留 `.woff2`（Web 分发用）。系统字体注册表（fontconfig / node-canvas）**不支持 woff2**，服务器安装需使用原始 `.ttf` / `.otf` 文件——它们已从仓库移除，需从字体官方发布渠道另行获取，或从旧部署备份恢复。
>
> 本机（10.40.92.18）已完成安装：`.otf` 位于 `/usr/share/fonts/opentype/bookforge/`，`.ttf` 位于 `/usr/share/fonts/truetype/bookforge/`。

取得原始 ttf/otf 文件后，执行：

```bash
sudo mkdir -p /usr/share/fonts/opentype/bookforge
sudo mkdir -p /usr/share/fonts/truetype/bookforge

# 按格式分别拷贝（示例）
sudo cp 汇文明朝体.otf ChillHuoSong_F_*.otf ... /usr/share/fonts/opentype/bookforge/
sudo cp 上图东观体-*.ttf 又又意宋.ttf ... /usr/share/fonts/truetype/bookforge/

# 刷新字体缓存
sudo fc-cache -fv

# 验证安装（期望列出 24 条 bookforge 目录下的记录）
fc-list | grep bookforge | wc -l   # 24
```

> 字体文件较大，`git clone` / `git pull` 时注意网络耗时。如使用 CI/CD 流水线，可考虑单独管理字体文件，避免每次构建重复下载。

### 14.3 字体文件 woff2 优化（已完成）

**本项目已完成全部 24 款字体的 woff2 转换**（体积从约 360 MB 缩至约 159 MB，缩小约 56%），`@font-face` 已全部指向 `.woff2`，原始 `.ttf` / `.otf` 已从仓库删除。以下步骤仅在未来新增字体时需要：

```bash
# 安装转换工具（Ubuntu）
sudo apt install -y woff2

# 逐个转换（在源 ttf/otf 所在目录执行，产物为同名 .woff2）
woff2_compress 字体文件.ttf

# 转换后将 .woff2 放入 frontend/public/fonts/ 并提交 git，
# 同时更新 frontend/src/index.css 中对应 @font-face：
#   url('/fonts/xxx.woff2') format('woff2')
```

> 新增字体时保留原始 ttf/otf 一份用于服务器系统安装（见 14.2），转换完成后即可从工作目录删除。

### 14.4 Git LFS 管理大字体文件（推荐）

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

### 14.5 字体加载性能优化

- **`font-display: swap`**：已启用，确保字体加载期间文本以后备字体立即显示，避免 FOIT（Flash of Invisible Text）。
- **`local()` 优先**：已安装字体的客户端零延迟，不触发网络请求。
- **预加载提示**：如需进一步优化，可在 `index.html` 的 `<head>` 中添加 `<link rel="preload">` 提示浏览器尽早加载字体文件：

```html
<link rel="preload" href="/fonts/上图东观体-常规.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/又又意宋.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/汇文明朝体.woff2" as="font" type="font/woff2" crossorigin>
```

> 注意：`preload` 仅对网络加载生效，已安装字体的客户端不受影响。且只有转换为 `.woff2` 后才有意义，原始 `.ttf` 文件过大不推荐 preload。

### 14.6 增量代码更新时的字体处理

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

### 14.7 验证字体正确渲染

```bash
# 1. 验证前端字体文件可访问
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5180/fonts/上图东观体-常规.woff2
# 期望 200

# 2. 验证后端 Canvas 渲染可用字体
# 启动后端后，通过 API 触发生成手账或借书卡，观察输出图片中的文字字形是否正确

# 3. 浏览器验证（开发机访问）
# 打开 F12 → Network 标签，确认字体请求状态：
#   - 已安装字体：无网络请求（local() 命中）
#   - 未安装字体：200 从服务器加载字体文件
# 打开 F12 → Console，确认无字体加载 warning
```
