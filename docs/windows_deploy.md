# Windows 部署与启动指南（Win11 64 位）

本文档记录 BookForge 在 Windows（Win11 64 位）环境下从零启动的完整步骤，以及实际踩坑后总结的兼容性修复，便于后续在同一类环境快速复现。

> 适用环境：Windows 11 64 位、Python 3.13.x、Node.js 25.x、npm 11.x
> 已知结论：项目本身代码无需改动，**仅需补齐两个第三方依赖的 Windows/Python 3.13 兼容问题**即可正常启动。

---

## 1. 环境前置要求

- **Python** ≥ 3.11（已在 3.13.9 验证）
- **Node.js** ≥ 18（已在 v25.2.0 验证）
- **Git**（用于拉取仓库与潜在迁移）

检查命令：

```powershell
python --version
node --version
npm --version
```

---

## 2. 后端启动

### 2.1 创建虚拟环境并安装依赖

```powershell
cd backend

# 创建虚拟环境（Windows 激活脚本在 .venv\Scripts\）
python -m venv .venv
.\.venv\Scripts\Activate.ps1

pip install -r requirements.txt
```

> 说明：`pip install` 结束后若看到 `pip is available ...` 提示，属于 pip 自身升级提醒，**不是错误**，依赖已安装完成。

### 2.2 Windows / Python 3.13 必做的两项兼容修复（关键）

直接按 README 启动会在 Windows + Python 3.13 下崩溃，需先执行以下修复（已写入 `requirements.txt` 之外的系统级补充，建议每次新环境都执行）：

```powershell
# 修复 1：Python 3.13 移除了内置 IANA 时区数据，Asia/Shanghai 需要 tzdata 包
pip install tzdata

# 修复 2：bcrypt 5.0 与 passlib 在 Python 3.13 不兼容（见下方“踩坑记录”）
pip install "bcrypt==4.0.1"
```

> 若 `requirements.txt` 已锁定 `bcrypt>=5`，请将 `bcrypt` 版本约束改为 `bcrypt==4.0.1` 后再安装，避免被升级回去。

### 2.3 配置环境变量

```powershell
cp .env.example .env
# 编辑 .env，至少设置 SECRET_KEY（可用任意随机字符串）
```

### 2.4 启动后端

```powershell
# 开发模式（建议加 -u 避免日志缓冲导致看不到启动进度）
$env:PYTHONPATH="."
python -u -m uvicorn app.main:app --reload --port 8000
```

- 启动成功标志：`INFO: Application startup complete`
- 首次启动会自动执行 Alembic 迁移建表，并创建默认管理员 **admin / admin123**（登录后请尽快修改）
- 交互式文档：http://localhost:8000/docs

---

## 3. 前端启动

```powershell
cd frontend
npm install
npm run dev -- --port 5173
```

- 启动成功标志：`VITE ready in ...` + `Local: http://localhost:5173/`
- Vite 自动将 `/api` 与 `/static` 代理转发到 `http://localhost:8000`
- 出现的 `__dirname` 警告无害（Vite 未来版本提示），不影响运行

---

## 4. 验证服务

```powershell
# 后端根路径
(Invoke-RestMethod http://127.0.0.1:8000/).message
# 期望输出：Welcome to BookForge API

# 后端文档
(Invoke-WebRequest http://127.0.0.1:8000/docs -UseBasicParsing).StatusCode
# 期望：200

# 前端
(Invoke-WebRequest http://127.0.0.1:5173/ -UseBasicParsing).StatusCode
# 期望：200
```

---

## 5. 后台常驻运行（可选）

普通终端窗口关闭即停止服务。如需常驻，可用以下任一种方式：

**方式 A：PowerShell 后台作业（当前会话内）**

```powershell
# 后端
Start-Process -FilePath "python" -ArgumentList "-u","-m","uvicorn","app.main:app","--reload","--port","8000" -WorkingDirectory "$PWD\backend" -RedirectStandardOutput "$env:TEMP\uv_out.log" -RedirectStandardError "$env:TEMP\uv_err.log"

# 前端
Start-Process -FilePath "npm" -ArgumentList "run","dev","--","--port","5173" -WorkingDirectory "$PWD\frontend"
```

**方式 B：使用进程管理器（如 supervisor / nssm / Windows 任务计划程序）**，适合生产或长期开发机。

---

## 6. 踩坑记录（FIRST-RUN 必读）

### 坑 1：缺少 `tzdata` → `ZoneInfoNotFoundError: 'No time zone found with key Asia/Shanghai'`

- **根因**：`app/core/timeutils.py` 使用 `ZoneInfo("Asia/Shanghai")`。Python 3.9+ 的 `zoneinfo` 在 **Windows** 上需要独立的 `tzdata` 包提供时区数据；Linux 通常内置，Windows 没有。
- **现象**：后端启动即报 `ZoneInfoNotFoundError`，进程退出。
- **修复**：`pip install tzdata`

### 坑 2：passlib + bcrypt 5.0 崩溃 → `ValueError: password cannot be longer than 72 bytes`

- **根因**：后端 `lifespan` 启动时会用 `passlib` 的 `bcrypt` 创建默认管理员账号。bcrypt **5.0** 在 Python 3.13 上加载 backend 时即抛错（内部 `detect_wrap_bug` 触发 72 字节限制校验），导致 uvicorn 在 `Application startup complete` 前异常退出，**且错误信息被日志缓冲吞掉，仅能看到卡在 Alembic migration 阶段**。
- **现象**：进程在 `Waiting for application startup` 后静默退出，端口连不通。
- **修复**：降级到兼容版本 `pip install "bcrypt==4.0.1"`
- **排查技巧**：用 `python -u -c "from app.core.security import get_password_hash; get_password_hash('admin123')"` 可独立复现并暴露真实错误，绕开 uvicorn 日志缓冲。

### 坑 3：日志缓冲导致误判“卡死”

- **根因**：PowerShell 管道 + uvicorn 子进程输出缓冲，使 `Running upgrade` / `Application startup complete` 等日志看不到，误以为卡在 migration。
- **缓解**：启动命令加 `-u`（无缓冲 Python），或把日志重定向到文件（`RedirectStandardOutput/Error`）再 `Get-Content` 查看。

---

## 7. 一键快速清单（新机器复制粘贴）

```powershell
# 后端
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install tzdata
pip install "bcrypt==4.0.1"
cp .env.example .env
$env:PYTHONPATH="."
python -u -m uvicorn app.main:app --reload --port 8000

# 前端（另开终端）
cd frontend
npm install
npm run dev -- --port 5173
```
