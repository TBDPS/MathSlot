#!/usr/bin/env bash
# 让 OpenCode 以独立 supervisor 身份审查当前 HEAD，并写出 REV-<sha>.md。
#
# 默认在临时 git worktree 里审查：监督者即使想改文件，也改不到真实工作区。
#
# 用法：
#   scripts/agent/supervise.sh --dry-run                 # 只打印提示词
#   scripts/agent/supervise.sh                          # 隔离 worktree + 新建归档会话
#   scripts/agent/supervise.sh --session <id>           # 继续指定 OpenCode 会话（非隔离）
#   scripts/agent/supervise.sh --since <sha>
#   scripts/agent/supervise.sh --force
#   scripts/agent/supervise.sh --keep-worktree          # 调试：保留临时 worktree
#
# 退出码：0 审查完成且 APPROVE；2 已有 REV 跳过；3 opencode 不可用；
#         4 未产出 REV；5 worktree 失败；6 审查完成但不是 APPROVE。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

MODEL="${SUPERVISOR_MODEL:-volcengine-plan/deepseek-v4.1-flash-economy}"
SESSION=""
SINCE=""
DRY=0
FORCE=0
KEEP=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --session) SESSION="$2"; shift 2 ;;
    --since) SINCE="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --force) FORCE=1; shift ;;
    --keep-worktree) KEEP=1; shift ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

command -v opencode >/dev/null 2>&1 || { echo "opencode 不在 PATH" >&2; exit 3; }
command -v git >/dev/null 2>&1 || { echo "git 不在 PATH" >&2; exit 3; }

HEAD="$(git rev-parse --short HEAD)"
HEAD_FULL="$(git rev-parse HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
mkdir -p agent-state/reviews

REV="agent-state/reviews/REV-${HEAD}.md"
if [[ -f "$REV" && $FORCE -eq 0 ]]; then
  echo "该 HEAD 已有审查：$REV（用 --force 重审）"
  exit 2
fi
if [[ -z "$SINCE" ]]; then
  SINCE="$(cat agent-state/reviews/.last 2>/dev/null || true)"
  [[ -z "$SINCE" ]] && SINCE="HEAD~1"
fi

CHANGED="$(git diff --name-status "$SINCE"..HEAD 2>/dev/null | head -40)"
STAT="$(git diff --stat "$SINCE"..HEAD 2>/dev/null | tail -1)"
SUBJECT="$(git log -1 --format='%h %s')"
GATE="$(python3 -c "import json;print(json.load(open('agent-state/state.json'))['gate'])" 2>/dev/null || echo unknown)"
ROUND="$(python3 -c "import json;print(json.load(open('agent-state/state.json'))['round'])" 2>/dev/null || echo unknown)"
LATEST_AUD="$(ls -t agent-state/audits/AUD-*.md 2>/dev/null | head -1 || true)"
LATEST_VER="$(ls -t agent-state/verify/VER-*.md 2>/dev/null | head -1 || true)"

build_prompt() {
  local repo_path="$1"
  cat <<EOF
你是 MathSlot 的外部监督者（opencode-supervisor）。只审查，不改代码。

仓库：$repo_path
分支：$BRANCH
Gate：$GATE（round $ROUND）
审查 HEAD：$HEAD_FULL
diff 起点：$SINCE
提交：$SUBJECT
变更统计：$STAT
变更文件：
$CHANGED

必须读取：
- AGENTS.md
- agent-state/HUMAN_REVIEW.md
- agent-state/state.json、agent-state/HANDOFF.md
- docs/LLM_IMPLEMENTATION_SPEC.md 的 §2、§4、§14
- 最近的审计：${LATEST_AUD:-无}
- 最近的验收：${LATEST_VER:-无}

必须自己执行（不要相信报告里的数字）：
- git diff ${SINCE}..HEAD
- cargo test --workspace --quiet
- scripts/agent/acceptance.sh --fast

判定三档：APPROVE / REJECT / BLOCKED。规则见 .opencode/agents/supervisor.md。

只允许写一个文件：agent-state/reviews/REV-${HEAD}.md
front matter 必须含 head（完整 40 位 sha）、verdict、reviewer: opencode-supervisor，
末尾机器可读两行：verdict: ... 与 head: ...

不要修改代码、测试、docs/LLM_IMPLEMENTATION_SPEC.md、scripts/agent/**；不要 git push。
完成后只回复：verdict + 三行理由 + REV 路径。
EOF
}

if [[ $DRY -eq 1 ]]; then
  build_prompt "$ROOT"
  exit 0
fi

LATEST_CHECK="$(python3 scripts/agent/check_review.py --head "$HEAD" >/dev/null 2>&1; echo $?)"

WT=""
cleanup() {
  if [[ -n "$WT" && $KEEP -eq 0 ]]; then
    git worktree remove --force "$WT" >/dev/null 2>&1 || true
    rmdir "$(dirname "$WT")" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ -n "$SESSION" ]]; then
  echo "审查 HEAD $HEAD（会话 $SESSION，非隔离）…"
  opencode run -s "$SESSION" --agent supervisor -m "$MODEL" --auto "$(build_prompt "$ROOT")"
  RC=$?
else
  TMPBASE="$(mktemp -d /tmp/mathslot-review.XXXXXX)" || { echo "mktemp 失败" >&2; exit 5; }
  WT="$TMPBASE/wt"
  if ! git worktree add --detach "$WT" HEAD >/dev/null 2>&1; then
    echo "git worktree add 失败" >&2
    exit 5
  fi
  echo "审查 HEAD $HEAD（隔离 worktree $WT）…"
  (
    cd "$WT" || exit 5
    CARGO_TARGET_DIR="$ROOT/target" opencode run --archived --agent supervisor -m "$MODEL" --auto "$(build_prompt "$WT")"
  )
  RC=$?

  if [[ -f "$WT/agent-state/reviews/REV-${HEAD}.md" ]]; then
    mkdir -p agent-state/reviews
    cp "$WT/agent-state/reviews/REV-${HEAD}.md" "$REV"
  fi
fi

if [[ $RC -ne 0 ]]; then
  echo "opencode 退出码 $RC" >&2
fi

if [[ ! -f "$REV" ]]; then
  echo "未产出 $REV（opencode 可能失败或未写文件）" >&2
  exit 4
fi

echo "$HEAD" > agent-state/reviews/.last
printf '%s\t%s\t%s\t%s\n' "$(date -Iseconds)" "$HEAD" "$GATE" "$REV" >> agent-state/reviews/index.tsv

echo "完成：$REV"
tail -n 4 "$REV"

if python3 scripts/agent/check_review.py --head "$HEAD" >/dev/null 2>&1; then
  exit 0
fi
echo "审查结果不是 APPROVE（见 $REV）"
exit 6
