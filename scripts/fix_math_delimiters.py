"""把 $$ 定界符统一改写成「独占一行」，让 remark-math 正确识别 display math。

两种待修模式：
  A. 行以 $$ 开头但后面还跟内容   $$\begin{aligned}      →  $$\n\begin{aligned}
  B. 行以 $$ 结尾但前面还有内容   \end{aligned}$$         →  \end{aligned}\n$$
"""

import pathlib
import re
import sys

POSTS = pathlib.Path("src/content/posts")

LEADING = re.compile(r"^([ \t]*)\$\$(?!\$)[ \t]*(.+)$")
TRAILING = re.compile(r"^(.+?)(?<!\$)\$\$[ \t]*$")


def fix_text(text: str) -> tuple[str, int]:
    lines = text.split("\n")
    out: list[str] = []
    in_fence = False
    changes = 0

    for line in lines:
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            out.append(line)
            continue
        if in_fence or "$$" not in line or line.strip() == "$$":
            out.append(line)
            continue

        # 先处理 A（开头），再处理 B（结尾）；两者互斥于同一行时按顺序拆开
        m1 = LEADING.match(line)
        if m1:
            indent, content = m1.group(1), m1.group(2)
            out.append(f"{indent}$$")
            line = content
            changes += 1

        m2 = TRAILING.match(line)
        if m2:
            content = m2.group(1)
            out.append(content)
            out.append("$$")
            changes += 1
        elif line != "$$":
            out.append(line)

    return "\n".join(out), changes


def main() -> None:
    apply = "--apply" in sys.argv
    total = 0
    for p in sorted(POSTS.glob("*.md")):
        text = p.read_text(encoding="utf-8")
        new, n = fix_text(text)
        if n:
            total += n
            print(f"{p.name}: {n} 处")
            if apply:
                p.write_text(new, encoding="utf-8", newline="\n")
    print(f"\n{'[已写入]' if apply else '[演练]'} 合计 {total} 处")


if __name__ == "__main__":
    main()
