#!/usr/bin/env bash
# Antigravity Stop hook：记录每轮结束，并在缺少外部审查时留下 pending 标记。
# 只读 + 追加日志，不调用模型，不阻塞 agent（始终输出 {}）。

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mkdir -p "$ROOT/agent-state/reviews"

TMP="$(mktemp /tmp/mathslot-hook-stop.XXXXXX.json)"
cat > "$TMP"

python3 - "$ROOT" "$TMP" <<'PY' >/tmp/mathslot-hook-stop.log 2>&1 || true
import json, subprocess, sys, datetime
from pathlib import Path

root = Path(sys.argv[1])
try:
    data = json.loads(Path(sys.argv[2]).read_text() or "{}")
except Exception:
    data = {}

head = ""
try:
    head = subprocess.check_output(["git", "-C", str(root), "rev-parse", "--short", "HEAD"], text=True).strip()
except Exception:
    pass

row = {
    "ts": datetime.datetime.now().isoformat(timespec="seconds"),
    "head": head,
    "conversation": data.get("conversationId", ""),
    "reason": data.get("terminationReason", ""),
    "last_user": (data.get("lastUserInput") or "")[:300],
    "cwd": data.get("cwd", ""),
}
with (root / "agent-state" / "turns.jsonl").open("a", encoding="utf-8") as f:
    f.write(json.dumps(row, ensure_ascii=False) + "\n")

approved = False
try:
    subprocess.run(
        [sys.executable, str(root / "scripts" / "agent" / "check_review.py"), "--head", head],
        check=True,
        capture_output=True,
    )
    approved = True
except Exception:
    approved = False

if head and not approved:
    (root / "agent-state" / "reviews" / ".pending").write_text(head + "\n", encoding="utf-8")
PY

rm -f "$TMP"

# Antigravity Stop hook 必须返回空 JSON 对象才允许正常停止。
echo '{}'
