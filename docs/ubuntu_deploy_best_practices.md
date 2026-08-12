# BookForge 生产部署与运维最佳实践（Ubuntu）

本文档记录 BookForge（书海回响素材工坊）在 Ubuntu 服务器上的生产部署、启动与运维的完整最佳实践，汇总了真实部署过程中踩过的坑与对应的根治方案，避免每次重新部署重复排障。

> 项目当前已部署于 `10.40.92.18`，后端端口 `8010`，前端端口 `5180`。

---

## 1. 架构概览

| 组件 | 技术 | 生产运行方式 |
|------|------|--------------|
| 后端 | Python 3.12 · FastAPI · SQLAlchemy · SQLite | `uvicorn`，systemd 托管 |
| 前端 | React 19 · Vite · TS | `npm run build` 产物 + `vite preview`，systemd 托管 |
| 数据库 | SQLite（文件 `backend/bookforge.db`） | 后端启动时 Alembic 自动迁移建表 |
| 通信 | REST + SSE | 前端 Vite 代理 `/api`、`/static` 到后端 |

---

## 2. 环境准备

### 2.1 必需软件

```bash
# Python 3.10+（推荐 3.12）
sudo apt update
sudo apt install -y python3 python3-venv python3-pip

# Node.js 18+（本机使用 nvm，v22.23.1）
# 使用 nvm 安装：curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 22
nvm use 22

# 防火墙
sudo apt install -y ufw
```

### 2.2 端口占用的先验检查（重要）

> 部署前**必须**确认新端口未被占用，且从未在 ufw 放行过。已占用端口会导致绑定失败或 502。

```bash
# 查看当前监听端口
ss -tuln

# 确认目标端口空闲
ss -tuln | grep -E ':(8000|5173|8010|5180)\b' || echo "端口空闲"
```

本项目默认端口存在冲突风险，因为：
- 后端默认 `8000` 常被其他服务占用（本机被 `chroma` 占用）
- 前端默认 `5173` 常被其他服务占用（本机被 `node` 占用）

因此生产环境使用**自定义端口**：后端 `8010`、前端 `5180`（均需确认空闲）。

---

## 3. 代码层面的必要修复（一次性）

以下修复已在源码中完成，重新部署**不要**回退这些改动。

### 3.1 后端 `requirements.txt`：锁定 `bcrypt`

`passlib[bcrypt]` 与 `bcrypt>=4.1` 不兼容（`passlib` 读取 `bcrypt.__about__` 报错，登录时抛 `ValueError: password cannot be longer than 72 bytes`）。必须锁定：

```txt
passlib[bcrypt]
bcrypt==4.0.1
```

### 3.2 后端 `app/core/config.py`：管理员账号可由 `.env` 配置

```python
ADMIN_USERNAME: str = "admin"
ADMIN_PASSWORD: str = "admin123"
```

### 3.3 后端 `app/main.py`：启动初始化使用配置的管理员账号，并导入 `settings`

- 必须 `from app.core.config import settings`
- 创建管理员时使用 `settings.ADMIN_USERNAME` / `settings.ADMIN_PASSWORD`，而非硬编码 `admin/admin123`
- `_startup_init()` 在 FastAPI `lifespan` 中通过 `await asyncio.to_thread(...)` 执行（避免阻塞事件循环、避免 SQLite 死锁）

### 3.4 后端 `app/main.py`：CORS 允许前端生产端口

```python
allow_origins=[
    "http://localhost:5180",
    "http://localhost:5173",
],
```

### 3.5 前端 `vite.config.ts`：代理目标指向后端端口

`server.proxy` 中 `/api` 与 `/static` 的 `target` 改为 `http://localhost:8010`。

---

## 4. 后端部署步骤

```bash
cd /opt/EchoesForgeClaw/backend

# 1. 创建虚拟环境并安装依赖（依赖含 bcrypt 锁定）
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2. 创建 .env（至少需 SECRET_KEY；管理员账号密码）
# 生成随机 SECRET_KEY：
python3 -c "import secrets; print(secrets.token_hex(32))"
```

`backend/.env` 内容：

```ini
SECRET_KEY=<随机 64 位 hex>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<你的强密码>
```

> 数据库表结构、默认管理员、默认设置、默认提示词均在首次启动时由后端自动创建，无需手工建表。

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

# 后端：重启即触发 alembic upgrade head，自动新建/更新表（如本次的 book_cache 表）
sudo systemctl restart bookforge-backend

# 前端：只要前端源码有改动，必须重建 dist，否则部署的是旧逻辑
cd frontend && npm run build && cd ..
sudo systemctl restart bookforge-frontend
```

要点：

- **新增/变更数据库表无需手工建表**：迁移脚本随后端启动时的 `alembic upgrade head` 自动执行（见 `app/main.py` 的 `command.upgrade(alembic_cfg, "head")`）。
- **前端改动必须 `npm run build`**：`vite preview` 只服务 `dist/`，不编译源码；漏构建会把旧页面当作最新逻辑部署（本次提交就改了前端 `BookInfoNode` 等组件）。
- **后端依赖一般不用重装**：除非 `requirements.txt` 有变动（本次提交未改动依赖）。

---

## 6. Systemd 服务（开机自启 + 崩溃自愈）

### 6.1 后端 `/etc/systemd/system/bookforge-backend.service`

```ini
[Unit]
Description=BookForge Backend (FastAPI)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/EchoesForgeClaw/backend
ExecStart=/opt/EchoesForgeClaw/backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8010
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

> `WorkingDirectory` **必须**设为 `backend` 目录，否则 `app` 模块与相对路径 `.env`、`bookforge.db` 找不到。

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
# {"message":"Welcome to BookForge API"}

# 登录接口（验证管理员账号与 bcrypt 修复）
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

### 10.1 登录报 `ValueError: password cannot be longer than 72 bytes`
**原因**：`bcrypt` 版本过新（≥4.1），与 `passlib 1.7.4` 不兼容。
**解决**：`pip install "bcrypt==4.0.1"`，并确保 `requirements.txt` 已锁定。

### 10.2 前端打不开 / 502 Bad Gateway
**原因**：后端未启动，或前端代理目标端口错误。
**排查**：
```bash
systemctl is-active bookforge-backend      # 必须 active
ss -tuln | grep 8010                       # 后端必须监听
cat frontend/vite.config.ts                # target 必须为 8010
```

### 10.3 后端启动即崩溃（exit-code 3）
**排查**：查看日志确认是否 `ModuleNotFoundError` 或绑定失败。
```bash
journalctl -u bookforge-backend -n 50
```
常见原因：
- `WorkingDirectory` 错误 → 找不到 `app` 模块 / `.env` / `bookforge.db`
- 端口被占用 → 换端口并放行

### 10.4 数据库被破坏 / 需要重置
删除数据库文件后重启服务，Alembic 会自动重建全部表并重建管理员：
```bash
sudo systemctl stop bookforge-backend
rm -f /opt/EchoesForgeClaw/backend/bookforge.db
sudo systemctl start bookforge-backend
```

### 10.5 修改端口后需要同步改动
修改端口时，以下 4 处**必须**同步：
1. `backend/app/main.py` 的 CORS `allow_origins`
2. `frontend/vite.config.ts` 的代理 `target`
3. systemd 服务文件的 `ExecStart --port`
4. `ufw` 放行新端口

### 10.6 代码更新后新增的数据库表未生效
**原因**：只重启了服务但忘了处理迁移，或误以为需要手动建表。
**解决**：本项目**无需手动建表**。后端每次启动都会执行 `alembic upgrade head`（`app/main.py`）自动应用迁移脚本（如 `book_cache` 表的 `c4d5e6f7a8b0_create_book_cache_table.py`）。只需 `sudo systemctl restart bookforge-backend` 即可，新表会自动创建。若仍缺表，查看日志确认迁移是否报错：`journalctl -u bookforge-backend -n 50 | grep -i alembic`。

---
## 11. 一键部署脚本

为减少重复排障，提供一键部署/启动脚本 `scripts/deploy.sh`（见本目录），完成：

- 环境自检、端口自动选型
- 依赖安装（含 bcrypt 锁定；默认仅首次 `--install` 或虚拟环境/`node_modules` 缺失时安装）
- `.env` 自动生成（随机 `SECRET_KEY`；管理员密码**仅在未设置时**写入，避免每次部署覆盖已有密码）
- **每次都执行前端生产构建 `npm run build`**（修复点：旧版仅在 `--install` 时构建，导致代码更新后部署了旧前端；`book_cache` 那次更新即因此需手动构建）
- 后端重启时 Alembic 自动迁移建表（详见 5.1）
- systemd 服务生成与启动、ufw 放行、启动自检

```bash
# 首次部署（安装依赖 + 构建 + 启动）
sudo bash scripts/deploy.sh --install

# 代码更新后重新部署（跳过依赖安装，但前端仍会重新构建）
sudo bash scripts/deploy.sh
```

> 脚本幂等，可重复执行。无 `--install` 时只重建前端并重启服务，适合日常增量更新。

---

## 12. 安全与配置注意

- `.env` 含 `SECRET_KEY` 与管理员密码，**不要提交到 git**（`backend/.gitignore` 未忽略 `.env`，需自行确认或补充）。
- 生产环境建议将 `SECRET_KEY` 换成随机值，避免使用默认值。
- 管理员账号首次创建后请勿在代码中硬编码，全部通过 `.env` 管理。