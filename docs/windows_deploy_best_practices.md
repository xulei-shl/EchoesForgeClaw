# BookForge 生产部署与运维最佳实践（Windows 11）

本文档记录 BookForge（书海回响素材工坊）在 Windows 11 上的部署、启动与运维完整最佳实践，汇总了 Windows 特有的兼容性问题与根治方案。

> 环境：Windows 11 64 位 · Python 3.12 · Node.js 24 · 后端端口 8010 · 前端端口 5173（Vite dev）· 5180（生产预览）

---

## 1. 架构概览

| 组件 | 技术 | 运行方式 |
|------|------|----------|
| 后端 | Python 3.12 · FastAPI · SQLAlchemy · SQLite | `uvicorn`，终端窗口或 Windows 任务计划程序托管 |
| 前端 | React 19 · Vite · TS | `npm run dev`（开发）或 `npm run build` + `vite preview`（生产预览） |
| 数据库 | SQLite（文件 `backend/bookforge.db`） | 后端启动时 Alembic 自动迁移建表 |
| 通信 | REST + SSE | 前端 Vite 代理 `/api`、`/static` 到后端 |

---

## 2. 环境准备

### 2.1 必需软件

```powershell
# Python 3.10+（推荐 3.12，而非 3.13+，避免 bcrypt 兼容问题）
# 从 https://www.python.org/downloads/ 下载安装
python --version

# Node.js 18+（推荐 22 LTS）
# 从 https://nodejs.org/ 下载安装
node --version
npm --version

# Git（可选，用于拉取代码）
git --version
```

### 2.2 端口占用的先验检查

```powershell
# 查看当前监听端口
netstat -ano | findstr "LISTENING"

# 确认目标端口空闲
netstat -ano | findstr ":8010 " ; netstat -ano | findstr ":5180 " ; netstat -ano | findstr ":5173 "
```

> 后端 8000 常被其他服务占用，因此生产环境统一使用 **8010**。前端开发默认 5173，生产预览使用 5180。

---

## 3. 代码层面的必要修复（一次性，已合入源码）

以下修复已在源码中完成，重新部署时**不要**回退。

### 3.1 `requirements.txt`：锁定 `bcrypt`

`passlib[bcrypt]` 与 `bcrypt>=4.1` 不兼容，必须锁定：

```txt
passlib[bcrypt]
bcrypt==4.0.1
```

### 3.2 Windows 特有：`tzdata` 包

Python 的 `zoneinfo` 在 Windows 上缺少内置 IANA 时区数据，必须安装 `tzdata`：

```txt
tzdata
```

> 已写入 `requirements.txt` 或作为补充依赖。若从零安装，需手动 `pip install tzdata`。

### 3.3 `.env` 配置

```ini
SECRET_KEY=<随机 64 位 hex>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<你的强密码>
```

生成随机 SECRET_KEY：

```powershell
python -c "import secrets; print(secrets.token_hex(32))"
```

---

## 4. 后端部署步骤

```powershell
cd F:\Github\EchoesForgeClaw\backend

# 1. 创建虚拟环境（Windows 使用 Scripts\activate）
python -m venv .venv

# 2. 安装依赖
.\.venv\Scripts\pip.exe install -r requirements.txt

# 3. 确保 tzdata 已安装（Windows 必需）
.\.venv\Scripts\pip.exe install tzdata

# 4. 确保 .env 已配置
# 检查 .env 是否存在，若不存在则从 .env.example 复制
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

> 数据库表结构、默认管理员、默认设置、默认提示词均在首次启动时由后端自动创建，无需手工建表。

### 4.1 启动后端

```powershell
# 开发模式（推荐，带热重载）
.\.venv\Scripts\python.exe -u -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8010

# 生产模式（无热重载）
.\.venv\Scripts\python.exe -u -m uvicorn app.main:app --host 0.0.0.0 --port 8010
```

启动成功标志：`INFO:     Application startup complete.`

---

## 5. 前端部署步骤

```powershell
cd F:\Github\EchoesForgeClaw\frontend

# 安装依赖（首次或 node_modules 缺失时）
npm install

# 生产构建（每次前端代码更新后必须执行）
npm run build
```

### 5.1 启动前端

```powershell
# 开发模式（热重载，默认端口 5173）
npm run dev

# 生产预览模式（服务 dist/，建议指定端口 5180）
npm run preview -- --host 0.0.0.0 --port 5180
```

> `vite.config.ts` 已配置 `/api` 和 `/static` 代理到 `http://localhost:8010`，开发模式和生产预览模式均生效。

### 5.2 代码更新后重新部署（增量更新）

```powershell
cd F:\Github\EchoesForgeClaw
git pull

# 后端：重启即可（首次启动自动执行 Alembic 迁移）
# 如果新增了依赖，需重新安装
cd backend
.\.venv\Scripts\pip.exe install -r requirements.txt

# 前端：必须重新构建，否则部署的是旧 dist
cd ..\frontend
npm run build
```

要点：

- **新增/变更数据库表无需手工建表**：迁移脚本随后端启动时的 `alembic upgrade head` 自动执行。
- **前端改动必须 `npm run build`**：`vite preview` 只服务 `dist/`，不编译源码。
- **后端依赖一般不用重装**：除非 `requirements.txt` 有变动。

---

## 6. 后台常驻运行（Windows 无 systemd 的替代方案）

### 6.1 方案 A：PowerShell 后台作业（当前会话内，关闭后失效）

```powershell
# 启动后端
$backendJob = Start-Job -ScriptBlock {
    Set-Location "F:\Github\EchoesForgeClaw\backend"
    .\.venv\Scripts\python.exe -u -m uvicorn app.main:app --host 0.0.0.0 --port 8010
}

# 启动前端
$frontendJob = Start-Job -ScriptBlock {
    Set-Location "F:\Github\EchoesForgeClaw\frontend"
    npm run dev
}

# 查看作业状态
Get-Job

# 停止作业
Stop-Job $backendJob, $frontendJob
Remove-Job $backendJob, $frontendJob
```

### 6.2 方案 B：新建终端窗口（推荐日常开发）

```powershell
# 后端窗口
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "& { Set-Location 'F:\Github\EchoesForgeClaw\backend'; .\.venv\Scripts\python.exe -u -m uvicorn app.main:app --host 0.0.0.0 --port 8010 }"

# 前端窗口
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "& { Set-Location 'F:\Github\EchoesForgeClaw\frontend'; npm run dev }"
```

### 6.3 方案 C：Windows 任务计划程序（开机自启 + 崩溃自愈）

**后端任务**：

```powershell
# 创建后端任务（开机自启，用户登录时运行）
$backendAction = New-ScheduledTaskAction -Execute "F:\Github\EchoesForgeClaw\backend\.venv\Scripts\python.exe" `
    -Argument "-u -m uvicorn app.main:app --host 0.0.0.0 --port 8010" `
    -WorkingDirectory "F:\Github\EchoesForgeClaw\backend"

$backendTrigger = New-ScheduledTaskTrigger -AtStartup
$backendSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName "BookForge-Backend" `
    -Action $backendAction `
    -Trigger $backendTrigger `
    -Settings $backendSettings `
    -RunLevel Highest `
    -User "$env:USERDOMAIN\$env:USERNAME" `
    -Force
```

**前端任务**：

```powershell
$frontendAction = New-ScheduledTaskAction -Execute "npm" `
    -Argument "run dev" `
    -WorkingDirectory "F:\Github\EchoesForgeClaw\frontend"

$frontendTrigger = New-ScheduledTaskTrigger -AtStartup

Register-ScheduledTask -TaskName "BookForge-Frontend" `
    -Action $frontendAction `
    -Trigger $frontendTrigger `
    -Settings $backendSettings `
    -RunLevel Highest `
    -User "$env:USERDOMAIN\$env:USERNAME" `
    -Force
```

> 注意：任务计划程序无法像 systemd 那样精确检测进程崩溃并立即重启，仅支持退出后按间隔重启。

### 6.4 方案 D：nssm（非系统服务管理器，推荐生产环境）

[nssm](https://nssm.cc/) 可将任意程序注册为 Windows 服务，支持崩溃自动重启：

```powershell
# 下载 nssm（https://nssm.cc/download）
# 解压后，注册后端服务
.\nssm.exe install BookForge-Backend "F:\Github\EchoesForgeClaw\backend\.venv\Scripts\python.exe" "-u -m uvicorn app.main:app --host 0.0.0.0 --port 8010"
# 设置 Working Directory：nssm 界面中 在 AppDirectory 填入 F:\Github\EchoesForgeClaw\backend

# 注册前端服务
.\nssm.exe install BookForge-Frontend "F:\Github\EchoesForgeClaw\frontend\node_modules\.bin\vite.cmd" "preview --host 0.0.0.0 --port 5180"
# 设置 AppDirectory 为 F:\Github\EchoesForgeClaw\frontend

# 启动服务
.\nssm.exe start BookForge-Backend
.\nssm.exe start BookForge-Frontend
```

---

## 7. Windows 防火墙放行（局域网访问）

```powershell
# 以管理员身份运行
New-NetFirewallRule -DisplayName "BookForge Backend 8010" `
    -Direction Inbound -Protocol TCP -LocalPort 8010 -Action Allow

New-NetFirewallRule -DisplayName "BookForge Frontend 5180" `
    -Direction Inbound -Protocol TCP -LocalPort 5180 -Action Allow

# 查看已放行规则
Get-NetFirewallRule -DisplayName "BookForge*" | Format-Table DisplayName, Enabled
```

---

## 8. 启动验证

```powershell
# 后端根路径
(Invoke-RestMethod -Uri "http://localhost:8010/").message
# 期望输出：Welcome to BookForge API

# 登录接口（验证管理员账号与 bcrypt）
$body = @{username="admin"; password="<你的密码>"} | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:8010/api/auth/login" `
    -Method POST -Body $body -ContentType "application/json"
# 返回 token 与 user 即成功

# 前端页面
(Invoke-WebRequest -Uri "http://localhost:5173/" -UseBasicParsing).StatusCode
# 期望：200

# 前端代理到后端是否打通
Invoke-RestMethod -Uri "http://localhost:5173/api/auth/login" `
    -Method POST -Body $body -ContentType "application/json"
# 应返回 JSON 而非 502
```

---

## 9. 运维命令速查

```powershell
# 查看进程是否在运行
Get-Process -Name python -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, StartTime
Get-Process -Name node -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, StartTime

# 查看端口监听
netstat -ano | findstr ":8010 "
netstat -ano | findstr ":5173 "
netstat -ano | findstr ":5180 "

# 通过 PID 查看进程
Get-Process -Id <PID>

# 强制终止进程
Stop-Process -Id <PID> -Force

# 任务计划程序管理
Get-ScheduledTask -TaskName "BookForge*" | Start-ScheduledTask
Get-ScheduledTask -TaskName "BookForge*" | Stop-ScheduledTask
Get-ScheduledTask -TaskName "BookForge*" | Disable-ScheduledTask
Get-ScheduledTask -TaskName "BookForge*" | Unregister-ScheduledTask -Confirm:$false

# 查看后端日志（使用后台作业时）
Receive-Job -Name Job1 -Keep
```

---

## 10. 常见问题排查（FAQ）

### 10.1 登录报 `ValueError: password cannot be longer than 72 bytes`

**原因**：`bcrypt` 版本过新（≥4.1），与 `passlib 1.7.4` 不兼容。

**解决**：
```powershell
.\.venv\Scripts\pip.exe install "bcrypt==4.0.1"
```

### 10.2 后端启动报 `ZoneInfoNotFoundError: 'No time zone found with key Asia/Shanghai'`

**原因**：Windows 上 Python 的 `zoneinfo` 缺少内置 IANA 时区数据，这是 Windows 独有的问题（Linux 自带）。

**解决**：
```powershell
.\.venv\Scripts\pip.exe install tzdata
```

### 10.3 后端启动后立即退出，无错误日志

**排查**：日志缓冲可能掩盖了真实错误。使用 `-u` 标志运行 Python 以禁用缓冲：

```powershell
.\.venv\Scripts\python.exe -u -m uvicorn app.main:app --host 0.0.0.0 --port 8010
```

### 10.4 前端打不开 / 502 Bad Gateway

**原因**：后端未启动，或前端代理目标端口错误。

**排查**：
```powershell
netstat -ano | findstr ":8010 "    # 后端必须监听
Get-Content ..\frontend\vite.config.ts | Select-String "target"    # target 必须为 http://localhost:8010
```

### 10.5 数据库被破坏 / 需要重置

删除数据库文件后重启服务，Alembic 会自动重建全部表并重建管理员：

```powershell
Stop-Process -Id (Get-Process -Name python).Id -Force -ErrorAction SilentlyContinue
Remove-Item F:\Github\EchoesForgeClaw\backend\bookforge.db -Force
# 重新启动后端
```

### 10.6 修改端口后需要同步改动

修改端口时，以下 3 处**必须**同步：

1. `backend/app/main.py` 的 CORS `allow_origins`
2. `frontend/vite.config.ts` 的代理 `target`
3. Windows 防火墙放行新端口

### 10.7 代码更新后新增的数据库表未生效

**原因**：只重启了服务但忘了处理迁移，或误以为需要手动建表。

**解决**：本项目**无需手动建表**。后端每次启动都会执行 `alembic upgrade head`（`app/main.py`）自动应用迁移脚本。只需重启后端即可。若仍缺表，查看后端终端输出确认迁移是否报错。

### 10.8 端口被占用

```powershell
# 查看哪个进程占用了端口
netstat -ano | findstr ":8010 "
# 记下 PID，然后
Get-Process -Id <PID>
# 如需强制释放
Stop-Process -Id <PID> -Force
```

---

## 11. Windows 与 Ubuntu 关键差异对照

| 项目 | Ubuntu | Windows 11 |
|------|--------|------------|
| 虚拟环境路径 | `venv/bin/` | `.venv\Scripts\` |
| Python 时区数据 | 内置 | 需额外 `pip install tzdata` |
| 服务管理 | systemd | 任务计划程序 / nssm |
| 防火墙 | ufw | `New-NetFirewallRule` |
| shell 脚本 | bash | PowerShell |
| 日志查看 | `journalctl` | `Receive-Job` / 终端窗口 |
| 路径分隔符 | `/` | `\` |
| 进程管理 | `systemctl` / `kill` | `Get-Process` / `Stop-Process` |
| bcrypt 兼容 | 同为 4.0.1 锁定 | 同为 4.0.1 锁定 |

---

## 12. 一键快速启动（已就绪环境）

```powershell
# 后端
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "& { Set-Location 'F:\Github\EchoesForgeClaw\backend'; .\.venv\Scripts\python.exe -u -m uvicorn app.main:app --host 0.0.0.0 --port 8010 }"

# 前端
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "& { Set-Location 'F:\Github\EchoesForgeClaw\frontend'; npm run dev }"
```