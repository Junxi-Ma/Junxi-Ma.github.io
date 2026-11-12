/* ============================================================
   notes.js — 笔记列表页
   数据：data/index.json（由 build_index.py 生成）
   交互：搜索（150ms 防抖）/ 标签筛选 / 按年分组 / 空态与错误态
   ============================================================ */

import { fetchIndex, escapeHtml, stateHtml } from './api.js';
import { observeReveals } from './main.js';

const listEl = document.getElementById('notes-list');
const chipsEl = document.getElementById('notes-chips');
const countEl = document.getElementById('notes-count');
const searchEl = document.getElementById('notes-search');

let allNotes = [];
let activeTag = '';
let query = '';
let firstRender = true;

/* ---------- 渲染 ---------- */

function noteRow(note, i) {
  const href = `note.html?path=${encodeURIComponent(note.path)}`;
  const date = note.date || '—';
  const cls = firstRender ? 'note-row reveal' : 'note-row';
  const style = firstRender ? ` style="--i:${Math.min(i, 8)}"` : '';
  return `<a class="${cls}"${style} href="${href}">
      <span class="note-row__date">${escapeHtml(date)}</span>
      <span class="note-row__main">
        <span class="note-row__title">${escapeHtml(note.title)}</span>
        <span class="note-row__desc">${escapeHtml(note.description)}</span>
      </span>
      <span class="note-row__meta">
        <span class="note-row__tags">${note.tags
          .map((t) => `<span class="tag">${escapeHtml(String(t))}</span>`)
          .join('')}</span>
        <span class="note-row__arr" aria-hidden="true">→</span>
      </span>
    </a>`;
}

function groupByYear(notes) {
  const groups = new Map();
  for (const n of notes) {
    const year = n.date ? n.date.slice(0, 4) : '未标注';
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(n);
  }
  // 有年份的倒序，「未标注」排最后
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === '未标注') return 1;
    if (b === '未标注') return -1;
    return Number(b) - Number(a);
  });
  return keys.map((y) => [y, groups.get(y)]);
}

function render() {
  const q = query.trim().toLowerCase();
  const filtered = allNotes.filter((n) => {
    if (activeTag && !n.tags.includes(activeTag)) return false;
    if (!q) return true;
    const hay = [n.title, n.description, n.date || '', ...n.tags]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });

  countEl.textContent = filtered.length === allNotes.length
    ? `${allNotes.length} 篇`
    : `${filtered.length} / ${allNotes.length} 篇`;

  if (!filtered.length) {
    listEl.innerHTML = stateHtml(
      '0 / No Results',
      query || activeTag ? '没有匹配的笔记，换个关键词试试。' : '还没有任何笔记。'
    );
    return;
  }

  let i = 0;
  listEl.innerHTML = groupByYear(filtered)
    .map(
      ([year, notes]) => `<section class="year-group">
        <h2 class="year-group__label"><b>▸</b>${escapeHtml(year)}</h2>
        <div class="rows">${notes.map((n) => noteRow(n, i++)).join('')}</div>
      </section>`
    )
    .join('');

  if (firstRender) {
    observeReveals(listEl);
    firstRender = false;
  }
}

function renderChips() {
  const counter = new Map();
  for (const n of allNotes) {
    for (const t of n.tags) counter.set(t, (counter.get(t) || 0) + 1);
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

let debounce;
searchEl.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    query = searchEl.value;
    render();
  }, 150);
});

/* ---------- 启动 ---------- */
try {
  const { notes } = await fetchIndex();
  allNotes = notes;
  renderChips();
  render();
} catch {
  countEl.textContent = '';
  listEl.innerHTML =
    stateHtml('Error / 加载失败', '内容索引加载失败，请刷新重试。', true) +
    `<p style="text-align:center;margin-top:-24px">
       <button class="btn btn--ghost btn--sm" onclick="location.reload()">重新加载</button>
     </p>`;
}
