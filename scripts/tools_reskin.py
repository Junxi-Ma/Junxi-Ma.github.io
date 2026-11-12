#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把工具页从「旧站暗金壳」换成「Firefly 浅色壳」

改五处，工具自身的业务逻辑与布局一行不动：
  1. <head> 主题脚本：键从 site-theme 换成主站的 theme，同时写 data-theme 与 .dark
  2. CSS 引用：tokens.css + main.css -> tool-shell.css
  3. 顶部完整站点导航 -> 左上「返回站点」胶囊 + 右上主题按钮
  4. 页脚 -> 删除
  5. main.js -> 内联主题脚本（只保留主题切换，不再有导航/进度条逻辑）

保留不动：
  - 工具自己的 style.css / app.js / engine.js / data.js
  - site-gate.js 与 site-gate.css（全站门禁）
  - tool-ui.css（部分工具依赖）
  - KaTeX 等 vendor 资源

幂等：已经改过的页面再跑一遍不会有变化。
用法：python scripts/tools_reskin.py [--dry-run] [--only 目录名]
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "public" / "tools"
BRANCHES = ROOT / "public" / "branches"

# ── 首帧主题脚本（与主站 Firefly 共用 localStorage 键） ──────────────────
THEME_HEAD = """<script>
    /* 首帧前定下主题，避免闪烁。
       与主站共用 localStorage 的 theme / hue 两个键：
       theme ∈ {light, dark, system}；hue 是 0-360 的主题色相。
       同时写 data-theme（部分工具的自有 CSS 仍在用）和 .dark（tool-shell 用）。 */
    (function () {
      var DARK = 'dark', LIGHT = 'light', SYS = 'system';
      var t = null, hue = null;
      try {
        t = localStorage.getItem('theme');
        hue = localStorage.getItem('hue');
      } catch (e) {}
      if (t !== DARK && t !== LIGHT) t = SYS;
      var sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      var dark = t === DARK || (t === SYS && sysDark);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.dataset.theme = dark ? DARK : LIGHT;
      document.documentElement.classList.add('js');
      if (hue) document.documentElement.style.setProperty('--hue', hue);
      var m = document.querySelector('meta[name="theme-color"]');
      if (m) m.content = dark ? '#12181a' : '#f2f5f4';
    })();
  </script>"""

# ── 返回胶囊 + 主题按钮（取代整条站点导航） ─────────────────────────────
BACK_SHELL = """  <a class="tool-back" href="{back_href}">
    <span class="tool-back__arrow" aria-hidden="true">&larr;</span>
    <span>{back_text}</span>
  </a>
  <button class="tool-theme" id="tool-theme" type="button" aria-label="切换深浅色" title="切换深浅色">
    <svg class="tool-theme__sun" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
    </svg>
    <svg class="tool-theme__moon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  </button>"""

# ── 主题切换逻辑（取代 main.js） ────────────────────────────────────────
THEME_SCRIPT = """<script>
    /* 主题切换：写回主站同一套 localStorage 键，回到主站后主题保持一致 */
    (function () {
      var btn = document.getElementById('tool-theme');
      if (!btn) return;
      function apply(dark) {
        var root = document.documentElement;
        root.classList.toggle('dark', dark);
        root.dataset.theme = dark ? 'dark' : 'light';
        var m = document.querySelector('meta[name="theme-color"]');
        if (m) m.content = dark ? '#12181a' : '#f2f5f4';
        try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (e) {}
      }
      btn.addEventListener('click', function () {
        apply(!document.documentElement.classList.contains('dark'));
      });
    })();
  </script>"""


def strip_main_js(html: str) -> tuple[str, int]:
    """删掉 main.js 引用，返回 (新 html, 删除数量)。"""
    pat = re.compile(r'\s*<script type="module" src="(?:\.\./)+assets/js/main\.js"></script>')
    return pat.subn("", html)


def replace_theme_head(html: str) -> tuple[str, int]:
    """替换 <head> 里的主题初始化脚本。"""
    # 已经是新脚本就不动（保证幂等）
    if "与主站共用 localStorage" in html:
        return html, 0
    # 匹配「首帧前定下主题」那段内联脚本（旧站的写法）
    pat = re.compile(
        r"<script>\s*/\*\s*首帧前定下主题.*?</script>",
        re.S,
    )
    new, n = pat.subn(THEME_HEAD, html)
    if n:
        return new, n
    # 退路：按 site-theme 特征匹配
    pat2 = re.compile(r"<script>[^<]*localStorage\.getItem\('site-theme'\).*?</script>", re.S)
    return pat2.subn(THEME_HEAD, html)


def swap_css(html: str) -> tuple[str, list[str]]:
    """tokens.css -> tool-shell.css；删掉 main.css 引用。"""
    done: list[str] = []

    def to_shell(m: re.Match[str]) -> str:
        done.append("tokens→shell")
        return m.group(0).replace("tokens.css", "tool-shell.css")

    html = re.sub(
        r'<link rel="stylesheet" href="(?:\.\./)+assets/css/tokens\.css">',
        to_shell,
        html,
    )

    def drop_main(m: re.Match[str]) -> str:
        done.append("删 main.css")
        return ""

    html = re.sub(
        r'\s*<link rel="stylesheet" href="(?:\.\./)+assets/css/main\.css">',
        drop_main,
        html,
    )
    return html, done


def swap_nav(html: str, back_href: str, back_text: str) -> tuple[str, int]:
    """整条站点导航 -> 返回胶囊 + 主题按钮。"""
    pat = re.compile(r'[ \t]*<header class="nav" id="nav">.*?</header>', re.S)
    shell = BACK_SHELL.format(back_href=back_href, back_text=back_text)
    return pat.subn(shell, html)


def drop_footer(html: str) -> tuple[str, int]:
    pat = re.compile(r'\s*<footer class="footer">.*?</footer>', re.S)
    return pat.subn("", html)


def drop_skip_link(html: str) -> tuple[str, int]:
    """删掉旧站的无障碍跳转链接：它的样式在 main.css 里，main.css 已移除。"""
    pat = re.compile(r'\s*<a class="skip-link"[^>]*>.*?</a>', re.S)
    return pat.subn("", html)


def drop_article_back(html: str) -> tuple[str, int]:
    """删掉正文顶部的「← 全部工具」：左上角胶囊已经提供了同一个出口。"""
    pat = re.compile(r'[ \t]*<a class="article-back"[^>]*>.*?</a>[ \t]*\r?\n?', re.S)
    return pat.subn("", html)


# 旧站页面 -> 新站路由
OLD_LINKS = [
    ('href="../../index.html#about"', 'href="/about/"'),
    ('href="../../index.html"', 'href="/"'),
    ('href="../../tools.html"', 'href="/tools/"'),
    ('href="../../notes.html"', 'href="/archive/"'),
    ('href="../../branches.html"', 'href="/branches/"'),
    ('href="../index.html#about"', 'href="/about/"'),
    ('href="../index.html"', 'href="/"'),
    ('href="../tools.html"', 'href="/tools/"'),
    ('href="../notes.html"', 'href="/archive/"'),
    ('href="../branches.html"', 'href="/branches/"'),
]


def fix_old_links(html: str) -> tuple[str, int]:
    """把指向旧站页面的链接改成新站路由，避免 404。"""
    total = 0
    for old, new in OLD_LINKS:
        n = html.count(old)
        if n:
            html = html.replace(old, new)
            total += n
    return html, total


def add_theme_script(html: str) -> tuple[str, int]:
    """把主题切换脚本插到 </body> 前（若已存在则跳过）。"""
    if 'id="tool-theme"' not in html:
        return html, 0
    if "主题切换：写回主站同一套" in html:
        return html, 0
    pat = re.compile(r"\s*</body>")
    return pat.subn("\n  " + THEME_SCRIPT + "\n</body>", html, count=1)


def convert(path: Path, back_href: str, back_text: str, dry: bool) -> dict:
    raw = path.read_text(encoding="utf-8")
    html = raw
    report: dict[str, object] = {"file": str(path.relative_to(ROOT))}

    html, n_head = replace_theme_head(html)
    html, css_ops = swap_css(html)
    html, n_nav = swap_nav(html, back_href, back_text)
    html, n_foot = drop_footer(html)
    html, n_skip = drop_skip_link(html)
    html, n_back = drop_article_back(html)
    html, n_links = fix_old_links(html)
    html, n_mainjs = strip_main_js(html)
    html, n_script = add_theme_script(html)

    report.update(
        {
            "主题脚本": n_head,
            "CSS": ",".join(css_ops) or "未动",
            "导航": n_nav,
            "页脚": n_foot,
            "跳转链接": n_skip,
            "正文返回": n_back,
            "旧链接": n_links,
            "main.js": n_mainjs,
            "切换脚本": n_script,
            "changed": html != raw,
        }
    )
    if not dry and html != raw:
        path.write_text(html, encoding="utf-8", newline="\n")
    return report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", default="", help="只处理某个目录名")
    ap.add_argument("--branches", action="store_true", help="处理 branches/ 而不是 tools/")
    args = ap.parse_args()

    base = BRANCHES if args.branches else TOOLS
    if not base.is_dir():
        print(f"[错误] 找不到目录 {base}", file=sys.stderr)
        return 1

    dirs = sorted(d for d in base.iterdir() if d.is_dir() and (d / "index.html").is_file())
    if args.only:
        dirs = [d for d in dirs if d.name == args.only]

    if not dirs:
        print("[错误] 没有可处理的页面", file=sys.stderr)
        return 1

    back_href = "/branches/" if args.branches else "/tools/"
    back_text = "全部分支" if args.branches else "全部工具"

    print(f"{'[演练] ' if args.dry_run else ''}处理 {len(dirs)} 个页面\n")
    changed = 0
    for d in dirs:
        r = convert(d / "index.html", back_href, back_text, args.dry_run)
        if r["changed"]:
            changed += 1
        print(
            f"  {d.name:16s} 导航={r['导航']} 页脚={r['页脚']} 正文返回={r['正文返回']} "
            f"旧链接={r['旧链接']} main.js={r['main.js']} CSS={r['CSS']}"
        )

    print(f"\n{changed}/{len(dirs)} 个页面有改动。" + ("（演练，未写文件）" if args.dry_run else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
