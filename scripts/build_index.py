#!/usr/bin/env python3
"""build_index.py — 扫描 notes/ 与 tools/，生成 data/index.json。

纯标准库，零第三方依赖。本地与 GitHub Actions 均可运行：

    python scripts/build_index.py

幂等性保证（重要）：内容不变则输出字节级一致 —— 不写时间戳、
确定性排序。CI 依赖这一点判断「无变化则跳过」。
"""

from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NOTES_DIR = ROOT / "notes"
TOOLS_DIR = ROOT / "tools"
OUT_FILE = ROOT / "data" / "index.json"

VERSION = 1
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
HEADING_RE = re.compile(r"^#\s+(.+)$", re.M)
FM_RE = re.compile(r"^---\r?\n(.*?)\r?\n---\r?\n?", re.S)
TITLE_TAG_RE = re.compile(r"<title>(.*?)</title>", re.S | re.I)
DESC_TAG_RE = re.compile(r'<meta\s+name="description"\s+content="([^"]*)"', re.I)


def warn(msg: str) -> None:
    print(f"[warn] {msg}", file=sys.stderr)


# ---------------------------------------------------------------- frontmatter


def strip_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """解析简单 YAML 子集，返回 (元数据, 正文)。

    支持：key: value、引号字符串、tags: [a, b]、
    tags:\\n  - item 块列表。不认识的行一律忽略。
    """
    m = FM_RE.match(text)
    if not m:
        return {}, text

    meta: dict = {}
    list_key: str | None = None
    for line in m.group(1).splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        li = re.match(r"^\s+-\s+(.*)$", line)
        if li and list_key:
            meta[list_key].append(strip_quotes(li.group(1).strip()))
            continue

        kv = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if not kv:
            continue
        key, value = kv.group(1), kv.group(2).strip()

        if value == "":
            meta[key] = []
            list_key = key
            continue
        list_key = None

        if value.startswith("[") and value.endswith("]"):
            meta[key] = [
                strip_quotes(v.strip()) for v in value[1:-1].split(",") if v.strip()
            ]
        else:
            meta[key] = strip_quotes(value)

    return meta, text[m.end():]


def strip_markdown(md: str) -> str:
    """去掉 Markdown 语法标记，得到纯文本（用于摘要）。"""
    s = md
    s = re.sub(r"```.*?```", " ", s, flags=re.S)
    s = re.sub(r"`([^`]*)`", r"\1", s)
    s = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", s)
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)
    s = re.sub(r"^\s{0,3}#{1,6}\s+", "", s, flags=re.M)
    s = re.sub(r"^\s{0,3}>\s?", "", s, flags=re.M)
    s = re.sub(r"^\s{0,3}[-*+]\s+", "", s, flags=re.M)
    s = re.sub(r"^\s{0,3}\d+\.\s+", "", s, flags=re.M)
    s = re.sub(r"[*_~]{1,3}([^*_~]+)[*_~]{1,3}", r"\1", s)
    s = re.sub(r"^\s*(?:\|[\s|-]*\|?|-{3,})\s*$", " ", s, flags=re.M)  # 表格分隔行/分隔线
    s = s.replace("|", " ")
    return re.sub(r"\s+", " ", s).strip()


def valid_date(value) -> str | None:
    if not isinstance(value, str) or not DATE_RE.match(value):
        return None
    try:
        date.fromisoformat(value)
    except ValueError:
        return None
    return value


def normalize_tags(value) -> list[str]:
    if isinstance(value, list):
        return [str(t).strip() for t in value if str(t).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


# ------------------------------------------------------------------- 扫描笔记


def scan_notes() -> list[dict]:
    if not NOTES_DIR.is_dir():
        return []

    notes = []
    for path in sorted(NOTES_DIR.rglob("*.md")):
        rel = path.relative_to(ROOT).as_posix()
        # 跳过隐藏/草稿（. 或 _ 开头的文件或目录）
        if any(part.startswith((".", "_")) for part in path.relative_to(NOTES_DIR).parts):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError) as e:
            warn(f"跳过 {rel}: 无法读取（{e}）")
            continue

        try:
            meta, body = parse_frontmatter(text)

            # title 回退链：frontmatter → 首个一级标题 → 文件名
            title = str(meta.get("title") or "").strip()
            if not title:
                h = HEADING_RE.search(body)
                title = h.group(1).strip() if h else path.stem
            title = re.sub(r"[*_`]", "", title)

            # description 回退链：frontmatter → 首段纯文本（160 字截断）
            desc = str(meta.get("description") or "").strip()
            if not desc:
                plain = strip_markdown(body)
                desc = plain[:160] + ("…" if len(plain) > 160 else "")

            notes.append(
                {
                    "path": rel,
                    "title": title,
                    "date": valid_date(meta.get("date")),
                    "tags": normalize_tags(meta.get("tags")),
                    "description": desc,
                }
            )
        except Exception as e:  # 单文件解析失败不拖垮整体
            warn(f"跳过 {rel}: 解析失败（{e!r}）")

    # 排序：日期倒序（无日期最后），同日期按路径升序 → 确定性输出
    notes.sort(
        key=lambda n: (
            n["date"] is None,
            tuple(-int(x) for x in n["date"].split("-")) if n["date"] else (),
            n["path"],
        )
    )
    return notes


# ------------------------------------------------------------------- 扫描工具


def scan_tools() -> list[dict]:
    if not TOOLS_DIR.is_dir():
        return []

    tools = []
    for index in sorted(TOOLS_DIR.glob("*/index.html")):
        folder = index.parent
        rel_dir = folder.relative_to(ROOT).as_posix() + "/"
        try:
            html = index.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError) as e:
            warn(f"跳过 {rel_dir}: 无法读取（{e}）")
            continue

        try:
            meta: dict = {}
            meta_file = folder / "meta.json"
            if meta_file.is_file():
                meta = json.loads(meta_file.read_text(encoding="utf-8"))

            # title：meta.json 优先，否则 <title> 取「—」前的第一段
            title = str(meta.get("title") or "").strip()
            if not title:
                t = TITLE_TAG_RE.search(html)
                raw = t.group(1).strip() if t else folder.name
                title = re.split(r"\s+[—|–]\s+", raw)[0].strip() or folder.name

            desc = str(meta.get("description") or "").strip()
            if not desc:
                d = DESC_TAG_RE.search(html)
                desc = d.group(1).strip() if d else ""

            order = meta.get("order")
            if not isinstance(order, int):
                order = 100

            tools.append(
                {
                    "path": rel_dir,
                    "title": title,
                    "description": desc,
                    "tags": normalize_tags(meta.get("tags")),
                    "icon": str(meta.get("icon") or "🔧").strip(),
                    "order": order,
                }
            )
        except Exception as e:
            warn(f"跳过 {rel_dir}: 解析失败（{e!r}）")

    tools.sort(key=lambda t: (t["order"], t["title"], t["path"]))
    return tools


# ----------------------------------------------------------------------- main


def build() -> dict:
    # 不写时间戳：保证同输入 → 同输出（CI 幂等判断依赖这一点）
    return {"version": VERSION, "notes": scan_notes(), "tools": scan_tools()}


def main() -> int:
    # Windows 控制台默认 GBK，统一为 UTF-8（CI 上为 no-op）
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass

    try:
        data = build()
    except Exception as e:
        print(f"[fatal] 生成失败: {e!r}", file=sys.stderr)
        return 1

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    OUT_FILE.write_text(payload, encoding="utf-8", newline="\n")

    print(
        f"OK → {OUT_FILE.relative_to(ROOT).as_posix()}  "
        f"(notes: {len(data['notes'])}, tools: {len(data['tools'])})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
