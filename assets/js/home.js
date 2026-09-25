/* ============================================================
   home.js — 首页动态区
   Hero 最近更新 / 精选工具 / 最新笔记（数据：data/index.json）
   ============================================================ */

import { fetchIndex, escapeHtml, stateHtml } from './api.js';
import { observeReveals } from './main.js';

const toolsEl = document.getElementById('home-tools');
const notesEl = document.getElementById('home-notes');
const statusEl = document.getElementById('hero-status');

const FEATURED_TOOLS = 3;
const LATEST_NOTES = 4;

function toolCard(tool, i) {
  return `<a class="card reveal" style="--i:${i}" href="${tool.path}">
      <span class="card__icon" aria-hidden="true">${escapeHtml(tool.icon)}</span>
      <span class="card__arrow" aria-hidden="true">↗</span>
      <span class="card__title">${escapeHtml(tool.title)}</span>
      <span class="card__desc">${escapeHtml(tool.description)}</span>
      <span class="card__tags">${tool.tags
        .map((t) => `<span class="tag">${escapeHtml(String(t))}</span>`)
        .join('')}</span>
    </a>`;
}

function noteRow(note, i) {
  const href = `note.html?path=${encodeURIComponent(note.path)}`;
  return `<a class="note-row reveal" style="--i:${i}" href="${href}">
      <span class="note-row__date">${escapeHtml(note.date || '—')}</span>
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

try {
  const { notes, tools } = await fetchIndex();

  // Hero 状态行：最近一篇笔记
  const latest = notes[0];
  if (latest) {
    statusEl.innerHTML =
      `<b>Latest</b> — 《<a href="note.html?path=${encodeURIComponent(latest.path)}">${escapeHtml(latest.title)}</a>》` +
      (latest.date ? ` · ${escapeHtml(latest.date)}` : '');
    statusEl.hidden = false;
  }

  // 精选工具
  const featured = tools.slice(0, FEATURED_TOOLS);
  if (featured.length) {
    toolsEl.innerHTML = featured.map(toolCard).join('');
    observeReveals(toolsEl);
  } else {
    toolsEl.innerHTML = `<div style="grid-column:1/-1">${stateHtml(
      'Empty / 即将上架',
      '第一个小工具正在打磨中。'
    )}</div>`;
  }

  // 最新笔记
  const latestNotes = notes.slice(0, LATEST_NOTES);
  if (latestNotes.length) {
    notesEl.innerHTML = latestNotes.map(noteRow).join('');
    observeReveals(notesEl);
  } else {
    notesEl.innerHTML = stateHtml('Empty / 暂无笔记', '笔记正在路上。');
  }
} catch {
  const err = stateHtml('Error / 加载失败', '内容索引加载失败，请刷新重试。', true);
  toolsEl.innerHTML = err;
  notesEl.innerHTML = err;
}
