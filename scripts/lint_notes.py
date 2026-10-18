#!/usr/bin/env python3
"""lint_notes.py —— 检查笔记里最容易踩的 Markdown 排版坑。

纯标准库，零第三方依赖。

    python scripts/lint_notes.py              # 检查 notes/ 下全部 .md
    python scripts/lint_notes.py a.md b.md    # 只检查指定文件

发现问题时退出码为 1（方便 pre-commit / CI 拦截）。

为什么需要它：这些坑的共同点是「源码看着没问题，渲染出来却坏了」，
肉眼逐行检查很难发现，必须按渲染规则机械校验。

检查项：
  1. 强调 ** 的 flanking 规则 —— 结尾 ** 前面是标点、后面紧跟文字时无法闭合，
     星号会原样显示。中文写作里 **词（注释）**后面接汉字就会踩到。
     正确写法：把括号移到加粗外面，即 **词**（注释）。
  2. 半角波浪号 ≥2 —— 同一段落里两两配对成删除线，波浪号消失、文字被划掉。
     正确写法：用全角「～」。
  3. 标题里的括号说明 —— 仅对「标题不带括号」约定过的笔记启用（见 STRICT_HEADING_FILES）。
     其他笔记标题里的页码等括号是有用信息，不在此列。
  4. 粘贴来的 LaTeX 残留 \\( \\) —— KaTeX 会报错。
  5. 数学公式 $ 不配对（已正确处理跨行的 $$ 块）。
"""

from __future__ import annotations

import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NOTES_DIR = ROOT / "notes"

MATH_INLINE = re.compile(r"\$([^$\n]+?)\$")
HEADING = re.compile(r"^(#{2,4})\s+(.*)$")
FENCE = re.compile(r"^\s*(```|~~~)")

ASCII_PUNCT = set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")

# 这些笔记约定「小节标题不带括号说明」；其余笔记标题里的括号（如页码）保留。
STRICT_HEADING_FILES = {"notes/synoptic-principles-notes.md"}


def is_punct(ch: str) -> bool:
    """CommonMark 意义下的「标点」：ASCII 标点或 Unicode P* 类。"""
    if not ch:
        return False
    if ch in ASCII_PUNCT:
        return True
    return unicodedata.category(ch).startswith("P")


def is_space(ch: str) -> bool:
    return (not ch) or ch.isspace()


def prose_chunks(line: str, in_display: bool) -> tuple[list[str], bool]:
    """切出「不在 $$ 公式块里」的散文片段，可跨行维护状态。"""
    chunks: list[str] = []
    buf: list[str] = []
    i = 0
    n = len(line)
    while i < n:
        if line.startswith("$$", i):
            if not in_display:
                chunks.append("".join(buf))
                buf = []
                in_display = True
            else:
                in_display = False
            i += 2
        else:
            if not in_display:
                buf.append(line[i])
            i += 1
    if buf:
        chunks.append("".join(buf))
    return chunks, in_display


def stash_inline(text: str) -> str:
    return MATH_INLINE.sub(lambda m: "\x00", text)


def check_emphasis(prose: str) -> list[str]:
    """检查成对的 ** 是否都满足 flanking 规则。"""
    problems = []
    starts = [m.start() for m in re.finditer(r"\*\*", prose)]
    for k in range(0, len(starts) - 1, 2):
        op, cl = starts[k], starts[k + 1]

        prev = prose[op - 1] if op > 0 else ""
        nxt = prose[op + 2] if op + 2 < len(prose) else ""
        if is_space(nxt) or (is_punct(nxt) and not (is_space(prev) or is_punct(prev))):
            problems.append("开头的 ** 无法开启强调（后面紧跟标点）")

        prev = prose[cl - 1] if cl > 0 else ""
        nxt = prose[cl + 2] if cl + 2 < len(prose) else ""
        if is_space(prev) or (is_punct(prev) and not (is_space(nxt) or is_punct(nxt))):
            problems.append(
                "结尾的 ** 无法闭合强调（前面是标点、后面紧跟文字）→ 星号会原样显示；"
                "把括号移到加粗外面即可"
            )
    return problems


def check_file(path: Path) -> list[tuple[int, str, str]]:
    """返回 [(行号, 问题描述, 原始行)]。"""
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError) as e:
        return [(0, f"无法读取：{e}", "")]

    try:
        rel = path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        rel = path.as_posix()
    strict_heading = rel in STRICT_HEADING_FILES

    issues: list[tuple[int, str, str]] = []
    in_fence = False
    in_display = False

    for lineno, raw in enumerate(text.splitlines(), 1):
        if FENCE.match(raw) and not in_display:
            in_fence = not in_fence
            continue
        if in_fence:
            continue

        chunks, in_display = prose_chunks(raw, in_display)

        # 标题规则用原始行判断（标题里不会有公式块）
        h = HEADING.match(raw)
        if strict_heading and h and ("（" in h.group(2) or "(" in h.group(2)):
            issues.append((lineno, "标题里带括号说明 → 请把补充信息写进正文", raw))

        for chunk in chunks:
            if not chunk:
                continue
            prose = stash_inline(chunk)

            for msg in check_emphasis(prose):
                issues.append((lineno, msg, raw))

            if prose.count("~") >= 2:
                issues.append(
                    (
                        lineno,
                        "半角 ~ 出现 ≥2 个，会配对成删除线 → 请改用全角「～」",
                        raw,
                    )
                )

            if "$" in prose:
                issues.append((lineno, "数学公式 $ 不配对", raw))

        if re.search(r"\\\(|\\\)", raw):
            issues.append((lineno, r"残留 \( 或 \) → KaTeX 会报错", raw))

    return issues


def main(argv: list[str]) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass

    if argv:
        targets = [Path(a) for a in argv]
    else:
        targets = sorted(NOTES_DIR.rglob("*.md")) if NOTES_DIR.is_dir() else []

    total = 0
    checked = 0
    for path in targets:
        if not path.is_file():
            print(f"[skip] {path} 不存在")
            continue
        checked += 1
        try:
            rel = path.resolve().relative_to(ROOT).as_posix()
        except ValueError:
            rel = path.as_posix()

        issues = check_file(path)
        if not issues:
            continue
        total += len(issues)
        print(f"\n{rel}")
        for lineno, msg, raw in issues:
            print(f"  第 {lineno} 行: {msg}")
            if raw.strip():
                print(f"    {raw.strip()[:100]}")

    if total:
        print(f"\n共 {total} 处问题。修复后再提交。")
        return 1

    print(f"OK — 检查了 {checked} 个文件，没有排版问题。")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
