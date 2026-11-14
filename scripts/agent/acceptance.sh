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
run_step "cargo test --workspace" cargo test --workspace --offline
run_step "xtask 生成物与文档防漂移" cargo run --offline -p xtask -- check

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

if [[ -f "$ROOT/packages/ui/scripts/bench-budgets.mjs" ]] && command -v node >/dev/null 2>&1; then
  if node "$ROOT/packages/ui/scripts/bench-budgets.mjs" >/tmp/mathslot-perf.json 2>/tmp/mathslot-perf.err; then
    if python3 - "$ROOT/agent-state/baseline/perf-baseline.json" /tmp/mathslot-perf.json >/tmp/mathslot-perf-cmp.log 2>&1 <<'PY'
import json, sys
base_path, cur_path = sys.argv[1], sys.argv[2]
cur = json.load(open(cur_path))
try:
    base = json.load(open(base_path))["wasm_node"]
except FileNotFoundError:
    print("no perf-baseline.json; budget thresholds only")
    sys.exit(0)
errs = []
max_wasm_mem = int(base["stress_1000_edits"]["wasm_memory_after_1000_bytes"] * 1.10)
cur_wasm_mem = cur["stress_1000_edits"]["wasm_memory_after_1000_bytes"]
if cur_wasm_mem > max_wasm_mem:
    errs.append(f"wasm_memory_after_1000 {cur_wasm_mem} > +10% baseline {max_wasm_mem}")
max_rss = int(base["stress_1000_edits"]["node_rss_after_bytes"] * 1.10)
cur_rss = cur["stress_1000_edits"]["node_rss_after_bytes"]
if cur_rss > max_rss:
    errs.append(f"node_rss_after {cur_rss} > +10% baseline {max_rss}")
if errs:
    print("; ".join(errs))
    sys.exit(1)
print(f"wasm={cur['wasm']['wasm_bytes']}B, mem1000={cur_wasm_mem}B, parse_p95={cur['parse']['p95_ms']}ms, render_p95={cur['render']['p95_ms']}ms")
PY
    then
      record PASS "性能与 WASM 预算" "$(cat /tmp/mathslot-perf-cmp.log)"
    else
      record FAIL "性能与 WASM 预算" "超出 +10% 基线：$(cat /tmp/mathslot-perf-cmp.log)"
    fi
  else
    record FAIL "性能与 WASM 预算" "bench-budgets.mjs 失败"
    tail -n 12 /tmp/mathslot-perf.err | sed 's/^/    /'
  fi
fi

read -r ACTIVE_LET ACTIVE_UNWRAP ACTIVE_TABLES LEGACY_LET LEGACY_UNWRAP LEGACY_TABLES <<< "$(python3 - "$ROOT" <<'PY'
import pathlib, re, sys

root = pathlib.Path(sys.argv[1])
active_dirs = [
    "crates/mathslot-syntax/src",
    "crates/mathslot-doc/src",
    "crates/mathslot-latex/src",
    "crates/mathslot-command/src",
    "crates/mathslot-app/src",
    "crates/mathslot-store/src",
    "crates/mathslot-render/src",
    "crates/mathslot-wasm/src",
    "apps/desktop/src-tauri/src",
    "xtask/src",
]

def strip_cfg_tests(src: str) -> str:
    out = []
    in_test = False
    brace_depth = 0
    saw_open = False
    for line in src.splitlines(keepends=True):
        if not in_test and re.match(r'\s*#\[cfg\(test\)\]', line):
            in_test = True
            brace_depth = 0
            saw_open = False
        if in_test:
            opens = line.count('{')
            closes = line.count('}')
            if opens > 0:
                saw_open = True
            brace_depth += opens - closes
            if saw_open and brace_depth <= 0:
                in_test = False
            continue
        out.append(line)
    return "".join(out)

p_let = re.compile(r'let\s+_\s*=')
p_unwrap = re.compile(r'\.unwrap\s*\(')
p_tables = re.compile(r'const\s+(?:COMMAND|SYMBOL|STRUCT|RELATION|OPERATOR|GREEK)_ENTRIES')

a_let = a_unwrap = a_tables = 0
for d in active_dirs:
    base = root / d
    if not base.exists():
        continue
    for f in base.rglob("*.rs"):
        code = strip_cfg_tests(f.read_text(encoding="utf-8"))
        a_let += len(p_let.findall(code))
        a_unwrap += len(p_unwrap.findall(code))
        a_tables += len(p_tables.findall(code))

l_let = l_unwrap = l_tables = 0
for d in ["src", "crates/mathslot-core"]:
    base = root / d
    if not base.exists():
        continue
    for f in base.rglob("*.rs"):
        txt = f.read_text(encoding="utf-8")
        l_let += len(p_let.findall(txt))
        if d == "src" or "/src/" in f.as_posix():
            l_unwrap += len(p_unwrap.findall(txt))
        l_tables += len(p_tables.findall(txt))

print(a_let, a_unwrap, a_tables, l_let, l_unwrap, l_tables)
PY
)"

if [[ "$ACTIVE_LET" -eq 0 ]]; then
  record PASS "活跃产品路径 let _ =" "0 处（冻结旧栈 $LEGACY_LET 处）"
else
  record FAIL "活跃产品路径 let _ =" "$ACTIVE_LET 处（应为 0）"
fi

if [[ "$ACTIVE_UNWRAP" -eq 0 ]]; then
  record PASS "活跃产品路径 unwrap()" "0 处（冻结旧栈 $LEGACY_UNWRAP 处）"
else
  record FAIL "活跃产品路径 unwrap()" "$ACTIVE_UNWRAP 处（应为 0）"
fi

if [[ "$ACTIVE_TABLES" -eq 0 ]]; then
  record PASS "活跃产品路径命令表常量" "0 处（仅 catalog，冻结旧栈 $LEGACY_TABLES 处）"
else
  record FAIL "活跃产品路径命令表常量" "$ACTIVE_TABLES 处（应为 0）"
fi

if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  DIRTY="$(git -C "$ROOT" status --porcelain | wc -l)"
  if [[ "$DIRTY" -eq 0 ]]; then
    record PASS "工作区干净" "0 个未提交改动"
  else
    record WARN "工作区未提交" "$DIRTY 个文件"
  fi
fi

# Gate 收口时要求外部监督者（OpenCode）对本 HEAD 出具 APPROVE。
# 用法：REQUIRE_REVIEW=1 scripts/agent/acceptance.sh
if [[ "${REQUIRE_REVIEW:-0}" == "1" ]]; then
  if HEAD_SHA="$(git -C "$ROOT" rev-parse --short HEAD)" && \
     python3 "$ROOT/scripts/agent/check_review.py" --head "$HEAD_SHA" >/dev/null 2>&1; then
    record PASS "外部监督审查" "APPROVE ($HEAD_SHA)"
  else
    record FAIL "外部监督审查" "缺少 APPROVE（REQUIRE_REVIEW=1）"
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
