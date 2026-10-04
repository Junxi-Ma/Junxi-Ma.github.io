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
    maybeRecord();
  }

  function lose() {
    over = true;
    stopTimer();
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
  function newGame(key) {
    diffKey = key;
    store.set(KEYS.diff, key);
    over = false;
    started = false;
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

  /* ---------- 交互 ---------- */
  gridEl.addEventListener('click', (e) => {
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

  undoBtn.addEventListener('click', undo);
  eraseBtn.addEventListener('click', eraseCell);
  hintBtn.addEventListener('click', hint);

  function setNoteMode(on) {
    noteMode = on;
    noteBtn.setAttribute('aria-pressed', String(on));
  }
  noteBtn.addEventListener('click', () => setNoteMode(!noteMode));

  /* ---------- 对话框 ---------- */
  function showDialog(title, build) {
    cardTitle.textContent = title;
    cardBody.textContent = '';
    build(cardBody);
    modal.hidden = false;
  }
  function closeDialog() { modal.hidden = true; cardBody.textContent = ''; }
  modal.addEventListener('pointerdown', (e) => { if (e.target === modal) closeDialog(); });

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
      submitRecord(time, mistakes, 3 - hints);
      return;
    }
    showDialog('🎉 完成！', (body) => {
      const badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = '🏆 新纪录';
      body.appendChild(badge);
      const big = document.createElement('div');
      big.className = 'big';
      big.textContent = fmt(time);
      body.appendChild(big);
      const p = document.createElement('p');
      p.textContent = `${DIFFS[diffKey].label} · 失误 ${mistakes} 次 · 提示 ${3 - hints} 次`;
      body.appendChild(p);
      let nameInput = null;
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
      const foot = document.createElement('div');
      foot.className = 'sk-actions';
      const ok = document.createElement('button');
      ok.className = 'sk-abtn primary';
      ok.type = 'button';
      ok.textContent = '记入英雄榜';
      const save = () => {
        const name = cloudUser ? cloudUser.name : (nameInput.value.trim() || '匿名');
        if (nameInput) store.set(KEYS.name, name);
        best[diffKey] = { t: time, n: name, d: new Date().toISOString().slice(0, 10) };
        store.set(KEYS.best, best);
        submitRecord(time, mistakes, 3 - hints);
        closeDialog();
      };
      ok.addEventListener('click', save);
      if (nameInput) nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      foot.appendChild(ok);
      body.appendChild(foot);
      if (nameInput) setTimeout(() => { nameInput.focus(); nameInput.select(); }, 0);
    });
  }

  /* ---------- 我的纪录 ---------- */
  function openBest() {
    showDialog('我的纪录', (body) => {
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
      const foot = document.createElement('div');
      foot.className = 'sk-actions';
      const ok = document.createElement('button');
      ok.className = 'sk-abtn primary';
      ok.type = 'button';
      ok.textContent = '确定';
      ok.addEventListener('click', closeDialog);
      foot.appendChild(ok);
      body.appendChild(foot);
    });
  }
  bestBtn.addEventListener('click', openBest);

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
  function renderFs() { fitSudoku(); }
  fsBtn.addEventListener('click', async () => {
    const api = sheetEl.requestFullscreen || sheetEl.webkitRequestFullscreen;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      const p = exit.call(document);
      if (p && p.then) { p.then(renderFs).catch(renderFs); }
      setTimeout(renderFs, 120);
      document.body.classList.remove('sk-fs-fake');
    } else if (api) {
      try {
        let entered = false;
        await Promise.race([
          api.call(sheetEl).then(() => { entered = true; }),
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

  /* ---------- 尺寸自适应 ---------- */
  function fitSudoku() {
    const w = gridEl.clientWidth;
    if (w > 0) gridEl.style.fontSize = (w / 9 * 0.52).toFixed(1) + 'px';
  }
  window.addEventListener('resize', fitSudoku);

  /* ---------- 难度切换 ---------- */
  for (const btn of document.querySelectorAll('.sk-diffbtn')) {
    btn.addEventListener('click', () => {
      for (const t of document.querySelectorAll('.sk-diffbtn')) t.classList.toggle('on', t === btn);
      newGame(btn.dataset.diff);
    });
  }

  /* ---------- 启动 ---------- */
  buildNums();
  buildBoard();
  repaintAll();
  updateLives();
  updateHintBtn();
  fitSudoku();
  newGame(diffKey);
  initCloud();
})();
