#!/usr/bin/env bash
# 轮询仓库，HEAD 变化且没有 APPROVE 审查时，自动调用 OpenCode 监督者。
#
# 用法：
#   scripts/agent/watch.sh --once                 # 检查一次
#   scripts/agent/watch.sh --interval 600         # 每 10 分钟检查一次
#   nohup scripts/agent/watch.sh --interval 600 >/tmp/mathslot-watch.log 2>&1 &
#
# 注意：每次审查都是一次模型调用，间隔不要太短（建议 >= 300 秒）。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

INTERVAL=600
ONCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --once) ONCE=1; shift ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

LOCK="/tmp/mathslot-watch.lock"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK"
  flock -n 9 || { echo "已有 watcher 在运行"; exit 0; }
fi

while :; do
  HEAD="$(git rev-parse --short HEAD)"
  if python3 scripts/agent/check_review.py --head "$HEAD" >/dev/null 2>&1; then
    echo "$(date -Iseconds) $HEAD 已有 APPROVE，跳过"
  else
    echo "$(date -Iseconds) $HEAD 无 APPROVE，触发审查"
    scripts/agent/supervise.sh || echo "审查失败（退出码 $?）"
  fi
  [[ $ONCE -eq 1 ]] && break
  sleep "$INTERVAL"
done
