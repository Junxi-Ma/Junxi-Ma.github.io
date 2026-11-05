# -*- coding: utf-8 -*-
"""修复 VS Code settings.json：合并两个顶层对象，并调整 LaTeX Workshop
   默认 recipe，避开需要 Perl 的 latexmk。"""
import json
import re
import shutil
import time
from pathlib import Path

P = Path(r"C:\Users\35002\AppData\Roaming\Code\User\settings.json")


def split_top_objects(s: str):
    """按顶层 {} 切分，忽略字符串内部的括号。"""
    parts, depth, start = [], 0, None
    in_str = esc = False
    for i, c in enumerate(s):
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == "{":
            if depth == 0:
                start = i
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                parts.append(s[start:i + 1])
    return parts


def strip_trailing_commas(t: str) -> str:
    return re.sub(r",(\s*[}\]])", r"\1", t)


raw = P.read_text(encoding="utf-8-sig")

# 备份
bak = P.with_suffix(f".json.bak-{time.strftime('%Y%m%d-%H%M%S')}")
shutil.copy2(P, bak)
print(f"backup -> {bak}")

parts = split_top_objects(raw)
print(f"found {len(parts)} top-level object(s)")

merged = {}
for i, p in enumerate(parts, 1):
    obj = json.loads(strip_trailing_commas(p))
    print(f"  object {i}: {len(obj)} keys")
    for k, v in obj.items():
        if k in merged and merged[k] != v:
            print(f"  ! key conflict, later wins: {k}")
        merged[k] = v

# --- 调整 LaTeX Workshop：绕开需要 Perl 的 latexmk ---
merged["latex-workshop.latex.clean.method"] = "command"
merged["latex-workshop.latex.autoClean.run"] = "never"

recipes = merged.get("latex-workshop.latex.recipes")
if isinstance(recipes, list):
    if not any(r.get("name") == "XeLaTeX x2" for r in recipes if isinstance(r, dict)):
        recipes.insert(0, {"name": "XeLaTeX x2", "tools": ["xelatex", "xelatex"]})
    merged["latex-workshop.latex.recipes"] = recipes
merged["latex-workshop.latex.recipe.default"] = "first"

out = json.dumps(merged, ensure_ascii=False, indent=4)
# 校验可解析
json.loads(out)
P.write_text(out, encoding="utf-8", newline="\n")

print(f"\nwritten: {P}  ({len(out.encode('utf-8'))} bytes)")
print("verify: json.loads OK")
print("recipe.default =", merged["latex-workshop.latex.recipe.default"])
print("recipes[0]     =", merged["latex-workshop.latex.recipes"][0])
