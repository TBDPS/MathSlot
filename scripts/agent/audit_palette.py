#!/usr/bin/env python3
"""审阅调色板卡片与命令目录的一致性（只读，不改任何文件）。

检查三件事：
  1. 卡片 badge 是否真的对应一条命令；
  2. 卡片 glyph 是否与命令目录的 glyph_hint 一致；
  3. 卡片 hover 里的 LaTeX 是否与命令目录的 detail 一致。

退出码：0 = 全部一致，1 = 存在不一致。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "src" / "app.rs"
CMD = ROOT / "crates" / "mathslot-core" / "src" / "command.rs"

TILE_RE = re.compile(r"Tile \{(?P<body>[^}]*)\}")
SUBE_RE = re.compile(r"SubEntry \{(?P<body>[^}]*)\}")


def field(body: str, name: str) -> str | None:
    m = re.search(rf'{name}: "([^"]*)"', body)
    return m.group(1) if m else None


def first_latex(text: str | None) -> str | None:
    if not text:
        return None
    m = re.search(r"\\+([A-Za-z]+)", text)
    return m.group(1) if m else None


def parse_tiles() -> list[dict]:
    tiles = []
    for m in TILE_RE.finditer(APP.read_text(encoding="utf-8")):
        body = m.group("body")
        tiles.append(
            {
                "code": field(body, "code"),
                "badge": field(body, "badge"),
                "glyph": field(body, "glyph"),
                "label": field(body, "label"),
                "hover": field(body, "hover"),
            }
        )
    return [t for t in tiles if t["code"]]


def parse_commands() -> tuple[dict[str, dict], list[str]]:
    entries: dict[str, dict] = {}
    dupes: list[str] = []
    for m in SUBE_RE.finditer(CMD.read_text(encoding="utf-8")):
        body = m.group("body")
        code = field(body, "code")
        if not code:
            continue
        if code in entries:
            dupes.append(code)
        entries[code] = {
            "label": field(body, "label"),
            "glyph": field(body, "glyph_hint"),
            "latex": first_latex(field(body, "detail")),
            "target": (re.search(r"CommandTarget::([A-Za-z]+)\(([^)]*)\)", body) or [None, None, None])[1],
            "target_val": (re.search(r"CommandTarget::([A-Za-z]+)\(([^)]*)\)", body) or [None, None, None])[2],
        }
    return entries, dupes


def main() -> int:
    if not APP.exists() or not CMD.exists():
        print(f"缺少文件：{APP} 或 {CMD}", file=sys.stderr)
        return 2

    tiles = parse_tiles()
    entries, dupes = parse_commands()

    mismatches: list[tuple[str, str]] = []
    unmapped: list[str] = []

    for tile in tiles:
        code = tile["code"]
        entry = entries.get(code)
        if entry is None:
            unmapped.append(f'{code} ({tile["label"]})')
            continue

        problems = []
        if tile["glyph"] != entry["glyph"]:
            problems.append(f'glyph 卡片={tile["glyph"]} 目录={entry["glyph"]}')
        tile_latex = first_latex(tile["hover"])
        if entry["latex"] and tile_latex != entry["latex"]:
            problems.append(f'latex 卡片={tile_latex} 目录={entry["latex"]}')
        if problems:
            mismatches.append(
                (
                    f'{code} "{tile["label"]}" -> {entry["target"]}::{entry["target_val"]}',
                    "; ".join(problems),
                )
            )

    print(f"扫描：{len(tiles)} 张卡片，{len(entries)} 条子菜单命令")
    if dupes:
        print(f"命令目录重复 code：{sorted(set(dupes))}")

    if mismatches:
        print("\n不一致的卡片：")
        for who, why in mismatches:
            print(f"  - {who}\n      {why}")
    if unmapped:
        print("\n未在命令目录中找到的卡片（可能是直输简码，需人工确认）：")
        for u in unmapped:
            print(f"  - {u}")

    if mismatches:
        print(f"\nFAIL：{len(mismatches)} 张卡片与命令目录不一致")
        return 1

    print("\nPASS：所有可映射卡片与命令目录一致")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
