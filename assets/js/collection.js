/* ============================================================
   collection.js — 照片墙 / 时间线 / 朋友圈 的共用渲染器
   三个页面共用这一个模块，靠 <main data-collection="..."> 区分。
   数据文件在 data/ 下，格式见 README「预留栏目」一节。
   数据为空时展示引导文案，不报错、不露骨架。
   ============================================================ */

import { escapeHtml, stateHtml } from './api.js';

const root = document.querySelector('[data-collection]');
if (root) {
  const kind = root.dataset.collection;
  const listEl = document.getElementById('collection-list');
  const countEl = document.getElementById('collection-count');
  const DATA_URL = `data/${kind}.json`;

  const EMPTY = {
    photos: ['Empty / 还没有照片', '把图片放进 photos/ 目录，再到 data/photos.json 里登记一条即可。'],
    timeline: ['Empty / 还没有事件', '在 data/timeline.json 里按时间顺序添加事件。'],
    moments: ['Empty / 还没有动态', '在 data/moments.json 里写下第一条动态。'],
  };

  const RENDER = {
    photos: (items) =>
      `<div class="gallery">${items
        .map(
          (it) => `<figure class="gallery__item reveal">
            <img src="${escapeHtml(it.src)}" alt="${escapeHtml(it.title || '')}" loading="lazy">
            <figcaption>
              <span class="gallery__title">${escapeHtml(it.title || '')}</span>
              ${it.date ? `<span class="gallery__date">${escapeHtml(it.date)}</span>` : ''}
            </figcaption>
          </figure>`
        )
        .join('')}</div>`,

    timeline: (items) =>
      `<ol class="timeline">${items
        .map(
          (it) => `<li class="timeline__item reveal">
            <span class="timeline__dot" aria-hidden="true"></span>
            <div class="timeline__body">
              <div class="timeline__head">
                <time class="timeline__date">${escapeHtml(it.date || '')}</time>
                ${it.tag ? `<span class="tag">${escapeHtml(it.tag)}</span>` : ''}
              </div>
              <h3 class="timeline__title">${escapeHtml(it.title || '')}</h3>
              ${it.text ? `<p class="timeline__text">${escapeHtml(it.text)}</p>` : ''}
            </div>
          </li>`
        )
        .join('')}</ol>`,

    moments: (items) =>
      `<div class="moments">${items
        .map(
          (it) => `<article class="moment reveal">
            ${it.date ? `<time class="moment__date">${escapeHtml(it.date)}</time>` : ''}
            <p class="moment__text">${escapeHtml(it.text || '')}</p>
            ${Array.isArray(it.images) && it.images.length
              ? `<div class="moment__images">${it.images
                  .map((src) => `<img src="${escapeHtml(src)}" alt="" loading="lazy">`)
                  .join('')}</div>`
              : ''}
          </article>`
        )
        .join('')}</div>`,
  };

  const { observeReveals } = await import('./main.js');

  try {
    const res = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const items = Array.isArray(data) ? data : data.items || [];

    if (!items.length) {
      const [title, desc] = EMPTY[kind] || ['Empty', ''];
      listEl.innerHTML = stateHtml(title, desc);
    } else {
      listEl.innerHTML = RENDER[kind](items);
      observeReveals(listEl);
      if (countEl) countEl.textContent = `${items.length} 条`;
    }
  } catch {
    const [title, desc] = EMPTY[kind] || ['Empty', ''];
    listEl.innerHTML = stateHtml(title, desc);
  }
}
