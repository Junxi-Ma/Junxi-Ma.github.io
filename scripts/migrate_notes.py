#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 notes/*.md 迁移成 Astro 内容集 src/content/posts/*.md

做四件事：
  1. frontmatter 字段改名：date -> published，并补 category
  2. 链接重写：../tools/x/ -> /tools/x/，x.md -> /posts/x/
  3. 无 frontmatter 的笔记按旧站回退规则补全（标题取第一个 # 标题）
  4. 只处理代码块外的文本，避免误改代码示例里的路径

幂等：重复运行结果一致。原 notes/ 不动，仅读取。

用法：python scripts/migrate_notes.py [--dry-run]
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "notes"
DST = ROOT / "src" / "content" / "posts"

# 标签 -> 分类。8 个标签收敛成 6 个分类（工具/生活 目前还没有笔记）。
CATEGORY_MAP = {
    "天气学原理": "天气学原理",
    "动力气象学": "动力气象学",
    "大气探测学": "大气探测学",
    "技术": "技术",
    "工具": "工具",
    "生活": "生活",
    "游戏": "工具",
    "学习": "技术",
}
DEFAULT_CATEGORY = "技术"

# 少数笔记整篇都是列表/代码块，自动摘要取不到段落，这里手工指定（按文件名）。
DESCRIPTION_OVERRIDES = {
    "regex-cheatsheet.md": "常用正则模式速查：行首空白、日期、后行断言、忽略大小写，附回溯与性能陷阱。",
    "welcome.md": "这个网站是怎么运作的：纯静态前端加 Supabase 动态后端、自动内容索引与 GitHub Pages 部署。",
}


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """解析旧站使用的 YAML 子集，返回 (字段字典, 正文)。"""
    text = text.lstrip("\ufeff")
    m = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n?", text, re.S)
    if not m:
        return {}, text

    meta: dict[str, object] = {}
    list_key: str | None = None
    for line in m.group(1).splitlines():
        if not line.strip() or line.strip().startswith("#"):
            continue
        item = re.match(r"^\s+-\s+(.*)$", line)
        if item and list_key:
            meta.setdefault(list_key, [])
            meta[list_key].append(unquote(item.group(1).strip()))  # type: ignore[union-attr]
            continue
        kv = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if not kv:
            continue
        key, val = kv.group(1), kv.group(2).strip()
        if val == "":
            meta[key] = []
            list_key = key
            continue
        list_key = None
        if val.startswith("[") and val.endswith("]"):
            meta[key] = [unquote(s.strip()) for s in val[1:-1].split(",") if s.strip()]
        else:
            meta[key] = unquote(val)
    return meta, text[m.end():]


def unquote(s: str) -> str:
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        return s[1:-1]
    return s


def split_code_fences(body: str) -> list[tuple[bool, str]]:
    """按 ``` 围栏切分，返回 [(是否代码块, 文本片段)]。"""
    parts: list[tuple[bool, str]] = []
    buf: list[str] = []
    in_code = False
    for line in body.splitlines(keepends=True):
        if re.match(r"^\s*```", line):
            parts.append((in_code, "".join(buf)))
            buf = [line]
            in_code = not in_code
            continue
        buf.append(line)
    parts.append((in_code, "".join(buf)))
    return parts


def rewrite_links(body: str) -> str:
    """把站内相对链接改成绝对路径，代码块内不动。"""

    def fix(chunk: str) -> str:
        # 笔记互相引用：](foo.md) 或 ](./foo.md#anchor) -> ](/posts/foo/)
        chunk = re.sub(r"\]\(\.?/?([A-Za-z0-9_-]+)\.md(#[^)]*)?\)", r"](/posts/\1/\2)", chunk)
        # 指向工具目录：](../tools/x/) 或 ](../tools/x/) -> ](/tools/x/)
        chunk = re.sub(r"\]\((?:\.\./)+tools/([A-Za-z0-9_-]+)/?\)", r"](/tools/\1/)", chunk)
        # 指向分支目录
        chunk = re.sub(r"\]\((?:\.\./)+branches/([A-Za-z0-9_-]+)/?\)", r"](/branches/\1/)", chunk)
        # 其余 ../ 开头的站内相对路径统一转根绝对
        chunk = re.sub(r"\]\((?:\.\./)+([A-Za-z0-9_./-]+)\)", r"](/\1)", chunk)
        return chunk

    return "".join(fix(part) if not is_code else part for is_code, part in split_code_fences(body))


def first_heading(body: str) -> str:
    for line in body.splitlines():
        m = re.match(r"^#\s+(.+?)\s*$", line)
        if m:
            return m.group(1)
    return ""


def first_paragraph(body: str) -> str:
    """取首段文字作摘要（跳过标题、引用、表格、列表、空行、代码块）。"""
    in_code = False
    for line in body.splitlines():
        s = line.strip()
        if s.startswith("```"):
            in_code = not in_code
            continue
        if in_code or not s:
            continue
        # 标题 / 引用 / 表格 / 分隔线
        if s.startswith(("#", ">", "|", "---", "***")):
            continue
        # 无序列表与有序列表：它们是条目，不是段落
        if re.match(r"^[-*+]\s+", s) or re.match(r"^\d+\.\s+", s):
            continue
        text = re.sub(r"[*_`\[\]]", "", s)
        text = re.sub(r"\]\([^)]*\)", "", text)
        return text[:120]
    return ""


def file_date(path: Path) -> str:
    return dt.date.fromtimestamp(path.stat().st_mtime).isoformat()


def yaml_str(s: str) -> str:
    """按需给字符串加引号，避免冒号、井号等破坏 YAML。"""
    if s == "":
        return '""'
    if re.search(r"[:#\[\]{}&*!|>'\"%@`]", s) or s != s.strip():
        return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return s


def convert(path: Path) -> tuple[str, dict]:
    raw = path.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(raw)

    title = str(meta.get("title") or first_heading(body) or path.stem)
    description = str(meta.get("description") or DESCRIPTION_OVERRIDES.get(path.name) or first_paragraph(body))
    published = str(meta.get("date") or meta.get("published") or file_date(path))
    tags = meta.get("tags") or []
    if isinstance(tags, str):
        tags = [tags]

    category = ""
    for tag in tags:
        if tag in CATEGORY_MAP:
            category = CATEGORY_MAP[tag]
            break
    if not category:
        category = DEFAULT_CATEGORY

    body = rewrite_links(body)

    # 正文开头的 H1 与 title 重复（模板的 banner 已经显示标题），去掉它。
    # 比较时忽略空白与常见分隔符，因为有的笔记标题写成「云量识别 · 算法修订记录」，
    # 而 frontmatter 的 title 是「云量识别算法修订记录」，两者其实是同一个标题。
    def _norm(s: str) -> str:
        return re.sub(r"[\s·•・\-—–:：,，.。、]", "", s)

    stripped = body.lstrip("\n")
    m_h1 = re.match(r"^#\s+(.+?)\s*\r?\n", stripped)
    if m_h1 and _norm(m_h1.group(1)) == _norm(title):
        stripped = stripped[m_h1.end():].lstrip("\n")
    body = stripped

    out = [
        "---",
        f"title: {yaml_str(title)}",
        f"published: {published}",
        f"description: {yaml_str(description)}",
        f"category: {yaml_str(category)}",
    ]
    if tags:
        out.append("tags: [" + ", ".join(yaml_str(t) for t in tags) + "]")
    out.append("---")
    out.append("")

    stats = {
        "title": title,
        "category": category,
        "tags": list(tags),
        "published": published,
        "had_frontmatter": bool(meta),
    }
    return "\n".join(out) + "\n\n" + body.lstrip("\n"), stats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not SRC.is_dir():
        print(f"[错误] 找不到源目录 {SRC}", file=sys.stderr)
        return 1

    DST.mkdir(parents=True, exist_ok=True)

    files = sorted(SRC.glob("*.md"))
    if not files:
        print("[错误] notes/ 下没有 .md 文件", file=sys.stderr)
        return 1

    print(f"{'[演练] ' if args.dry_run else ''}迁移 {len(files)} 篇笔记 -> {DST.relative_to(ROOT)}\n")
    for f in files:
        text, stats = convert(f)
        target = DST / f.name
        if not args.dry_run:
            # 显式写 LF：仓库的 .gitattributes 要求 * text eol=lf，
            # Windows 上 Path.write_text 默认会把 \n 转成 CRLF，白白制造一堆警告。
            target.write_text(text, encoding="utf-8", newline="\n")
        mark = "" if stats["had_frontmatter"] else "  (无 frontmatter，已按回退规则补全)"
        print(f"  {f.name:44s} 分类={stats['category']:8s} 发布={stats['published']}{mark}")

    print("\n完成。" if not args.dry_run else "\n演练结束，未写文件。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
