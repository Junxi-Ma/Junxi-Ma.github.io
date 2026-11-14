/**
 * Stardy — 路由与启动
 *
 * 路由表（hash）：
 *   #/                  首页（科目列表）
 *   #/s/<id>/<tab>      科目工作台（overview/tree/docs/cards/settings）
 *   #/review/<id>       全屏复习层（hash 变走即关闭，浏览器后退可退出）
 */

import db from './db.js?v=11';
import { toast } from './ui.js?v=11';
import { renderHome } from './views/home.js?v=11';
import { renderWorkspace } from './views/workspace.js?v=11';
import { renderGlobalSettings } from './views/settings.js?v=11';
import { open as reviewOpen, close as reviewClose, isOpen } from './views/review.js?v=11';

async function route() {
  const main = document.getElementById('main');
  const h = location.hash || '#/';

  const mReview = h.match(/^#\/review\/([A-Za-z0-9-]+)/);
  if (mReview) {
    try {
      await reviewOpen(mReview[1]);
    } catch (e) {
      console.error('[stardy] 打开复习失败：', e);
      toast('打开复习失败：' + e.message, true);
      history.back();
    }
    return;
  }
  if (isOpen()) reviewClose(); // hash 已离开复习页（后退 / 退出按钮改 hash）

  if (h === '#/settings') {
    await renderGlobalSettings(main);
    return;
  }
  const mWs = h.match(/^#\/s\/([A-Za-z0-9-]+)(?:\/([a-z]+))?/);
  try {
    if (mWs) {
      await renderWorkspace(main, mWs[1], mWs[2] || 'overview');
    } else {
      await renderHome(main);
    }
  } catch (e) {
    console.error('[stardy] 视图渲染失败：', e);
    main.innerHTML = `
      <div class="container tool sdy-view">
        <div class="sdy-empty">
          页面渲染出错了：${String(e.message || e).replace(/</g, '&lt;')}<br>
          <button class="btn" onclick="location.reload()">刷新重试</button>
        </div>
      </div>`;
  }
}

async function boot() {
  try {
    await db.ready();
  } catch (e) {
    console.error('[stardy] IndexedDB 不可用：', e);
    toast('浏览器存储不可用（隐私模式？），学习进度将无法保存', true, 6000);
  }
  window.addEventListener('hashchange', route);
  await route();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
