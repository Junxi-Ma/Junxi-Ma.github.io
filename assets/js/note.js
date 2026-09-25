/* ============================================================
   note.js — 笔记详情页控制器
   流程：?path= 白名单校验 → fetch .md → 元数据 → 渲染 → 增强
   安全：路径必须落在 notes/ 目录内，杜绝 fetch 被诱导到外域
   ============================================================ */

import {
  fetchIndex,
  splitFrontmatter,
  readingMinutes,
  formatDate,
  escapeHtml,
  stateHtml,
} from './api.js';
import {
  renderMarkdown,
  enhanceArticle,
  bindCopyButtons,
  rewriteNoteLinks,
} from './markdown.js';

const el = (id) => document.getElementById(id);

/* ---------- 路径白名单校验 ---------- */
function validatePath(raw) {
  if (!raw) return null;
  const path = raw.trim();
  if (path.startsWith('/') || path.includes('..')) return null;
  if (path.includes('://') || path.includes('//') || path.includes('\\')) return null;
  if (!/^notes\/[A-Za-z0-9_][A-Za-z0-9_\-./]*\.md$/.test(path)) return null;
  if (path.split('/').includes('..')) return null;
  return path;
}

/* ---------- 错误态 ---------- */
function showError(code, text) {
  el('note-head-loading').hidden = true;
  const body = el('note-body');
  body.innerHTML =
    stateHtml(code, text, true) +
    `<p style="text-align:center;margin-top:-24px">
       <a class="btn btn--ghost btn--sm" href="notes.html">← 返回笔记列表</a>
     </p>`;
  document.title = `${code.split(' / ')[0]} — Michael`;
}

/* ---------- 主流程 ---------- */
async function main() {
  const path = validatePath(new URLSearchParams(location.search).get('path'));
  if (!path) {
    showError('400 / Bad Request', '笔记路径不合法。');
    return;
  }

  // 1. 获取 Markdown 原文
  let raw;
  try {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    raw = await res.text();
  } catch {
    showError('404 / Not Found', '这篇笔记不存在，或尚未部署上线。');
    return;
  }

  const { frontmatter, body } = splitFrontmatter(raw);

  // 2. 元数据：优先 index.json，缺失时回退 frontmatter 解析
  let indexed = null;
  try {
    const { notes } = await fetchIndex();
    indexed = notes.find((n) => n.path === path) || null;
  } catch {
    /* 索引不可用不阻塞阅读 */
  }

  const fallbackTitle = (body.match(/^#\s+(.+)$/m) || [, ''])[1].trim();
  const fileName = path.split('/').pop().replace(/\.md$/, '');
  const title =
    indexed?.title || frontmatter.title || fallbackTitle || fileName;
  const date = formatDate(indexed?.date || frontmatter.date);
  const tags = Array.isArray(indexed?.tags)
    ? indexed.tags
    : Array.isArray(frontmatter.tags)
      ? frontmatter.tags
      : [];
  const minutes = readingMinutes(body);

  // 3. 渲染页头
  el('note-head-loading').hidden = true;

  const titleEl = el('note-title');
  titleEl.textContent = title;
  titleEl.hidden = false;
  document.title = `${title} — Michael`;

  const desc = document.querySelector('meta[name="description"]');
  const plain = body.replace(/^#\s+.+$/m, '').trim().slice(0, 120);
  if (desc && plain) desc.content = `${plain}…`;

  const metaEl = el('note-meta');
  const metaParts = [];
  if (date) metaParts.push(`<time datetime="${date}">${date}</time>`);
  metaParts.push(`<span>约 ${minutes} 分钟阅读</span>`);
  metaEl.innerHTML = metaParts.join('<span class="dot">·</span>');
  metaEl.hidden = false;

  const tagsEl = el('note-tags');
  if (tags.length) {
    tagsEl.innerHTML = tags
      .map((t) => `<span class="tag">${escapeHtml(String(t))}</span>`)
      .join('');
    tagsEl.hidden = false;
  }

  // 4. 渲染正文（marked → DOMPurify → 增强）
  const bodyEl = el('note-body');
  bodyEl.innerHTML = renderMarkdown(body);
  const toc = enhanceArticle(bodyEl);
  rewriteNoteLinks(bodyEl, path);
  bindCopyButtons(bodyEl);

  // 5. 侧边目录
  if (toc.length) {
    const tocEl = el('toc');
    tocEl.innerHTML =
      `<p class="toc__label"><b>+</b>On this page</p>` +
      toc
        .map(
          (item) =>
            `<a href="#${item.id}" class="lvl-${item.level}">${escapeHtml(item.text)}</a>`
        )
        .join('');
    tocEl.hidden = false;
    initSpy(tocEl, bodyEl);
  }

  // 6. 阅读进度条
  initProgress();
}

/* ---------- TOC 滚动高亮 ---------- */
function initSpy(tocEl, bodyEl) {
  const links = [...tocEl.querySelectorAll('a')];
  // a.hash 对中文 id 会百分号编码，必须先解码再按 id 查找
  const heads = links
    .map((a) => {
      let id = a.hash.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        /* 非法编码 → 保持原样 */
      }
      return { link: a, el: document.getElementById(id) };
    })
    .filter((x) => x.el);

  let raf = 0;
  const update = () => {
    raf = 0;
    let active = heads[0];
    for (const h of heads) {
      if (h.el.getBoundingClientRect().top <= 120) active = h;
    }
    links.forEach((a) => a.classList.remove('is-active'));
    active?.link.classList.add('is-active');
  };

  window.addEventListener(
    'scroll',
    () => {
      if (!raf) raf = requestAnimationFrame(update);
    },
    { passive: true }
  );
  update();
}

/* ---------- 阅读进度条 ---------- */
function initProgress() {
  const bar = el('progress');
  if (!bar) return;
  let raf = 0;
  const update = () => {
    raf = 0;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, window.scrollY / max) : 0;
    bar.style.setProperty('--p', `${(p * 100).toFixed(2)}%`);
  };
  window.addEventListener(
    'scroll',
    () => {
      if (!raf) raf = requestAnimationFrame(update);
    },
    { passive: true }
  );
  window.addEventListener('resize', update, { passive: true });
  update();
}

main();
