/* ============================================================
   tools.js — 工具列表页
   数据：data/index.json 的 tools 字段
   交互：标签筛选 / 卡片网格 / 空态与错误态
   ============================================================ */

import { fetchIndex, escapeHtml, stateHtml } from './api.js';
import { observeReveals } from './main.js';

const listEl = document.getElementById('tools-list');
const chipsEl = document.getElementById('tools-chips');
const countEl = document.getElementById('tools-count');

let allTools = [];
let activeTag = '';
let firstRender = true;

/* ---------- 渲染 ---------- */

function toolCard(tool, i) {
  const cls = firstRender ? 'card reveal' : 'card';
  const style = firstRender ? ` style="--i:${Math.min(i, 8)}"` : '';
  return `<a class="${cls}"${style} href="${tool.path}">
      <span class="card__icon" aria-hidden="true">${escapeHtml(tool.icon)}</span>
      <span class="card__arrow" aria-hidden="true">↗</span>
      <span class="card__title">${escapeHtml(tool.title)}</span>
      <span class="card__desc">${escapeHtml(tool.description)}</span>
      <span class="card__tags">${tool.tags
        .map((t) => `<span class="tag">${escapeHtml(String(t))}</span>`)
        .join('')}</span>
    </a>`;
}

function render() {
  const filtered = activeTag
    ? allTools.filter((t) => t.tags.includes(activeTag))
    : allTools;

  countEl.textContent = filtered.length === allTools.length
    ? `${allTools.length} 个`
    : `${filtered.length} / ${allTools.length} 个`;

  if (!filtered.length) {
    listEl.innerHTML = `<div style="grid-column:1/-1">${stateHtml(
      '0 / No Results',
      activeTag ? '这个标签下还没有工具。' : '工具箱还是空的。'
    )}</div>`;
    return;
  }

  listEl.innerHTML = filtered.map(toolCard).join('');

  if (firstRender) {
    observeReveals(listEl);
    firstRender = false;
  }
}

function renderChips() {
  const counter = new Map();
  for (const t of allTools) {
    for (const tag of t.tags) counter.set(tag, (counter.get(tag) || 0) + 1);
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
  const { tools } = await fetchIndex();
  allTools = tools;
  if (allTools.length) {
    renderChips();
    render();
  } else {
    countEl.textContent = '0 个';
    listEl.innerHTML = `<div style="grid-column:1/-1">${stateHtml(
      'Empty / 工具箱空空如也',
      '在 tools/ 目录下新建一个文件夹放入 index.html 即可上架。'
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
