#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""扫一遍：有没有别的地方把 .catch() 直接挂在 Supabase 查询链上。

PostgrestBuilder 只有 then，没 catch —— 挂了就抛 TypeError。
判据：从 `.from(` 起，到语句结束（下一个 `;` 或换行后非链式行）之前出现 `.catch(`。
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCAN = [ROOT / "public" / "tools", ROOT / "public" / "assets" / "js", ROOT / "src"]
SKIP = ("vendor", "node_modules", ".min.", "three.module", "stockfish", "katex")

CHAIN = re.compile(r"\.from\(\s*['\"]([A-Za-z_][\w]*)['\"]\s*\)", re.S)

hits = []
for base in SCAN:
    for p in base.rglob("*.js"):
        sp = str(p).replace("\\", "/")
        if any(k in sp for k in SKIP):
            continue
        try:
            src = p.read_text(encoding="utf-8")
        except Exception:
            continue
        for m in CHAIN.finditer(src):
            tail = src[m.end():m.end() + 700]
            # 截到本次链式调用结束：出现 ; 或 } 或空白行
            cut = len(tail)
            for ch in (";", "}"):
                i = tail.find(ch)
                if i != -1:
                    cut = min(cut, i)
            seg = tail[:cut]
            if ".catch(" in seg:
                line = src[:m.start()].count("\n") + 1
                snippet = re.sub(r"\s+", " ", seg)[:150]
                hits.append((str(p.relative_to(ROOT)), line, m.group(1), snippet))

if not hits:
    print("没发现：查询链上没有直接挂 .catch 的地方")
else:
    print(f"发现 {len(hits)} 处：")
    for f, ln, tbl, snip in hits:
        print(f"  {f}:{ln}  table={tbl}")
        print(f"    {snip}")
