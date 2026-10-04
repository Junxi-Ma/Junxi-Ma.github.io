/* ============================================================
   经典扫雷 — Windows 9x 复刻版
   与原版对齐的规则：首击必安全（格子够时避开 3×3）、右键插旗、
   （?）标记、中键/双键快开（chording）、计时上限 999、
   计数器可为负；触屏适配：点按挖雷、长按插旗、点按已开数字快开。
   云端（Supabase）：登录用户破纪录自动署名上云；右侧英雄榜为
   全站初/中/高级最短用时 Top 10；云端不可用时静默回退纯本地。
   ============================================================ */
import { getSupabase, isConfigured } from '../../assets/js/supabase.js';

(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);

  /* ---------- 常量与本地存储 ---------- */
  const PRESETS = {
    b: { cols: 9,  rows: 9,  mines: 10, name: '初级' },
    i: { cols: 16, rows: 16, mines: 40, name: '中级' },
    e: { cols: 30, rows: 16, mines: 99, name: '高级' },
  };
  const KEYS = {
    best: 'ms-best-v1',    // { b:{t,n,d}, i:…, e:… }
    marks: 'ms-marks-v1',  // （?）标记开关
    ng: 'ms-noguess-v1',   // 无猜模式开关
    custom: 'ms-custom-v1',// 自定义 { cols, rows, mines }
    fm: 'ms-flagmode-v1',  // 插旗模式
    preset: 'ms-preset-v1',
    name: 'ms-name-v1',
  };
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? d : JSON.parse(v);
      } catch { return d; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 隐私模式等场景静默失败 */ }
    },
  };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------- DOM ---------- */
  const boardEl = $('#ms-board');
  const faceEl = $('#ms-face');
  const ledMinesEl = $('#ms-led-mines');
  const ledTimeEl = $('#ms-led-time');
  const stageEl = $('.ms-stage');
  const modal = $('#ms-modal');
  const dlgCap = $('#ms-dlg-cap');
  const dlgBody = $('#ms-dlg-body');
  const fmBtn = $('#ms-flagmode');
  const menus = [...document.querySelectorAll('.ms-menu')];

  /* ---------- 笑脸（内联 SVG，随状态切换） ---------- */
  const FACES = {
    smile: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#ff0" stroke="#000" stroke-width="1.3"/><circle cx="8.4" cy="9.6" r="1.3" fill="#000"/><circle cx="15.6" cy="9.6" r="1.3" fill="#000"/><path d="M6.8,13.6Q12,18.8 17.2,13.6" fill="none" stroke="#000" stroke-width="1.7" stroke-linecap="round"/></svg>',
    ooh: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#ff0" stroke="#000" stroke-width="1.3"/><circle cx="8.4" cy="9.2" r="1.3" fill="#000"/><circle cx="15.6" cy="9.2" r="1.3" fill="#000"/><ellipse cx="12" cy="15.8" rx="2.6" ry="3.4" fill="#000"/></svg>',
    cool: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#ff0" stroke="#000" stroke-width="1.3"/><rect x="4.2" y="8" width="15.6" height="2" fill="#000"/><rect x="5.4" y="6.6" width="6.2" height="5.4" rx="1.8" fill="#000"/><rect x="12.4" y="6.6" width="6.2" height="5.4" rx="1.8" fill="#000"/><path d="M8,15.4Q12,18.6 16,15.4" fill="none" stroke="#000" stroke-width="1.7" stroke-linecap="round"/></svg>',
    dead: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#ff0" stroke="#000" stroke-width="1.3"/><path d="M6.8,7.8l3.4,3.4M10.2,7.8l-3.4,3.4" stroke="#000" stroke-width="1.5" stroke-linecap="round"/><path d="M13.8,7.8l3.4,3.4M17.2,7.8l-3.4,3.4" stroke="#000" stroke-width="1.5" stroke-linecap="round"/><path d="M7,17.4Q12,12.8 17,17.4" fill="none" stroke="#000" stroke-width="1.7" stroke-linecap="round"/></svg>',
  };
  const setFace = (k) => { faceEl.innerHTML = FACES[k]; };

  /* ---------- 七段 LED ---------- */
  const SEGMAP = {
    0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg',
    5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g',
  };
  function makeLED(el) {
    el.textContent = '';
    const ds = [];
    for (let k = 0; k < 3; k++) {
      const d = document.createElement('span');
      d.className = 'ms-digit';
      for (const s of 'abcdefg') {
        const seg = document.createElement('i');
        seg.className = 'ms-seg s-' + s;
        seg.dataset.s = s;
        d.appendChild(seg);
      }
      el.appendChild(d);
      ds.push(d);
    }
    return ds;
  }
  function setLED(ds, val) {
    // 计数器与原版一致：可为负（-NN），正向最多 999
    const str = val < 0
      ? '-' + String(Math.min(-val, 99)).padStart(2, '0')
      : String(Math.min(val, 999)).padStart(3, '0');
    for (let k = 0; k < 3; k++) {
      const on = SEGMAP[str[k]] || '';
      for (const seg of ds[k].children) seg.classList.toggle('on', on.includes(seg.dataset.s));
    }
  }

  /* ---------- 游戏状态 ---------- */
  let presetKey = ['b', 'i', 'e', 'custom'].includes(store.get(KEYS.preset, 'b')) ? store.get(KEYS.preset, 'b') : 'b';
  let cfg = loadCfg();
  let marksOn = store.get(KEYS.marks, true) !== false;
  let flagMode = store.get(KEYS.fm, false) === true;
  let noGuess = store.get(KEYS.ng, true) !== false;

  /* ---------- 云端（Supabase）状态 ----------
     cloudSb 为 null 时全部功能静默降级为纯本地（后端未配置/加载失败）；
     cloudUser 为 null 表示游客（破纪录时才需要输入署名）。 */
  let cloudSb = null;
  let cloudUser = null;
  let lbTab = 'b';

  let cols, rows, mines, n;
  let isMine, adj, open, mark; // mark: 0 无 / 1 旗 / 2 问号
  let cells = [];
  let openedCount, flags, started, over, time, timerId = null;
  let minesDigits, timeDigits;

  function loadCfg() {
    if (presetKey !== 'custom') return { ...PRESETS[presetKey] };
    const c = store.get(KEYS.custom, null);
    if (c && c.cols >= 9 && c.cols <= 30 && c.rows >= 9 && c.rows <= 24 &&
        c.mines >= 10 && c.mines <= c.cols * c.rows - 10) {
      return { cols: c.cols, rows: c.rows, mines: c.mines };
    }
    presetKey = 'b';
    return { ...PRESETS.b };
  }

  function nb(i) {
    const x = i % cols, y = (i / cols) | 0, out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) out.push(ny * cols + nx);
      }
    }
    return out;
  }

  /* ---------- 开局 ---------- */
  function newGame() {
    clearInterval(timerId);
    timerId = null;
    ({ cols, rows, mines } = cfg);
    n = cols * rows;
    isMine = new Uint8Array(n);
    adj = new Uint8Array(n);
    open = new Uint8Array(n);
    mark = new Uint8Array(n);
    openedCount = 0;
    flags = 0;
    started = false;
    over = false;
    time = 0;
    setLED(minesDigits, mines);
    setLED(timeDigits, 0);
    setFace('smile');
    buildBoard();
    fitBoard();
  }

  function buildBoard() {
    const frag = document.createDocumentFragment();
    cells = new Array(n);
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div');
      d.className = 'ms-cell';
      d.dataset.i = i;
      frag.appendChild(d);
      cells[i] = d;
    }
    boardEl.replaceChildren(frag);
    boardEl.style.gridTemplateColumns = `repeat(${cols}, var(--cs))`;
  }

  function fitBoard() {
    // 40 = 窗体边框与内边距，6 = 雷区凹槽边框；过小则保底 20px 交给横向滚动
    let cs = Math.floor((stageEl.clientWidth - 40) / cols);
    if (isFullscreen()) {
      // 窗口全屏：宽高都参与，150 ≈ 标题栏+菜单+HUD+凹槽边框+窗体内边距
      cs = Math.min(
        Math.floor((window.innerWidth - 44) / cols),
        Math.floor((window.innerHeight - 150) / rows)
      );
    }
    cs = clamp(cs, 20, isFullscreen() ? 44 : 30);
    boardEl.style.setProperty('--cs', cs + 'px');
  }

  /* ---------- 全屏（标题栏 □ 按钮）：窗口本体铺满整屏，英雄榜不显示 ----------
     优先 Fullscreen API（连系统浏览器菜单一起隐藏）；
     API 不可用/被拒时降级为 CSS 假全屏（窗口 fixed 盖满视口）。 */
  const maxBtn = $('#ms-max');
  const fsTarget = document.querySelector('.ms-window');

  function isFullscreen() {
    return Boolean(
      document.fullscreenElement === fsTarget ||
      document.webkitFullscreenElement === fsTarget ||
      document.body.classList.contains('ms-win-fake')
    );
  }
  function renderFs() {
    if (maxBtn) {
      maxBtn.textContent = isFullscreen() ? '❐' : '□';
      maxBtn.title = isFullscreen() ? '还原' : '全屏';
    }
    fitBoard();
  }
  async function toggleFullscreen() {
    const api = fsTarget && (fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen);
    if (isFullscreen()) {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        const p = exit.call(document);
        // 某些环境退出时 fullscreenchange 不触发：主动多同步几次
        if (p && p.then) { p.then(renderFs).catch(renderFs); }
        setTimeout(renderFs, 120);
        setTimeout(renderFs, 400);
      } else {
        document.body.classList.remove('ms-win-fake');
      }
      renderFs();
      return;
    }
    if (api) {
      try {
        // 无用户激活的合成点击会让 requestFullscreen 永远挂起 → 800ms 超时转假全屏
        let entered = false;
        await Promise.race([
          api.call(fsTarget).then(() => { entered = true; }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('fs-timeout')), 800)),
        ]);
        setTimeout(renderFs, 50);
        setTimeout(renderFs, 400);
        return;
      } catch {
        /* 超时/被拒 → 先假全屏兜底；若真全屏迟到生效，fullscreenchange 会摘掉假全屏 */
      }
    }
    document.body.classList.add('ms-win-fake');
    renderFs();
  }
  document.addEventListener('fullscreenchange', () => {
    // 迟到的真全屏成功时，自动撤掉假全屏
    if (document.fullscreenElement && document.body.classList.contains('ms-win-fake')) {
      document.body.classList.remove('ms-win-fake');
    }
    renderFs();
  });
  document.addEventListener('webkitfullscreenchange', renderFs);
  if (maxBtn) maxBtn.addEventListener('click', toggleFullscreen);

  /* 首击后布雷：格子够时避开首击 3×3，保证开局舒服（原版至少保证首击不踩雷）。
     无猜模式会反复调用换盘 —— 必须先清空上一盘的雷与邻数，否则旧雷累积、局面被污染。 */
  function placeMines(safe) {
    isMine.fill(0);
    adj.fill(0);
    const forbid = new Set([safe]);
    const around = nb(safe);
    if (mines <= n - around.length - 1) for (const k of around) forbid.add(k);
    const pool = [];
    for (let i = 0; i < n; i++) if (!forbid.has(i)) pool.push(i);
    for (let k = 0; k < mines; k++) {
      const j = k + ((Math.random() * (pool.length - k)) | 0);
      const t = pool[k]; pool[k] = pool[j]; pool[j] = t;
      isMine[pool[k]] = 1;
    }
    for (let i = 0; i < n; i++) {
      if (isMine[i]) continue;
      let c = 0;
      for (const k of nb(i)) if (isMine[k]) c++;
      adj[i] = c;
    }
  }

  function paint(i) {
    const el = cells[i];
    el.className = 'ms-cell';
    el.textContent = '';
    if (open[i]) {
      el.classList.add('open');
      if (adj[i]) {
        el.classList.add('n' + adj[i]);
        el.textContent = adj[i];
      }
    } else if (mark[i] === 1) {
      el.classList.add('flag');
    } else if (mark[i] === 2) {
      el.classList.add('qm');
      el.textContent = '?';
    }
  }

  /* ---------- 核心操作 ---------- */
  function reveal(i) {
    if (over || open[i] || mark[i] === 1) return;
    if (!started) start(i);
    if (isMine[i]) { lose(i); return; }
    const stack = [i];
    while (stack.length) {
      const j = stack.pop();
      if (open[j] || mark[j] === 1) continue;
      open[j] = 1;
      openedCount++;
      paint(j);
      if (adj[j] === 0) for (const k of nb(j)) if (!open[k]) stack.push(k);
    }
    if (openedCount === n - mines) win();
  }

  function start(i) {
    started = true;
    placeMines(i);
    if (noGuess) {
      // 换盘直到逻辑可解；预算兜底（超难自定义盘几乎不会触发）——超时接受当前盘
      const deadline = performance.now() + 900;
      let tries = 0;
      while (!solvableFrom(i)) {
        if (++tries > 500 || performance.now() > deadline) break;
        placeMines(i);
      }
    }
    timerId = setInterval(() => {
      if (time < 999) {
        time++;
        setLED(timeDigits, time);
      }
    }, 1000);
  }

  /* ---------- 无猜检测：从首击出发的逻辑求解器 ----------
     三级规则：① 单格约束（需雷数==未知数→全雷；==0→全安全）；
     ② 子集差（A⊂B 时，B−A 的需雷数推出差集全雷/全安全，覆盖 1-2-1 等模型）；
     ③ 全局雷数作为一个约束参与 ②（收官阶段数雷）。
     推不动仍剩未开格 → 该盘需要猜 → 重布雷。 */
  function solvableFrom(safe) {
    const opened = new Uint8Array(n);
    const flg = new Uint8Array(n);
    let cnt = 0, flgCnt = 0;
    const flood = (s) => {
      const st = [s];
      while (st.length) {
        const j = st.pop();
        if (opened[j]) continue;
        opened[j] = 1;
        cnt++;
        // 雷格 adj 恒为 0（未参与计数），加 isMine 保险防误推导经雷级联虚增 cnt
        if (!isMine[j] && adj[j] === 0) for (const k of nb(j)) if (!opened[k]) st.push(k);
      }
    };
    flood(safe);
    for (let wave = 0; wave < 2000 && cnt < n - mines; wave++) {
      const cons = [];
      for (let i = 0; i < n; i++) {
        if (!opened[i] || !adj[i]) continue;
        let f = 0;
        const unk = [];
        for (const k of nb(i)) {
          if (opened[k]) continue;
          if (flg[k]) f++;
          else unk.push(k);
        }
        if (unk.length) cons.push({ cells: unk, need: adj[i] - f });
      }
      { // 全局约束：所有未开未旗格的剩余雷数
        const unk = [];
        let f = 0;
        for (let i = 0; i < n; i++) {
          if (opened[i]) continue;
          if (flg[i]) f++;
          else unk.push(i);
        }
        if (unk.length) cons.push({ cells: unk, need: mines - f });
      }
      const mineSet = new Set();
      const safeSet = new Set();
      for (const c of cons) {
        if (c.need === c.cells.length) for (const k of c.cells) mineSet.add(k);
        else if (c.need === 0) for (const k of c.cells) safeSet.add(k);
      }
      if (!mineSet.size && !safeSet.size) {
        // 规则① 失效才跑更贵的规则②（子集差）
        for (let a = 0; a < cons.length; a++) {
          const A = cons[a];
          const sa = A._set || (A._set = new Set(A.cells));
          for (let b = 0; b < cons.length; b++) {
            if (a === b) continue;
            const B = cons[b];
            if (B.cells.length <= A.cells.length) continue;
            const sb = B._set || (B._set = new Set(B.cells));
            let subset = true;
            for (const x of A.cells) if (!sb.has(x)) { subset = false; break; }
            if (!subset) continue;
            const dNeed = B.need - A.need;
            const dLen = B.cells.length - A.cells.length;
            if (dNeed === 0) { for (const x of B.cells) if (!sa.has(x)) safeSet.add(x); }
            else if (dNeed === dLen) { for (const x of B.cells) if (!sa.has(x)) mineSet.add(x); }
          }
        }
        if (!mineSet.size && !safeSet.size) break;
      }
      for (const k of mineSet) if (!flg[k]) { flg[k] = 1; flgCnt++; }
      for (const k of safeSet) if (!opened[k]) flood(k);
    }
    return cnt >= n - mines;
  }

  function flag(i) {
    if (over || open[i]) return;
    if (mark[i] === 1) {
      flags--;
      mark[i] = marksOn ? 2 : 0;
    } else if (mark[i] === 2) {
      mark[i] = 0;
    } else {
      mark[i] = 1;
      flags++;
    }
    paint(i);
    setLED(minesDigits, mines - flags);
  }

  /* 快开：已开数字周围的旗数与数字吻合时，翻开其余邻居 */
  function chord(i) {
    if (over || !open[i] || !adj[i]) return;
    let f = 0;
    for (const k of nb(i)) if (mark[k] === 1) f++;
    if (f !== adj[i]) return;
    for (const k of nb(i)) {
      if (open[k] || mark[k] === 1) continue;
      if (isMine[k]) { lose(k); return; }
      reveal(k);
      if (over) return;
    }
  }

  function lose(hit) {
    over = true;
    clearInterval(timerId);
    timerId = null;
    setFace('dead');
    for (let i = 0; i < n; i++) {
      const el = cells[i];
      if (isMine[i] && mark[i] !== 1) {
        el.className = 'ms-cell open mine' + (i === hit ? ' boom' : '');
      } else if (!isMine[i] && mark[i] === 1) {
        el.className = 'ms-cell open wrong';
      }
    }
  }

  function win() {
    over = true;
    clearInterval(timerId);
    timerId = null;
    setFace('cool');
    for (let i = 0; i < n; i++) if (isMine[i]) { mark[i] = 1; paint(i); }
    flags = mines;
    setLED(minesDigits, 0);
    maybeRecord();
  }

  /* ---------- 指针交互（鼠标 + 触屏统一走 Pointer Events） ---------- */
  let pressIdx = -1, chordMode = false, longDone = false, pressTimer = 0, faceHeld = false;
  let startX = 0, startY = 0;

  boardEl.addEventListener('contextmenu', (e) => e.preventDefault());
  boardEl.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // 阻止中键自动滚动

  boardEl.addEventListener('pointerdown', (e) => {
    if (over || !e.isPrimary) return;
    const cell = e.target.closest('.ms-cell');
    if (!cell) return;
    const i = +cell.dataset.i;
    if (e.pointerType === 'mouse') {
      if (e.button === 2) { flag(i); return; }                 // 右键按下即插旗（原版行为）
      if (e.button === 1) { e.preventDefault(); beginChord(i); return; }
      if (e.button !== 0) return;
      if (e.buttons & 2) { beginChord(i); return; }            // 左右同按 → 快开
      beginPress(i, null);
    } else if (e.button === 0) {
      beginPress(i, e);                                        // 触屏：等待长按
    }
  });

  function beginPress(i, ev) {
    pressIdx = i;
    chordMode = false;
    longDone = false;
    faceHeld = true;
    setFace('ooh');
    setPress(i, true);
    if (ev) {
      startX = ev.clientX;
      startY = ev.clientY;
      pressTimer = setTimeout(() => {                          // 长按插旗
        longDone = true;
        flag(i);
        clearAllDown();
        faceHeld = false;
        if (!over) setFace('smile');
        if (navigator.vibrate) navigator.vibrate(50);
      }, 380);
    }
  }

  function beginChord(i) {
    pressIdx = i;
    chordMode = true;
    longDone = false;
    faceHeld = true;
    setFace('ooh');
    setPress(i, true);
  }

  /* 按压预览：闭合格变平；已开数字按住时闪现将快开的邻居（原版行为） */
  function setPress(i, on) {
    if (open[i]) {
      if (!adj[i]) return;
      for (const k of nb(i)) if (!open[k] && mark[k] !== 1) cells[k].classList.toggle('is-down', on);
    } else if (mark[i] !== 1) {
      cells[i].classList.toggle('is-down', on);
    }
  }

  function clearAllDown() {
    for (const el of boardEl.querySelectorAll('.ms-cell.is-down')) el.classList.remove('is-down');
  }

  function endPressVisual() {
    clearTimeout(pressTimer);
    clearAllDown();
    if (faceHeld) {
      faceHeld = false;
      if (!over) setFace('smile');
    }
  }

  boardEl.addEventListener('pointermove', (e) => {
    if (pressIdx < 0) return;
    if (e.pointerType !== 'mouse') {
      // 触屏：位移超过阈值视为滚动，取消本次按压与长按
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 10) {
        pressIdx = -1;
        chordMode = false;
        longDone = false;
        endPressVisual();
      }
      return;
    }
    // 鼠标按住拖动：按压跟随指向的格子，动作落在松开处（原版行为）
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el && el.closest('.ms-cell');
    if (!cell) return;
    const i = +cell.dataset.i;
    if (i !== pressIdx) {
      clearAllDown();
      pressIdx = i;
      setPress(i, true);
    }
  });

  boardEl.addEventListener('pointerup', (e) => {
    if (pressIdx < 0) return;
    const wasChord = chordMode;
    const wasLong = longDone;
    pressIdx = -1;
    chordMode = false;
    longDone = false;
    endPressVisual();
    if (over || wasLong) return;
    if (e.pointerType === 'mouse' && e.button === 2) return;   // 右键抬起不触发翻开

    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = (el && el.closest('.ms-cell')) || (e.target.closest && e.target.closest('.ms-cell'));
    const i = cell ? +cell.dataset.i : -1;
    if (i < 0) return;
    if (wasChord) { if (open[i]) chord(i); return; }
    if (open[i]) chord(i);                                     // 点已开数字 = 快开（触屏主要手段）
    else if (flagMode) flag(i);
    else reveal(i);
  });

  // 按住后拖出棋盘再松手：由 window 兜底清按压态（boardEl 的 handler 先行把 pressIdx 清掉）
  window.addEventListener('pointerup', () => {
    if (pressIdx < 0) return;
    pressIdx = -1;
    chordMode = false;
    longDone = false;
    endPressVisual();
  });
  boardEl.addEventListener('pointercancel', () => {
    pressIdx = -1;
    chordMode = false;
    longDone = false;
    endPressVisual();
  });

  /* ---------- 菜单 ---------- */
  function syncMenuChecks() {
    const game = $('#ms-menu-game');
    for (const mi of game.querySelectorAll('.ms-mi')) {
      if (mi.dataset.diff) $('.chk', mi).textContent = mi.dataset.diff === presetKey ? '●' : '';
    }
    $('.chk', game.querySelector('[data-act="marks"]')).textContent = marksOn ? '✓' : '';
    $('.chk', game.querySelector('[data-act="noguess"]')).textContent = noGuess ? '✓' : '';
  }

  function openMenu(m) {
    for (const x of menus) {
      const on = x === m;
      x.classList.toggle('open', on);
      $('.ms-drop', x).hidden = !on;
      $('.ms-menu-btn', x).setAttribute('aria-expanded', String(on));
    }
  }
  const closeMenus = () => openMenu(null);

  for (const m of menus) {
    const btn = $('.ms-menu-btn', m);
    btn.addEventListener('click', () => {
      m.classList.contains('open') ? closeMenus() : openMenu(m);
    });
    btn.addEventListener('pointerenter', () => {               // 菜单开着时划过即切换（原版行为）
      if (menus.some((x) => x.classList.contains('open')) && !m.classList.contains('open')) openMenu(m);
    });
    $('.ms-drop', m).addEventListener('click', (e) => {
      const mi = e.target.closest('.ms-mi');
      if (!mi) return;
      closeMenus();
      if (mi.dataset.diff) setPreset(mi.dataset.diff);
      else doAction(mi.dataset.act);
    });
  }
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.ms-menu')) closeMenus();
  });

  function setPreset(k) {
    presetKey = k;
    cfg = { ...PRESETS[k] };
    store.set(KEYS.preset, k);
    syncMenuChecks();
    newGame();
  }

  function doAction(act) {
    if (act === 'new') newGame();
    else if (act === 'custom') openCustom();
    else if (act === 'marks') {
      marksOn = !marksOn;
      store.set(KEYS.marks, marksOn);
      syncMenuChecks();
    } else if (act === 'noguess') {
      noGuess = !noGuess;
      store.set(KEYS.ng, noGuess);
      syncMenuChecks();
    } else if (act === 'best') openBest();
    else if (act === 'exit') location.href = '../../tools.html';
    else if (act === 'about') openAbout();
  }

  /* ---------- 对话框 ---------- */
  function showDialog(cap, build) {
    dlgCap.textContent = cap;
    dlgBody.textContent = '';
    build(dlgBody);
    modal.hidden = false;
  }
  function closeDialog() {
    modal.hidden = true;
    dlgBody.textContent = '';
  }
  modal.addEventListener('pointerdown', (e) => { if (e.target === modal) closeDialog(); });
  $('#ms-dlg-x').addEventListener('click', closeDialog);

  function openCustom() {
    showDialog('自定义棋盘', (body) => {
      body.innerHTML = `
        <div class="ms-field"><label for="ms-cw">宽度：</label><input class="ms-input" id="ms-cw" type="number" min="9" max="30" step="1" value="${cfg.cols}"></div>
        <div class="ms-field"><label for="ms-ch">高度：</label><input class="ms-input" id="ms-ch" type="number" min="9" max="24" step="1" value="${cfg.rows}"></div>
        <div class="ms-field"><label for="ms-cm">雷数：</label><input class="ms-input" id="ms-cm" type="number" min="10" step="1" value="${cfg.mines}"></div>
        <p class="ms-note">范围：宽 9–30，高 9–24，雷数 10 至 格数−10。</p>
        <div class="ms-dlg-foot right">
          <button class="ms-btn" id="ms-cc" type="button">取消</button>
          <button class="ms-btn default" id="ms-co" type="button">确定</button>
        </div>`;
      const w = $('#ms-cw'), h = $('#ms-ch'), m = $('#ms-cm');
      const apply = () => {
        const c = clamp(parseInt(w.value, 10) || 9, 9, 30);
        const r = clamp(parseInt(h.value, 10) || 9, 9, 24);
        const mn = clamp(parseInt(m.value, 10) || 10, 10, c * r - 10);
        cfg = { cols: c, rows: r, mines: mn };
        presetKey = 'custom';
        store.set(KEYS.custom, cfg);
        store.set(KEYS.preset, presetKey);
        syncMenuChecks();
        newGame();
        closeDialog();
      };
      $('#ms-co').addEventListener('click', apply);
      $('#ms-cc').addEventListener('click', closeDialog);
      body.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
      w.focus();
      w.select();
    });
  }

  function openBest() {
    showDialog('最佳纪录', (body) => {
      const best = store.get(KEYS.best, {});
      const head = document.createElement('div');
      head.className = 'ms-best-row ms-best-head';
      const h0 = document.createElement('span');
      h0.className = 'k';
      h0.textContent = '等级';
      const h1 = document.createElement('b');
      h1.textContent = '本机纪录';
      const h2 = document.createElement('span');
      h2.className = 'c';
      h2.textContent = '云端我的最好';
      head.append(h0, h1, h2);
      body.appendChild(head);
      const cloudCells = {};
      for (const k of ['b', 'i', 'e']) {
        const row = document.createElement('div');
        row.className = 'ms-best-row';
        const kEl = document.createElement('span');
        kEl.className = 'k';
        kEl.textContent = PRESETS[k].name;
        const tEl = document.createElement('b');
        tEl.textContent = best[k] ? `${best[k].t} 秒` : '—';
        const cEl = document.createElement('span');
        cEl.className = 'c';
        cEl.textContent = '…';
        cloudCells[k] = cEl;
        row.append(kEl, tEl, cEl);
        body.appendChild(row);
      }
      // 云端该登录账号各难度的最好成绩（换设备也看得到）
      if (cloudSb && cloudUser) {
        cloudSb.from('minesweeper_records')
          .select('difficulty,seconds')
          .eq('user_id', cloudUser.id)
          .then(({ data, error }) => {
            if (error) throw error;
            const top = {};
            for (const r of data || []) {
              if (!(r.difficulty in top) || r.seconds < top[r.difficulty]) top[r.difficulty] = r.seconds;
            }
            for (const k of ['b', 'i', 'e']) cloudCells[k].textContent = k in top ? `${top[k]} 秒` : '—';
          })
          .catch(() => {
            for (const k of ['b', 'i', 'e']) cloudCells[k].textContent = '—';
          });
      } else {
        for (const k of ['b', 'i', 'e']) cloudCells[k].textContent = '—';
      }
      const note = document.createElement('p');
      note.className = 'ms-note';
      note.style.marginTop = '10px';
      note.textContent = cloudUser
        ? '本机纪录存在这台设备；云端成绩登录后全设备同步，并参与右侧全站英雄榜。自定义棋盘不计入。'
        : '本机纪录保存在这台设备。登录后成绩自动署名上云、全设备同步并参与右侧全站英雄榜。自定义棋盘不计入。';
      body.appendChild(note);
      const foot = document.createElement('div');
      foot.className = 'ms-dlg-foot right';
      const reset = document.createElement('button');
      reset.className = 'ms-btn';
      reset.type = 'button';
      reset.textContent = '清除本机纪录';
      reset.addEventListener('click', () => {
        store.set(KEYS.best, {});
        closeDialog();
        openBest();
      });
      const ok = document.createElement('button');
      ok.className = 'ms-btn default';
      ok.type = 'button';
      ok.textContent = '确定';
      ok.addEventListener('click', closeDialog);
      foot.append(reset, ok);
      body.appendChild(foot);
    });
  }

  function openAbout() {
    showDialog('关于扫雷', (body) => {
      body.innerHTML = `
        <p style="text-align:center; font-size:15px;"><b>经典扫雷 · 复刻版</b></p>
        <p>忠实复刻 Windows 9x 自带的扫雷：三档难度与自定义棋盘、（?）标记、双键快开。默认开启无猜模式——每盘都经过求解器验证，纯逻辑可通关，不会遇到只能二选一的死局；可在「游戏」菜单关闭，回归原版随机。</p>
        <p class="ms-sub">通关成绩上云参与右侧「英雄榜」（初/中/高级各自的全站最短用时 Top 10）：登录后自动用账号昵称署名、全设备同步；游客破纪录时输入一次大名即可上榜。</p>
        <p class="ms-sub">电脑：左键挖雷 · 右键插旗 · 中键/双键快开 · F2 重开<br>触屏：点按挖雷 · 长按插旗 · 底部可切换插旗模式</p>
        <p class="ms-sub">Michael 的工具站 · 全程本地运行</p>
        <div class="ms-dlg-foot"><button class="ms-btn default" id="ms-aok" type="button">确定</button></div>`;
      $('#ms-aok').addEventListener('click', closeDialog);
    });
  }

  /* ---------- 云端：身份 / 成绩上报 ---------- */
  async function initCloud() {
    if (!isConfigured()) {
      renderLbNote('未连接云端');
      return;
    }
    try {
      const sb = await getSupabase();
      if (!sb) {
        renderLbNote('云端暂不可用');
        return;
      }
      cloudSb = sb;
      const { data } = await sb.auth.getSession();
      setCloudUser(data?.session?.user ?? null);
      sb.auth.onAuthStateChange(() => {
        sb.auth.getSession()
          .then(({ data }) => setCloudUser(data?.session?.user ?? null))
          .catch(() => {});
      });
      loadLeaderboard();
    } catch {
      renderLbNote('云端暂不可用');
    }
  }

  function setCloudUser(u) {
    cloudUser = u ? {
      id: u.id,
      name: u.user_metadata?.display_name || (u.email ? u.email.split('@')[0] : '用户'),
    } : null;
    if (cloudSb) loadLeaderboard(); // 登录态变化后重新高亮榜上自己的记录
  }

  /* 每次通关（初/中/高级）都上报云端榜；失败静默，本地纪录不受影响 */
  async function submitRecord(diffKey, seconds) {
    if (!cloudSb) return;
    const name = cloudUser ? cloudUser.name : (store.get(KEYS.name, '') || '匿名');
    try {
      const { error } = await cloudSb.from('minesweeper_records').insert({
        user_id: cloudUser ? cloudUser.id : null,
        name,
        difficulty: diffKey,
        seconds,
      });
      if (error) throw error;
      loadLeaderboard();
    } catch (e) {
      console.warn('[扫雷] 云端成绩提交失败：', e?.message || e);
    }
  }

  function maybeRecord() {
    if (!PRESETS[presetKey]) return; // 自定义不入榜
    const best = store.get(KEYS.best, {});
    const old = best[presetKey];
    if (old && time >= old.t) {
      // 不是本机新纪录：不弹窗，成绩仍上报云端榜
      submitRecord(presetKey, time);
      return;
    }
    const diffName = PRESETS[presetKey].name;
    showDialog('新纪录！', (body) => {
      const p = document.createElement('p');
      p.innerHTML = `你用 <b>${time}</b> 秒完成${diffName}，刷新本机纪录！`;
      body.appendChild(p);
      let nameInput = null;
      if (cloudUser) {
        // 登录用户：直接用登录名，免输入
        const signed = document.createElement('p');
        signed.className = 'ms-sub';
        signed.textContent = `署名：${cloudUser.name}（登录账号自动署名）`;
        body.appendChild(signed);
      } else {
        const field = document.createElement('div');
        field.className = 'ms-field';
        const lab = document.createElement('label');
        lab.textContent = '留下大名：';
        lab.htmlFor = 'ms-rn';
        nameInput = document.createElement('input');
        nameInput.className = 'ms-input';
        nameInput.id = 'ms-rn';
        nameInput.maxLength = 16;
        nameInput.value = store.get(KEYS.name, '匿名');
        field.append(lab, nameInput);
        body.appendChild(field);
      }
      const foot = document.createElement('div');
      foot.className = 'ms-dlg-foot';
      const ok = document.createElement('button');
      ok.className = 'ms-btn default';
      ok.type = 'button';
      ok.textContent = '确定';
      const save = () => {
        const name = cloudUser ? cloudUser.name : (nameInput.value.trim() || '匿名');
        if (nameInput) store.set(KEYS.name, name);
        best[presetKey] = { t: time, n: name, d: new Date().toISOString().slice(0, 10) };
        store.set(KEYS.best, best);
        submitRecord(presetKey, time);
        closeDialog();
      };
      ok.addEventListener('click', save);
      if (nameInput) nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      foot.appendChild(ok);
      body.append(foot);
      if (nameInput) setTimeout(() => { nameInput.focus(); nameInput.select(); }, 0);
    });
  }

  /* ---------- 右侧全站英雄榜 ---------- */
  const lbListEl = $('#ms-lb-list');
  const lbNoteEl = $('#ms-lb-note');

  function renderLbNote(msg, emptyText) {
    if (!lbNoteEl) return;
    lbNoteEl.textContent = msg;
    if (!lbListEl) return;
    const li = document.createElement('li');
    li.className = 'ms-lb-empty';
    li.textContent = emptyText || '—';
    lbListEl.replaceChildren(li);
  }

  async function loadLeaderboard() {
    if (!cloudSb || !lbListEl) return;
    lbNoteEl.textContent = '读取中…';
    try {
      const { data, error } = await cloudSb.from('minesweeper_records')
        .select('name,seconds,user_id')
        .eq('difficulty', lbTab)
        .order('seconds', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      lbNoteEl.textContent = '全站共享 · 每人最快';
      // 每人只取最快一局：登录用户按账号去重，游客按名字去重
      const seen = new Set();
      const top = [];
      for (const r of data || []) {
        const key = r.user_id ? 'u:' + r.user_id : 'n:' + (r.name || '');
        if (seen.has(key)) continue;
        seen.add(key);
        top.push(r);
        if (top.length === 10) break;
      }
      if (!top.length) {
        renderLbNote('全站共享 · 每人最快', '虚位以待，快来霸榜！');
        return;
      }
      const rows = top.map((r, idx) => {
        const li = document.createElement('li');
        li.className = 'ms-lb-row' + (cloudUser && r.user_id === cloudUser.id ? ' me' : '');
        const rk = document.createElement('span');
        rk.className = 'rk' + (idx < 3 ? ' rk' + (idx + 1) : '');
        rk.textContent = idx + 1;
        const nm = document.createElement('span');
        nm.className = 'nm';
        nm.textContent = r.name || '匿名';
        const tm = document.createElement('span');
        tm.className = 'tm';
        tm.textContent = `${r.seconds} 秒`;
        li.append(rk, nm, tm);
        return li;
      });
      lbListEl.replaceChildren(...rows);
    } catch (e) {
      console.warn('[扫雷] 排行榜读取失败：', e?.message || e);
      renderLbNote('云端暂不可用', '榜单暂时读不到');
    }
  }

  for (const btn of document.querySelectorAll('.ms-lb-tab')) {
    btn.addEventListener('click', () => {
      lbTab = btn.dataset.lb;
      for (const t of document.querySelectorAll('.ms-lb-tab')) {
        t.classList.toggle('on', t === btn);
        t.setAttribute('aria-selected', String(t === btn));
      }
      loadLeaderboard();
    });
  }
  $('#ms-lb-refresh')?.addEventListener('click', loadLeaderboard);

  /* ---------- 其余入口 ---------- */
  faceEl.addEventListener('click', newGame);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'F2') {
      e.preventDefault();
      newGame();
    } else if (e.key === 'Escape') {
      closeMenus();
      closeDialog();
      if (document.body.classList.contains('ms-win-fake')) {
        document.body.classList.remove('ms-win-fake');
        renderFs();
      }
    }
  });

  function renderFm() {
    fmBtn.setAttribute('aria-pressed', String(flagMode));
    fmBtn.textContent = flagMode
      ? '🚩 插旗模式：开（点按即插旗）'
      : '💣 挖雷模式：开（点按挖雷 · 长按插旗）';
  }
  fmBtn.addEventListener('click', () => {
    flagMode = !flagMode;
    store.set(KEYS.fm, flagMode);
    renderFm();
  });

  /* ---------- 启动 ---------- */
  minesDigits = makeLED(ledMinesEl);
  timeDigits = makeLED(ledTimeEl);
  setFace('smile');
  renderFm();
  syncMenuChecks();
  newGame();
  window.addEventListener('resize', fitBoard);
  initCloud();
})();
