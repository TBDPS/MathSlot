#!/usr/bin/env python3
"""check_review.py 的安全回归测试（对应 ADR-0003 / REV-2e256cd 第 3 条）。

运行：python3 -m unittest discover -s scripts/agent/tests -v
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "agent"))

import check_review  # noqa: E402

FULL = "2e256cd7ee852bf4a501310263a2c7932cd9ffcc"


def write_rev(root: Path, name: str, *, head: str, verdict: str, reviewer: str = "opencode-supervisor") -> None:
    d = root / "agent-state" / "reviews"
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_text(
        f"---\nhead: {head}\nshort: {head[:7]}\nverdict: {verdict}\nreviewer: {reviewer}\n---\n\nbody\n",
        encoding="utf-8",
    )


class CheckReviewTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_exact_full_sha_approves(self) -> None:
        write_rev(self.root, "REV-ok.md", head=FULL, verdict="APPROVE")
        self.assertTrue(check_review.evaluate(self.root, FULL)["approved"])

    def test_short_sha_forgery_is_rejected(self) -> None:
        # 旧实现的 bug：head: 2 会匹配所有 2* 的 HEAD。
        write_rev(self.root, "REV-forged.md", head="2", verdict="APPROVE")
        self.assertFalse(check_review.evaluate(self.root, FULL)["approved"])

    def test_reject_is_not_approved(self) -> None:
        write_rev(self.root, "REV-reject.md", head=FULL, verdict="REJECT")
        self.assertFalse(check_review.evaluate(self.root, FULL)["approved"])

    def test_untrusted_reviewer_is_rejected(self) -> None:
        write_rev(self.root, "REV-fake.md", head=FULL, verdict="APPROVE", reviewer="coordinator")
        self.assertFalse(check_review.evaluate(self.root, FULL)["approved"])

    def test_body_verdict_does_not_count(self) -> None:
        d = self.root / "agent-state" / "reviews"
        d.mkdir(parents=True, exist_ok=True)
        (d / "REV-body.md").write_text(
            f"---\nhead: {FULL}\nverdict: REJECT\nreviewer: opencode-supervisor\n---\n\nverdict: APPROVE\n",
            encoding="utf-8",
        )
        self.assertFalse(check_review.evaluate(self.root, FULL)["approved"])

    def test_twelve_char_prefix_matches(self) -> None:
        write_rev(self.root, "REV-prefix.md", head=FULL[:12], verdict="APPROVE")
        self.assertTrue(check_review.evaluate(self.root, FULL)["approved"])


if __name__ == "__main__":
    unittest.main()
