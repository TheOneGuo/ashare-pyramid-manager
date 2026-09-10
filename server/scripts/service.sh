#!/bin/bash
# 节节高后端（ashare-pyramid-server）服务管理
#
# 背景：后端原来是手工 `tsx --watch src/index.js` 起的，机器重启/进程崩溃就没了，
# 而每日 21:00 的研报下载+精读任务依赖进程常驻。这里把它交给 launchd 托管：
#   - plist: ~/Library/LaunchAgents/com.gray.ashare-pyramid-server.plist
#   - KeepAlive=true → 崩溃会被自动拉起（所以 plist 里故意不带 --watch：
#     tsx --watch 崩了只会打印 "Waiting for file changes" 然后挂着，进程不退，KeepAlive 就永远不触发）
#
# ⚠️ 首次启用必须在「你自己的终端」里跑（WorkBuddy 的沙箱进程没有 launchd 域写权限，
#    launchctl bootstrap 会报 5: Input/output error）：
#     bash scripts/service.sh enable
#
# 之后日常：
#   bash scripts/service.sh restart   # 改完 server 代码后重启生效（无 --watch，不自动热载）
#   bash scripts/service.sh status    # 看托管状态 + 端口 + health
#   bash scripts/service.sh logs      # 跟踪日志

set -u

LABEL="com.gray.ashare-pyramid-server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WS_ID="$(basename "$(dirname "$SERVER_DIR")")"   # 用于精确 pkill，避免误伤同机其它 node 项目
PORT="$(grep -E '^PORT=' "$SERVER_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2 | tr -d ' ')"
PORT="${PORT:-9999}"
LOG="/tmp/pyramid-server.log"

log() { printf '%s\n' "$*"; }

kill_manual() {
  # 杀掉手工启动的实例（含 tsx 监督进程，否则它会立刻把子进程拉回来）
  if pgrep -f "$WS_ID" >/dev/null 2>&1; then
    log "-> 停止手工实例（匹配工作区 ID $WS_ID）"
    pkill -f "$WS_ID" 2>/dev/null
    for _ in $(seq 1 15); do
      pgrep -f "$WS_ID" >/dev/null 2>&1 || break
      sleep 1
    done
  fi
}

wait_health() {
  local i code
  for i in $(seq 1 60); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null)"
    if [ "$code" = "200" ]; then log "-> 就绪（第 ${i} 次探测）: http://127.0.0.1:$PORT/api/health"; return 0; fi
    sleep 2
  done
  log "-> ⚠️ 等了 120s 仍未就绪，看日志: tail -40 $LOG"
  return 1
}

case "${1:-status}" in
  enable)
    [ -f "$PLIST" ] || { log "找不到 plist: $PLIST"; exit 1; }
    kill_manual
    log "-> launchctl bootstrap $DOMAIN"
    launchctl bootstrap "$DOMAIN" "$PLIST" 2>&1 || {
      log "bootstrap 失败。若报 5: Input/output error，说明当前 shell 也没有 launchd 域写权限，"
      log "请改用「终端.app」直接执行（不要经过任何沙箱/IDE 内置终端）。"
      exit 1
    }
    wait_health || exit 1
    log "✅ 已由 launchd 托管（开机自动启动 + 崩溃自动拉起）"
    ;;
  restart)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      log "-> launchctl kickstart -k $DOMAIN/$LABEL"
      launchctl kickstart -k "$DOMAIN/$LABEL" 2>&1 || {
        # 没有 kickstart 权限时退化成 pkill：KeepAlive=true 会立刻把它拉起来
        log "-> kickstart 不可用，改用 pkill + KeepAlive 自动拉起"
        pkill -f "$WS_ID" 2>/dev/null; sleep 12
      }
    else
      log "-> launchd 未托管，按手工方式重启"
      kill_manual
      ( cd "$SERVER_DIR" && nohup ./node_modules/.bin/tsx --watch src/index.js >> "$LOG" 2>&1 & ) 
    fi
    wait_health || exit 1
    ;;
  stop)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      launchctl bootout "$DOMAIN/$LABEL" 2>&1 && log "-> 已 bootout（KeepAlive 不会再生效）"
    fi
    kill_manual; log "-> 已停止"
    ;;
  status)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      log "launchd: 已托管"
      launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -E '^\s*(state|pid|last exit code|runs) ' | sed 's/^/  /'
    else
      log "launchd: 未托管（跑过 'bash scripts/service.sh enable' 之后才是 24×7）"
    fi
    log "端口监听:"; lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | sed 's/^/  /' || log "  (无)"
    log "health: $(curl -s --max-time 8 "http://127.0.0.1:$PORT/api/health" | head -c 200)"
    ;;
  logs)
    tail -n "${2:-60}" -f "$LOG"
    ;;
  *)
    log "用法: bash scripts/service.sh {enable|restart|stop|status|logs [行数]}"
    exit 1
    ;;
esac
