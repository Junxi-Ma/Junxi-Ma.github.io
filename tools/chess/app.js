/* ============================================================
   棋乐馆 — 国际象棋 / 五子棋 / 中国象棋
   启动器选模式 → 全屏棋盘对局。
   引擎：engine.js（国际象棋 + AI）、gomoku.js、xiangqi.js。
   联机房间仅国际象棋：Supabase 房间码准入，fen 为局面真相，
   realtime + 4s 轮询兜底。云端不可用时静默回退纯本地。
   ============================================================ */
import {
  START_FEN, parseFEN, toFEN, genLegal, makeMove, unmakeMove, moveToSan,
  gameStatus, inCheck, findBestMove, pieceGlyph, repetitionKey,
} from './engine.js';
import * as Gomoku from './gomoku.js';
import * as Xiangqi from './xiangqi.js';
import * as Go from './go.js';
import { getSupabase, isConfigured } from '../../assets/js/supabase.js';

(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
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

  const launcherEl = $('#ch-launcher');
  const gameEl = $('#ch-game');
  const boardEl = $('#ch-board');
  const statusEl = $('#ch-status');
  const modeChip = $('#ch-modechip');
  const clockEl = $('#ch-clock');
  const capTopEl = $('#ch-cap-top');
  const capBottomEl = $('#ch-cap-bottom');
  const roomChip = $('#ch-roomchip');

  /* ---------- 全局 ---------- */
  let kind = null;             // chess | gomoku | xiangqi
  let mode = 'ai';             // ai | online | local
  let over = false;
  let resultText = '';
  let flipped = false;
  let startTime = Date.now();
  let clockTimer = null;
  let thinking = false;
  let cloudSb = null;
  let cloudUser = null;


  let online = null;           // { code, seat, channel, poll, room, finishedShown }

  const DIFF_LABEL = ['新手', '业余', '棋手', '大师'];
  const DIFF_CFG = [
    { maxDepth: 1, timeMs: 200 },
    { maxDepth: 2, timeMs: 400 },
    { maxDepth: 3, timeMs: 800 },
    { maxDepth: 5, timeMs: 1400 },
  ];
  const XQ_DIFF_DEPTH = { easy: 1, medium: 2, hard: 3 };

  function myName() {
    return cloudUser?.name || store.get('ch-name-v1', '') || '';
  }
  async function ensureName() {
    let name = myName();
    if (name) return name;
    name = await new Promise((resolve) => {
      showDialog('怎么称呼你？', (body) => {
        const input = document.createElement('input');
        input.className = 'ch-code-input';
        input.style.letterSpacing = '0';
        input.maxLength = 16;
        input.placeholder = '对局昵称';
        body.appendChild(input);
        const foot = document.createElement('div');
        foot.className = 'ch-actions';
        const ok = document.createElement('button');
        ok.className = 'ch-btn primary';
        ok.type = 'button';
        ok.textContent = '开始对弈';
        ok.addEventListener('click', () => {
          const v = input.value.trim() || '棋手';
          store.set('ch-name-v1', v);
          resolve(v);
        });
        foot.appendChild(ok);
        body.appendChild(foot);
        setTimeout(() => input.focus(), 0);
      });
    });
    closeDialog();
    return name;
  }

  /* ---------- 视图 ---------- */
  function showGame(chipText) {
    modeChip.textContent = chipText;
    launcherEl.hidden = true;
    gameEl.hidden = false;
    startClock();
    // 棋盘刚从 hidden 变为可见时 clientWidth 才有效；
    // 用 rAF 再量一次，确保棋子在首帧就是正确大小。
    fitBoard();
    requestAnimationFrame(fitBoard);
    render();
  }
  function showLauncher() {
    gameEl.hidden = true;
    launcherEl.hidden = false;
    stopClock();
  }

  /* ---------- 通用：计时 / 对话框 / 状态 ---------- */
  function fmt(t) {
    const m = String((t / 60) | 0).padStart(2, '0');
    const s = String(t % 60).padStart(2, '0');
    return m + ':' + s;
  }
  function startClock() {
    stopClock();
    clockTimer = setInterval(() => {
      const t = Math.floor((Date.now() - startTime) / 1000);
      clockEl.textContent = fmt(t);
    }, 500);
  }
  function stopClock() { clearInterval(clockTimer); clockTimer = null; clockEl.textContent = ''; }

  /* showDialog(title, text)                   —— 普通提示
     showDialog(title, bodyBuilder, {input})   —— 带自定义内容的交互框，
     bodyBuilder(body) 里自行 appendChild，并用 opts.onOk 决定确认键行为。 */
  const modalEl = () => $('#ch-modal');
  let dialogCleanup = null;
  function showDialog(title, textOrBuilder, opts) {
    if (dialogCleanup) { dialogCleanup(); dialogCleanup = null; }
    const titleEl = $('#ch-card-title');
    const textEl = $('#ch-card-text');
    const actionsEl = modalEl().querySelector('.ch-actions');
    titleEl.textContent = title;
    if (typeof textOrBuilder === 'function') {
      textEl.hidden = true;
      textEl.textContent = '';
      // 先在 #ch-card-text 之后挂一个容器，供 builder 填充
      let host = modalEl().querySelector('.ch-dialog-body');
      if (!host) {
        host = document.createElement('div');
        host.className = 'ch-dialog-body';
        textEl.after(host);
      }
      host.hidden = false;
      host.textContent = '';
      actionsEl.hidden = true;
      textOrBuilder(host);
      dialogCleanup = () => { host.textContent = ''; host.hidden = true; actionsEl.hidden = false; };
    } else {
      textEl.hidden = false;
      textEl.textContent = textOrBuilder == null ? '' : String(textOrBuilder);
      actionsEl.hidden = false;
      const host = modalEl().querySelector('.ch-dialog-body');
      if (host) { host.textContent = ''; host.hidden = true; }
    }
    modalEl().hidden = false;
    if (opts && typeof opts.focus === 'function') setTimeout(opts.focus, 0);
  }
  function closeDialog() {
    modalEl().hidden = true;
    if (dialogCleanup) { dialogCleanup(); dialogCleanup = null; }
  }
  $('#ch-card-ok').addEventListener('click', () => closeDialog());

  function endGame(text) {
    over = true;
    resultText = text;
    showDialog('对局结束', text);
    render();
  }

  /* ================================================================
     一、国际象棋（原实现，逻辑不变）
     ================================================================ */
  const GChess = {
    st: parseFEN(START_FEN),
    history: [],
    selected: -1,
    targets: [],
    lastMove: null,
    aiDiff: store.get('ch-aidiff-v1', 2) ?? 2,
    aiColorMe: store.get('ch-aiside-v1', 'w') || 'w',
    thinking: false,
  };

  /* ---------- 棋盘容器的棋种 class：必须互斥 ----------
     历史 bug：各 *Build() 只 remove 自己关心的两个类，从不摘掉 'go'。
     于是进过围棋后，之后的国象/五子棋/象棋棋盘都仍挂着 .go，
     被 .ch-board.go 的 19×19 网格布局接管 → 棋盘显示错乱。 */
  const BOARD_KIND_CLASS = ['gomoku', 'xiangqi', 'go', 'chess'];
  function resetBoardClass(keep) {
    boardEl.classList.remove(...BOARD_KIND_CLASS);
    if (keep) boardEl.classList.add(keep);
  }

  function chessBuild() {
    boardEl.textContent = '';
    resetBoardClass(null);
    for (let dp = 0; dp < 64; dp++) {
      const sq = document.createElement('button');
      sq.type = 'button';
      sq.className = 'ch-sq';
      sq.dataset.dp = dp;
      boardEl.appendChild(sq);
    }
  }
  const chessDispToSq = (dp) => (flipped ? 63 - dp : dp);

  function chessRender() {
    const st = GChess.st;
    const checkedKing = (!over && inCheck(st, st.turn))
      ? st.board.findIndex((p, i) => p && p.t === 'k' && p.c === st.turn)
      : -1;
    for (let dp = 0; dp < 64; dp++) {
      const sq = chessDispToSq(dp);
      const el = boardEl.children[dp];
      const r = sq >> 3, c = sq & 7;
      el.className = 'ch-sq ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
      const p = st.board[sq];
      el.innerHTML = '';
      const dispR = dp >> 3, dispC = dp & 7;
      if (dispC === (flipped ? 7 : 0)) {
        const t = document.createElement('span');
        t.className = 'ch-coord rank';
        t.textContent = String(8 - dispR);
        el.appendChild(t);
      }
      if (dispR === (flipped ? 0 : 7)) {
        const t = document.createElement('span');
        t.className = 'ch-coord file';
        t.textContent = String.fromCharCode(97 + (flipped ? 7 - dispC : dispC));
        el.appendChild(t);
      }
      if (p) {
        const s = document.createElement('span');
        s.className = 'ch-piece ' + p.c;
        s.textContent = pieceGlyph(p);
        el.appendChild(s);
      }
      if (GChess.lastMove && (sq === GChess.lastMove.from || sq === GChess.lastMove.to)) el.classList.add('last');
      if (sq === GChess.selected) el.classList.add('sel');
      if (sq === checkedKing) el.classList.add('check');
      const t = GChess.targets.find((x) => x.to === sq);
      if (t) {
        const mark = document.createElement('span');
        mark.className = st.board[sq] ? 'ring' : 'dot';
        el.appendChild(mark);
      }
    }
    chessCaptures();
  }

  function chessCaptures() {
    const st = GChess.st;
    const start = { p: 8, n: 2, b: 2, r: 2, q: 1 };
    const cnt = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
    for (const p of st.board) if (p && p.t !== 'k') cnt[p.c][p.t]++;
    const order = ['q', 'r', 'b', 'n', 'p'];
    const lost = (c) => order.flatMap((t) => Array(Math.max(0, start[t] - cnt[c][t])).fill(t))
      .map((t) => pieceGlyph({ t, c })).join('');
    capTopEl.textContent = lost('b');
    capBottomEl.textContent = lost('w');
  }

  function chessOnSquare(dp) {
    if (over || gameEl.hidden) return;
    if (mode === 'ai' && GChess.thinking) return;
    if (mode === 'online' && (!online || online.room?.status !== 'playing')) return;
    const sq = chessDispToSq(dp);
    if (GChess.selected >= 0) {
      const ms = GChess.targets.filter((x) => x.to === sq);
      if (ms.length) {
        if (ms.length > 1 && ms[0].promo) { chessPromo(ms); return; }
        chessPlay(ms[0]);
        return;
      }
    }
    const p = GChess.st.board[sq];
    const myColor = mode === 'local' ? GChess.st.turn : (mode === 'ai' ? GChess.aiColorMe : (online ? online.seat : GChess.st.turn));
    if (p && p.c === myColor && (mode !== 'online' || GChess.st.turn === myColor)) {
      GChess.selected = sq;
      GChess.targets = genLegal(GChess.st).filter((x) => x.from === sq);
      chessRender();
    } else {
      GChess.selected = -1;
      GChess.targets = [];
      chessRender();
    }
  }

  let chessPendingPromo = null;
  function chessPromo(ms) {
    chessPendingPromo = ms;
    const row = $('#ch-promo-row');
    row.textContent = '';
    for (const m of ms) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = pieceGlyph({ t: m.promo, c: m.c });
      b.addEventListener('click', () => {
        $('#ch-promo').hidden = true;
        const list = chessPendingPromo;
        chessPendingPromo = null;
        if (list) chessPlay(list.find((x) => x.promo === m.promo) || list[0]);
      });
      row.appendChild(b);
    }
    $('#ch-promo').hidden = false;
  }

  function chessPlay(m) {
    const san = moveToSan(GChess.st, m);
    makeMove(GChess.st, m);
    GChess.selected = -1;
    GChess.targets = [];
    GChess.lastMove = { from: m.from, to: m.to };
    GChess.history.push({ san, fen: toFEN(GChess.st), repKey: repetitionKey(GChess.st) });
    chessAfterMove(m);
  }

  /* 三次重复局面统计（FIDE 9.2）。key 只含子力布置 + 轮走方 + 易位权 + 过路兵格。 */
  function chessRepetitions() {
    const key = repetitionKey(GChess.st);
    let n = 0;
    for (const h of GChess.history) if (h.repKey === key) n++;
    // 历史里存的是「走完之后的局面」，当前局面本身也算一次
    return n + 1;
  }

  function chessAfterMove(m) {
    render();
    const status = gameStatus(GChess.st, { repetition: chessRepetitions() });
    if (status.over) { chessFinish(status); return; }
    if (mode === 'ai' && GChess.st.turn !== GChess.aiColorMe) chessAiReply();
    if (mode === 'online' && online) onlinePushMove();
  }

  function chessAiReply() {
    GChess.thinking = true;
    renderStatus();
    setTimeout(() => {
      const m = findBestMove(GChess.st, { ...DIFF_CFG[GChess.aiDiff], skill: GChess.aiDiff });
      GChess.thinking = false;
      if (m && !over && mode === 'ai' && kind === 'chess') chessPlay(m);
      else render();
    }, 80);
  }

  function chessFinish(status) {
    over = true;
    const winner = GChess.st.turn === 'w' ? '黑' : '白';
    let text;
    if (status.reason === 'checkmate') {
      text = mode === 'ai'
        ? (winner === (GChess.aiColorMe === 'w' ? '白' : '黑') ? '将杀 —— 你赢了 🎉' : '将杀 —— 你输了 😵')
        : `将杀 —— ${winner}方胜`;
    } else if (status.reason === 'stalemate') text = '逼和 —— 和棋 🤝';
    else if (status.reason === 'fifty') text = '五十回合无进展 —— 和棋 🤝';
    else if (status.reason === 'repetition') text = '三次重复局面 —— 和棋 🤝';
    else text = '双方子力不足 —— 和棋 🤝';
    endGame(text);
    if (mode === 'online' && online && status.reason === 'checkmate') {
      onlineMarkFinished(GChess.st.turn === 'w' ? '0-1' : '1-0');
    }
  }

  function chessNew() {
    GChess.st = parseFEN(START_FEN);
    GChess.history = [];
    GChess.selected = -1;
    GChess.targets = [];
    GChess.lastMove = null;
    GChess.thinking = false;
    // 仅人机模式才因执黑自动翻转；双人同屏保持白在下
    flipped = GChess.aiColorMe === 'b' && mode === 'ai';
    chessBuild();
    chessRender();
  }

  /* ================================================================
     二、五子棋
     ================================================================ */
  const GG = {
    bd: null, me: 1, vsAI: true, hard: true, history: [], aiLevel: 0,
    lastIdx: null, winLine: null,
  };

  function gomokuBuild() {
    boardEl.textContent = '';
    resetBoardClass('gomoku');
    for (let i = 0; i < 225; i++) {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'ch-sq gk';
      d.dataset.i = i;
      boardEl.appendChild(d);
    }
  }

  function gomokuPaint(i) {
    const el = boardEl.children[i];
    el.className = 'ch-sq gk';
    el.innerHTML = '';
    const v = GG.bd[i];
    if (v) {
      const s = document.createElement('span');
      s.className = 'gk-stone ' + (v === 1 ? 'black' : 'white');
      el.appendChild(s);
    }
  }

  // 每帧先清掉所有辅助高亮（旧实现只 add 不 remove，
  // 导致上一步/胜利线的标记越积越多，重开或移动后残留）。
  function gomokuRender() {
    for (let i = 0; i < 225; i++) gomokuPaint(i);
    if (GG.lastIdx != null && GG.bd[GG.lastIdx]) boardEl.children[GG.lastIdx].classList.add('gk-last');
    if (GG.winLine) for (const k of GG.winLine) boardEl.children[k].classList.add('gk-winline');
  }

  function gomokuNew(opts) {
    GG.bd = Gomoku.emptyBoard();
    GG.history = [];
    GG.me = opts.me;            // 人机模式：1 = 黑（先手）
    GG.vsAI = opts.vsAI;
    GG.hard = opts.hard;
    GG.lastIdx = null;
    GG.winLine = null;
    GG.turnNow = 1;
    over = false; resultText = '';
    gomokuBuild();
    gomokuRender();
    if (GG.vsAI && GG.me === 2) { // 人执白 → AI 黑先
      setTimeout(() => { if (kind === 'gomoku' && !over) gomokuAiMove(); }, 200);
    }
  }

  function gomokuAiMove() {
    thinking = true;
    renderStatus();
    setTimeout(() => {
      const { idx } = Gomoku.bestMove(GG.bd, GG.me === 1 ? 2 : 1, GG.hard);
      thinking = false;
      if (idx == null || kind !== 'gomoku' || over) return;
      gomokuPlace(idx);
    }, 120);
  }

  function gomokuPlace(i) {
    if (over || GG.bd[i]) return;
    GG.history.push({ bd: Int8Array.from(GG.bd), turnNow: GG.turnNow, i });
    GG.bd[i] = GG.turnNow;
    GG.lastIdx = i;
    const line = Gomoku.checkWin(GG.bd, i);
    if (line) {
      GG.winLine = line;
      gomokuRender();
      gomokuEnd((GG.turnNow === 1 ? '黑方' : '白方') + '五连获胜 🎉');
      return;
    }
    GG.turnNow = GG.turnNow === 1 ? 2 : 1;
    gomokuRender();
    renderStatus();
    if (GG.vsAI && GG.turnNow !== GG.me && kind === 'gomoku' && !over) gomokuAiMove();
  }
  let GG_turnNow = 1;
  Object.defineProperty(GG, 'turnNow', {
    get() { return GG_turnNow; },
    set(v) { GG_turnNow = v; },
  });

  function gomokuEnd(text) {
    over = true;
    resultText = text;
    showDialog('对局结束', text);
    renderStatus();
  }

  function gomokuUndo() {
    if (!GG.history.length) return;
    // 人机模式撤两步（AI + 己方）；双人撤一步
    const steps = GG.vsAI && GG.history.length >= 2 ? 2 : 1;
    for (let k = 0; k < steps && GG.history.length; k++) {
      const h = GG.history.pop();
      GG.bd = Int8Array.from(h.bd);
      GG.turnNow = h.turnNow;
    }
    GG.lastIdx = GG.history.length ? GG.history[GG.history.length - 1].i : null;
    GG.winLine = null;
    over = false;
    gomokuRender();
  }

  /* ================================================================
     三、围棋
     ================================================================ */
  const GO = {
    bd: null, turn: 1, ko: -1, passes: 0, history: [],
    caps: { 1: 0, 2: 0 }, lastIdx: null,
    vsAI: true, hard: true, me: 1,
  };

  function goBuild() {
    boardEl.textContent = '';
    resetBoardClass('go');
    for (let i = 0; i < 361; i++) {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'ch-sq gopt';
      d.dataset.i = i;
      boardEl.appendChild(d);
    }
    // 星位用 CSS 定位在交叉点上（(n+0.5)/19 与本盘网格线中心一致）
    for (const [r, c] of GO_STARS) {
      const star = document.createElement('span');
      star.className = 'go-star';
      star.style.left = ((c + 0.5) / 19 * 100).toFixed(4) + '%';
      star.style.top = ((r + 0.5) / 19 * 100).toFixed(4) + '%';
      boardEl.appendChild(star);
    }
  }

  const GO_STARS = [[3, 3], [3, 9], [3, 15], [9, 3], [9, 9], [9, 15], [15, 3], [15, 9], [15, 15]];

  // 直接按索引取格子（棋盘子节点前 361 个就是落点按钮，星位在其后）
  function goCell(i) { return boardEl.children[i]; }

  function goPaint(i) {
    const el = goCell(i);
    if (!el) return;
    el.className = 'ch-sq gopt';
    el.innerHTML = '';
    const v = GO.bd[i];
    if (v) {
      const sp = document.createElement('span');
      sp.className = 'go-stone ' + (v === 1 ? 'black' : 'white');
      el.appendChild(sp);
    }
  }

  function goRender() {
    for (let i = 0; i < 361; i++) goPaint(i);
    if (GO.lastIdx != null && GO.bd[GO.lastIdx]) {
      const ring = document.createElement('span');
      ring.className = 'go-last';
      goCell(GO.lastIdx).appendChild(ring);
    }
    renderCapturesGo();
    renderStatus();
  }

  function renderCapturesGo() {
    const mk = (n, cls) => {
      let out = '';
      for (let k = 0; k < n && k < 30; k++) out += '<span class="go-caps ' + cls + '"></span>';
      return out + (n > 30 ? '…' : '');
    };
    capTopEl.innerHTML = mk(GO.caps[2], 'w');
    capBottomEl.innerHTML = mk(GO.caps[1], 'b');
  }

  function goNew(opts) {
    GO.bd = Go.emptyBoard();
    GO.turn = 1; GO.ko = -1; GO.passes = 0;
    GO.history = []; GO.caps = { 1: 0, 2: 0 }; GO.lastIdx = null;
    GO.vsAI = opts.vsAI; GO.hard = opts.hard; GO.me = opts.me ?? 1;
    over = false; resultText = '';
    goBuild();
    goRender();
    if (GO.vsAI && GO.me === 2) {
      setTimeout(() => { if (kind === 'go' && !over) goAiMove(); }, 200);
    }
  }

  function goPlayAt(i) {
    // 先快照再落子：Go.play 会原地改动 GO.bd，
    // 旧代码在 play() 之后才 push 快照，撤棋时恢复的其实是「已落子」的局面。
    const snap = { bd: Int8Array.from(GO.bd), turn: GO.turn, ko: GO.ko, passes: GO.passes, caps: { ...GO.caps }, lastIdx: GO.lastIdx };
    const r = Go.play(GO.bd, i, GO.turn, GO.ko);
    if (!r.ok) return false;
    GO.history.push(snap);
    GO.caps[GO.turn] += r.captured.length;
    GO.ko = r.ko;
    GO.passes = 0;
    GO.lastIdx = i;
    GO.turn = GO.turn === 1 ? 2 : 1;
    goRender();
    if (GO.vsAI && GO.turn !== GO.me && kind === 'go' && !over) goAiMove();
    return true;
  }

  function goAiMove() {
    thinking = true;
    renderStatus();
    setTimeout(() => {
      const r = Go.aiMove(GO.bd, GO.turn, GO.ko, GO.hard);
      thinking = false;
      if (kind !== 'go' || over) return;
      if (r.pass || r.idx == null) { goPass(true); return; }
      goPlayAt(r.idx);
    }, 150);
  }

  function goPass(ai) {
    GO.history.push({ bd: Int8Array.from(GO.bd), turn: GO.turn, ko: GO.ko, passes: GO.passes, caps: { ...GO.caps }, lastIdx: GO.lastIdx });
    GO.passes++;
    GO.ko = -1;
    GO.turn = GO.turn === 1 ? 2 : 1;
    GO.lastIdx = null;
    if (GO.passes >= 2) {
      const t = Go.score(GO.bd);
      const whiteTotal = t.white + Go.KOMI;
      const diff = Math.round(Math.abs(t.black - whiteTotal) * 2) / 2;
      const text = `黑 ${t.black} 子 · 白 ${whiteTotal} 子（贴 ${Go.KOMI}）—— ` +
        (Math.abs(t.black - whiteTotal) < 1e-9 ? '和棋 🤝'
          : t.black > whiteTotal ? '黑胜 ' + diff + ' 子' : '白胜 ' + diff + ' 子');
      goRender();
      endGame(text);
      return;
    }
    goRender();
    if (!over && GO.vsAI && GO.turn !== GO.me && kind === 'go') goAiMove();
  }

  function goUndo() {
    if (!GO.history.length) return;
    const steps = GO.vsAI && GO.history.length >= 2 ? 2 : 1;
    for (let k = 0; k < steps && GO.history.length; k++) {
      const h = GO.history.pop();
      GO.bd = Int8Array.from(h.bd);
      GO.turn = h.turn; GO.ko = h.ko; GO.passes = h.passes; GO.caps = { ...h.caps };
      GO.lastIdx = h.lastIdx ?? null;
    }
    over = false;
    goRender();
  }

  function goResign() {
    const loser = GO.turn === 1 ? '黑方' : '白方';
    endGame(loser + '认输 —— ' + (loser === '黑方' ? '白方胜' : '黑方胜'));
  }

  function goClick(i) {
    if (over || gameEl.hidden) return;
    if (GO.vsAI && GO.turn !== GO.me) return;
    goPlayAt(i);
  }

  /* ================================================================
     三、中国象棋
     ================================================================ */
  const XQ = {
    st: null, history: [], selected: -1, targets: [],
    vsAI: true, hard: 'medium', me: 'r', lastMove: null,
  };
  const XQ_CHAR = {
    r: { k: '帥', a: '仕', b: '相', n: '傌', r: '俥', c: '炮', p: '兵' },
    b: { k: '將', a: '士', b: '象', n: '馬', r: '車', c: '砲', p: '卒' },
  };

  function xiangqiBuild() {
    boardEl.textContent = '';
    resetBoardClass('xiangqi');
    for (let i = 0; i < 90; i++) {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'ch-sq xq';
      d.dataset.i = i;
      boardEl.appendChild(d);
    }
    const river = document.createElement('div');
    river.className = 'ch-xq-river';
    river.innerHTML = '<span>楚 河</span><span>漢 界</span>';
    boardEl.appendChild(river);
  }

  function xiangqiPaint(i) {
    const el = boardEl.children[i];
    if (!el) return;
    el.innerHTML = '';
    const p = XQ.st.bd[i];
    if (!p) return;
    const s = document.createElement('span');
    s.className = 'xq-piece ' + p.c;
    s.textContent = XQ_CHAR[p.c][p.t];
    el.appendChild(s);
  }

  function xiangqiRender() {
    // 用 Set 预收 targets，避免每格都做一次 O(n) 的 find
    const targets = new Set(XQ.targets.map((m) => m.to));
    for (let i = 0; i < 90; i++) {
      const el = boardEl.children[i];
      if (!el) continue;
      el.classList.toggle('sel', i === XQ.selected);
      el.classList.toggle('target', targets.has(i));
      el.classList.toggle('lastmove', !!XQ.lastMove && (i === XQ.lastMove.from || i === XQ.lastMove.to));
      xiangqiPaint(i);
    }
  }

  function xiangqiNew(opts) {
    XQ.st = Xiangqi.initState();
    XQ.history = [];
    XQ.selected = -1; XQ.targets = []; XQ.lastMove = null;
    XQ.vsAI = opts.vsAI;
    XQ.hard = opts.hard;
    XQ.me = opts.me || 'r';
    over = false; resultText = '';
    xiangqiBuild();
    xiangqiRender();
    if (XQ.vsAI && XQ.me === 'b') {
      setTimeout(() => { if (kind === 'xiangqi' && !over) xiangqiAiMove(); }, 200);
    }
  }

  function xiangqiAiMove() {
    thinking = true;
    renderStatus();
    setTimeout(() => {
      const depth = { easy: 1, medium: 2, hard: 3 }[XQ.hard] ?? 2;
      const r = Xiangqi.findBestMove(XQ.st, depth);
      thinking = false;
      if (!r || kind !== 'xiangqi' || over) return;
      xiangqiApply(r.move);
    }, 120);
  }

  const enc = (bd) => bd.map((p) => (p ? (p.c === 'r' ? p.t.charCodeAt(0) : -p.t.charCodeAt(0)) : 0));
  const dec = (arr) => arr.map((v) => {
    if (v === 0) return null;
    return v > 0 ? { t: String.fromCharCode(v), c: 'r' } : { t: String.fromCharCode(-v), c: 'b' };
  });

  function xiangqiApply(m) {
    XQ.history.push({ bd: enc(XQ.st.bd), turn: XQ.st.turn, key: Xiangqi.positionKey(XQ.st) });
    Xiangqi.makeMove(XQ.st, m);
    XQ.lastMove = { from: m.from, to: m.to };
    XQ.selected = -1; XQ.targets = [];
    xiangqiRender();
    const status = Xiangqi.gameStatus(XQ.st, { repetition: xiangqiRepetitions() });
    if (status.over) {
      let text;
      if (status.reason === 'repetition') {
        text = '三次重复局面 —— 和棋 🤝';
      } else {
        const winner = status.winner === 'r' ? '红方' : '黑方';
        text = XQ.vsAI
          ? (status.winner === XQ.me ? '将死对方 —— 你赢了 🎉' : '被将死 —— 你输了 😵')
          : `${winner}胜 🎉`;
      }
      over = true;
      resultText = text;
      showDialog('对局结束', text);
      renderStatus();
      return;
    }
    if (XQ.vsAI && XQ.st.turn !== XQ.me && kind === 'xiangqi' && !over) xiangqiAiMove();
  }

  /* 三次重复局面统计（走完后的历史局面 + 当前局面本身） */
  function xiangqiRepetitions() {
    const key = Xiangqi.positionKey(XQ.st);
    let n = 0;
    for (const h of XQ.history) if (h.key === key) n++;
    return n + 1;
  }

  function xiangqiUndo() {
    if (!XQ.history.length) return;
    const steps = XQ.vsAI && XQ.history.length >= 2 ? 2 : 1;
    for (let k = 0; k < steps && XQ.history.length; k++) {
      const h = XQ.history.pop();
      XQ.st.bd = dec(h.bd);
      XQ.st.turn = h.turn;
    }
    XQ.selected = -1; XQ.targets = []; XQ.lastMove = null;
    over = false;
    xiangqiRender();
  }

  /* ================================================================
     棋盘点击分发
     ================================================================ */
  boardEl.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-i],[data-dp]');
    if (!cell) return;
    if (kind === 'chess') chessOnSquare(+cell.dataset.dp);
    else if (kind === 'gomoku') gomokuClick(+cell.dataset.i);
    else if (kind === 'xiangqi') xiangqiClick(+cell.dataset.i);
    else if (kind === 'go') goClick(+cell.dataset.i);
  });

  function gomokuClick(i) {
    if (over || gameEl.hidden) return;
    if (GG.vsAI && GG.turnNow !== GG.me) return;
    gomokuPlace(i);
  }

  function xiangqiClick(i) {
    if (over || gameEl.hidden) return;
    if (XQ.vsAI && XQ.st.turn !== XQ.me) return;
    if (XQ.selected >= 0) {
      const m = XQ.targets.find((x) => x.to === i);
      if (m) { xiangqiApply(m); return; }
    }
    const p = XQ.st.bd[i];
    if (p && p.c === XQ.st.turn) {
      XQ.selected = i;
      XQ.targets = Xiangqi.genLegal(XQ.st).filter((x) => x.from === i);
    } else {
      XQ.selected = -1;
      XQ.targets = [];
    }
    xiangqiRender();
  }

  /* ================================================================
     棋种启动
     ================================================================ */
  function startGame(kindKey) {
    onlineCleanup();
    kind = kindKey;
    // 任一棋种只要在「双人同屏」下就该是 local（旧逻辑漏了围棋）
    const vsAI = kind === 'chess' ? true
      : kind === 'gomoku' ? GG.vsAI
        : kind === 'xiangqi' ? XQ.vsAI : GO.vsAI;
    mode = vsAI ? 'ai' : 'local';
    over = false; resultText = '';
    startTime = Date.now();
    if (kind === 'chess') {
      chessNew();
      showGame('人机 · ' + DIFF_LABEL[GChess.aiDiff] + ' · ' + (GChess.aiColorMe === 'w' ? '执白' : '执黑'));
      if (GChess.st.turn !== GChess.aiColorMe) chessAiReply();
    } else if (kind === 'gomoku') {
      gomokuNew({ me: 1, vsAI: GG.vsAI, hard: GG.hard });
      showGame('五子棋 · ' + (GG.vsAI ? (GG.hard ? '困难' : '简单') : '双人同屏'));
    } else if (kind === 'xiangqi') {
      xiangqiNew({ vsAI: XQ.vsAI, hard: XQ.hard, me: 'r' });
      showGame('中国象棋 · ' + (XQ.vsAI ? ({ easy: '简单', medium: '普通', hard: '困难' }[XQ.hard] || '普通') : '双人同屏'));
    } else if (kind === 'go') {
      goNew({ vsAI: GO.vsAI, hard: GO.hard, me: 1 });
      showGame('围棋 · ' + (GO.vsAI ? (GO.hard ? '普通' : '简单') : '双人同屏'));
    }
  }

  /* ================================================================
     状态栏 / 按钮
     ================================================================ */
  function renderStatus() {
    let s = '';
    if (over) s = resultText;
    else if (kind === 'chess') {
      if (mode === 'ai') s = GChess.thinking ? 'AI 思考中…' : (GChess.st.turn === GChess.aiColorMe ? '你的回合' : 'AI 回合');
      else if (online) {
        if (online.room?.status === 'waiting') s = `等待对手加入 — 房间码 ${online.code}`;
        else if (online.room?.status === 'finished') s = online.room.result || '对局结束';
        else s = `${online.room?.white_name || '白'} ⚔ ${online.room?.black_name || '黑'} · ${GChess.st.turn === online.seat ? '你走' : '对方走'}`;
      }
    } else if (kind === 'gomoku') {
      s = thinking ? 'AI 思考中…' : (GG.vsAI ? (GG.turnNow === GG.me ? '你的回合（黑）' : 'AI 回合（白）') : (GG.turnNow === 1 ? '黑方回合' : '白方回合'));
    } else if (kind === 'xiangqi') {
      s = thinking ? 'AI 思考中…' : (XQ.vsAI ? (XQ.st.turn === XQ.me ? '你的回合（红）' : 'AI 回合（黑）') : (XQ.st.turn === 'r' ? '红方回合' : '黑方回合'));
    } else if (kind === 'go') {
      s = thinking ? 'AI 思考中…' : (GO.vsAI ? (GO.turn === GO.me ? '你的回合（黑）' : 'AI 回合（白）') : (GO.turn === 1 ? '黑方回合' : '白方回合'));
    }
    if (!over) {
      if (kind === 'go' && GO.passes > 0) s += ` · 对方已停一手，再停一手即终局`;
      if (kind === 'chess' && GChess.history.length) s += ` · 上一步 ${GChess.history[GChess.history.length - 1].san}`;
      if (kind === 'gomoku' && GG.history.length) s += ` · 上一手 (${(GG.history[GG.history.length - 1].i / 15 | 0) + 1},${GG.history[GG.history.length - 1].i % 15 + 1})`;
      if (kind === 'xiangqi' && XQ.lastMove) s += ` · 上一步 (${Math.floor(XQ.lastMove.from / 9) + 1},${XQ.lastMove.from % 9 + 1})->(${Math.floor(XQ.lastMove.to / 9) + 1},${XQ.lastMove.to % 9 + 1})`;
    }
    statusEl.textContent = s;
    updateButtons();
  }

  function render() {
    if (kind === 'chess') chessRender();
    else if (kind === 'gomoku') gomokuRender();
    else if (kind === 'xiangqi') xiangqiRender();
    updateButtons();
    renderStatus();
  }

  function updateButtons() {
    const flipBtn = $('#ch-flip');
    const restartBtn = $('#ch-restart');
    const undoBtn = $('#ch-undo');
    const resignBtn = $('#ch-resign');
    const hist = kind === 'chess' ? GChess.history.length
      : kind === 'gomoku' ? GG.history.length
        : kind === 'xiangqi' ? XQ.history.length : 0;
    flipBtn.hidden = kind !== 'chess';
    restartBtn.hidden = mode === 'online';
    undoBtn.hidden = kind === 'chess' && mode !== 'ai';
    resignBtn.hidden = mode === 'local';
    $('#ch-pass').hidden = kind !== 'go';
    const hist2 = kind === 'go' ? GO.history.length : hist;
    undoBtn.disabled = thinking || over || !hist2;
    resignBtn.disabled = over;
  }

  /* ---------- 按钮动作 ---------- */
  $('#ch-exit').addEventListener('click', () => {
    onlineCleanup();
    kind = null;
    showLauncher();
  });
  $('#ch-undo').addEventListener('click', () => {
    if (thinking || over) return;
    if (kind === 'chess') {
      // 悔棋仅人机模式开放（联机/双人同屏涉及对手，不应单方撤回）
      if (mode !== 'ai' || !GChess.history.length) return;
      chessUndo();
    } else if (kind === 'gomoku') gomokuUndo();
    else if (kind === 'xiangqi') xiangqiUndo();
    else if (kind === 'go') goUndo();
  });

  function chessUndo() {
    // 人机：轮到 AI 说明刚走完我的一步，先弹掉 AI 的那一步
    if (GChess.st.turn === GChess.aiColorMe && GChess.history.length) GChess.history.pop();
    if (GChess.history.length) GChess.history.pop();
    const back = GChess.history.length ? GChess.history[GChess.history.length - 1].fen : START_FEN;
    GChess.st = parseFEN(back);
    GChess.thinking = false;
    GChess.selected = -1; GChess.targets = []; GChess.lastMove = null;
    over = false; resultText = '';
    if (online) { online.finishedShown = false; }
    chessRender();
    renderStatus();
  }

  $('#ch-resign').addEventListener('click', () => {
    if (over) return;
    if (kind === 'chess') {
      if (mode === 'ai') {
        endGame('你认输了 —— AI 获胜');
      } else if (mode === 'local') {
        // 双人同屏：由当前要走的一方认输
        endGame((GChess.st.turn === 'w' ? '白方' : '黑方') + '认输 —— ' +
          (GChess.st.turn === 'w' ? '黑方' : '白方') + '胜');
      } else if (online && online.seat) {
        onlineMarkFinished(online.seat === 'w' ? '0-1' : '1-0');
        endGame('你认输了 —— 对方胜');
      }
    } else if (kind === 'gomoku') {
      gomokuEnd(GG.turnNow === 1 ? '黑方认输 —— 白方胜' : '白方认输 —— 黑方胜');
    } else if (kind === 'xiangqi') {
      xiangqiEnd(XQ.st.turn === 'r' ? '红方认输 —— 黑方胜' : '黑方认输 —— 红方胜');
    } else if (kind === 'go') {
      goResign();
    }
  });
  $('#ch-pass').addEventListener('click', () => { if (kind === 'go' && !over) goPass(false); });
  function xiangqiEnd(text) {
    over = true;
    resultText = text;
    showDialog('对局结束', text);
    renderStatus();
  }
  $('#ch-restart')?.addEventListener('click', () => { if (kind) startGame(kind); });
  $('#ch-flip').addEventListener('click', () => { if (kind === 'chess') { flipped = !flipped; chessRender(); } });
  $('#ch-fs').addEventListener('click', async () => {
    const api = gameEl.requestFullscreen || gameEl.webkitRequestFullscreen;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      const p = exit.call(document);
      if (p && p.then) { p.then(renderFs).catch(renderFs); }
      setTimeout(renderFs, 120);
    } else if (api) {
      try {
        await Promise.race([
          api.call(gameEl),
          new Promise((_, rej) => setTimeout(() => rej(new Error('fs-timeout')), 800)),
        ]);
        setTimeout(renderFs, 60);
      } catch { /* 拒绝即忽略：对局视图本已铺满 */ }
    }
  });
  function renderFs() { fitBoard(); }
  document.addEventListener('fullscreenchange', () => { renderFs(); });

  /* ---------- 日 / 夜 ---------- */
  const themeBtn = $('#ch-theme');
  function renderTheme() {
    if (themeBtn) {
      const light = document.documentElement.dataset.theme === 'light';
      themeBtn.textContent = light ? '🌙' : '☀';
      themeBtn.title = light ? '切换到雨夜' : '切换到夏日';
    }
  }
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    store.set('site-theme', next);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = next === 'light' ? '#faf8f5' : '#0a0a0b';
    renderTheme();
  });
  renderTheme();

  /* ---------- 尺寸 ---------- */
  function fitBoard() {
    // 棋盘已由 CSS 按 --skw / --board-h 约束，这里只把「格宽」换算成棋子尺寸。
    const w = boardEl.clientWidth;
    const h = boardEl.clientHeight;
    if (w > 0) boardEl.style.setProperty('--ch-piece', (w / 8 * 0.74).toFixed(1) + 'px');
    if (w > 0) boardEl.style.setProperty('--gk-stone', (w / 15 * 0.72).toFixed(1) + 'px');
    // 象棋/围棋按较短边取，避免竖盘时子偏大
    const wq = Math.min(w, h * 9 / 10);
    if (wq > 0) boardEl.style.setProperty('--xq-piece', (wq / 9 * 0.82).toFixed(1) + 'px');
    if (w > 0) boardEl.style.setProperty('--go-stone', (w / 19 * 0.92).toFixed(1) + 'px');
  }
  window.addEventListener('resize', fitBoard);
  window.addEventListener('orientationchange', fitBoard);

  /* ---------- 联机（国际象棋） ---------- */
  async function initCloud() {
    if (!isConfigured()) return;
    try {
      const sb = await getSupabase();
      if (!sb) return;
      cloudSb = sb;
      const { data } = await sb.auth.getSession();
      cloudUser = data?.session?.user ? {
        id: data.session.user.id,
        name: data.session.user.user_metadata?.display_name || data.session.user.email?.split('@')[0] || '用户',
      } : null;
    } catch { /* 静默 */ }
  }
  function genCode() {
    const abc = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    let s = '';
    for (let i = 0; i < 4; i++) s += abc[(Math.random() * abc.length) | 0];
    return s;
  }
  async function createRoom() {
    if (!cloudSb) { showDialog('联机不可用', '云端未连接，稍后再试。'); return; }
    const name = await ensureName();
    const code = genCode();
    const { error } = await cloudSb.from('chess_rooms').insert({
      code, fen: START_FEN, moves: [], white_name: name, black_name: '', status: 'waiting',
    });
    if (error) { showDialog('创建失败', error.message); return; }
    startChessOnline(code, 'w');
  }
  async function joinRoom() {
    if (!cloudSb) { showDialog('联机不可用', '云端未连接，稍后再试。'); return; }
    const code = ($('#ch-code-input').value || '').trim().toUpperCase();
    if (!code) return;
    const { data, error } = await cloudSb.from('chess_rooms').select('*').eq('code', code).maybeSingle();
    if (error || !data) { showDialog('房间不存在', '检查一下房间码？'); return; }
    const remembered = store.get('ch-seat-' + code, null);
    if (data.status === 'waiting' && !data.black_name && remembered !== 'w') {
      const name = await ensureName();
      await cloudSb.from('chess_rooms').update({ black_name: name, status: 'playing', updated_at: new Date().toISOString() }).eq('code', code);
      startChessOnline(code, 'b');
      return;
    }
    if (remembered === 'w' || remembered === 'b') { startChessOnline(code, remembered); return; }
    startChessOnline(code, null);
  }
  function startChessOnline(code, seat) {
    kind = 'chess';
    mode = 'online';
    over = false; resultText = '';
    GChess.st = parseFEN(START_FEN);
    GChess.history = [];
    GChess.selected = -1; GChess.targets = []; GChess.lastMove = [];
    GChess.thinking = false;
    flipped = seat === 'b';
    startTime = Date.now();
    onlineCleanup();
    online = { code, seat, channel: null, poll: null, room: null, finishedShown: false };
    if (seat) store.set('ch-seat-' + code, seat);
    chessBuild();
    showGame('联机 · ' + (seat === 'w' ? '执白' : seat === 'b' ? '执黑' : '观战'));
    roomChip.hidden = false;
    roomChip.textContent = '房间 ' + code;
    if (cloudSb) {
      cloudSb.from('chess_rooms').select('*').eq('code', code).maybeSingle()
        .then(({ data }) => { if (data) onlineOnRoom(data); });
      online.channel = cloudSb.channel('chess-room-' + code)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chess_rooms', filter: 'code=eq.' + code },
          (payload) => { if (payload.new) onlineOnRoom(payload.new); })
        .subscribe();
    }
    online.poll = setInterval(async () => {
      if (!cloudSb || document.hidden) return;
      const { data } = await cloudSb.from('chess_rooms').select('*').eq('code', code).maybeSingle();
      if (data) onlineOnRoom(data);
    }, 4000);
    chessRender();
  }
  function onlineOnRoom(room) {
    if (!online || gameEl.hidden || kind !== 'chess') return;
    online.room = room;
    if (room.fen !== toFEN(GChess.st)) {
      GChess.st = parseFEN(room.fen);
      GChess.history = (room.moves || []).slice();
      GChess.selected = -1; GChess.targets = []; GChess.lastMove = null;
      const status = gameStatus(GChess.st);
      if (status.over && !online.finishedShown) {
        online.finishedShown = true;
        endGame((room.result ? room.result + ' · ' : '') + (status.reason === 'checkmate' ? '将杀' : status.reason === 'stalemate' ? '逼和' : '和棋'));
      }
    }
    if (room.status === 'finished' && !over) {
      over = true;
      if (!online.finishedShown) { online.finishedShown = true; endGame(room.result || '对局结束'); }
    }
    chessRender();
  }
  function onlinePushMove() {
    if (!online || !cloudSb) return;
    cloudSb.from('chess_rooms').update({
      fen: toFEN(GChess.st),
      moves: GChess.history,
      updated_at: new Date().toISOString(),
    }).eq('code', online.code).then(({ error }) => {
      if (error) console.warn('[棋] 走子同步失败：', error.message);
    });
    const status = gameStatus(GChess.st);
    if (status.over) onlineMarkFinished(GChess.st.turn === 'w' ? '0-1' : '1-0');
  }
  function onlineMarkFinished(result) {
    if (!online || !cloudSb || !result) return;
    if (online.room && online.room.status === 'finished') return;
    cloudSb.from('chess_rooms').update({
      status: 'finished', result, updated_at: new Date().toISOString(),
    }).eq('code', online.code).then(({ error }) => {
      if (error) console.warn('[棋] 终局同步失败：', error.message);
    });
  }
  function onlineCleanup() {
    if (online) {
      if (online.channel) cloudSb?.removeChannel(online.channel);
      if (online.poll) clearInterval(online.poll);
      online = null;
    }
    roomChip.hidden = true;
  }

  /* ---------- 启动器事件 ---------- */
  /* ---------- 启动器：统一选择棋类与模式 ---------- */
  const sel = {
    kind: 'chess', mode: 'ai',
    aiDiff: GChess.aiDiff, side: GChess.aiColorMe,
    xqDiff: 'medium', gkHard: 'hard', goDiff: 'normal',
  };
  const DIFF_CHIPS = {
    chess: [['0', '新手'], ['1', '业余'], ['2', '棋手'], ['3', '大师']],
    xiangqi: [['easy', '简单'], ['medium', '普通'], ['hard', '困难']],
    gomoku: [['easy', '简单'], ['hard', '困难']],
    go: [['easy', '简单'], ['normal', '普通']],
  };
  const diffWrap = $('#sel-diff');
  const diffLabel = $('#sel-diff-label');
  const sideWrap = $('#sel-side-wrap');
  const onlineWrap = $('#sel-online-wrap');
  const onlineChip = $('#sel-mode-online');

  function selDiffValue() {
    return sel.kind === 'chess' ? String(sel.aiDiff)
      : sel.kind === 'xiangqi' ? sel.xqDiff
        : sel.gkHard;
  }

  function renderSel() {
    // 棋类切走后若仍停在联机模式，强制回落到人机（联机仅国象）
    if (sel.kind !== 'chess' && sel.mode === 'online') sel.mode = 'ai';
    for (const b of document.querySelectorAll('#sel-kind .ch-chip')) b.classList.toggle('on', b.dataset.v === sel.kind);
    for (const b of document.querySelectorAll('#sel-mode .ch-chip')) b.classList.toggle('on', b.dataset.v === sel.mode);
    onlineChip.hidden = sel.kind !== 'chess';
    sideWrap.hidden = sel.kind !== 'chess';
    onlineWrap.hidden = !(sel.kind === 'chess' && sel.mode === 'online');
    diffLabel.textContent = sel.kind === 'chess' ? 'AI 棋力' : 'AI 难度';
    diffWrap.textContent = '';
    const cur = selDiffValue();
    for (const [v, label] of DIFF_CHIPS[sel.kind]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ch-chip' + (cur === v ? ' on' : '');
      b.dataset.v = v;
      b.textContent = label;
      b.addEventListener('click', () => {
        if (sel.kind === 'chess') sel.aiDiff = +v;
        else if (sel.kind === 'xiangqi') sel.xqDiff = v;
        else if (sel.kind === 'go') sel.goDiff = v;
        else sel.gkHard = v;
        renderSel();
      });
      diffWrap.appendChild(b);
    }
  }
  for (const b of document.querySelectorAll('#sel-kind .ch-chip')) {
    b.addEventListener('click', () => { sel.kind = b.dataset.v; renderSel(); });
  }
  for (const b of document.querySelectorAll('#sel-mode .ch-chip')) {
    b.addEventListener('click', () => { sel.mode = b.dataset.v; renderSel(); });
  }
  for (const b of document.querySelectorAll('#sel-side .ch-chip')) {
    b.addEventListener('click', () => { sel.side = b.dataset.v; renderSel(); });
  }
  $('#ch-start').addEventListener('click', async () => {
    if (sel.kind === 'chess') {
      GChess.aiDiff = sel.aiDiff;
      GChess.aiColorMe = sel.side;
      if (sel.mode === 'online') { await createRoom(); return; }
      startGame('chess');
    } else if (sel.kind === 'xiangqi') {
      XQ.hard = sel.xqDiff; XQ.vsAI = sel.mode === 'ai';
      startGame('xiangqi');
    } else if (sel.kind === 'go') {
      GO.vsAI = sel.mode === 'ai';
      GO.hard = sel.goDiff === 'normal';
      startGame('go');
    } else {
      GG.hard = sel.gkHard === 'hard'; GG.vsAI = sel.mode === 'ai';
      startGame('gomoku');
    }
  });
  renderSel();

  // 联机房间控件：只绑定一次（旧代码在 renderSel 内部又绑了一遍，
  // 点一次「创建房间」会插入两个房间）
  $('#ch-create').addEventListener('click', createRoom);
  $('#ch-join').addEventListener('click', joinRoom);
  $('#ch-code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  roomChip.addEventListener('click', async () => {
    if (!online) return;
    try {
      await navigator.clipboard.writeText(online.code);
      roomChip.textContent = '已复制 ' + online.code;
      setTimeout(() => { roomChip.textContent = '房间 ' + online.code; }, 1200);
    } catch { /* 剪贴板不可用则忽略 */ }
  });

  /* ---------- 键盘 ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (!modalEl().hidden) {
      if (e.key === 'Escape' || e.key === 'Enter') closeDialog();
      return;
    }
    if (gameEl.hidden) return;
    if (kind !== 'chess') {
      if (e.key === 'Escape') {
        if (document.fullscreenElement || document.webkitFullscreenElement) return;
        $('#ch-exit').click();
      }
      return;
    }
    // 棋盘操作一律走「显示坐标 dp」：chessOnSquare 内部再用 chessDispToSq 换算，
    // 因此这里绝不能再手动翻转一次（旧代码对 sq 做了两次翻转 → 落点错格）。
    const step = { ArrowUp: -8, ArrowDown: 8, ArrowLeft: -1, ArrowRight: 1 };
    if (e.key in step) {
      e.preventDefault();
      if (GChess.selected < 0) { chessOnSquare(flipped ? 63 : 56); return; }
      const curDisp = flipped ? 63 - GChess.selected : GChess.selected;
      const nextDisp = curDisp + step[e.key];
      if (nextDisp < 0 || nextDisp > 63) return;
      // 左右移动不得跨行折返
      if ((step[e.key] === -1 || step[e.key] === 1) && (nextDisp >> 3) !== (curDisp >> 3)) return;
      chessOnSquare(nextDisp);
    } else if (e.key === 'Enter' && GChess.selected >= 0) {
      e.preventDefault();
      chessOnSquare(flipped ? 63 - GChess.selected : GChess.selected);
    } else if (e.key === 'Escape') {
      if (document.fullscreenElement || document.webkitFullscreenElement) return;
      $('#ch-exit').click();
    }
  });

  /* ---------- 尺寸 ---------- */
  window.addEventListener('resize', fitBoard);

  /* ---------- 启动 ---------- */
  initCloud();
})();
