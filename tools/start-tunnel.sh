#!/usr/bin/env bash
# 顺手 · 一键起公网隧道
#
#   bash tools/start-tunnel.sh static   # 公网看到 dist/ 的静态构建（默认，更稳）
#   bash tools/start-tunnel.sh dev      # 公网看到 5173 的实时开发页面（需 dev server 在跑）
#
# 前置：Clash 代理在 127.0.0.1:7897；dev 模式需要 5173 的 dev server 已在跑。
# 说明：本机网络封了 Cloudflare 的 7844 端口，所以必须走代理 + 强制 HTTP/2；
#       curl 的 schannel 后端在本机是坏的，验证公网请用浏览器或 node fetch。

set -u
cd "$(dirname "$0")/.." || exit 1
PROXY="${PROXY:-http://127.0.0.1:7897}"
PORT="${PORT:-5174}"
MODE="${1:-static}"

case "$MODE" in
  dev)    export TUNNEL_UPSTREAM="${TUNNEL_UPSTREAM:-http://127.0.0.1:5173}" ;;
  static) unset TUNNEL_UPSTREAM ;;
  *) echo "用法: bash tools/start-tunnel.sh [dev|static]"; exit 1 ;;
esac

echo "[顺手] 模式：$MODE"
node tools/tunnel-server.mjs &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' EXIT
sleep 1

echo "[顺手] 公网地址会打印在下面的 Cloudflare 日志里，格式 https://xxx.trycloudflare.com"
HTTP_PROXY="$PROXY" HTTPS_PROXY="$PROXY" NO_PROXY="localhost,127.0.0.1,::1" \
  "/c/Program Files (x86)/cloudflared/cloudflared.exe" tunnel \
  --url "http://127.0.0.1:$PORT" --protocol http2 --no-autoupdate
