#!/usr/bin/env python3
"""检查某个 HEAD 是否有外部监督者（OpenCode supervisor）的 APPROVE 审查。

用法：
  check_review.py --head <sha>                 # 0=有 APPROVE；1=没有
  check_review.py --head <sha> --json
  check_review.py --root /tmp/fixture --head abc123...   # 测试用

安全规则（ADR-0003）：
  - 只认 front matter 里的 verdict / head / reviewer；
  - head 匹配要求 40 位全等，或等长前缀且长度 >= 12（拒绝 "head: 2" 这类伪造）；
  - reviewer 必须是 opencode-supervisor。
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIN_PREFIX = 12
TRUSTED_REVIEWER = "opencode-supervisor"


def front_matter(text: str) -> dict[str, str]:
    m = re.match(r"^---\s*\n(.*?)\n---\s*(\n|$)", text, re.S)
    block = m.group(1) if m else ""
    data: dict[str, str] = {}
    for line in block.splitlines():
        mm = re.match(r"^([A-Za-z_]+):\s*(.*)$", line.strip())
        if mm:
            data[mm.group(1).lower()] = mm.group(2).strip().strip("'\"")
    return data


def head_matches(target: str, candidate: str) -> bool:
    target = target.strip().lower()
    candidate = candidate.strip().lower()
    if not target or not candidate:
        return False
    if target == candidate:
        return True
    shorter = min(len(target), len(candidate))
    if shorter < MIN_PREFIX:
        return False
    return target.startswith(candidate) or candidate.startswith(target)


def evaluate(root: Path, head: str) -> dict:
    reviews_dir = root / "agent-state" / "reviews"
    found = []
    for rev in sorted(reviews_dir.glob("REV-*.md"), reverse=True):
        meta = front_matter(rev.read_text(encoding="utf-8", errors="replace"))
        cand = meta.get("head", "")
        reviewer = meta.get("reviewer", "")
        verdict = meta.get("verdict", "").upper()
        if not head_matches(head, cand):
            continue
        trusted = reviewer == TRUSTED_REVIEWER
        found.append(
            {
                "file": str(rev.relative_to(root)),
                "verdict": verdict,
                "head": cand,
                "reviewer": reviewer,
                "trusted_reviewer": trusted,
                "approved": trusted and verdict == "APPROVE",
            }
        )
    approved = any(f["approved"] for f in found)
    return {"head": head, "approved": approved, "reviews": found}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(ROOT))
    ap.add_argument("--head", default="")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    root = Path(args.root)
    head = args.head.strip()
    if head and len(head) < 40:
        # 允许调用者传短 sha（acceptance.sh 传 7 位），先解析成完整 sha 再比对。
        try:
            head = subprocess.check_output(
                ["git", "-C", str(root), "rev-parse", head], text=True, stderr=subprocess.DEVNULL
            ).strip()
        except Exception:
            pass
    if not head:
        head = subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "--short", "HEAD"], text=True
        ).strip()

    result = evaluate(root, head)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        if result["approved"]:
            print(f"APPROVE 存在：{head}")
        elif result["reviews"]:
            r = result["reviews"][0]
            why = "reviewer 不可信" if not r["trusted_reviewer"] else r["verdict"]
            print(f"审查不算通过：{why} ({r['file']})")
        else:
            print(f"缺少监督者审查：{head}")
    return 0 if result["approved"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
