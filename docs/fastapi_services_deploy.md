# BookForge FastAPI 微服务部署与运维（Ubuntu）

本文档覆盖项目 4 个独立 Python（FastAPI/Uvicorn）微服务的部署、升级与排障。它们**不属于** Node.js 后端，由 `backend-ts` 按 URL 代理调用；仅当使用对应画布节点功能时才必须启动，未启动时其余功能不受影响（对应节点会提示服务不可用）。

> 当前服务器 `10.40.92.18` 已完成部署并验证。后端代理默认值见 `backend-ts/src/config/seed.ts`。

## 1. 服务总览

| 服务 | 目录 | 端口 | systemd 单元 | 后端环境变量（默认值） | 功能入口 |
|------|------|------|--------------|------------------------|----------|
| maptoposter | `services/maptoposter/` | 8100 | `bookforge-maptoposter` | `MAPTOPoster_API` (`http://127.0.0.1:8100`) | 地图海报节点 |
| prettymaps | `services/prettymaps/` | 8101 | `bookforge-prettymaps` | `PRETTYMAPS_API` (`http://127.0.0.1:8101`) | 艺术地图生成节点 |
| chinese-traditional-patterns | `services/chinese-traditional-patterns/` | 8102 | `chinese-traditional-patterns` | `PATTERNS_API` (`http://127.0.0.1:8102`) | 中国传统纹样检索节点 |
| zhongguo-traditional-colors | `services/zhongguo-traditional-colors/` | 8103 | `zhongguo-traditional-colors` | `COLORS_API` (`http://127.0.0.1:8103`) | 中国传统配色节点 |

统一约定：

- Python ≥ 3.11（本机 3.12.3），每个服务**独立 venv**（`services/<name>/venv/`），互不污染，也不受系统 Python 升级影响；
- systemd 托管：`Restart=always` + `RestartSec=5` 崩溃自愈，开机自启（enabled）；
- systemd `ExecStart` 使用 **venv 内 uvicorn 绝对路径**，不依赖 PATH；
- ufw 已放行 8100-8103/tcp（见主文档第 7 节）。

## 2. 首次部署

```bash
cd /opt/EchoesForgeClaw   # 代码随 git pull 就位

# 0. 部署前确认端口空闲（重要）
ss -tuln | grep -E ':(8100|8101|8102|8103)\b' || echo "端口空闲"

# 1. 为每个服务创建独立 venv 并安装依赖
for d in maptoposter prettymaps chinese-traditional-patterns zhongguo-traditional-colors; do
  python3 -m venv services/$d/venv
  services/$d/venv/bin/pip install -r services/$d/requirements.txt
done

# 2. ⚠️ 补装缺失的 Web 框架依赖（已知坑，见 FAQ 5.1）
services/maptoposter/venv/bin/pip install fastapi uvicorn
services/prettymaps/venv/bin/pip install fastapi uvicorn

# 3. 创建 systemd 服务（模板见第 3 节），然后启用并启动
sudo systemctl daemon-reload
sudo systemctl enable --now bookforge-maptoposter bookforge-prettymaps \
                            chinese-traditional-patterns zhongguo-traditional-colors
```

> 重型服务（maptoposter/prettymaps，matplotlib/geopandas/osmnx 栈）首次启动约 15-25 秒属正常现象，勿在启动瞬间误判失败。

### 2.1 健康检查

```bash
systemctl is-active bookforge-maptoposter bookforge-prettymaps \
                   chinese-traditional-patterns zhongguo-traditional-colors
# 期望 active active active active

curl -s http://localhost:8100/health   # {"status":"ok"}
curl -s http://localhost:8101/health   # {"status":"ok"}
curl -s http://localhost:8102/health   # {"status":"ok","total_patterns":100}
curl -s http://localhost:8103/health   # {"status":"ok","total_colors":742,"total_categories":8}
```

## 3. systemd 单元模板

以 maptoposter 为例（`/etc/systemd/system/bookforge-maptoposter.service`），其余三个仅替换 Description / WorkingDirectory / 端口：

```ini
[Unit]
Description=BookForge FastAPI Service (maptoposter)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/EchoesForgeClaw/services/maptoposter
ExecStart=/opt/EchoesForgeClaw/services/maptoposter/venv/bin/uvicorn api:app --host 0.0.0.0 --port 8100
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

当前已生成的 4 个单元文件：

| 服务 | 单元文件 |
|------|----------|
| `/etc/systemd/system/bookforge-maptoposter.service` | 端口 8100 |
| `/etc/systemd/system/bookforge-prettymaps.service` | 端口 8101 |
| `/etc/systemd/system/chinese-traditional-patterns.service` | 端口 8102 |
| `/etc/systemd/system/zhongguo-traditional-colors.service` | 端口 8103 |

## 4. 升级流程（增量更新）

**核心原则：git pull 只更新代码，不触碰 venv 与 systemd 单元，因此常规升级只需重启对应服务。**

```bash
cd /opt/EchoesForgeClaw && git pull

# 只重启有代码变更的服务（按需选择）
sudo systemctl restart bookforge-maptoposter      # 例：maptoposter 有变更

# 仅当某服务 requirements.txt 变更时，才需要重装该服务依赖：
services/<name>/venv/bin/pip install -r services/<name>/requirements.txt
sudo systemctl restart <单元名>
```

不需要做的：

- ❌ 不需要重启 Node 后端/前端（除非后端代理代码变更）；
- ❌ 不需要 daemon-reload（单元文件未变时）；
- ❌ 不需要删除重建 venv。

跨机部署时：在 `backend-ts/.env` 设置对应的 `MAPTOPoster_API` / `PRETTYMAPS_API` / `PATTERNS_API` / `COLORS_API=http://<host>:<port>`，重启 `bookforge-backend` 生效。

## 5. 排障 FAQ

### 5.1 启动即崩：`status=203/EXEC`
**原因**：venv 中没有 uvicorn 可执行文件——maptoposter 与 prettymaps 的 `requirements.txt` 上游遗漏了 `fastapi`/`uvicorn`。
**解决**：
```bash
services/maptoposter/venv/bin/pip install fastapi uvicorn
sudo systemctl restart bookforge-maptoposter
```
（prettymaps 同理。）建议向上游 PR 补全这两个依赖。

### 5.2 启动即崩：`ModuleNotFoundError: No module named 'fastapi'`
同 5.1 的另一种表现，日志出现在 import 阶段。解决方式相同。

### 5.3 服务一直 `activating` 但最终成功
重型服务（maptoposter/prettymaps）导入 matplotlib/osmnx 等需 15-25 秒。用 `journalctl -u <单元名> -f` 观察到 `Uvicorn running on ...` 即为正常。

### 5.4 端口被占用
- **8100 冲突**：`docs/fastclaw-dev/plugins/mem0` 的 Mem0 服务默认也指向 `127.0.0.1:8100`。二者只能留一个在 8100，另一个换端口并同步引用方；
- 换端口方法：改单元文件的 `--port` → `daemon-reload` → restart → 同步 `backend-ts/.env` 对应变量（或系统设置）→ 重启后端。

### 5.5 切换 Python 大版本后
venv 绑定创建时的解释器版本（本机 3.12）。系统 Python 大版本升级后需**删除并重建各 venv**：
```bash
for d in maptoposter prettymaps chinese-traditional-patterns zhongguo-traditional-colors; do
  rm -rf services/$d/venv
  python3 -m venv services/$d/venv
  services/$d/venv/bin/pip install -r services/$d/requirements.txt
done
services/maptoposter/venv/bin/pip install fastapi uvicorn
services/prettymaps/venv/bin/pip install fastapi uvicorn
sudo systemctl restart bookforge-maptoposter bookforge-prettymaps \
                    chinese-traditional-patterns zhongguo-traditional-colors
```

## 6. 运维命令速查

```bash
# 状态 / 日志 / 重启
systemctl status bookforge-maptoposter
journalctl -u bookforge-prettymaps -f
sudo systemctl restart <单元名>

# 批量操作
systemctl is-active bookforge-maptoposter bookforge-prettymaps chinese-traditional-patterns zhongguo-traditional-colors
sudo systemctl stop bookforge-prettymaps          # 停止单个（不用的服务可停掉省资源）
sudo systemctl disable --now <单元名>              # 取消自启并停止
```

> 资源紧张时可只启用用到的服务：未启动服务的对应节点会报「Python API not running」，不影响其他功能。
