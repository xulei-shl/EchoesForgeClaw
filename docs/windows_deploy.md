# Windows 部署与启动指南（Win11 64 位）

本文档记录 BookForge 在 Windows（Win11 64 位）环境下从零启动的完整步骤。后端已由 Python（FastAPI/uvicorn）迁移为 **TypeScript（Fastify + Drizzle + AI SDK，目录 `backend-ts/`）**，启动方式与依赖要求已随之变化。

> 适用环境：Windows 11 64 位、Node.js ≥ 22.9（已在 v24.13.0 验证）、npm 11.x
> **主后端（backend-ts）不再需要 Python / venv / pip / uvicorn**，启动前仅需准备 Node.js 环境与 `backend-ts/.env`。
> **例外**：地图海报节点（`frontend/src/modules/multimodal`）依赖一个独立的 Python 微服务，代码位于 `services/maptoposter/`，需 Python ≥ 3.11。仅当使用该功能时才需要 Python，详见「第 4 节」。

---

## 1. 环境前置要求

- **Node.js** ≥ 22.9（`backend-ts` 的启动脚本使用 `--env-file-if-exists` 加载 `.env`，依赖此版本；已在本机 v24.13.0 验证）
- **npm**（随 Node.js 安装）
- **Git**（用于拉取仓库与潜在迁移）

检查命令：

```powershell
node --version   # 必须 >= v22.9.0
npm --version
```

> 注意：切换 Node 大版本后，`better-sqlite3` 是原生模块，需重新执行 `npm install` 下载匹配该版本的预编译二进制（见「踩坑记录」坑 3）。

---

## 2. 后端启动

后端位于 `backend-ts/` 目录，直接以 Node.js 运行 TypeScript（tsx 加载器），**无需编译产物**。

### 2.1 安装依赖

```powershell
cd backend-ts
npm install
```

### 2.2 配置环境变量

```powershell
cp .env.example .env
# 编辑 .env：
#  - 必改 SECRET_KEY（任意随机字符串，JWT 签名密钥）
#  - PORT 保持 8010（与前端 Vite 代理 target 一致，改动需同步，见坑 2）
```

`.env` 关键项（`npm run start` 会自动加载，无需手动 export）：

```ini
SECRET_KEY=change-me                # 必改：JWT 签名密钥
PORT=8010                           # 监听端口（前端代理指向 8010）
CORS_ORIGINS=http://localhost:5173,http://localhost:5180
ADMIN_USERNAME=admin                # 首次启动创建的默认管理员
ADMIN_PASSWORD=admin123             # 登录后请尽快修改
# DATABASE_URL=sqlite:///./bookforge.db   # 默认库文件 backend-ts/bookforge.db
# OPENAI_API_KEY=                   # 文本模型 Key（无 Key 时聊天/提示词走 Mock 演示）
# OPENAI_IMAGE_API_KEY=             # 图像生成 Key（无 Key 时生成占位图）
```

### 2.3 启动后端

```powershell
# 开发模式（文件变更自动重启）
npm run dev

# 或普通启动
npm run start
```

- 启动成功标志：`Server listening at http://127.0.0.1:8010`
- 首次启动会自动**幂等建表**（表缺失才创建，对应旧版 Alembic 迁移），并创建默认管理员（用户名取 `.env` 的 `ADMIN_USERNAME`，默认 `admin`；密码取 `ADMIN_PASSWORD`，默认 `admin123`）与默认系统设置、提示词
- 健康检查：http://localhost:8010/health （返回 `{"status":"ok"}`）
- 无 Swagger 文档页（旧版 `/docs` 已移除）；接口契约见 `backend-ts/tests/` 契约测试

> 端口说明：后端统一使用 **8010**（与 `docs/ubuntu_deploy_best_practices.md` 的生产端口保持一致）。前端 Vite 代理（`frontend/vite.config.ts`）的 `/api`、`/static` target 指向 `http://localhost:8010`，两者必须一致，否则 502。
>
> **存量数据复用**：TS 后端默认使用 `backend-ts/bookforge.db`（全新空库）。若需直接复用旧 Python 后端的数据，在 `.env` 中设置 `DATABASE_URL=sqlite:///../backend/bookforge.db`（表结构与旧库一致，已验证可读），或把旧 `backend/bookforge.db` 拷贝到 `backend-ts/` 下。

---

## 3. 前端启动

```powershell
cd frontend
npm install
npm run dev -- --port 5173
```

- 启动成功标志：`VITE ready in ...` + `Local: http://localhost:5173/`
- Vite 自动将 `/api` 与 `/static` 代理转发到 `http://localhost:8010`
- 出现的 `__dirname` 警告无害（Vite 未来版本提示），不影响运行

---

## 4. 地图海报 Python 服务（地图海报节点依赖）

地图海报节点（`frontend/src/modules/multimodal`）依赖一个独立的 Python 微服务生成海报，它**不属于** Node.js 后端，需单独用 Python 启动。代码已迁移至仓库根目录 `services/maptoposter/`（早期版本位于 `docs/多模态工具/地图/maptoposter-main`，现已移走）。

### 4.1 安装依赖（首次）

```powershell
cd services/maptoposter
pip install -r requirements.txt
```

> 首次运行会自动安装依赖并下载 Roboto 字体。需要 Python ≥ 3.11（本机 Python 3.14 已验证）。

### 4.2 启动服务

```powershell
cd services/maptoposter

# 方式一：uvicorn（推荐）
uvicorn api:app --host 0.0.0.0 --port 8100

# 方式二：python 直接运行
python api.py
```

- 启动成功标志：`Uvicorn running on http://0.0.0.0:8100`
- 健康检查：`(Invoke-RestMethod http://127.0.0.1:8100/health).status` → `ok`
- 端口固定 **8100**，与 `backend-ts` 读取的环境变量 `MAPTOPoster_API`（默认 `http://127.0.0.1:8100`，见 `backend-ts/src/modules/bookplate/routes/map-poster.ts`）一致，无需额外配置即可被后端代理调用

### 4.3 后台常驻（PowerShell 作业）

```powershell
Start-Process -FilePath "uvicorn" -ArgumentList "api:app","--host","0.0.0.0","--port","8100" `
  -WorkingDirectory "$PWD\services\maptoposter" `
  -RedirectStandardOutput "$env:TEMP\map_out.log" -RedirectStandardError "$env:TEMP\map_err.log"
```

### 4.4 端口冲突

若 8100 被占用（例如同时运行了 `docs/fastclaw-dev/plugins/mem0` 的 Mem0 服务，其 `plugin.json` 默认也指向 `127.0.0.1:8100`），需为其中之一换端口：改 maptoposter 启动端口时，同步修改 `backend-ts/.env` 的 `MAPTOPoster_API`（如 `http://127.0.0.1:8101`）。

## 5. 验证服务

```powershell
# 后端根路径
(Invoke-RestMethod http://127.0.0.1:8010/).message
# 期望输出：Welcome to BookForge API (TypeScript)

# 后端健康检查
(Invoke-RestMethod http://127.0.0.1:8010/health).status
# 期望：ok

# 登录接口（验证管理员账号与 JWT）
(Invoke-RestMethod -Method Post http://127.0.0.1:8010/api/auth/login -ContentType "application/json" -Body '{"username":"admin","password":"admin123"}').token
# 返回一长串 token 即成功

# 前端
(Invoke-WebRequest http://127.0.0.1:5173/ -UseBasicParsing).StatusCode
# 期望：200
```

---

## 6. 后台常驻运行（可选）

普通终端窗口关闭即停止服务。如需常驻，可用以下任一种方式：

**方式 A：PowerShell 后台作业（当前会话内）**

```powershell
# 后端（node 绝对路径用 where.exe node 查看）
Start-Process -FilePath "node" -ArgumentList "--import","tsx","src/server.ts" -WorkingDirectory "$PWD\backend-ts" -RedirectStandardOutput "$env:TEMP\bk_out.log" -RedirectStandardError "$env:TEMP\bk_err.log"

# 前端
Start-Process -FilePath "npm" -ArgumentList "run","dev","--","--port","5173" -WorkingDirectory "$PWD\frontend"
```

> 注意：`Start-Process -FilePath "node"` 方式不会加载 `.env`（`--env-file-if-exists` 仅存在于 npm scripts）。常驻场景请改用 **方式 B**，或在启动前手动设置 `$env:SECRET_KEY`、`$env:PORT` 等环境变量，或用 `node --env-file=.env --import tsx src/server.ts` 显式加载。

**方式 B：使用进程管理器（如 supervisor / nssm / Windows 任务计划程序）**，适合生产或长期开发机。

---

## 7. 踩坑记录（FIRST-RUN 必读）

### 坑 1：`npm run start` 直接报错 / Node 版本过低

- **现象**：`bad option: --env-file-if-exists` 或启动即退出。
- **根因**：`backend-ts` 的启动脚本用 `tsx --env-file-if-exists=.env` 加载 `.env`，该 flag 需要 **Node ≥ 22.9**；另外 `better-sqlite3` 原生模块对 Node 版本敏感。
- **修复**：安装 Node.js ≥ 22.9（nvm-windows / fnm / 官网安装包均可），然后 `npm install` 重装原生依赖。

### 坑 2：后端起来了但前端 502 Bad Gateway

- **根因**：后端端口与前端 Vite 代理 target 不一致。前端代理固定指向 `http://localhost:8010`，而 `backend-ts` 未配置时默认 `8000`。
- **修复**：确认 `backend-ts/.env` 中 `PORT=8010`（.env.example 已默认），且启动时 `.env` 被加载（`npm run start` 会自动加载；手动 `node src/server.ts` 不会）。

### 坑 3：`npm install` 报 better-sqlite3 编译错误

- **根因**：`better-sqlite3` 是原生模块，当前 Node 版本没有预编译二进制时会走 node-gyp 编译，Windows 上需要 VS Build Tools + Python。
- **修复**：优先安装**官方预编译二进制匹配的 Node LTS 版本**（22.x / 24.x 常见版本均有 prebuild）；确需编译时安装 `python` + `Visual Studio Build Tools`（勾选 C++ 桌面开发）后重试 `npm install`。

### 坑 4：登录 401 / 管理员密码不对

- **根因**：首次启动种子创建管理员时读取 `.env` 的 `ADMIN_PASSWORD`；若 `.env` 未配置则默认 `admin123`。修改 `.env` 后需删除已建库（`backend-ts/bookforge.db`，见坑 5）或手工改库才能生效。
- **修复**：首次部署前先写好 `.env` 再启动。

### 坑 5：数据库被破坏 / 想重置

删除数据库文件后重启，后端会自动重建全部表并重新创建管理员：

```powershell
# 先停服务（若常驻）
# Remove-Item backend-ts\bookforge.db
npm run start
```

---

## 8. 一键快速清单（新机器复制粘贴）

```powershell
# 后端
cd backend-ts
npm install
cp .env.example .env
# 编辑 .env：改 SECRET_KEY（其余保持默认）
npm run start

# 前端（另开终端）
cd frontend
npm install
npm run dev -- --port 5173

# 地图海报 Python 服务（仅使用地图海报节点时需要，另开终端）
cd services/maptoposter
pip install -r requirements.txt
uvicorn api:app --host 0.0.0.0 --port 8100
```
