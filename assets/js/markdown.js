/* ============================================================
   markdown.js — 笔记渲染管线
   marked(GFM) → DOMPurify 净化 → 增强（表格包裹 / 代码工具条 /
   高亮 / 标题锚点 / TOC 数据）
   依赖：window.marked、window.DOMPurify、window.hljs（经典脚本先行加载）
   ============================================================ */

import { escapeHtml } from './api.js';

/**
 * 渲染 Markdown → 已净化的 HTML。
 * 固定顺序：marked.parse → DOMPurify.sanitize，任何情况不跳过净化。
 */
export function renderMarkdown(md) {
  const raw = window.marked.parse(String(md ?? ''), {
    gfm: true,
    breaks: false,
    pedantic: false,
  });
  return window.DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    // input 保留（GFM 任务列表复选框，marked 输出 type=checkbox + disabled）
    FORBID_TAGS: ['style', 'form', 'button'],
  });
}

/** 对已渲染的 .markdown 容器做增强；返回 TOC 数据 [{level,id,text}] */
export function enhanceArticle(root) {
  wrapTables(root);
  wrapCodeBlocks(root);
  highlightCode(root);
  lazyImages(root);
  const toc = buildHeadingAnchors(root);
  return toc;
}

/* 表格外包一层 .md-table，实现横向滚动而不撑破版式 */
function wrapTables(root) {
  root.querySelectorAll('table').forEach((t) => {
    if (t.parentElement?.classList.contains('md-table')) return;
    const wrap = document.createElement('div');
    wrap.className = 'md-table';
    t.replaceWith(wrap);
    wrap.appendChild(t);
  });
}

/* 每个 pre>code 包上工具条（语言角标 + 复制按钮） */
function wrapCodeBlocks(root) {
  root.querySelectorAll('pre').forEach((pre) => {
    if (pre.parentElement?.classList.contains('md-code')) return;
    const code = pre.querySelector('code');
    if (!code) return;

    const lang = [...code.classList]
      .filter((c) => c.startsWith('language-'))
      .map((c) => c.slice('language-'.length))[0] || '';

    const box = document.createElement('div');
    box.className = 'md-code';

    const bar = document.createElement('div');
    bar.className = 'md-code__bar';
    bar.innerHTML =
      `<span class="md-code__lang">${escapeHtml(lang || 'text')}</span>` +
      `<button class="md-code__copy" type="button" aria-label="复制代码">复制</button>`;

    pre.replaceWith(box);
    box.append(bar, pre);
  });
}

/* highlight.js 高亮（未知语言降级为纯文本） */
function highlightCode(root) {
  const hljs = window.hljs;
  if (!hljs) return;
  root.querySelectorAll('.md-code pre code').forEach((code) => {
    const cls = [...code.classList].find((c) => c.startsWith('language-'));
    const lang = cls ? cls.slice('language-'.length) : '';
    if (lang && !hljs.getLanguage(lang)) {
      code.classList.remove(cls); // 语言包缺失 → 纯文本
      return;
    }
    if (lang) hljs.highlightElement(code);
  });
}

function lazyImages(root) {
  root.querySelectorAll('img').forEach((img) => {
    img.loading = 'lazy';
    img.decoding = 'async';
  });
}

/* 标题打 id + 锚点链接，返回 TOC 数据 */
function buildHeadingAnchors(root) {
  const used = new Map();
  const toc = [];

  root.querySelectorAll('h1, h2, h3, h4').forEach((h) => {
    const base = slugify(h.textContent);
    const n = used.get(base) || 0;
    used.set(base, n + 1);
    const id = n === 0 ? base : `${base}-${n}`;
    h.id = id;

    const a = document.createElement('a');
    a.className = 'heading-anchor';
    a.href = `#${id}`;
    a.textContent = '#';
    a.setAttribute('aria-hidden', 'true');
    a.tabIndex = -1;
    h.appendChild(a);

    if (h.tagName === 'H2' || h.tagName === 'H3') {
      toc.push({
        level: h.tagName === 'H3' ? 3 : 2,
        id,
        text: h.textContent.replace(/#$/, '').trim(),
      });
    }
  });
  return toc;
}

/**
 * 把正文里的 .md 相对链接改写为 note.html?path=... 路由。
 * 作者在笔记里写 `[另一篇](other.md)` 即可，无需关心路由。
 * @param {HTMLElement} root 已渲染的容器
 * @param {string} currentPath 当前笔记路径（如 'notes/welcome.md'）
 */
export function rewriteNoteLinks(root, currentPath) {
  const dir = currentPath.split('/').slice(0, -1);
  root.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.includes(':')) return; // 锚点/外链/mailto
    if (!/\.md$/i.test(href)) return;

    const segs = href.split('/');
    const merged = [...dir];
    for (const s of segs) {
      if (s === '.' || s === '') continue;
      if (s === '..') merged.pop();
      else merged.push(s);
    }
    const target = merged.join('/');
    if (!target.startsWith('notes/')) return; // 不越出 notes/ 目录
    a.href = `note.html?path=${encodeURIComponent(target)}`;
  });
}

export function slugify(text) {
  const s = String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s || 'section';
}

/** 复制按钮：事件委托（对动态注入的代码块同样生效） */
export function bindCopyButtons(container) {
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('.md-code__copy');
    if (!btn) return;
    const code = btn.closest('.md-code')?.querySelector('code');
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code.textContent || '');
      flash(btn, '已复制 ✓');
    } catch {
      // 剪贴板 API 不可用（非 https 等）→ 降级 execCommand
      const ta = document.createElement('textarea');
      ta.value = code.textContent || '';
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        flash(btn, '已复制 ✓');
      } catch {
        flash(btn, '复制失败');
      }
      ta.remove();
    }
  });
}

function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  btn.classList.add('is-done');
  clearTimeout(btn._t);
  btn._t = setTimeout(() => {
    btn.textContent = '复制';
    btn.classList.remove('is-done');
  }, 1600);
}
