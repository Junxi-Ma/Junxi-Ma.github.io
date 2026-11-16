/* ============================================================
   纸感数独 — 现代风格
   · 生成：先随机铺满一张终盘，再逐格挖空并保持唯一解（MRV 回归计数）
   · 交互：点选作答、铅笔笔记、提示×3、撤销、三次失误上限
   · 云端（Supabase）：完成即自动署名上云；英雄榜每人只计最快
   · 云端不可用时静默回退纯本地
   ============================================================ */
import { getSupabase, isConfigured } from '../../assets/js/supabase.js';

(() => {
  'use strict';

  /* 版本标记：排查时一眼确认浏览器跑的是哪一版脚本 */
  const BUILD = 'v7 · 2026-11-16';
  console.info('[数独] build', BUILD);

  /* 未捕获错误在页面顶部亮一条红条：排查「点了没反应」时至少能看到原因。
     资源加载失败（图片/字体）冒泡上来的 error 事件忽略，只报真正的脚本错误。 */
  window.addEventListener('error', (ev) => {
    try {
      if (ev.target && ev.target !== window && ev.target.nodeType === 1) return;
      if (document.getElementById('sk-errbar')) return;
      const where = ev.filename ? ' @ ' + ev.filename.split('/').pop() + ':' + (ev.lineno || 0) : '';
      const bar = document.createElement('div');
      bar.id = 'sk-errbar';
      bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:9999;padding:10px 14px;'
        + 'font:13px/1.6 system-ui,-apple-system,"Microsoft YaHei",sans-serif;'
        + 'background:#b3261e;color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.3)';
      bar.textContent = '数独脚本出错（' + BUILD + '）：' + (ev.message || ev.error || '未知错误')
        + where + ' —— 按 F12 看控制台，把这段发我';
      document.body.appendChild(bar);
    } catch { /* 提示本身失败就算了 */ }
  });

  const $ = (s, el = document) => el.querySelector(s);

  /* ---------- 常量与本地存储 ---------- */
  const DIFFS = {
    easy: { clues: 40, label: '入门' },
    medium: { clues: 34, label: '进阶' },
    hard: { clues: 29, label: '困难' },
    expert: { clues: 25, label: '专家' },
  };
  const KEYS = {
    best: 'sk-best-v1',     // { easy:{t,n,d}, ... }
    diff: 'sk-diff-v1',
    name: 'sk-name-v1',
    save: 'sk-save-v1',     // 暂停存档（本机副本，跨设备靠云端）
  };
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? d : JSON.parse(v);
      } catch { return d; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 静默 */ }
    },
  };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------- DOM ---------- */
  const gridEl = $('#sk-grid');
  const sheetEl = $('#sk-sheet');
  const diffLabel = $('#sk-diff-label');
  const timerEl = $('#sk-timer');
  const livesEl = $('#sk-lives');
  const numsEl = $('#sk-nums');
  const noteBtn = $('#sk-note');
  const hintBtn = $('#sk-hint');
  const undoBtn = $('#sk-undo');
  const eraseBtn = $('#sk-erase');
  const bestBtn = $('#sk-best');
  const fsBtn = $('#sk-fs');
  const modal = $('#sk-modal');
  const cardTitle = $('#sk-card-title');
  const cardBody = $('#sk-card-body');
  const lbListEl = $('#sk-lb-list');
  const lbNoteEl = $('#sk-lb-note');
  const pauseBtn = $('#sk-pause');
  const pauseEl = $('#sk-pause-veil');
  const pauseNoteEl = $('#sk-pause-note');
  const pauseHintEl = $('#sk-pause-hint');
  const resumeBtn = $('#sk-resume');

  /* ---------- 引擎：位运算 + MRV 求解/生成 ---------- */
  const ROW = new Uint8Array(81), COL = new Uint8Array(81), BOX = new Uint8Array(81);
  for (let i = 0; i < 81; i++) {
    const r = (i / 9) | 0, c = i % 9;
    ROW[i] = r; COL[i] = c; BOX[i] = ((r / 3) | 0) * 3 + ((c / 3) | 0);
  }
  const ROWP = [], COLP = [], BOXP = []; // 同行/列/宫_peer，用于笔记清理
  for (let i = 0; i < 81; i++) {
    ROWP.push([]); COLP.push([]); BOXP.push([]);
    for (let j = 0; j < 81; j++) {
      if (j === i) continue;
      if (ROW[j] === ROW[i]) ROWP[i].push(j);
      if (COL[j] === COL[i]) COLP[i].push(j);
      if (BOX[j] === BOX[i]) BOXP[i].push(j);
    }
  }
  const bitOf = (d) => 1 << d;
  const digitOf = (bit) => 31 - Math.clz32(bit);

  /* 数解（MRV 回溯），最多数到 limit 个即停；sol 返回找到的第一个解 */
  function countSolutions(bd, limit) {
    const rowM = new Int32Array(9), colM = new Int32Array(9), boxM = new Int32Array(9);
    for (let i = 0; i < 81; i++)
      if (bd[i]) {
        const b = bitOf(bd[i]);
        rowM[ROW[i]] |= b; colM[COL[i]] |= b; boxM[BOX[i]] |= b;
      }
    let count = 0;
    const sol = new Int8Array(81);
    (function dfs() {
      if (count >= limit) return;
      let best = -1, bestMask = 0, bestN = 10;
      for (let i = 0; i < 81; i++) {
        if (bd[i]) continue;
        const used = rowM[ROW[i]] | colM[COL[i]] | boxM[BOX[i]];
        let mask = 0, n = 0;
        for (let d = 1; d <= 9; d++) if (!(used & bitOf(d))) { mask |= bitOf(d); n++; }
        if (n === 0) return; // 死局
        if (n < bestN) { bestN = n; best = i; bestMask = mask; if (n === 1) break; }
      }
      if (best === -1) { // 填满
        count++;
        if (count === 1) sol.set(bd);
        return;
      }
      const r = ROW[best], c = COL[best], bx = BOX[best];
      let mask = bestMask;
      while (mask) {
        const bit = mask & -mask;
        mask ^= bit;
        bd[best] = digitOf(bit);
        rowM[r] |= bit; colM[c] |= bit; boxM[bx] |= bit;
        dfs();
        bd[best] = 0;
        rowM[r] ^= bit; colM[c] ^= bit; boxM[bx] ^= bit;
        if (count >= limit) return;
      }
    })();
    return { count, sol };
  }

  /* 随机铺满一张终盘 */
  function generateFull() {
    const bd = new Int8Array(81);
    const rowM = new Int32Array(9), colM = new Int32Array(9), boxM = new Int32Array(9);
    function dfs() {
      let best = -1, bestMask = 0, bestN = 10;
      for (let i = 0; i < 81; i++) {
        if (bd[i]) continue;
        const used = rowM[ROW[i]] | colM[COL[i]] | boxM[BOX[i]];
        let mask = 0, n = 0;
        for (let d = 1; d <= 9; d++) if (!(used & bitOf(d))) { mask |= bitOf(d); n++; }
        if (n === 0) return false;
        if (n < bestN) { bestN = n; best = i; bestMask = mask; if (n === 1) break; }
      }
      if (best === -1) return true;
      const r = ROW[best], c = COL[best], bx = BOX[best];
      const cands = [];
      for (let m = bestMask; m; m ^= m & -m) cands.push(m & -m);
      for (let i = cands.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [cands[i], cands[j]] = [cands[j], cands[i]];
      }
      for (const bit of cands) {
        bd[best] = digitOf(bit);
        rowM[r] |= bit; colM[c] |= bit; boxM[bx] |= bit;
        if (dfs()) return true;
        bd[best] = 0;
        rowM[r] ^= bit; colM[c] ^= bit; boxM[bx] ^= bit;
      }
      return false;
    }
    dfs();
    return bd;
  }

  /* 挖空出唯一解谜题：目标 clues 个提示，2.5s 预算兜底 */
  function makePuzzle(clues) {
    const solution = generateFull();
    const puzzle = Int8Array.from(solution);
    const order = [...Array(81).keys()];
    for (let i = order.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [order[i], order[j]] = [order[j], order[i]];
    }
    const deadline = performance.now() + 2500;
    let removed = 0;
    const target = 81 - clues;
    for (const i of order) {
      if (removed >= target || performance.now() > deadline) break;
      const backup = puzzle[i];
      puzzle[i] = 0;
      if (countSolutions(puzzle, 2).count === 1) removed++;
      else puzzle[i] = backup;
    }
    return { solution, puzzle, clues: 81 - removed };
  }

  /* ---------- 游戏状态 ---------- */
  let diffKey = ['easy', 'medium', 'hard', 'expert'].includes(store.get(KEYS.diff, 'easy')) ? store.get(KEYS.diff, 'easy') : 'easy';
  let solution = new Int8Array(81);
  let given = new Uint8Array(81);  // 1 = 提示格
  let val = new Int8Array(81);     // 当前盘面（0 空）
  let notes = new Int16Array(81);  // 笔记位掩码
  let sel = -1;
  let noteMode = false;
  let mistakes = 0, hints = 3;
  let history = [];
  let started = false, over = false, time = 0, timerId = null;

  /* ---------- 云端（Supabase）状态 ---------- */
  let cloudSb = null;
  let cloudUser = null;
  let lbDiff = 'easy';

  /* ---------- 建盘与渲染 ---------- */
  let cells = [];

  function buildBoard() {
    const frag = document.createDocumentFragment();
    cells = new Array(81);
    for (let i = 0; i < 81; i++) {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'sk-cell';
      d.dataset.i = i;
      const r = (i / 9) | 0, c = i % 9;
      if (c === 2 || c === 5) d.classList.add('ebr');
      if (r === 2 || r === 5) d.classList.add('ebb');
      const digit = document.createElement('span');
      digit.className = 'sk-d';
      const notesEl = document.createElement('span');
      notesEl.className = 'sk-n';
      for (let n = 1; n <= 9; n++) {
        const ni = document.createElement('i');
        ni.textContent = n;
        ni.dataset.d = n;
        notesEl.appendChild(ni);
      }
      d.append(digit, notesEl);
      frag.appendChild(d);
      cells[i] = d;
    }
    gridEl.replaceChildren(frag);
  }

  function paint(i) {
    const el = cells[i];
    const nEl = el.querySelector('.sk-n');
    const dEl = el.querySelector('.sk-d');
    el.classList.toggle('given', given[i] === 1);
    el.classList.toggle('userval', given[i] === 0 && val[i] > 0);
    el.classList.toggle('bad', given[i] === 0 && val[i] > 0 && val[i] !== solution[i]);
    const showNote = val[i] === 0 && notes[i] > 0;
    nEl.style.display = showNote ? '' : 'none';
    dEl.textContent = val[i] > 0 ? String(val[i]) : '';
    if (showNote)
      for (const ni of nEl.children)
        ni.classList.toggle('on', (notes[i] & bitOf(+ni.dataset.d)) !== 0);
  }

  function paintHighlights() {
    const d = sel >= 0 ? val[sel] : 0;
    const sr = sel >= 0 ? ROW[sel] : -1, sc = sel >= 0 ? COL[sel] : -1, sb = sel >= 0 ? BOX[sel] : -1;
    for (let i = 0; i < 81; i++) {
      const el = cells[i];
      el.classList.toggle('sel', i === sel);
      const peer = sel >= 0 && i !== sel && (ROW[i] === sr || COL[i] === sc || BOX[i] === sb);
      el.classList.toggle('peer', peer);
      el.classList.toggle('same', d > 0 && i !== sel && val[i] === d);
    }
  }

  function select(i) {
    sel = i;
    paintHighlights();
  }

  function repaintAll() {
    for (let i = 0; i < 81; i++) paint(i);
    paintHighlights();
    updateNums();
  }

  /* ---------- 数字键剩余计数 ---------- */
  function updateNums() {
    for (let d = 1; d <= 9; d++) {
      const btn = numsEl.children[d - 1];
      let n = 0;
      for (let i = 0; i < 81; i++) if (val[i] === d) n++;
      btn.querySelector('span').textContent = String(9 - n);
      btn.classList.toggle('done', n >= 9);
    }
  }

  /* ---------- 计时 ---------- */
  function fmt(t) {
    const m = String((t / 60) | 0).padStart(2, '0');
    const s = String(t % 60).padStart(2, '0');
    return m + ':' + s;
  }
  function startTimer() {
    if (timerId) return;
    timerId = setInterval(() => {
      time++;
      timerEl.textContent = fmt(time);
    }, 1000);
  }
  function stopTimer() {
    clearInterval(timerId);
    timerId = null;
  }

  /* ---------- 历史与动作 ---------- */
  function pushHistory() {
    history.push({ val: Int8Array.from(val), notes: Int16Array.from(notes), mistakes, hints });
    if (history.length > 400) history.shift();
  }
  function undo() {
    if (over || !history.length) return;
    const h = history.pop();
    val = h.val; notes = h.notes; mistakes = h.mistakes; hints = h.hints;
    updateLives(); updateHintBtn(); repaintAll();
  }

  function begin() {
    if (!started) { started = true; startTimer(); }
  }

  function placeDigit(d) {
    if (over || sel < 0 || given[sel]) return;
    if (val[sel] === d && notes[sel] === 0) return;
    begin();
    pushHistory();
    val[sel] = d;
    notes[sel] = 0;
    if (d === solution[sel]) {
      // 正确：清理同 unit 的笔记
      for (const p of [...ROWP[sel], ...COLP[sel], ...BOXP[sel]])
        if (val[p] === 0 && (notes[p] & bitOf(d))) { notes[p] &= ~bitOf(d); paint(p); }
    } else {
      mistakes++;
      updateLives();
      if (mistakes >= 3) { repaintAll(); lose(); return; }
    }
    paint(sel);
    paintHighlights();
    updateNums();
    checkWin();
  }

  function eraseCell() {
    if (over || sel < 0 || given[sel]) return;
    if (val[sel] === 0 && notes[sel] === 0) return;
    begin();
    pushHistory();
    val[sel] = 0;
    notes[sel] = 0;
    paint(sel);
    paintHighlights();
    updateNums();
  }

  function toggleNote(d) {
    if (over || sel < 0 || given[sel] || val[sel] > 0) return;
    begin();
    pushHistory();
    notes[sel] ^= bitOf(d);
    paint(sel);
  }

  function hint() {
    if (over || hints <= 0) return;
    let target = sel;
    if (target < 0 || given[target] || val[target] === solution[target]) {
      const empties = [];
      for (let i = 0; i < 81; i++) if (!given[i] && val[i] !== solution[i]) empties.push(i);
      if (!empties.length) return;
      target = empties[(Math.random() * empties.length) | 0];
    }
    begin();
    pushHistory();
    hints--;
    updateHintBtn();
    val[target] = solution[target];
    notes[target] = 0;
    for (const p of [...ROWP[target], ...COLP[target], ...BOXP[target]])
      if (val[p] === 0 && (notes[p] & bitOf(solution[target]))) { notes[p] &= ~bitOf(solution[target]); paint(p); }
    sel = target;
    paint(target);
    paintHighlights();
    updateNums();
    checkWin();
  }

  function checkWin() {
    for (let i = 0; i < 81; i++) if (val[i] !== solution[i]) return;
    over = true;
    stopTimer();
    select(-1);
    clearSave();
    maybeRecord();
  }

  function lose() {
    over = true;
    stopTimer();
    clearSave();
    // 揭示答案
    for (let i = 0; i < 81; i++) {
      if (!given[i] && val[i] !== solution[i]) { val[i] = solution[i]; paint(i); cells[i].classList.add('reveal'); }
    }
    showDialog('三次失误', (body) => {
      const p = document.createElement('p');
      p.textContent = '本局到此为止 —— 正确答案已用灰色补全。';
      body.appendChild(p);
      const foot = document.createElement('div');
      foot.className = 'sk-actions';
      const again = document.createElement('button');
      again.className = 'sk-abtn primary';
      again.type = 'button';
      again.textContent = '再来一局';
      again.addEventListener('click', () => { closeDialog(); newGame(diffKey); });
      foot.appendChild(again);
      body.appendChild(foot);
    });
  }

  function updateLives() {
    [...livesEl.children].forEach((dot, idx) => dot.classList.toggle('off', idx >= 3 - mistakes));
  }
  function updateHintBtn() {
    hintBtn.textContent = `💡 提示 ×${hints}`;
    hintBtn.disabled = hints <= 0;
  }

  /* ---------- 新局 ---------- */
  function newGame(key, opts = {}) {
    diffKey = key;
    store.set(KEYS.diff, key);
    over = false;
    started = false;
    paused = false;
    if (pauseEl) pauseEl.hidden = true;
    // 开新局就把上一局的暂停存档作废；启动时的第一局除外，那时还要拿它来问要不要续
    if (!opts.keepSave) clearSave();
    mistakes = 0;
    hints = 3;
    history = [];
    sel = -1;
    stopTimer();
    time = 0;
    timerEl.textContent = '00:00';
    diffLabel.textContent = DIFFS[key].label;
    updateLives();
    updateHintBtn();
    diffLabel.textContent = '出题中…';
    // 让「出题中」先画出来再阻塞生成
    setTimeout(() => {
      const { solution: sol, puzzle } = makePuzzle(DIFFS[key].clues);
      solution = sol;
      given = new Uint8Array(81);
      val = new Int8Array(81);
      notes = new Int16Array(81);
      for (let i = 0; i < 81; i++) if (puzzle[i]) { given[i] = 1; val[i] = puzzle[i]; }
      buildBoard();
      repaintAll();
      diffLabel.textContent = DIFFS[key].label;
      fitSudoku();
    }, 30);
  }

  /* ---------- 数字键 ---------- */
  function buildNums() {
    numsEl.textContent = '';
    for (let d = 1; d <= 9; d++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sk-num';
      const digit = document.createElement('b');
      digit.textContent = d;
      const cnt = document.createElement('span');
      cnt.textContent = '9';
      b.append(digit, cnt);
      b.addEventListener('click', () => {
        if (noteMode) toggleNote(d);
        else placeDigit(d);
      });
      numsEl.appendChild(b);
    }
  }

  /* ---------- 难度切换 ----------
     事件委托绑在 document 上，位置提到其它绑定之前：
     这样即便页面上某个元素缺失、或后面的初始化在某处抛错，
     难度按钮也照常能切；newGame 真出错时给出可见反馈，而不是「点了没反应」。 */
  document.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('.sk-diffbtn') : null;
    if (!btn || btn.disabled) return;
    for (const t of document.querySelectorAll('.sk-diffbtn')) t.classList.toggle('on', t === btn);
    try {
      newGame(btn.dataset.diff);
    } catch (err) {
      console.error('[数独] 切换难度失败：', err);
      if (diffLabel) diffLabel.textContent = '出题失败，请刷新页面';
    }
  });

  /* ---------- 交互 ---------- */
  gridEl?.addEventListener('click', (e) => {
    const cell = e.target.closest('.sk-cell');
    if (cell) select(+cell.dataset.i);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape') {
      if (!modal.hidden) { closeDialog(); return; }
      if (document.body.classList.contains('sk-fs-fake')) {
        document.body.classList.remove('sk-fs-fake');
        renderFs();
      }
      return;
    }
    if (!modal.hidden) return;
    if (e.key >= '1' && e.key <= '9') {
      const d = +e.key;
      noteMode ? toggleNote(d) : placeDigit(d);
      e.preventDefault();
    } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
      eraseCell();
      e.preventDefault();
    } else if (e.key === 'n' || e.key === 'N') {
      setNoteMode(!noteMode);
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      if (sel < 0) { select(40); return; }
      let r = ROW[sel], c = COL[sel];
      if (e.key === 'ArrowUp') r = (r + 8) % 9;
      if (e.key === 'ArrowDown') r = (r + 1) % 9;
      if (e.key === 'ArrowLeft') c = (c + 8) % 9;
      if (e.key === 'ArrowRight') c = (c + 1) % 9;
      select(r * 9 + c);
    }
  });

  undoBtn?.addEventListener('click', undo);
  eraseBtn?.addEventListener('click', eraseCell);
  hintBtn?.addEventListener('click', hint);

  function setNoteMode(on) {
    noteMode = on;
    noteBtn.setAttribute('aria-pressed', String(on));
  }
  noteBtn?.addEventListener('click', () => setNoteMode(!noteMode));

  /* ---------- 对话框 ---------- */
  function showDialog(title, build) {
    cardTitle.textContent = title;
    cardBody.textContent = '';
    build(cardBody);
    modal.hidden = false;
  }
  function closeDialog() { modal.hidden = true; cardBody.textContent = ''; }
  modal?.addEventListener('pointerdown', (e) => { if (e.target === modal) closeDialog(); });

  /* ---------- 云端（Supabase） ---------- */
  async function initCloud() {
    if (!isConfigured()) { renderLbNote('未连接云端'); return; }
    try {
      const sb = await getSupabase();
      if (!sb) { renderLbNote('云端暂不可用'); return; }
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
    if (cloudSb) loadLeaderboard();
  }
  async function submitRecord(seconds, mistakesN, hintsN) {
    if (!cloudSb) return;
    const name = cloudUser ? cloudUser.name : (store.get(KEYS.name, '') || '匿名');
    try {
      const { error } = await cloudSb.from('sudoku_records').insert({
        user_id: cloudUser ? cloudUser.id : null,
        name,
        difficulty: diffKey,
        seconds,
        mistakes: mistakesN,
        hints: hintsN,
      });
      if (error) throw error;
      loadLeaderboard();
    } catch (e) {
      console.warn('[数独] 云端成绩提交失败：', e?.message || e);
    }
  }

  function maybeRecord() {
    const best = store.get(KEYS.best, {});
    const old = best[diffKey];
    if (old && time >= old.t) {
      // 没破纪录：成绩照旧自动上榜，弹窗留着做收藏入口
      submitRecord(time, mistakes, 3 - hints);
      showDoneDialog(false);
      return;
    }
    showDoneDialog(true);
  }

  function showDoneDialog(isNewBest) {
    showDialog(isNewBest ? '🎉 完成！' : '本局完成', (body) => {
      if (isNewBest) {
        const badge = document.createElement('div');
        badge.className = 'badge';
        badge.textContent = '🏆 新纪录';
        body.appendChild(badge);
      }
      const big = document.createElement('div');
      big.className = 'big';
      big.textContent = fmt(time);
      body.appendChild(big);
      const p = document.createElement('p');
      p.textContent = `${DIFFS[diffKey].label} · 失误 ${mistakes} 次 · 提示 ${3 - hints} 次`;
      body.appendChild(p);
      let nameInput = null;
      if (isNewBest) {
        if (cloudUser) {
          const signed = document.createElement('p');
          signed.className = 'muted';
          signed.textContent = `署名：${cloudUser.name}（登录账号自动署名）`;
          body.appendChild(signed);
        } else {
          const field = document.createElement('div');
          field.className = 'sk-field';
          const lab = document.createElement('label');
          lab.textContent = '留下大名：';
          lab.htmlFor = 'sk-rn';
          nameInput = document.createElement('input');
          nameInput.className = 'sk-input';
          nameInput.id = 'sk-rn';
          nameInput.maxLength = 16;
          nameInput.value = store.get(KEYS.name, '匿名');
          field.append(lab, nameInput);
          body.appendChild(field);
        }
      }
      const foot = document.createElement('div');
      foot.className = 'sk-actions';
      const fav = document.createElement('button');
      fav.className = 'sk-abtn';
      fav.type = 'button';
      fav.textContent = '收藏这局';
      fav.addEventListener('click', async () => {
        fav.disabled = true;
        fav.textContent = '收藏中…';
        const done = await collectGame();
        if (done) {
          fav.textContent = '已收藏 ✓';
          return;
        }
        fav.disabled = false;
        fav.textContent = '收藏这局';
        if (!cloudUser || !cloudSb) openLogin();
      });
      const ok = document.createElement('button');
      ok.className = 'sk-abtn primary';
      ok.type = 'button';
      ok.textContent = isNewBest ? '记入英雄榜' : '确定';
      const save = () => {
        if (isNewBest) {
          const name = cloudUser ? cloudUser.name : (nameInput.value.trim() || '匿名');
          if (nameInput) store.set(KEYS.name, name);
          best[diffKey] = { t: time, n: name, d: new Date().toISOString().slice(0, 10) };
          store.set(KEYS.best, best);
          submitRecord(time, mistakes, 3 - hints);
        }
        closeDialog();
      };
      ok.addEventListener('click', save);
      if (nameInput) nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      foot.append(fav, ok);
      body.appendChild(foot);
      if (nameInput) setTimeout(() => { nameInput.focus(); nameInput.select(); }, 0);
    });
  }

  /* ============================================================
     暂停 / 存档 / 收藏
     存档要塞进定长字符串才能过数据库的正则约束：
       givens   题意格（空格写 0）   ^[0-9]{81}$
       solution 完整解（无空格）     ^[1-9]{81}$
       board    当前填写（空格写 0） ^[0-9]{81}$
       notes    每格 3 位十六进制位掩码，共 243 位  ^[0-9a-f]{243}$
     ============================================================ */
  let paused = false;

  function makeSave() {
    const g = [], s = [], b = [], n = [];
    for (let i = 0; i < 81; i++) {
      g.push(given[i] ? val[i] : 0);
      s.push(solution[i]);
      b.push(val[i]);
      n.push(notes[i].toString(16).padStart(3, '0'));
    }
    return {
      difficulty: diffKey,
      givens: g.join(''),
      solution: s.join(''),
      board: b.join(''),
      notes: n.join(''),
      seconds: time,
      mistakes,
      hints_left: hints,
    };
  }

  function applySave(sv) {
    diffKey = DIFFS[sv.difficulty] ? sv.difficulty : 'easy';
    solution = Int8Array.from(sv.solution, (c) => +c);
    given = new Uint8Array(81);
    val = new Int8Array(81);
    notes = new Int16Array(81);
    for (let i = 0; i < 81; i++) {
      if (+sv.givens[i]) given[i] = 1;
      val[i] = +sv.board[i] || 0;
      notes[i] = parseInt(sv.notes.slice(i * 3, i * 3 + 3), 16) || 0;
    }
    mistakes = clamp(sv.mistakes | 0, 0, 2);
    hints = clamp(sv.hints_left | 0, 0, 3);
    time = clamp(sv.seconds | 0, 0, 35999);
    history = [];
    over = false;
    started = time > 0;
    sel = -1;
    stopTimer();
    buildBoard();
    repaintAll();
    updateLives();
    updateHintBtn();
    timerEl.textContent = fmt(time);
    diffLabel.textContent = DIFFS[diffKey].label;
    for (const b of document.querySelectorAll('.sk-diffbtn')) b.classList.toggle('on', b.dataset.diff === diffKey);
    store.set(KEYS.diff, diffKey);
    if (pauseEl) pauseEl.hidden = true;
    fitSudoku();
  }

  function pauseHint(text) {
    if (pauseHintEl) pauseHintEl.textContent = text || '';
  }

  /* 这局已经分出结果（完成或三振），暂停存档作废 */
  function clearSave() {
    store.set(KEYS.save, null);
    if (cloudSb && cloudUser) {
      // PostgrestBuilder 只有 then，没有 catch：挂 .catch() 会抛 TypeError，
      // 而 clearSave() 在 newGame / checkWin / lose 里都是同步调用的，
      // 一抛就会把换难度、结算这些流程整个打断。
      try {
        cloudSb.from('sudoku_saves').delete().eq('user_id', cloudUser.id)
          .then(() => {}, () => {});
      } catch { /* 云端删不掉不影响本地已清 */ }
    }
  }

  async function pushSave() {
    if (!cloudSb) return { ok: false, reason: 'offline' };
    if (!cloudUser) return { ok: false, reason: 'anon' };
    try {
      const { error } = await cloudSb.from('sudoku_saves').upsert({
        user_id: cloudUser.id,
        ...makeSave(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (error) throw error;
      return { ok: true };
    } catch (e) {
      console.warn('[数独] 存档上传失败：', e?.message || e);
      return { ok: false, reason: 'error' };
    }
  }

  async function pullSave() {
    if (!cloudSb || !cloudUser) return null;
    try {
      const { data, error } = await cloudSb.from('sudoku_saves')
        .select('*')
        .eq('user_id', cloudUser.id)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    } catch (e) {
      console.warn('[数独] 存档读取失败：', e?.message || e);
      return null;
    }
  }

  function pauseGame() {
    if (over || paused) return;
    paused = true;
    stopTimer();
    select(-1);
    if (pauseEl) pauseEl.hidden = false;
    // 纸张可能有一半在视口外，先把整张滚到中间，免得看不到「继续」
    if (!fsActive()) {
      try { sheetEl.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* 老浏览器忽略平滑 */ }
    }
    // 先落一份在本机，云端失败也不至于丢
    store.set(KEYS.save, makeSave());
    if (pauseNoteEl) pauseNoteEl.textContent = '计时已停，进度已存在这台设备。';
    pauseHint('正在同步到云端…');
    pushSave().then((r) => {
      if (r.ok) {
        pauseHint(`已同步到云端 · ${fmt(time)} · ${DIFFS[diffKey].label}`);
        if (pauseNoteEl) pauseNoteEl.textContent = '换设备登录同一账号即可继续。';
      } else if (r.reason === 'anon') {
        pauseHint('未登录：进度只在这台设备上，登录后可以跨设备继续。');
        addLoginShortcut();
      } else if (r.reason === 'offline') {
        pauseHint('云端暂不可用：进度只在这台设备上。');
      } else {
        pauseHint('上传失败：进度已存在这台设备，稍后可以再暂停一次重试。');
      }
    });
  }

  function resumeGame() {
    if (!paused) return;
    paused = false;
    if (pauseEl) pauseEl.hidden = true;
    if (started && !over) startTimer();
  }

  /* 未登录时在暂停遮罩里放一个「登录」入口 */
  function addLoginShortcut() {
    if (!pauseHintEl || pauseHintEl.querySelector('.sk-pause-login')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sk-abtn sk-pause-login';
    btn.textContent = '登录后同步';
    btn.style.marginTop = '8px';
    btn.addEventListener('click', openLogin);
    pauseHintEl.appendChild(document.createElement('br'));
    pauseHintEl.appendChild(btn);
  }

  function openLogin() {
    showDialog('登录', (body) => {
      const tip = document.createElement('p');
      tip.className = 'muted';
      tip.textContent = '登录后，暂停的进度会存到你的账号下，换设备也能继续。';
      body.appendChild(tip);
      const mk = (labelText, type, id) => {
        const field = document.createElement('div');
        field.className = 'sk-field';
        const lab = document.createElement('label');
        lab.textContent = labelText;
        lab.htmlFor = id;
        const input = document.createElement('input');
        input.className = 'sk-input';
        input.id = id;
        input.type = type;
        input.autocomplete = type === 'password' ? 'current-password' : 'email';
        field.append(lab, input);
        body.appendChild(field);
        return input;
      };
      const email = mk('邮箱：', 'email', 'sk-login-email');
      const pass = mk('密码：', 'password', 'sk-login-pass');
      const err = document.createElement('p');
      err.className = 'muted';
      err.style.minHeight = '18px';
      body.appendChild(err);
      const foot = document.createElement('div');
      foot.className = 'sk-actions';
      const go = document.createElement('button');
      go.className = 'sk-abtn primary';
      go.type = 'button';
      go.textContent = '登录';
      foot.appendChild(go);
      body.appendChild(foot);
      const submit = async () => {
        const e = email.value.trim();
        const p = pass.value;
        if (!e || !p) { err.textContent = '邮箱和密码都要填。'; return; }
        if (!cloudSb) { err.textContent = '云端暂不可用，稍后再试。'; return; }
        go.disabled = true;
        err.textContent = '登录中…';
        try {
          const { error } = await cloudSb.auth.signInWithPassword({ email: e, password: p });
          if (error) throw error;
          closeDialog();
          pauseHint('');
          pushSave().then((r) => {
            if (r.ok) {
              if (pauseNoteEl) pauseNoteEl.textContent = '换设备登录同一账号即可继续。';
              pauseHint(`已同步到云端 · ${fmt(time)} · ${DIFFS[diffKey].label}`);
            } else {
              pauseHint('登录成功，但存档没传上去，稍后再暂停一次试试。');
            }
          });
        } catch (ex) {
          err.textContent = /Invalid login credentials/i.test(ex?.message || '')
            ? '邮箱或密码不对。'
            : (ex?.message || '登录失败');
        } finally {
          go.disabled = false;
        }
      };
      go.addEventListener('click', submit);
      pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      setTimeout(() => email.focus(), 0);
    });
  }

  /* ---------- 收藏 ---------- */
  async function collectGame() {
    if (!cloudUser || !cloudSb) { openLogin(); return; }
    try {
      const sv = makeSave();
      const { error } = await cloudSb.from('sudoku_favorites').insert({
        user_id: cloudUser.id,
        difficulty: sv.difficulty,
        givens: sv.givens,
        solution: sv.solution,
        seconds: time,
        mistakes,
        hints_used: 3 - hints,
      });
      if (error) throw error;
      return true;
    } catch (e) {
      console.warn('[数独] 收藏失败：', e?.message || e);
      return false;
    }
  }

  function miniBoard(givens, solution) {
    const box = document.createElement('div');
    box.className = 'sk-mini';
    for (let i = 0; i < 81; i++) {
      const c = document.createElement('i');
      const g = givens[i] !== '0';
      c.textContent = g ? givens[i] : solution[i];
      if (g) c.className = 'g';
      if (i % 9 === 2 || i % 9 === 5) c.classList.add('b2');
      if ((i / 9 | 0) === 2 || (i / 9 | 0) === 5) c.classList.add('b3');
      box.appendChild(c);
    }
    return box;
  }

  /* ---------- 我的纪录 ---------- */
  let bestTab = 'record';

  function openBest() {
    showDialog('我的战绩', (body) => {
      const tabs = document.createElement('div');
      tabs.className = 'sk-tabs';
      const mkTab = (key, label) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sk-tab' + (bestTab === key ? ' on' : '');
        b.textContent = label;
        b.addEventListener('click', () => { bestTab = key; closeDialog(); openBest(); });
        return b;
      };
      tabs.append(mkTab('record', '最快纪录'), mkTab('fav', '收藏棋谱'));
      body.appendChild(tabs);
      if (bestTab === 'fav') renderFavorites(body);
      else renderRecords(body);
    });
  }

  function renderRecords(body) {
    const best = store.get(KEYS.best, {});
    const cloudCells = {};
    const head = document.createElement('div');
    head.className = 'sk-best-row';
    const h0 = document.createElement('span');
    h0.className = 'k';
    h0.textContent = '等级';
    const h1 = document.createElement('b');
    h1.textContent = '本机';
    const h2 = document.createElement('span');
    h2.className = 'c';
    h2.textContent = '云端';
    head.append(h0, h1, h2);
    body.appendChild(head);
    for (const k of Object.keys(DIFFS)) {
      const row = document.createElement('div');
      row.className = 'sk-best-row';
      const kEl = document.createElement('span');
      kEl.className = 'k';
      kEl.textContent = DIFFS[k].label;
      const tEl = document.createElement('b');
      tEl.textContent = best[k] ? fmt(best[k].t) : '—';
      const cEl = document.createElement('span');
      cEl.className = 'c';
      cEl.textContent = '…';
      cloudCells[k] = cEl;
      row.append(kEl, tEl, cEl);
      body.appendChild(row);
    }
    if (cloudSb && cloudUser) {
      cloudSb.from('sudoku_records')
        .select('difficulty,seconds')
        .eq('user_id', cloudUser.id)
        .then(({ data, error }) => {
          if (error) throw error;
          const top = {};
          for (const r of data || [])
            if (!(r.difficulty in top) || r.seconds < top[r.difficulty]) top[r.difficulty] = r.seconds;
          for (const k of Object.keys(DIFFS)) cloudCells[k].textContent = k in top ? fmt(top[k]) : '—';
        })
        .catch(() => { for (const k of Object.keys(DIFFS)) cloudCells[k].textContent = '—'; });
    } else {
      for (const k of Object.keys(DIFFS)) cloudCells[k].textContent = '—';
    }
    const note = document.createElement('p');
    note.className = 'muted';
    note.style.marginTop = '10px';
    note.textContent = '本机纪录存在这台设备；登录后云端全设备同步并参与英雄榜（每人只计最快）。';
    body.appendChild(note);
  }

  async function renderFavorites(body) {
    if (!cloudUser || !cloudSb) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = '收藏需要登录账号——收藏的棋谱会存到你的名下，换设备也在。';
      body.appendChild(p);
      const foot = document.createElement('div');
      foot.className = 'sk-actions';
      const go = document.createElement('button');
      go.className = 'sk-abtn primary';
      go.type = 'button';
      go.textContent = '登录';
      go.addEventListener('click', () => { closeDialog(); openLogin(); });
      foot.appendChild(go);
      body.appendChild(foot);
      return;
    }
    const holder = document.createElement('div');
    holder.textContent = '读取中…';
    holder.className = 'muted';
    body.appendChild(holder);
    try {
      const { data, error } = await cloudSb.from('sudoku_favorites')
        .select('id,difficulty,givens,solution,seconds,mistakes,hints_used,created_at')
        .eq('user_id', cloudUser.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      holder.textContent = '';
      if (!data || !data.length) {
        holder.textContent = '还没有收藏。做完一局后，在结算框里点「收藏这局」就会出现在这里。';
        return;
      }
      for (const r of data) {
        const item = document.createElement('div');
        item.className = 'sk-fav';
        item.appendChild(miniBoard(r.givens, r.solution));
        const meta = document.createElement('div');
        meta.className = 'sk-fav-meta';
        const t = document.createElement('b');
        t.textContent = `${DIFFS[r.difficulty]?.label || r.difficulty} · ${fmt(r.seconds)}`;
        const s = document.createElement('span');
        const d = new Date(r.created_at);
        const pad = (n) => String(n).padStart(2, '0');
        s.textContent = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
          + ` · 剩余 ${3 - r.mistakes} 命 · 提示 ${r.hints_used} 次`;
        meta.append(t, s);
        item.appendChild(meta);
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'sk-fav-del';
        del.textContent = '删除';
        del.addEventListener('click', async () => {
          del.disabled = true;
          const { error: e2 } = await cloudSb.from('sudoku_favorites').delete().eq('id', r.id);
          if (e2) { del.disabled = false; return; }
          item.remove();
          if (!holder.querySelector('.sk-fav')) holder.textContent = '还没有收藏。';
        });
        item.appendChild(del);
        holder.appendChild(item);
      }
    } catch (e) {
      console.warn('[数独] 收藏读取失败：', e?.message || e);
      holder.textContent = '收藏暂时读不到，稍后再试。';
    }
  }

  bestBtn?.addEventListener('click', openBest);

  /* ---------- 暂停 / 继续的按钮 ---------- */
  pauseBtn?.addEventListener('click', pauseGame);
  resumeBtn?.addEventListener('click', resumeGame);

  /* 打开页面时如果查到暂停存档，问一句要不要接着做。
     先查云端（可跨设备），没有再退回本机副本。 */
  async function offerResume() {
    if (paused || over) return;
    const cloud = await pullSave();
    const saved = cloud || store.get(KEYS.save, null);
    if (!saved) return;
    showDialog('有一局没做完', (body) => {
      const p = document.createElement('p');
      p.textContent = `${DIFFS[saved.difficulty]?.label || saved.difficulty} · 已用 ${fmt(saved.seconds || 0)} · 剩余 ${3 - (saved.mistakes || 0)} 命`;
      body.appendChild(p);
      const from = document.createElement('p');
      from.className = 'muted';
      from.textContent = cloud ? '这份进度存在你的账号下。' : '这份进度存在这台设备上。';
      body.appendChild(from);
      const foot = document.createElement('div');
      foot.className = 'sk-actions';
      const no = document.createElement('button');
      no.className = 'sk-abtn';
      no.type = 'button';
      no.textContent = '不做了';
      no.addEventListener('click', async () => {
        store.set(KEYS.save, null);
        closeDialog();
        if (cloudSb && cloudUser) {
          // 只要登录着就清一次云端：云端读取失败时 cloud 为 null，
          // 但库里可能仍留着旧存档，不清掉下次还会被问一遍。
          // 等删完再算放下，否则立刻刷新会读到旧存档。
          try {
            await cloudSb.from('sudoku_saves').delete().eq('user_id', cloudUser.id);
          } catch (e) {
            console.warn('[数独] 云端存档删除失败：', e?.message || e);
          }
        }
      });
      const yes = document.createElement('button');
      yes.className = 'sk-abtn primary';
      yes.type = 'button';
      yes.textContent = '接着做';
      yes.addEventListener('click', () => {
        closeDialog();
        applySave(saved);
        if (started && !over) startTimer();
      });
      foot.append(no, yes);
      body.appendChild(foot);
    });
  }

  /* ---------- 右侧英雄榜 ---------- */
  function renderLbNote(msg, emptyText) {
    if (!lbNoteEl) return;
    lbNoteEl.textContent = msg;
    if (!lbListEl) return;
    const li = document.createElement('li');
    li.className = 'sk-lb-empty';
    li.textContent = emptyText || '—';
    lbListEl.replaceChildren(li);
  }

  async function loadLeaderboard() {
    if (!cloudSb || !lbListEl) return;
    lbNoteEl.textContent = '读取中…';
    try {
      const { data, error } = await cloudSb.from('sudoku_records')
        .select('name,seconds,user_id')
        .eq('difficulty', lbDiff)
        .order('seconds', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      lbNoteEl.textContent = '全站共享 · 每人最快';
      const seen = new Set();
      const top = [];
      for (const r of data || []) {
        const key = r.user_id ? 'u:' + r.user_id : 'n:' + (r.name || '');
        if (seen.has(key)) continue;
        seen.add(key);
        top.push(r);
        if (top.length === 10) break;
      }
      if (!top.length) { renderLbNote('全站共享 · 每人最快', '虚位以待，快来霸榜！'); return; }
      const rows = top.map((r, idx) => {
        const li = document.createElement('li');
        li.className = 'sk-lb-row' + (cloudUser && r.user_id === cloudUser.id ? ' me' : '');
        const rk = document.createElement('span');
        rk.className = 'rk' + (idx < 3 ? ' rk' + (idx + 1) : '');
        rk.textContent = idx + 1;
        const nm = document.createElement('span');
        nm.className = 'nm';
        nm.textContent = r.name || '匿名';
        const tm = document.createElement('span');
        tm.className = 'tm';
        tm.textContent = fmt(r.seconds);
        li.append(rk, nm, tm);
        return li;
      });
      lbListEl.replaceChildren(...rows);
    } catch (e) {
      console.warn('[数独] 排行榜读取失败：', e?.message || e);
      renderLbNote('云端暂不可用', '榜单暂时读不到');
    }
  }

  for (const btn of document.querySelectorAll('.sk-lb-tab')) {
    btn.addEventListener('click', () => {
      lbDiff = btn.dataset.diff;
      for (const t of document.querySelectorAll('.sk-lb-tab')) {
        t.classList.toggle('on', t === btn);
        t.setAttribute('aria-selected', String(t === btn));
      }
      loadLeaderboard();
    });
  }
  $('#sk-lb-refresh')?.addEventListener('click', loadLeaderboard);

  /* ---------- 全屏 ---------- */
  const stageEl = sheetEl.parentElement;
  function fsActive() {
    return document.fullscreenElement === stageEl ||
      document.webkitFullscreenElement === stageEl ||
      document.body.classList.contains('sk-fs-fake');
  }
  function renderFs() {
    const on = fsActive();
    document.body.classList.toggle('sk-fs-on', on);
    fsBtn.textContent = on ? '⛶ 退出全屏' : '⛶ 全屏';
    fsBtn.title = on ? '退出全屏' : '全屏';
    fitSudoku();
    setTimeout(fitSudoku, 120);
  }
  function exitFake() {
    document.body.classList.remove('sk-fs-fake');
    renderFs();
  }
  fsBtn?.addEventListener('click', async () => {
    const api = stageEl.requestFullscreen || stageEl.webkitRequestFullscreen;
    // 假全屏（API 被拒/不可用）下再点按钮：直接撤掉 CSS 全屏，不要又去申请一次
    if (document.body.classList.contains('sk-fs-fake') &&
        !(document.fullscreenElement || document.webkitFullscreenElement)) {
      exitFake();
      return;
    }
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      const p = exit.call(document);
      if (p && p.then) { p.then(renderFs).catch(renderFs); }
      setTimeout(renderFs, 120);
      document.body.classList.remove('sk-fs-fake');
    } else if (api) {
      try {
        await Promise.race([
          api.call(stageEl),
          new Promise((_, rej) => setTimeout(() => rej(new Error('fs-timeout')), 800)),
        ]);
        setTimeout(renderFs, 50);
        setTimeout(renderFs, 400);
      } catch {
        document.body.classList.add('sk-fs-fake');
        renderFs();
      }
    } else {
      document.body.classList.add('sk-fs-fake');
      renderFs();
    }
  });
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement && document.body.classList.contains('sk-fs-fake'))
      document.body.classList.remove('sk-fs-fake');
    renderFs();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('sk-fs-fake')) exitFake();
  });

  /* ---------- 尺寸自适应 ---------- */
  function fitSudoku() {
    if (!fsActive()) {
      sheetEl.style.width = '';
      const w0 = gridEl.clientWidth;
      if (w0 > 0) gridEl.style.fontSize = (w0 / 9 * 0.52).toFixed(1) + 'px';
      return;
    }
    // 全屏：纸张宽度 = 可用宽度 与（可用高度 - 纸头 - 数字键）中的较小者
    const scs = getComputedStyle(stageEl);
    const gcs = getComputedStyle(sheetEl);
    const sPadX = (parseFloat(scs.paddingLeft) || 0) + (parseFloat(scs.paddingRight) || 0);
    const sPadY = (parseFloat(scs.paddingTop) || 0) + (parseFloat(scs.paddingBottom) || 0);
    const pPadX = (parseFloat(gcs.paddingLeft) || 0) + (parseFloat(gcs.paddingRight) || 0);
    const pPadY = (parseFloat(gcs.paddingTop) || 0) + (parseFloat(gcs.paddingBottom) || 0);
    const headEl = sheetEl.querySelector('.sk-head');
    const padEl = sheetEl.querySelector('.sk-pad');
    const headH = headEl ? headEl.offsetHeight : 0;
    const padH = padEl ? padEl.offsetHeight : 0;
    const availW = Math.max(0, stageEl.clientWidth - sPadX - pPadX);
    const availH = Math.max(0, stageEl.clientHeight - sPadY - pPadY - headH - padH - 12);
    const side = Math.max(150, Math.min(availW, availH));
    sheetEl.style.width = Math.floor(side + pPadX) + 'px';
    gridEl.style.fontSize = (side / 9 * 0.52).toFixed(1) + 'px';
  }
  window.addEventListener('resize', fitSudoku);

  /* ---------- 启动 ---------- */
  buildNums();
  buildBoard();
  repaintAll();
  updateLives();
  updateHintBtn();
  fitSudoku();
  newGame(diffKey, { keepSave: true });
  // 先出题保证首屏有棋盘；查存档是异步的，查到再问要不要接着做
  initCloud().then(() => { setTimeout(offerResume, 400); });
})();
