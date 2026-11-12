#!/usr/bin/env bash
# 恢复卡：每个用户回合（尤其上下文压缩后）先跑这个，再读文件。
# 不调用模型，不修改任何文件。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "== MathSlot 恢复卡 =="
python3 - <<'PY'
import json
from pathlib import Path

d = json.loads(Path("agent-state/state.json").read_text())
print(f"gate={d.get('gate')} round={d.get('round')} active={d.get('active_task')} next={d.get('next_task')}")
print(f"open_p1={','.join(d.get('open_p1', [])) or '-'}")
print(f"new_defects={','.join(d.get('new_defects', [])) or '-'}")
print(f"last_verdict={d.get('last_verdict') or '-'} no_progress={d.get('no_progress_rounds', 0)}")
r = d.get("reviews", {})
print(f"external_review={r.get('mode', '-')} last={r.get('last_verdict') or '-'}")
PY

echo "branch=$(git rev-parse --abbrev-ref HEAD) head=$(git rev-parse --short HEAD) dirty=$(git status --porcelain | wc -l)"
echo "latest_audit=$(ls -t agent-state/audits/AUD-*.md 2>/dev/null | head -1 || echo '-')"
echo "latest_verify=$(ls -t agent-state/verify/VER-*.md 2>/dev/null | head -1 || echo '-')"
echo
echo "必读（按顺序）："
echo "  1. AGENTS.md"
echo "  2. agent-state/RESUME.md"
echo "  3. agent-state/state.json 与 agent-state/HANDOFF.md"
echo "  4. docs/LLM_IMPLEMENTATION_SPEC.md 的 §2、§4、§14"
echo "  5. 最近一份 AUD-*.md 与 VER-*.md"
echo
echo "当前模式：串行；不建 swarm；外部审查 final-only；一次一个 T-*。"
echo "第一步：按 agent-state/RESUME.md 与 AGENT_START.md 的 A→D→I→V 流程继续。"
