/* ============================================================
   main.js — 全站通用交互
   导航滚动态 / 移动端菜单 / 滚动显现 / Hero spotlight / 年份
   ============================================================ */

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

  if ('IntersectionObserver' in window && !reducedMotion.matches) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 }
    );
    els.forEach((el) => io.observe(el));
  } else {
    // 不支持 IO 或用户偏好减少动效：直接显示
    els.forEach((el) => el.classList.add('is-in'));
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
