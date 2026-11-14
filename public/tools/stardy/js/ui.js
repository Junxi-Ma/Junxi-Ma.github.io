/**
 * Stardy — 共享 UI 工具：轻提示 / 模态 / 确认框
 */

import { escapeHtml } from './models.js?v=5';

let toastTimer = null;
export function toast(msg, isErr = false, ms = 2600) {
  const el = document.getElementById('sdy-toast');
  el.textContent = msg;
  el.classList.toggle('sdy-toast--err', !!isErr);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/**
 * 通用模态。bodyHtml 里的事件由调用方在 onMount(box, close) 里挂。
 * 返回 { box, close }。
 */
export function openModal({ title, bodyHtml = '', onMount = null, wide = false }) {
  const wrap = document.createElement('div');
  wrap.className = 'sdy-modal';
  wrap.innerHTML = `
    <div class="sdy-modal__box" role="dialog" aria-modal="true" style="${wide ? 'width:min(760px,100%)' : ''}">
      <h3>${escapeHtml(title)}</h3>
      <div class="sdy-modal__body">${bodyHtml}</div>
    </div>`;
  const box = wrap.querySelector('.sdy-modal__box');
  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  document.body.appendChild(wrap);
  if (onMount) onMount(box, close);
  return { box, close };
}

/** 确认框：Promise<boolean> */
export function confirmBox({ title, body = '', confirmText = '确定', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    const { box, close } = openModal({
      title,
      bodyHtml: `
        <p style="color:var(--text-2);font-size:var(--fs-note);line-height:1.7">${body}</p>
        <div class="sdy-modal__acts">
          <button class="btn" data-a="cancel">${escapeHtml(cancelText)}</button>
          <button class="btn ${danger ? '' : 'btn--primary'}" data-a="ok" style="${danger ? 'background:var(--danger-fg);border-color:var(--danger-fg);color:#fff' : ''}">${escapeHtml(confirmText)}</button>
        </div>`,
    });
    box.querySelector('[data-a="cancel"]').onclick = () => { close(); resolve(false); };
    box.querySelector('[data-a="ok"]').onclick = () => { close(); resolve(true); };
  });
}

/** 简易提示输入框（删除科目等强确认）：Promise<string|null> */
export function promptBox({ title, body = '', placeholder = '', confirmText = '确定' }) {
  return new Promise((resolve) => {
    const { box, close } = openModal({
      title,
      bodyHtml: `
        <p style="color:var(--text-2);font-size:var(--fs-note);line-height:1.7">${body}</p>
        <input class="sdy-input" data-a="input" placeholder="${escapeHtml(placeholder)}" autocomplete="off">
        <div class="sdy-modal__acts">
          <button class="btn" data-a="cancel">取消</button>
          <button class="btn" data-a="ok" style="background:var(--danger-fg);border-color:var(--danger-fg);color:#fff">${escapeHtml(confirmText)}</button>
        </div>`,
    });
    const input = box.querySelector('[data-a="input"]');
    input.focus();
    box.querySelector('[data-a="cancel"]').onclick = () => { close(); resolve(null); };
    const submit = () => { close(); resolve(input.value.trim()); };
    box.querySelector('[data-a="ok"]').onclick = submit;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });
}

export { escapeHtml };
