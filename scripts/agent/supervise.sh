#!/usr/bin/env bash
# 让 OpenCode 以独立 supervisor 身份审查当前 HEAD，并写出 agent-state/reviews/REV-<sha>.md
#
# 用法：
#   scripts/agent/supervise.sh --dry-run                 # 只打印将发送的提示词
#   scripts/agent/supervise.sh                          # 新建归档会话审查（推荐自动化）
#   scripts/agent/supervise.sh --continue-session       # 接着当前这条 OpenCode 对话审查
#   scripts/agent/supervise.sh --session <id>           # 指定会话
#   scripts/agent/supervise.sh --since <sha>            # 指定 diff 起点
#   scripts/agent/supervise.sh --force                  # 即使该 HEAD 已有 REV 也再审
#
# 退出码：0 审查完成且 REV 存在；2 已有 REV 跳过；3 opencode 不可用；4 未产出 REV。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

DEFAULT_SESSION="ses_e3003baccffeSQWqEzl3WNnH9o"   # 当前这条 OpenCode 对话
MODEL="${SUPERVISOR_MODEL:-volcengine-plan/deepseek-v4.1-flash-economy}"
SESSION=""
MODE="fresh"
SINCE=""
DRY=0
FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --continue-session) MODE="continue"; SESSION="$DEFAULT_SESSION"; shift ;;
    --session) MODE="continue"; SESSION="$2"; shift 2 ;;
    --since) SINCE="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//' ; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

command -v opencode >/dev/null 2>&1 || { echo "opencode 不在 PATH" >&2; exit 3; }

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

PROMPT="$(cat <<EOF
你是 MathSlot 的外部监督者（opencode-supervisor）。只审查，不改代码。

仓库：$ROOT
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
- cargo test --workspace（可加 --quiet）
- scripts/agent/acceptance.sh --fast

判定三档：APPROVE / REJECT / BLOCKED。规则见 .opencode/agents/supervisor.md。

只允许写一个文件：agent-state/reviews/REV-${HEAD}.md
格式必须包含 front matter（head/short/verdict/task/defects/reviewer/date）与
末尾机器可读两行：verdict: ... 与 head: ...

不要修改代码、测试、docs/LLM_IMPLEMENTATION_SPEC.md、scripts/agent/**；不要 git push。
完成后只回复：verdict + 三行理由 + REV 路径。
EOF
)"

if [[ $DRY -eq 1 ]]; then
  printf '%s\n' "$PROMPT"
  exit 0
fi

echo "审查 HEAD $HEAD（Gate $GATE）…"
if [[ "$MODE" == "continue" ]]; then
  opencode run -s "$SESSION" --agent supervisor -m "$MODEL" --auto "$PROMPT"
  RC=$?
else
  opencode run --archived --agent supervisor -m "$MODEL" --auto "$PROMPT"
  RC=$?
fi

if [[ $RC -ne 0 ]]; then
  echo "opencode 退出码 $RC" >&2
fi

if [[ ! -f "$REV" ]]; then
  echo "未产出 $REV（opencode 可能失败或未写文件）" >&2
  exit 4
fi

echo "$HEAD" > agent-state/reviews/.last
{
  printf '%s\t%s\t%s\t%s\n' "$(date -Iseconds)" "$HEAD" "$GATE" "$REV"
} >> agent-state/reviews/index.tsv

echo "完成：$REV"
tail -n 4 "$REV"
