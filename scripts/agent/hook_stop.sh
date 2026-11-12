#!/usr/bin/env bash
# Antigravity Stop hook：
#   1) 记录每轮结束；
#   2) 没有 APPROVE 审查时留下 pending 标记；
#   3) 若 agent-state/AUTORUN 存在，则有界地自动续跑（夜间模式）。
#
# 自动续跑的安全阀：
#   - agent-state/DONE 或 STOPPED 存在 → 允许停；
#   - 用户取消、token 预算耗尽、非 idle → 允许停；
#   - 配额错误 → 写 STOPPED，允许停；
#   - 连续 2 次进度哈希不变 → 写 STOPPED，允许停；
#   - 最多 AUTORUN_MAX 次（默认 30）→ 写 STOPPED，允许停。
#
# 永远输出合法 JSON；解析失败时输出 {}。

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mkdir -p "$ROOT/agent-state/reviews" "$ROOT/agent-state"

TMP="$(mktemp /tmp/mathslot-hook-stop.XXXXXX.json)"
cat > "$TMP"

DECISION="$(python3 - "$ROOT" "$TMP" <<'PY' 2>/tmp/mathslot-hook-stop.err
import hashlib
import json
import subprocess
import sys
import datetime
from pathlib import Path

root = Path(sys.argv[1])
state_dir = root / "agent-state"

try:
    data = json.loads(Path(sys.argv[2]).read_text() or "{}")
except Exception:
    data = {}


def git(*args: str) -> str:
    try:
        return subprocess.check_output(["git", "-C", str(root), *args], text=True, stderr=subprocess.DEVNULL)
    except Exception:
        return ""


head = git("rev-parse", "--short", "HEAD").strip()
status = git("status", "--porcelain")
status = "\n".join(line for line in status.splitlines() if "agent-state/" not in line)
try:
    state_text = (state_dir / "state.json").read_text()
except Exception:
    state_text = ""
progress = hashlib.sha1((head + "\n" + status + "\n" + state_text).encode()).hexdigest()

now = datetime.datetime.now().isoformat(timespec="seconds")
row = {
    "ts": now,
    "head": head,
    "conversation": data.get("conversationId", ""),
    "reason": data.get("terminationReason", ""),
    "continuation": data.get("continuationActive", False),
    "fully_idle": data.get("fullyIdle", None),
    "last_user": (data.get("lastUserInput") or "")[:300],
    "progress": progress[:12],
}
with (state_dir / "turns.jsonl").open("a", encoding="utf-8") as f:
    f.write(json.dumps(row, ensure_ascii=False) + "\n")

# pending 标记（没有 APPROVE 审查时）
approved = False
try:
    subprocess.run(
        [sys.executable, str(root / "scripts" / "agent" / "check_review.py"), "--head", head],
        check=True, capture_output=True,
    )
    approved = True
except Exception:
    approved = False
if head and not approved:
    (state_dir / "reviews" / ".pending").write_text(head + "\n", encoding="utf-8")

autorun = (state_dir / "AUTORUN").exists()
done = (state_dir / "DONE").exists()
stopped = (state_dir / "STOPPED").exists()
reason = str(data.get("terminationReason", ""))
error = str(data.get("error", "") or "").lower()
fully_idle = data.get("fullyIdle", True)
continuing = bool(data.get("continuationActive", False))
max_runs = int(__import__("os").environ.get("AUTORUN_MAX", "30"))

decision = {}


def stop(reason_text: str) -> None:
    (state_dir / "STOPPED").write_text(
        f"ts={now}\nreason={reason_text}\nhead={head}\n", encoding="utf-8"
    )


if autorun and not done and not stopped:
    quota = any(k in error for k in ("quota", "usage limit", "exceeded"))
    if reason in ("USER_CANCELED", "MAX_TOKEN_BUDGET_EXCEEDED"):
        decision = {}
    elif quota:
        stop("quota-or-usage-limit")
        decision = {}
    elif fully_idle is False:
        decision = {}
    else:
        count_file = state_dir / ".autorun-count"
        hash_file = state_dir / ".autorun-hash"
        stall_file = state_dir / ".autorun-stall"

        count = int(count_file.read_text().strip() or "0") if count_file.exists() else 0
        if not continuing:
            count = 0
            stall = 0
        else:
            stall = int(stall_file.read_text().strip() or "0") if stall_file.exists() else 0

        last_hash = hash_file.read_text().strip() if hash_file.exists() else ""
        if last_hash and last_hash == progress:
            stall += 1
        else:
            stall = 0

        if stall >= 2:
            stop("no-progress-twice")
            decision = {}
        elif count >= max_runs:
            stop(f"auturun-cap-{max_runs}")
            decision = {}
        else:
            count += 1
            count_file.write_text(str(count) + "\n", encoding="utf-8")
            hash_file.write_text(progress + "\n", encoding="utf-8")
            stall_file.write_text(str(stall) + "\n", encoding="utf-8")
            decision = {
                "decision": "continue",
                "reason": (
                    f"AUTORUN {count}/{max_runs}：先运行 scripts/agent/resume.sh，"
                    "按 AGENT_START.md 继续当前 T-*；每轮更新 state.json 与 HANDOFF.md；"
                    "G4 完成后写 agent-state/DONE 并写 OVERNIGHT_REPORT.md；"
                    "触发停机规则写 agent-state/STOPPED。不要建 swarm，不要外部审查。"
                ),
            }

print(json.dumps(decision, ensure_ascii=False))
PY
)" || DECISION='{}'

rm -f "$TMP"

# 兜底：任何异常都输出合法 JSON。
if [[ -z "${DECISION:-}" ]]; then
  DECISION='{}'
fi
printf '%s\n' "$DECISION"
