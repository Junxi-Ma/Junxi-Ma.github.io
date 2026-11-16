#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""数独：页面文案里的「下」改成「继续 / 做完」。"""
import pathlib

base = pathlib.Path(__file__).resolve().parent.parent / "public" / "tools" / "sudoku"

PAIRS = [
    ("进度存到云端换设备接着下，下完还能把棋谱收进个人战绩",
     "进度存到云端换设备继续，做完还能把棋谱收进个人战绩"),
    ("换台设备接着下；一局下完可以把棋谱收进「战绩」",
     "换台设备继续；做完一局可以把棋谱收进「战绩」"),
]

total = 0
for name in ("index.html", "meta.json"):
    p = base / name
    s = p.read_text(encoding="utf-8")
    before = s
    for old, new in PAIRS:
        s = s.replace(old, new)
    if s != before:
        p.write_text(s, encoding="utf-8")
        print(f"改：{name}")
        total += 1

# 兜底：确认没有漏网的「接着下 / 下完」
for name in ("index.html", "meta.json"):
    s = (base / name).read_text(encoding="utf-8")
    for bad in ("接着下", "下完", "不下了"):
        if bad in s:
            print(f"  ⚠ {name} 仍有「{bad}」")

print(f"完成，{total} 个文件")
