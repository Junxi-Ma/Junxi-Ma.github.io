/* ============================================================
   main.js — 全站通用交互
   导航滚动态 / 移动端菜单 / 滚动显现 / Hero spotlight / 年份
   ============================================================ */

import { siteConfig } from './site-config.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- 导航：滚动后加毛玻璃底 ---------- */
const nav = document.getElementById('nav');

function syncNavScroll() {
  if (nav) nav.classList.toggle('is-scrolled', window.scrollY > 8);
}
syncNavScroll();
window.addEventListener('scroll', syncNavScroll, { passive: true });

/* ---------- 移动端菜单 ---------- */
const toggle = document.getElementById('nav-toggle');
const links = document.getElementById('nav-links');

function setMenu(open) {
  if (!nav || !toggle) return;
  nav.classList.toggle('is-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
}

if (toggle && nav) {
  toggle.addEventListener('click', () => {
    setMenu(!nav.classList.contains('is-open'));
  });
  // 选择导航项后收起（锚点跳转在同页）
  links?.addEventListener('click', (e) => {
    if (e.target.closest('a')) setMenu(false);
  });
  // Esc 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setMenu(false);
  });
  // 恢复桌面布局时复位
  window.matchMedia('(min-width: 901px)').addEventListener('change', (e) => {
    if (e.matches) setMenu(false);
  });
}

/* ---------- 滚动显现（IntersectionObserver） ----------
   动态注入的 .reveal 节点（列表页渲染）可再次调用本函数 */
export function observeReveals(scope = document) {
  const els = scope.querySelectorAll('.reveal:not(.is-in)');
  if (!els.length) return;

  const show = (el) => el.classList.add('is-in');

  if ('IntersectionObserver' in window && !reducedMotion.matches) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            show(entry.target);
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 }
    );
    els.forEach((el) => io.observe(el));

    // 兜底：个别环境下 IntersectionObserver 可能迟迟不回调，
    // 下一帧先把已在视口内的元素放出来，避免内容一直不可见。
    requestAnimationFrame(() => {
      els.forEach((el) => {
        if (el.classList.contains('is-in')) return;
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) show(el);
      });
    });
  } else {
    // 不支持 IO 或用户偏好减少动效：直接显示
    els.forEach(show);
  }
}

observeReveals();

/* ---------- Hero 鼠标 spotlight ---------- */
const hero = document.getElementById('hero');
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

if (hero && finePointer.matches && !reducedMotion.matches) {
  let raf = 0;
  let mx = 0;
  let my = 0;

  hero.addEventListener(
    'pointermove',
    (e) => {
      const rect = hero.getBoundingClientRect();
      mx = e.clientX - rect.left;
      my = e.clientY - rect.top;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        hero.style.setProperty('--mx', `${mx}px`);
        hero.style.setProperty('--my', `${my}px`);
        raf = 0;
      });
    },
    { passive: true }
  );
}

/* ---------- 页脚年份 ---------- */
document.querySelectorAll('[data-year]').forEach((el) => {
  el.textContent = String(new Date().getFullYear());
});

/* ---------- 滚动进度条（全站注入；阅读页已有 #progress 则跳过） ---------- */
const existingProgress = document.getElementById('progress');
const progressBar = existingProgress || document.createElement('div');
if (!existingProgress) {
  progressBar.className = 'scroll-progress';
  progressBar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(progressBar);
}

/* ---------- 返回顶部（滚动一段后出现） ---------- */
const toTop = document.createElement('button');
toTop.className = 'to-top';
toTop.type = 'button';
toTop.setAttribute('aria-label', '返回顶部');
toTop.innerHTML =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 19V5M5 12l7-7 7 7"/></svg>';
document.body.appendChild(toTop);

toTop.addEventListener('click', () => {
  window.scrollTo({
    top: 0,
    behavior: reducedMotion.matches ? 'auto' : 'smooth',
  });
});

let scrollRaf = 0;
function syncScrollUI() {
  const doc = document.documentElement;
  const max = doc.scrollHeight - window.innerHeight;
  const y = window.scrollY || doc.scrollTop || 0;
  const ratio = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;

  if (!existingProgress) {
    progressBar.style.setProperty('--sp', ratio.toFixed(4));
  }
  toTop.classList.toggle('is-visible', y > 480);
}

function onScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    syncScrollUI();
    scrollRaf = 0;
  });
}

syncScrollUI();
window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', onScroll, { passive: true });

/* ---------- 锚点平滑滚动（尊重减少动效偏好） ---------- */
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="#"]');
  if (!link) return;
  const id = link.getAttribute('href');
  if (!id || id === '#') return;
  const target = document.querySelector(id);
  if (!target) return;
  e.preventDefault();
  target.scrollIntoView({
    behavior: reducedMotion.matches ? 'auto' : 'smooth',
    block: 'start',
  });
  history.replaceState(null, '', id);
});

/* ---------- 深 / 浅主题切换 ----------
   data-theme 由 <head> 内联脚本先行写入（防闪烁）；
   这里只负责按钮交互、持久化与 meta 同步。 */
const THEME_KEY = 'site-theme';
const THEME_COLOR = { dark: '#080f1f', light: '#eef2ff' };
const themeBtn = document.getElementById('theme-toggle');
const metaTheme = document.querySelector('meta[name="theme-color"]');

const readTheme = () =>
  document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

function applyTheme(theme, persist) {
  document.documentElement.dataset.theme = theme;
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* 隐私模式等场景下忽略 */
    }
  }
  themeBtn?.setAttribute(
    'aria-label',
    theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'
  );
  themeBtn?.setAttribute(
    'title',
    theme === 'dark' ? '浅色模式' : '深色模式'
  );
  if (metaTheme) metaTheme.content = THEME_COLOR[theme];
}

// 与 <head> 内联脚本的结果对齐（补 meta / aria）
applyTheme(readTheme(), false);

themeBtn?.addEventListener('click', () => {
  applyTheme(readTheme() === 'dark' ? 'light' : 'dark', true);
});

// 多标签页同步
window.addEventListener('storage', (e) => {
  if (e.key === THEME_KEY && (e.newValue === 'dark' || e.newValue === 'light')) {
    applyTheme(e.newValue, false);
  }
});

/* ---------- 预留栏目入口 ----------
   site-config.js 里 reserved.* 置 true 时，导航才出现对应入口。
   这样加栏目不用去改十几个页面里各自一份的导航标记。 */
const RESERVED_LINKS = [
  ['photos', '照片墙', 'photos.html'],
  ['timeline', '时间线', 'timeline.html'],
  ['moments', '朋友圈', 'moments.html'],
];

function mountReservedLinks() {
  const navLinks = document.getElementById('nav-links');
  const logo = document.querySelector('.nav__logo');
  if (!navLinks || !logo) return;

  const base = (logo.getAttribute('href') || '').replace(/index\.html$/, '');
  const anchor = navLinks.querySelector('a[href$="#about"]');

  for (const [key, label, href] of RESERVED_LINKS) {
    if (!siteConfig.reserved?.[key]) continue;
    const a = document.createElement('a');
    a.href = base + href;
    a.textContent = label;
    navLinks.insertBefore(a, anchor);
  }
}
mountReservedLinks();

/* ---------- Supabase 动态能力（访客统计 / 登录注册） ----------
   未配置后端时两个模块都会静默跳过，站点保持纯静态行为。 */
import './analytics.js';
import './auth.js';
import './effects.js';
