/* ============================================================
   home.js — 首页动态区
   Hero 最近更新 / 精选工具 / 最新笔记（数据：data/index.json）
   ============================================================ */

import { fetchIndex, escapeHtml, stateHtml } from './api.js';
import { observeReveals } from './main.js';

const toolsEl = document.getElementById('home-tools');
const notesEl = document.getElementById('home-notes');
const branchesEl = document.getElementById('home-branches');
const statusEl = document.getElementById('hero-status');

const FEATURED_TOOLS = 3;
const FEATURED_BRANCHES = 2;
const LATEST_NOTES = 4;

/* index.json 里的 path/url 都是「相对站点根目录」的路径（tools/xxx/、
   branches/xxx/index.html）。首页可能被 GitHub Pages 用无扩展名 URL
   （/index → index.html）提供服务，那时相对路径的基准会变，所以统一转绝对。 */
const SITE_ROOT = location.pathname.replace(/[^/]*$/, '') || '/';
const fromRoot = (p) => SITE_ROOT + String(p || '').replace(/^\.?\//, '');

function toolCard(tool, i) {
  return `<a class="card reveal" style="--i:${i}" href="${escapeHtml(fromRoot(tool.path))}">
      <span class="card__icon" aria-hidden="true">${escapeHtml(tool.icon)}</span>
      <span class="card__arrow" aria-hidden="true">↗</span>
      <span class="card__title">${escapeHtml(tool.title)}</span>
      <span class="card__desc">${escapeHtml(tool.description)}</span>
      <span class="card__tags">${tool.tags
        .map((t) => `<span class="tag">${escapeHtml(String(t))}</span>`)
        .join('')}</span>
    </a>`;
}

function branchCard(branch, i) {
  const tags = Array.isArray(branch.tags) ? branch.tags : [];
  return `<a class="card reveal" style="--i:${i}" href="${escapeHtml(fromRoot(branch.url))}">
      <span class="card__icon" aria-hidden="true">${escapeHtml(branch.icon)}</span>
      <span class="card__arrow" aria-hidden="true">↗</span>
      <span class="card__title">${escapeHtml(branch.title)}</span>
      <span class="card__desc">${escapeHtml(branch.description)}</span>
      <span class="card__tags">${tags
        .map((t) => `<span class="tag">${escapeHtml(String(t))}</span>`)
        .join('')}</span>
    </a>`;
}

function noteRow(note, i) {
  const href = `${fromRoot('note.html')}?path=${encodeURIComponent(note.path)}`;
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
  const { notes, tools, branches } = await fetchIndex();

  // Hero 状态行：最近一篇笔记
  const latest = notes[0];
  if (latest) {
    statusEl.innerHTML =
      `<b>Latest</b> — 《<a href="${fromRoot('note.html')}?path=${encodeURIComponent(latest.path)}">${escapeHtml(latest.title)}</a>》` +
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

  // 分支页面
  const featuredBranches = branches.slice(0, FEATURED_BRANCHES);
  if (featuredBranches.length) {
    branchesEl.innerHTML = featuredBranches.map(branchCard).join('');
    observeReveals(branchesEl);
  } else {
    branchesEl.innerHTML = `<div style="grid-column:1/-1">${stateHtml(
      'Empty / 暂无分支',
      '分支页面正在整理中。'
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
  branchesEl.innerHTML = err;
  notesEl.innerHTML = err;
}
