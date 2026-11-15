#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""数独：绑定健壮化 + 难度改事件委托 + 错误可见化。

背景：页面若拿到旧 HTML（没有 #sk-pause / #sk-resume / #sk-pause-veil）而 JS 是新版，
`pauseBtn.addEventListener` 会抛 TypeError，脚本整体中断——排在后面的难度绑定
（原先在文件末尾）根本不执行，于是「点难度完全没反应」。
"""
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parent.parent
js = root / "public" / "tools" / "sudoku" / "app.js"
html = root / "public" / "tools" / "sudoku" / "index.html"

s = js.read_text(encoding="utf-8")
counts = []


def rep(old, new, expect=1, label=""):
    global s
    n = s.count(old)
    if n != expect:
        raise SystemExit(f"[FAIL] {label or old[:48]!r}: expect {expect}, got {n}")
    s = s.replace(old, new)
    counts.append((label or old.strip()[:48], n))


# ---------- 1. 新增元素一律可选链，缺了也不中断 ----------
rep("  gridEl.addEventListener('click', (e) => {",
    "  gridEl?.addEventListener('click', (e) => {", 1, "gridEl")
rep("  undoBtn.addEventListener('click', undo);",
    "  undoBtn?.addEventListener('click', undo);", 1, "undoBtn")
rep("  eraseBtn.addEventListener('click', eraseCell);",
    "  eraseBtn?.addEventListener('click', eraseCell);", 1, "eraseBtn")
rep("  hintBtn.addEventListener('click', hint);",
    "  hintBtn?.addEventListener('click', hint);", 1, "hintBtn")
rep("  noteBtn.addEventListener('click', () => setNoteMode(!noteMode));",
    "  noteBtn?.addEventListener('click', () => setNoteMode(!noteMode));", 1, "noteBtn")
rep("  modal.addEventListener('pointerdown', (e) => { if (e.target === modal) closeDialog(); });",
    "  modal?.addEventListener('pointerdown', (e) => { if (e.target === modal) closeDialog(); });", 1, "modal")
rep("  bestBtn.addEventListener('click', openBest);",
    "  bestBtn?.addEventListener('click', openBest);", 1, "bestBtn")
rep("  pauseBtn.addEventListener('click', pauseGame);",
    "  pauseBtn?.addEventListener('click', pauseGame);", 1, "pauseBtn")
rep("  resumeBtn.addEventListener('click', resumeGame);",
    "  resumeBtn?.addEventListener('click', resumeGame);", 1, "resumeBtn")
rep("  fsBtn.addEventListener('click', async () => {",
    "  fsBtn?.addEventListener('click', async () => {", 1, "fsBtn")

# ---------- 2. 暂停遮罩的三个引用点加 null 保护 ----------
rep("    pauseEl.hidden = true;", "    if (pauseEl) pauseEl.hidden = true;", 3, "pauseEl.hide")
rep("    pauseEl.hidden = false;", "    if (pauseEl) pauseEl.hidden = false;", 1, "pauseEl.show")
rep("    pauseNoteEl.textContent = '计时已停，进度已存在这台设备。';",
    "    if (pauseNoteEl) pauseNoteEl.textContent = '计时已停，进度已存在这台设备。';", 1, "pauseNote1")
rep("        pauseNoteEl.textContent = '换设备登录同一账号即可接着下。';",
    "        if (pauseNoteEl) pauseNoteEl.textContent = '换设备登录同一账号即可接着下。';", 2, "pauseNote2")
rep("""  function pauseHint(text) {
    pauseHintEl.textContent = text || '';
  }""",
    """  function pauseHint(text) {
    if (pauseHintEl) pauseHintEl.textContent = text || '';
  }""", 1, "pauseHint")
rep("""  function addLoginShortcut() {
    if (pauseHintEl.querySelector('.sk-pause-login')) return;""",
    """  function addLoginShortcut() {
    if (!pauseHintEl || pauseHintEl.querySelector('.sk-pause-login')) return;""", 1, "addLoginShortcut")

# ---------- 3. 难度绑定：从文件末尾的循环改为靠前的事件委托 ----------
old_bind = """  /* ---------- 难度切换 ---------- */
  for (const btn of document.querySelectorAll('.sk-diffbtn')) {
    btn.addEventListener('click', () => {
      for (const t of document.querySelectorAll('.sk-diffbtn')) t.classList.toggle('on', t === btn);
      newGame(btn.dataset.diff);
    });
  }

"""
rep(old_bind, "", 1, "remove-old-diffbind")

new_bind = """  /* ---------- 难度切换 ----------
     事件委托绑在 document 上，位置提到其它绑定之前：
     这样即便页面上某个元素缺失、或后面的初始化在某处抛错，
     难度按钮也照常能切；newGame 真出错时给出可见反馈，而不是「点了没反应」。 */
  document.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('.sk-diffbtn') : null;
    if (!btn || btn.disabled) return;
    for (const t of document.querySelectorAll('.sk-diffbtn')) t.classList.toggle('on', t === btn);
    try {
      newGame(btn.dataset.diff);
    } catch (err) {
      console.error('[数独] 切换难度失败：', err);
      if (diffLabel) diffLabel.textContent = '出题失败，请刷新页面';
    }
  });

  /* ---------- 交互 ---------- */
  gridEl?.addEventListener('click', (e) => {"""
rep("""  /* ---------- 交互 ---------- */
  gridEl?.addEventListener('click', (e) => {""", new_bind, 1, "insert-diffbind")

# ---------- 4. 顶部：build 标记 + 未捕获错误可见化 ----------
head_old = """(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
"""
head_new = """(() => {
  'use strict';

  /* 版本标记：排查时一眼确认浏览器跑的是哪一版脚本 */
  const BUILD = 'v6 · 2026-11-16';
  console.info('[数独] build', BUILD);

  /* 未捕获错误在页面顶部亮一条红条：QR「点了没反应」时至少能看到原因 */
  window.addEventListener('error', (ev) => {
    try {
      if (document.getElementById('sk-errbar')) return;
      const bar = document.createElement('div');
      bar.id = 'sk-errbar';
      bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:9999;padding:10px 14px;'
        + 'font:13px/1.6 system-ui,-apple-system,"Microsoft YaHei",sans-serif;'
        + 'background:#b3261e;color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.3)';
      bar.textContent = '数独脚本出错（' + BUILD + '）：' + (ev.message || ev.error || '未知错误')
        + ' —— 按 F12 看控制台，把这段发我';
      document.body.appendChild(bar);
    } catch { /* 提示本身失败就算了 */ }
  });

  const $ = (s, el = document) => el.querySelector(s);
"""
rep(head_old, head_new, 1, "head")

js.write_text(s, encoding="utf-8")

# ---------- 5. 版本号 ----------
h = html.read_text(encoding="utf-8")
h2 = h.replace('href="style.css?v=4"', 'href="style.css?v=5"')
h2 = h2.replace('src="app.js?v=5"', 'src="app.js?v=6"')
if h2 == h:
    raise SystemExit("[FAIL] 版本号没替换成功")
html.write_text(h2, encoding="utf-8")

print("app.js 替换：")
for name, n in counts:
    print(f"  {n}x  {name}")
print("index.html: style.css?v=4 -> v5, app.js?v=5 -> v6")
print(f"app.js 新行数：{len(s.splitlines())}")
