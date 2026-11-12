#!/usr/bin/env python3
"""检查某个 HEAD 是否有外部监督者的 APPROVE 审查。

用法：
  check_review.py --head <sha>            # 0=有 APPROVE；1=没有/不是 APPROVE
  check_review.py --head <sha> --json     # 输出 JSON 供脚本使用
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REV_DIR = ROOT / "agent-state" / "reviews"


def read_verdict(path: Path) -> tuple[str | None, str | None]:
    text = path.read_text(encoding="utf-8", errors="replace")
    verdict = None
    head = None
    for line in text.splitlines():
        m = re.match(r"^verdict:\s*(\S+)", line.strip())
        if m:
            verdict = m.group(1).upper()
        m = re.match(r"^head:\s*(\S+)", line.strip())
        if m:
            head = m.group(1)
    return verdict, head


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--head", default="", help="目标 commit（默认 git HEAD）")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    head = args.head or subprocess.check_output(
        ["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"], text=True
    ).strip()

    found = []
    for rev in sorted(REV_DIR.glob("REV-*.md"), reverse=True):
        verdict, rev_head = read_verdict(rev)
        if not rev_head:
            continue
        if head.startswith(rev_head) or rev_head.startswith(head):
            found.append({"file": str(rev.relative_to(ROOT)), "verdict": verdict, "head": rev_head})

    approved = any(f["verdict"] == "APPROVE" for f in found)
    result = {"head": head, "approved": approved, "reviews": found}

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        if approved:
            print(f"APPROVE 存在：{head}")
        elif found:
            print(f"审查存在但不是 APPROVE：{found[0]['verdict']} ({found[0]['file']})")
        else:
            print(f"缺少监督者审查：{head}")
    return 0 if approved else 1


if __name__ == "__main__":
    raise SystemExit(main())
