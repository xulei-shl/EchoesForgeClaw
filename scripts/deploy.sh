#!/usr/bin/env bash
#
# BookForge 一键部署/启动脚本（Ubuntu）
#
# 功能：
#   1. 环境自检（python3 / node / npm / ufw）
#   2. 自动挑选未被占用的后端、前端端口
#   3. 创建/更新 backend/.env（随机 SECRET_KEY，管理员账号密码可配置）
#   4. 安装后端依赖（含 bcrypt 锁定修复，仅 --install 或虚拟环境缺失时）
#   5. 安装前端依赖（按需）并**每次都**生产构建（前端代码可能已更新）
#   6. 后端启动时由 Alembic 自动执行迁移建表（新增表无需手工处理）
#   7. 生成并安装 4 处端口相关的配置（CORS / vite 代理 / systemd / ufw）
#   8. 生成 systemd 服务并启用开机自启
#   9. ufw 放行端口
#  10. 启动服务并自检
#
# 用法：
#   sudo bash scripts/deploy.sh [--install] [--admin-password PASSWORD] [--backend-port P] [--frontend-port P]
#     --install          安装依赖（首次部署；不传则只构建前端（代码可能已更新）并重启服务）
#     --admin-password   管理员密码，默认 yfzjlxy0527（仅当 backend/.env 尚未设置时写入，避免覆盖已有密码）
#     --backend-port     后端端口，默认 8010（若被占用则自动寻找空闲端口）
#     --frontend-port    前端端口，默认 5180
#     --node-path        node/npm 绝对路径，默认自动探测
#
# 说明：脚本是幂等的，可重复执行；重复执行默认只构建前端（代码可能已更新）并重启服务。

set -euo pipefail

# ---------------- 参数解析 ----------------
INSTALL="no"
ADMIN_PASSWORD="yfzjlxy0527"
BACKEND_PORT="8010"
FRONTEND_PORT="5180"
NODE_PATH=""
PROJECT_DIR="/opt/EchoesForgeClaw"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"

print_help() {
  sed -n '2,24p' "$0"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install) INSTALL="yes" ;;
    --admin-password) ADMIN_PASSWORD="$2"; shift ;;
    --backend-port) BACKEND_PORT="$2"; shift ;;
    --frontend-port) FRONTEND_PORT="$2"; shift ;;
    --node-path) NODE_PATH="$2"; shift ;;
    -h|--help) print_help ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
  shift
done

# ---------------- 工具函数 ----------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# 端口占用情况：0=空闲，1=被本服务占用（可复用），2=被其他进程占用（需换）
port_state() {
  local p="$1"
  local pid
  pid=$(ss -tulnp 2>/dev/null | grep -E "[:.]$p\b" | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
  if [[ -z "$pid" ]]; then
    echo 0
  elif [[ -f "/proc/$pid/cmdline" ]] && grep -q "$PROJECT_DIR" "/proc/$pid/cmdline" 2>/dev/null; then
    echo 1
  else
    echo 2
  fi
}

# 挑选端口：给定端口空闲或为本服务占用则复用，否则顺延到空闲端口
pick_port() {
  local base="$1"
  local p="$base"
  while :; do
    local st
    st=$(port_state "$p")
    if [[ "$st" == "0" || "$st" == "1" ]]; then
      echo "$p"
      return
    fi
    p=$((p + 1))
  done
}

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"; }

# ---------------- 前置检查 ----------------
die_if_root_mismatch() {
  if [[ "$(id -u)" -ne 0 ]]; then
    die "请以 root 运行（或 sudo bash $0）"
  fi
}
die_if_root_mismatch

need_cmd python3
need_cmd ss
need_cmd systemctl
command -v ufw >/dev/null 2>&1 && HAS_UFW=1 || HAS_UFW=0

if [[ ! -d "$BACKEND_DIR" ]]; then die "未找到后端目录: $BACKEND_DIR"; fi
if [[ ! -d "$FRONTEND_DIR" ]]; then die "未找到前端目录: $FRONTEND_DIR"; fi

# 探测 node / npm
if [[ -z "$NODE_PATH" ]]; then
  NPM_BIN="$(command -v npm || true)"
  [[ -z "$NPM_BIN" ]] && die "未找到 npm，请安装 Node.js 或传 --node-path"
else
  NPM_BIN="$NODE_PATH/npm"
fi
command -v "$NPM_BIN" >/dev/null 2>&1 || die "npm 不可用: $NPM_BIN"

# ---------------- 端口规划 ----------------
info "正在挑选未被占用的端口..."
BACKEND_PORT=$(pick_port "$BACKEND_PORT")
FRONTEND_PORT=$(pick_port "$FRONTEND_PORT")
info "后端端口: $BACKEND_PORT"
info "前端端口: $FRONTEND_PORT"

# ---------------- 版本锁定检查（关键修复） ----------------
info "检查后端依赖的 bcrypt 锁定..."
if ! grep -qE '^bcrypt==4\.0\.1' "$BACKEND_DIR/requirements.txt" 2>/dev/null; then
  warn "requirements.txt 缺少 bcrypt==4.0.1 锁定（passlib 兼容性修复），自动补充"
  echo "bcrypt==4.0.1" >> "$BACKEND_DIR/requirements.txt"
fi

# ---------------- .env 生成 ----------------
info "配置 backend/.env ..."
ENV_FILE="$BACKEND_DIR/.env"
touch "$ENV_FILE"
if ! grep -q '^SECRET_KEY=' "$ENV_FILE" 2>/dev/null || [[ -z "$(grep '^SECRET_KEY=' "$ENV_FILE" | cut -d= -f2)" ]]; then
  SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  echo "SECRET_KEY=$SECRET_KEY" >> "$ENV_FILE"
  info "已生成随机 SECRET_KEY"
fi
# 管理员账号：用户名固定为 admin；密码若已存在则保留（避免每次部署重置），否则写入配置值
sed -i '/^ADMIN_USERNAME=/d' "$ENV_FILE"
echo "ADMIN_USERNAME=admin" >> "$ENV_FILE"
if ! grep -q '^ADMIN_PASSWORD=' "$ENV_FILE" 2>/dev/null; then
  echo "ADMIN_PASSWORD=$ADMIN_PASSWORD" >> "$ENV_FILE"
  info "已写入管理员密码（默认/配置值）"
else
  info "保留已有 ADMIN_PASSWORD（如需重置请手动修改 backend/.env 或重新运行并指定 --admin-password）"
fi
chmod 600 "$ENV_FILE"

# ---------------- 源码配置同步（CORS / vite 代理） ----------------
info "同步后端 CORS 配置（端口 $FRONTEND_PORT）..."
MAIN_PY="$BACKEND_DIR/app/main.py"
if ! grep -q "$FRONTEND_PORT" "$MAIN_PY" 2>/dev/null; then
  # 在 allow_origins 列表中加入当前前端端口（若列表以特定端口开头则替换）
  if grep -qE 'http://localhost:5[0-9]+' "$MAIN_PY"; then
    sed -E -i 's#(http://localhost:5[0-9]+)#http://localhost:'"$FRONTEND_PORT"'#' "$MAIN_PY"
  fi
fi

info "同步前端 Vite 代理目标（端口 $BACKEND_PORT）..."
VITE_CFG="$FRONTEND_DIR/vite.config.ts"
sed -E -i "s#(target: 'http://localhost:)[0-9]+'\$#\1$BACKEND_PORT'#" "$VITE_CFG" 2>/dev/null || \
  sed -E -i "s#(target: 'http://localhost:)[0-9]+'#\1$BACKEND_PORT'#g" "$VITE_CFG"

# ---------------- 后端依赖安装（按需） ----------------
# 仅在 --install 或虚拟环境缺失时安装；日常更新（如新增数据库表）无需重装
if [[ "$INSTALL" == "yes" || ! -d "$BACKEND_DIR/.venv" ]]; then
  info "安装后端依赖..."
  ( cd "$BACKEND_DIR" && if [[ ! -d .venv ]]; then python3 -m venv .venv; fi )
  "$BACKEND_DIR/.venv/bin/pip" install -r "$BACKEND_DIR/requirements.txt"
else
  info "跳过后端依赖安装（虚拟环境已存在且未指定 --install）"
fi

# ---------------- 前端依赖安装与构建 ----------------
# 前端构建【每次都执行】：前端代码可能已更新（如本次增加的「强制更新」按钮），
# 若跳过构建会把旧 dist 当作最新逻辑部署。依赖仅在 --install 或缺失时安装。
if [[ "$INSTALL" == "yes" || ! -d "$FRONTEND_DIR/node_modules" ]]; then
  info "安装前端依赖..."
  ( cd "$FRONTEND_DIR" && "$NPM_BIN" install )
else
  info "跳过前端依赖安装（node_modules 已存在且未指定 --install）"
fi
info "构建前端生产产物（npm run build）..."
( cd "$FRONTEND_DIR" && "$NPM_BIN" run build )

# ---------------- systemd 服务 ----------------
info "生成 systemd 服务..."
NODE_PREFIX="$(dirname "$(dirname "$NPM_BIN")")"          # /root/.nvm/versions/node/v22.23.1
NPM_CANON="$NODE_PREFIX/bin/npm"

cat > /etc/systemd/system/bookforge-backend.service <<EOF
[Unit]
Description=BookForge Backend (FastAPI)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$BACKEND_DIR
ExecStart=$BACKEND_DIR/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port $BACKEND_PORT
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/bookforge-frontend.service <<EOF
[Unit]
Description=BookForge Frontend (Vite Preview)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$FRONTEND_DIR
ExecStart=$NPM_CANON run preview -- --host 0.0.0.0 --port $FRONTEND_PORT
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable bookforge-backend bookforge-frontend

# ---------------- ufw 放行 ----------------
if [[ "$HAS_UFW" == "1" ]]; then
  info "配置防火墙放行端口 $BACKEND_PORT / $FRONTEND_PORT ..."
  ufw allow "$BACKEND_PORT/tcp" comment 'BookForge Backend' >/dev/null 2>&1 || true
  ufw allow "$FRONTEND_PORT/tcp" comment 'BookForge Frontend' >/dev/null 2>&1 || true
  ufw reload >/dev/null 2>&1 || true
else
  warn "未安装 ufw，跳过防火墙放行（局域网访问可能受限）"
fi

# ---------------- 启动并自检 ----------------
info "启动服务..."
systemctl restart bookforge-backend bookforge-frontend

echo
echo "等待后端启动..."
CNT=0
until systemctl is-active --quiet bookforge-backend; do
  CNT=$((CNT+1))
  [[ $CNT -gt 15 ]] && { warn "后端未能稳定运行，查看日志: journalctl -u bookforge-backend -n 50"; break; }
  sleep 1
done

sleep 2
BACKEND_STATUS=$(systemctl is-active bookforge-backend)
FRONTEND_STATUS=$(systemctl is-active bookforge-frontend)

echo
echo "==================== 部署结果 ===================="
echo -e "后端 service (${GREEN}$BACKEND_STATUS${NC})\t: http://<服务器IP>:$BACKEND_PORT"
echo -e "前端 service (${GREEN}$FRONTEND_STATUS${NC})\t: http://<服务器IP>:$FRONTEND_PORT"
echo "管理员账号  : admin / $ADMIN_PASSWORD"
echo "防火墙已放行: $BACKEND_PORT/tcp, $FRONTEND_PORT/tcp"
echo "日志        : journalctl -u bookforge-backend -f"
echo "=================================================="

# 快速自检
if curl -sf -o /dev/null --max-time 3 "http://localhost:$BACKEND_PORT/"; then
  info "后端自检通过"
else
  warn "后端自检失败，查看日志排查"
fi
if curl -sf -o /dev/null --max-time 3 "http://localhost:$FRONTEND_PORT/"; then
  info "前端自检通过"
else
  warn "前端自检失败，查看日志排查"
fi