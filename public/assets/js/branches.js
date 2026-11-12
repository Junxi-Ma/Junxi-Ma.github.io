/* ============================================================
   branches.js — 分支列表页
   数据：data/index.json 的 branches 字段
   交互：标签筛选 / 卡片网格 / 空态与错误态

   ★ url 的路径基准
   index.json 里的 branch.url 是「相对站点根目录」的路径
   （如 branches/junxun/index.html）。这里把它转成绝对路径再写入 href，
   因为本页可能被 GitHub Pages 用无扩展名的 URL（/branches）提供服务，
   此时页面的基准目录不是根目录，相对路径会被解析到 /junxun/… 而 404。

   站点根目录的推算：本页始终位于站点根下的 branches.html，
   所以 location.pathname 去掉末尾的 branches[.html] 就是根目录前缀。
   ============================================================ */

import { fetchIndex, escapeHtml, stateHtml } from './api.js';
import { observeReveals } from './main.js';

const listEl = document.getElementById('branches-list');
const chipsEl = document.getElementById('branches-chips');
const countEl = document.getElementById('branches-count');

/** 站点根目录前缀（兼容 user.github.io/ 与 user.github.io/repo/ 两种部署） */
function siteRoot() {
  const path = location.pathname.replace(/[^/]*$/, ''); // 去掉最后一段文件名
  return path || '/';
}

/** 把 index.json 里「相对站点根」的路径转成可直接用的绝对路径 */
function resolveFromRoot(url) {
  const u = String(url || '').replace(/^\.?\//, '');
  return siteRoot() + u;
}

let allBranches = [];
let activeTag = '';
let firstRender = true;

/* ---------- 渲染 ---------- */

function branchCard(branch, i) {
  const cls = firstRender ? 'card reveal' : 'card';
  const style = firstRender ? ` style="--i:${Math.min(i, 8)}"` : '';
  const tags = Array.isArray(branch.tags) ? branch.tags : [];
  return `<a class="${cls}"${style} href="${escapeHtml(resolveFromRoot(branch.url))}">
      <span class="card__icon" aria-hidden="true">${escapeHtml(branch.icon)}</span>
      <span class="card__arrow" aria-hidden="true">↗</span>
      <span class="card__title">${escapeHtml(branch.title)}</span>
      <span class="card__desc">${escapeHtml(branch.description)}</span>
      <span class="card__tags">${tags
        .map((t) => `<span class="tag">${escapeHtml(String(t))}</span>`)
        .join('')}</span>
    </a>`;
}

function render() {
  const filtered = activeTag
    ? allBranches.filter((b) => (b.tags || []).includes(activeTag))
    : allBranches;

  countEl.textContent =
    filtered.length === allBranches.length
      ? `${allBranches.length} 个`
      : `${filtered.length} / ${allBranches.length} 个`;

  if (!filtered.length) {
    listEl.innerHTML = `<div style="grid-column:1/-1">${stateHtml(
      '0 / No Results',
      activeTag ? '这个标签下还没有分支。' : '还没有分支页面。'
    )}</div>`;
    return;
  }

  listEl.innerHTML = filtered.map(branchCard).join('');

  if (firstRender) {
    observeReveals(listEl);
    firstRender = false;
  }
}

function renderChips() {
  const counter = new Map();
  for (const b of allBranches) {
    for (const tag of b.tags || []) counter.set(tag, (counter.get(tag) || 0) + 1);
  }
  const tags = [...counter.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .map(([t]) => t);

  chipsEl.innerHTML = ['']
    .concat(tags)
    .map(
      (t) =>
        `<button type="button" class="chip${t === activeTag ? ' is-active' : ''}" data-tag="${escapeHtml(t)}">${t ? escapeHtml(t) : '全部'}</button>`
    )
    .join('');
}

chipsEl.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  activeTag = chip.dataset.tag || '';
  chipsEl.querySelectorAll('.chip').forEach((c) => {
    c.classList.toggle('is-active', (c.dataset.tag || '') === activeTag);
  });
  render();
});

/* ---------- 启动 ---------- */
try {
  const { branches } = await fetchIndex();
  allBranches = branches;
  if (allBranches.length) {
    renderChips();
    render();
  } else {
    countEl.textContent = '0 个';
    listEl.innerHTML = `<div style="grid-column:1/-1">${stateHtml(
      'Empty / 还没有分支',
      '在 branches/ 目录下新建一个文件夹放入 index.html 即可上架。'
    )}</div>`;
  }
} catch {
  countEl.textContent = '';
  listEl.innerHTML = `<div style="grid-column:1/-1">${stateHtml(
    'Error / 加载失败',
    '内容索引加载失败，请刷新重试。',
    true
  )}</div>`;
}
