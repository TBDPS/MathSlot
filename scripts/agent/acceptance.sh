#!/usr/bin/env bash
# 聚合门禁：把"看起来好了"变成可执行的判定。
# 用法：scripts/agent/acceptance.sh [--fast]
#   --fast  跳过 clippy（约省几分钟）
#
# 退出码：0 = 全部 PASS；1 = 至少一项 FAIL；2 = 环境/脚本错误。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

FAST=0
[[ "${1:-}" == "--fast" ]] && FAST=1

PASS=0
FAIL=0
WARN=0
declare -a ROWS

record() {
  local status="$1" name="$2" detail="$3"
  ROWS+=("$status|$name|$detail")
  case "$status" in
    PASS) PASS=$((PASS + 1)) ;;
    FAIL) FAIL=$((FAIL + 1)) ;;
    WARN) WARN=$((WARN + 1)) ;;
  esac
}

run_step() {
  local name="$1"; shift
  local out
  out="$("$@" 2>&1)"
  local rc=$?
  if [[ $rc -eq 0 ]]; then
    record PASS "$name" "exit 0"
  else
    record FAIL "$name" "exit $rc"
    printf '%s\n' "$out" | tail -n 20 | sed 's/^/    /'
  fi
}

echo "== MathSlot 门禁（$ROOT）=="
echo "时间：$(date -Iseconds)"
echo

run_step "cargo fmt --check" cargo fmt --check
if [[ $FAST -eq 1 ]]; then
  record WARN "cargo clippy -D warnings" "跳过（--fast）"
else
  run_step "cargo clippy -D warnings" cargo clippy --workspace --all-targets -- -D warnings
fi
run_step "cargo test --workspace" cargo test --workspace

# 调色板一致性在 G0 只是 WARN：D-001 的正式修复属于 G1/T1.3（必须由 catalog 生成），
# 从 G1 起才作为硬门禁。
GATE="${GATE:-$(python3 -c "import json;print(json.load(open('agent-state/state.json'))['gate'])" 2>/dev/null || echo G0)}"
if python3 scripts/agent/audit_palette.py >/tmp/mathslot-palette.log 2>&1; then
  record PASS "调色板一致性" "exit 0（gate=$GATE）"
else
  if [[ "$GATE" == "G0" ]]; then
    record WARN "调色板一致性" "G0：已知 D-001，待 G1/T1.3 修复"
  else
    record FAIL "调色板一致性" "exit 1（gate=$GATE）"
    tail -n 12 /tmp/mathslot-palette.log | sed 's/^/    /'
  fi
fi

count() { rg -c --no-filename "$1" "${@:2}" 2>/dev/null | awk '{s+=$1} END {print s+0}'; }

LET_UNDERSCORE="$(count 'let _ = ' src crates --glob '!target' || true)"
UNWRAP="$(count '\.unwrap\(\)' src crates/mathslot-core/src --glob '!target' || true)"
TABLES="$(count 'const (COMMAND|SYMBOL|STRUCT|RELATION|OPERATOR|GREEK)_ENTRIES' src crates --glob '!target' || true)"

record WARN "let _ = 计数" "$LET_UNDERSCORE 处（G4 前应清零）"
record WARN "unwrap() 计数" "$UNWRAP 处（用户输入路径应为 0）"
record WARN "命令表常量" "$TABLES 处（G1 后应只剩 catalog）"

if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  DIRTY="$(git -C "$ROOT" status --porcelain | wc -l)"
  if [[ "$DIRTY" -eq 0 ]]; then
    record PASS "工作区干净" "0 个未提交改动"
  else
    record WARN "工作区未提交" "$DIRTY 个文件"
  fi
fi

echo
printf '%-6s %-28s %s\n' "结果" "检查项" "说明"
printf '%-6s %-28s %s\n' "------" "----------------------------" "----"
for row in "${ROWS[@]}"; do
  IFS='|' read -r st name detail <<< "$row"
  printf '%-6s %-28s %s\n' "$st" "$name" "$detail"
done

echo
echo "PASS=$PASS FAIL=$FAIL WARN=$WARN"
if [[ $FAIL -gt 0 ]]; then
  echo "结论：FAIL（不得推进 Gate，不得签署通过）"
  exit 1
fi
echo "结论：PASS"
