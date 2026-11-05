# -*- coding: utf-8 -*-
"""修复 UPC 模板的 \Bbbk 冲突：把 amsmath,amssymb 提到 newtxmath 之前加载。
   备份原文件，改完自检。"""
import shutil
import time
from pathlib import Path

SRC = Path(r"E:\科研项目\国际大学生物理竞赛\2026国际决赛\UPC Resource\11_论文模板与工具\LaTeX模板\main.tex")

bak = SRC.with_name(SRC.name + ".bak-" + time.strftime("%Y%m%d-%H%M%S"))
shutil.copy2(SRC, bak)
print("backup ->", bak)

text = SRC.read_text(encoding="utf-8")
lines = text.split("\n")

i_newtx = next(i for i, l in enumerate(lines) if "newtxtext" in l and "usepackage" in l)
i_ams = next(i for i, l in enumerate(lines) if "amsmath,amssymb" in l and "usepackage" in l)
print(f"newtxmath 在第 {i_newtx+1} 行, amssymb 在第 {i_ams+1} 行")

assert i_ams > i_newtx, "顺序已经是 amssymb 在前，无需修改"

ins = r"\usepackage{amsmath,amssymb}      % 必须先于 newtxmath：否则 \Bbbk 重复定义"
lines.insert(i_newtx, ins)
del lines[i_ams + 1]          # 插入后原行索引 +1

out = "\n".join(lines)
SRC.write_text(out, encoding="utf-8", newline="\n")

# 自检
chk = SRC.read_text(encoding="utf-8").split("\n")
a = next(i for i, l in enumerate(chk) if "amsmath,amssymb" in l)
n = next(i for i, l in enumerate(chk) if "newtxtext" in l and "usepackage" in l)
print(f"修改后: amssymb 在第 {a+1} 行, newtxmath 在第 {n+1} 行 -> {'OK' if a < n else 'STILL WRONG'}")
print(f"amsmath,amssymb 出现次数: {sum('amsmath,amssymb' in l for l in chk)}")
