/* ============================================================
   effects.js — 氛围特效引擎
   移植自 XinghuisamaBlogs 的 Fireflies / Sakura / GlobalSnow /
   DanmakuBackground / ClickEffect，用原生 DOM + CSS 动画重写。
   开关在 assets/js/site-config.js 的 effects 段。全关 = 零开销。
   ============================================================ */

import { siteConfig } from './site-config.js';

const cfg = siteConfig.effects || {};
const root = document.querySelector('[data-effects-root]') || (() => {
  const el = document.createElement('div');
  el.dataset.effectsRoot = 'true';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  return el;
})();

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/* 一次性注入所有关键帧，避免每个元素重复写 <style> */
function injectStyles(css) {
  getStyles().push(css);
}
const styleStore = [];
function getStyles() { return styleStore; }
function flushStyles() {
  if (!styleStore.length) return;
  const el = document.createElement('style');
  el.textContent = styleStore.join('\n');
  document.head.appendChild(el);
  styleStore.length = 0;
}

const layer = (name, styles) => {
  const el = document.createElement('div');
  el.className = `fx fx--${name}`;
  if (styles) Object.assign(el.style, styles);
  root.appendChild(el);
  return el;
};

const rand = (min, max) => min + Math.random() * (max - min);

/* 当前是否深色 */
const isDark = () => document.documentElement.dataset.theme !== 'light';

/* ------------------------------------------------------------
   1. 点击涟漪 —— canvas 绘制，靛蓝色扩散波纹
   ------------------------------------------------------------ */
function mountClick() {
  const canvas = document.createElement('canvas');
  canvas.className = 'fx-click';
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '9999',
  });
  root.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener('resize', resize);

  const ripples = [];
  const accent = () =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim() || '129, 140, 248';

  document.addEventListener('click', (e) => {
    if (reducedMotion.matches) return;
    ripples.push({ x: e.clientX, y: e.clientY, r: 0, opacity: 0.6, v: 2.5 });
  });

  (function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const rgb = accent();
    ctx.shadowBlur = 15;
    ctx.shadowColor = `rgba(${rgb}, 0.5)`;
    for (let i = ripples.length - 1; i >= 0; i--) {
      const p = ripples[i];
      p.r += p.v;
      p.v *= 0.96;
      p.opacity -= 0.015;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${rgb}, ${p.opacity})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb}, ${p.opacity * 0.3})`;
      ctx.fill();
      if (p.opacity <= 0) ripples.splice(i, 1);
    }
    requestAnimationFrame(frame);
  })();
}

/* ------------------------------------------------------------
   2. 萤火虫 —— 深色下的漫游光点
   ------------------------------------------------------------ */
function mountFireflies(node) {
  injectStyles(`
    @keyframes fxBreathe {
      0%, 100% { opacity: 0; transform: scale(0.3); }
      50% { opacity: 1; transform: scale(1.2);
        box-shadow: 0 0 10px 3px rgba(140, 190, 255, 0.8), 0 0 20px 6px rgba(99, 102, 241, 0.4); }
    }
    @keyframes fxFloatA { 0%,100% { transform: translate(0,0); } 33% { transform: translate(10vw,-15vh); } 66% { transform: translate(-5vw,-20vh); } }
    @keyframes fxFloatB { 0%,100% { transform: translate(0,0); } 33% { transform: translate(-12vw,10vh); } 66% { transform: translate(8vw,15vh); } }
    @keyframes fxFloatC { 0%,100% { transform: translate(0,0); } 33% { transform: translate(15vw,15vh); } 66% { transform: translate(-10vw,5vh); } }
    @keyframes fxFloatD { 0%,100% { transform: translate(0,0); } 33% { transform: translate(-15vw,-10vh); } 66% { transform: translate(10vw,-15vh); } }
    .fx-fireflies { position: absolute; inset: 0; mix-blend-mode: screen; }
    .fx-fireflies i {
      position: absolute; border-radius: 50%;
      background: rgba(200, 220, 255, 0.9);
      animation: fxBreathe var(--bd) ease-in-out infinite var(--bdl);
    }
  `);

  for (let i = 0; i < 50; i++) {
    const holder = document.createElement('span');
    Object.assign(holder.style, {
      position: 'absolute',
      top: `${Math.random() * 100}%`,
      left: `${Math.random() * 100}%`,
      animation: `fxFloat${'ABCD'[i % 4]} ${rand(15, 35)}s ease-in-out infinite ${rand(-20, 0)}s`,
    });
    const dot = document.createElement('i');
    const size = rand(3, 7);
    Object.assign(dot.style, {
      width: `${size}px`, height: `${size}px`, display: 'block',
      '--bd': `${rand(3, 8)}s`, '--bdl': `${rand(-10, 0)}s`,
    });
    holder.appendChild(dot);
    node.appendChild(holder);
  }
}

/* ------------------------------------------------------------
   3. 樱花 —— 亮色下的飘落花瓣
   ------------------------------------------------------------ */
function mountSakura(node) {
  injectStyles(`
    @keyframes fxSakuraFall {
      0%   { transform: translate(0, -10vh) rotate(0deg); opacity: 0; }
      10%  { opacity: 1; }
      80%  { opacity: 1; }
      100% { transform: translate(15vw, 110vh) rotate(360deg); opacity: 0; }
    }
    .fx-sakura { position: absolute; inset: 0; }
    .fx-sakura i { position: absolute; top: 0; background: rgba(244, 167, 195, 0.7); }
  `);

  for (let i = 0; i < 40; i++) {
    const p = document.createElement('i');
    const size = rand(8, 20);
    Object.assign(p.style, {
      left: `${Math.random() * 100}%`,
      width: `${size}px`,
      height: `${size * 1.2}px`,
      borderRadius: '100% 0 100% 0',
      boxShadow: '0 0 5px rgba(255, 182, 193, 0.6)',
      animation: `fxSakuraFall ${rand(6, 14)}s linear infinite ${rand(-15, 0)}s`,
    });
    node.appendChild(p);
  }
}

/* ------------------------------------------------------------
   4. 飘雪 —— 雪花字符 + 冷色滤镜
   ------------------------------------------------------------ */
function mountSnow(node) {
  injectStyles(`
    @keyframes fxSnowDrop {
      0%   { transform: translateY(0) rotate(0deg); }
      100% { transform: translateY(105vh) rotate(360deg); }
    }
    .fx-snow { position: absolute; inset: 0; }
    .fx-snow i {
      position: absolute; top: -20px; color: #fff; font-style: normal;
      user-select: none; filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.8));
    }
  `);

  const types = ['❄', '❅', '❆'];
  for (let i = 0; i < 40; i++) {
    const s = document.createElement('i');
    s.textContent = types[Math.floor(Math.random() * types.length)];
    Object.assign(s.style, {
      fontSize: `${rand(10, 25)}px`,
      left: `${Math.random() * 100}vw`,
      opacity: String(rand(0.3, 0.8)),
      animation: `fxSnowDrop ${rand(4, 10)}s linear infinite ${rand(0, 5)}s`,
    });
    node.appendChild(s);
  }
}

/* ------------------------------------------------------------
   5. 弹幕 —— 文字自右向左横穿
   ------------------------------------------------------------ */
function mountDanmaku(node) {
  const list = siteConfig.danmakuList || [];
  if (!list.length) return;

  injectStyles(`
    @keyframes fxDanmaku {
      0%   { right: -100%; transform: translateX(100%); }
      100% { right: 100%; transform: translateX(-100%); }
    }
    .fx-danmaku { position: absolute; top: 12%; left: 0; right: 0; height: 30%; }
    .fx-danmaku i {
      position: absolute; white-space: nowrap; font-style: normal;
      font-weight: 700; font-size: 18px; letter-spacing: 0.05em;
      color: var(--text-1); opacity: 0.12; user-select: none;
    }
  `);

  for (let i = 0; i < 15; i++) {
    const d = document.createElement('i');
    d.textContent = list[Math.floor(Math.random() * list.length)];
    Object.assign(d.style, {
      top: `${rand(10, 90)}%`,
      animation: `fxDanmaku ${rand(25, 45)}s linear infinite ${rand(0, 20)}s`,
    });
    node.appendChild(d);
  }
}

/* ------------------------------------------------------------
   6. 风动草丛 —— 页面底部的草叶
   ------------------------------------------------------------ */
function mountGrass(node) {
  injectStyles(`
    @keyframes fxSway { 0% { transform: rotate(-5deg); } 100% { transform: rotate(15deg); } }
    .fx-grass { position: absolute; left: 0; right: 0; bottom: 0; height: 128px; }
    .fx-grass span {
      position: absolute; bottom: 0; transform-origin: bottom center;
      display: flex; align-items: flex-end;
      animation: fxSway var(--d) ease-in-out infinite alternate var(--dl);
    }
    .fx-grass span i {
      display: block; height: 100%;
      background: linear-gradient(to top, rgba(255, 255, 255, 0.8), transparent);
    }
    html[data-theme="light"] .fx-grass span i {
      background: linear-gradient(to top, rgba(16, 185, 129, 0.8), transparent);
    }
  `);

  for (let i = 0; i < 150; i++) {
    const blade = document.createElement('span');
    const h = rand(30, 80);
    const w = rand(1, 3);
    Object.assign(blade.style, {
      left: `${(i / 150) * 100 + rand(-0.25, 0.25)}%`,
      height: `${h}px`,
      width: `${w * 4}px`,
      opacity: String(rand(0.2, 0.6)),
      '--d': `${rand(3, 7)}s`,
      '--dl': `${rand(-10, 0)}s`,
    });
    const leaf = document.createElement('i');
    Object.assign(leaf.style, {
      width: `${w}px`,
      borderRadius: Math.random() > 0.5 ? '100% 0 0 100%' : '0 100% 100% 0',
      transform: Math.random() > 0.5 ? 'translateX(50%)' : 'translateX(-50%)',
    });
    blade.appendChild(leaf);
    node.appendChild(blade);
  }
}

/* ------------------------------------------------------------
   装配
   ------------------------------------------------------------ */
const MOUNTS = {
  fireflies: mountFireflies,
  sakura: mountSakura,
  snow: mountSnow,
};

let ambientNodes = {};

function renderAmbient() {
  Object.values(ambientNodes).forEach((n) => n.remove());
  ambientNodes = {};
  if (reducedMotion.matches) return;

  const kind = isDark() ? cfg.dark : cfg.light;
  if (kind && MOUNTS[kind]) {
    ambientNodes[kind] = layer(kind);
    MOUNTS[kind](ambientNodes[kind]);
  }
  if (cfg.danmaku) {
    ambientNodes.danmaku = layer('danmaku');
    mountDanmaku(ambientNodes.danmaku);
  }
  if (cfg.grass) {
    ambientNodes.grass = layer('grass');
    mountGrass(ambientNodes.grass);
  }
  flushStyles();
}

renderAmbient();

// 深浅切换时换一套氛围（萤火虫 ↔ 樱花）
let lastDark = isDark();
new MutationObserver(() => {
  if (isDark() === lastDark) return;
  lastDark = isDark();
  renderAmbient();
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

reducedMotion.addEventListener?.('change', renderAmbient);

if (cfg.click) mountClick();

// 供调试：window.siteEffects.ambient('snow') 可临时切氛围
window.siteEffects = Object.freeze({
  rerender: renderAmbient,
  config: cfg,
});
