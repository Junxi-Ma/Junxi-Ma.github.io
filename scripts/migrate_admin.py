#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 admin.html 迁到 public/admin/index.html 并套上 Firefly 外壳。

后台的 .adm-* 样式写在页面内的 <style> 里，是自包含的，
所以只需要：换 CSS 变量来源、换导航、删页脚、修资源相对路径。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "admin.html"
DST_DIR = ROOT / "public" / "admin"
DST = DST_DIR / "index.html"

THEME_HEAD = """<script>
    /* 首帧前定下主题，与主站共用 localStorage 的 theme / hue */
    (function () {
      var DARK = 'dark', LIGHT = 'light', SYS = 'system';
      var t = null, hue = null;
      try { t = localStorage.getItem('theme'); hue = localStorage.getItem('hue'); } catch (e) {}
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

BACK_SHELL = """  <a class="tool-back" href="/">
    <span class="tool-back__arrow" aria-hidden="true">&larr;</span>
    <span>返回站点</span>
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

THEME_SCRIPT = """<script>
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


def main() -> int:
    if not SRC.is_file():
        print(f"[跳过] {SRC} 不存在（可能已经迁过）")
        return 0

    html = SRC.read_text(encoding="utf-8")

    # 1. 资源相对路径：admin.html 在根，迁到 public/admin/ 后要多退一层
    html = re.sub(r'(href|src)="assets/', r'\1="../../assets/', html)

    # 2. 主题脚本
    html = re.sub(r"<script>\s*/\*\s*首帧前定下主题.*?</script>", THEME_HEAD, html, flags=re.S)

    # 3. CSS：tokens -> tool-shell，删 main.css
    html = html.replace("../../assets/css/tokens.css", "../../assets/css/tool-shell.css")
    html = re.sub(r'\s*<link rel="stylesheet" href="\.\./\.\./assets/css/main\.css">', "", html)

    # 4. 导航 -> 胶囊
    html = re.sub(
        r'[ \t]*<header class="nav" id="nav">.*?</header>', BACK_SHELL, html, flags=re.S
    )

    # 5. 页脚 / 跳转链接 / main.js
    html = re.sub(r'\s*<footer class="footer">.*?</footer>', "", html, flags=re.S)
    html = re.sub(r'\s*<a class="skip-link"[^>]*>.*?</a>', "", html, flags=re.S)
    html = re.sub(
        r'\s*<script type="module" src="\.\./\.\./assets/js/main\.js"></script>', "", html
    )

    # 6. 主题切换脚本
    if 'id="tool-theme"' in html and "tool-theme" in html:
        html = re.sub(r"\s*</body>", "\n  " + THEME_SCRIPT + "\n</body>", html, count=1)

    DST_DIR.mkdir(parents=True, exist_ok=True)
    DST.write_text(html, encoding="utf-8", newline="\n")
    SRC.unlink()
    print(f"已迁移：admin.html -> {DST.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
