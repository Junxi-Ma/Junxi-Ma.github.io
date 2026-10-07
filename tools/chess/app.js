/* ============================================================
   棋乐馆 — 国际象棋 / 中国象棋 / 五子棋 / 围棋
   启动器选棋类 × 模式 × 难度 / 执子 → 全屏棋盘对局。
   引擎：
   · 国际象棋：vendor/chess.js 规则权威 + vendor/stockfish.js（Worker）四档 AI，
     内置 negamax 兜底；易位支持「王走两格」与「王吃到车」两种手势。
   · 中国象棋 / 五子棋 / 围棋：各自模块 + ai-worker.js 后台搜索。
   联机：四棋通用 board_rooms（Supabase，房间码准入），state 为局面真相。
   排行榜：chess_results 表 + get_chess_leaderboard RPC，终局自动上报。
   ============================================================ */
import {
  START_FEN, ChessGame, chessAiMove, pieceGlyph, sqToAlg, algToSq,
} from './engine.js?v=21';
import * as Gomoku from './gomoku.js?v=21';
import * as Xiangqi from './xiangqi.js?v=21';
import * as Go from './go.js?v=21';
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
  const KINDS = ['chess', 'xiangqi', 'gomoku', 'go'];
  const KIND_LABEL = { chess: '国际象棋', xiangqi: '中国象棋', gomoku: '五子棋', go: '围棋' };
  const SIDE_NAME = {
    chess: { w: '白', b: '黑' },
    xiangqi: { r: '红', b: '黑' },
    gomoku: { 1: '黑', 2: '白' },
    go: { 1: '黑', 2: '白' },
  };
  const DIFF_LABELS = {
    chess: ['新手', '业余', '棋手', '大师'],
    xiangqi: ['入门', '初级', '中级', '高级'],
    gomoku: ['简单', '中等', '困难'],
    go: ['简单', '中等', '困难'],
  };
  const SIDE_LABELS = {
    chess: { w: '执白先行', b: '执黑后行' },
    xiangqi: { r: '执红先行', b: '执黑后行' },
    gomoku: { 1: '执黑先行', 2: '执白后行' },
    go: { 1: '执黑先行', 2: '执白后行' },
  };
  const oppSide = (k, s) => ({
    chess: s === 'w' ? 'b' : 'w',
    xiangqi: s === 'r' ? 'b' : 'r',
    gomoku: s === 1 ? 2 : 1,
    go: s === 1 ? 2 : 1,
  }[k]);

  let kind = null;
  let mode = 'ai';             // ai | local | online
  let over = false;
  let resultText = '';
  let flipped = false;
  let startTime = Date.now();
  let clockTimer = null;
  let thinking = false;
  let recorded = false;        // 本局战绩是否已上报
  let cloudSb = null;
  let cloudUser = null;
  let online = null;           // { code, kind, seat('first'|'second'|null), channel, poll, room, finishedShown }

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

  /* ================================================================
     AI 后台 Worker（象棋 / 五子棋 / 围棋）；失败降级主线程
     ================================================================ */
  const AI_LOCAL = {
    xiangqi: (st, opts) => Xiangqi.findBestMove(st, opts),
    gomoku: (bd, me, level) => Gomoku.bestMove(bd, me, level),
    go: (bd, color, ko, level) => Go.aiMove(bd, color, ko, level),
  };
  let aiWorker = null;
  let aiWorkerTried = false;
  let aiWorkerSeq = 0;
  const aiPending = new Map();
  function ensureAiWorker() {
    if (aiWorkerTried) return aiWorker;
    aiWorkerTried = true;
    try {
      const w = new Worker(new URL('./ai-worker.js?v=21', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        const { id, ok, result, error } = e.data || {};
        const p = aiPending.get(id);
        if (!p) return;
        aiPending.delete(id);
        if (ok) p.resolve(result);
        else { console.warn('[棋] AI Worker 出错，回退主线程：', error); p.resolve(null); }
      };
      w.onerror = (e) => {
        console.warn('[棋] AI Worker 不可用，改用主线程搜索：', e.message || '');
        for (const [, p] of aiPending) p.resolve(null);
        aiPending.clear();
        try { w.terminate(); } catch { /* 忽略 */ }
        aiWorker = null;
      };
      aiWorker = w;
    } catch { aiWorker = null; }
    return aiWorker;
  }
  /* 返回 null 表示 worker 侧失败，调用方应回退主线程实现 */
  function callAi(fn, ...args) {
    const w = ensureAiWorker();
    if (!w) return Promise.resolve(null);
    return new Promise((resolve) => {
      const id = ++aiWorkerSeq;
      aiPending.set(id, { resolve });
      w.postMessage({ id, fn, args });
    });
  }

  /* ---------- 视图 ---------- */
  function showGame(chipText) {
    modeChip.textContent = chipText;
    launcherEl.hidden = true;
    gameEl.hidden = false;
    startClock();
    fitBoard();
    requestAnimationFrame(fitBoard);
    render();
  }
  function showLauncher() {
    gameEl.hidden = true;
    launcherEl.hidden = false;
    stopClock();
  }

  /* ---------- 计时 / 对话框 ---------- */
  function fmt(t) {
    const m = String((t / 60) | 0).padStart(2, '0');
    const s = String(t % 60) | 0;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function startClock() {
    stopClock();
    clockTimer = setInterval(() => {
      const t = Math.floor((Date.now() - startTime) / 1000);
      clockEl.textContent = fmt(t);
    }, 500);
  }
  function stopClock() { clearInterval(clockTimer); clockTimer = null; clockEl.textContent = ''; }

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

  /* ================================================================
     棋盘容器的棋种 class：必须互斥
     （历史 bug：残留的 .go 类接管 19×19 网格布局 → 棋盘显示错乱）
     ================================================================ */
  const BOARD_KIND_CLASS = ['gomoku', 'xiangqi', 'go', 'chess'];
  function resetBoardClass(keep) {
    boardEl.classList.remove(...BOARD_KIND_CLASS);
    if (keep) boardEl.classList.add(keep);
  }

  /* ================================================================
     一、国际象棋（chess.js 规则 + Stockfish AI）
     ================================================================ */
  const GC = {
    game: new ChessGame(),
    level: 2,
    me: 'w',          // 人机模式下我执的颜色
    selected: -1,     // sq 索引
    selMoves: [],     // 选中格的 verbose moves
    selPiece: null,
    thinking: false,
  };

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
  const chessSqToDisp = (sq) => (flipped ? 63 - sq : sq);

  function chessRender() {
    const st = GC.game;
    const checkedKing = (!over && st.inCheck()) ? st.kingSq(st.turn()) : -1;
    const bdArr = st.boardArray();
    const last = st.lastMove();
    for (let dp = 0; dp < 64; dp++) {
      const sq = chessDispToSq(dp);
      const el = boardEl.children[dp];
      const r = sq >> 3, c = sq & 7;
      el.className = 'ch-sq ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
      const p = bdArr[sq];
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
      if (last && (sq === last.from || sq === last.to)) el.classList.add('last');
      if (sq === GC.selected) el.classList.add('sel');
      if (sq === checkedKing) el.classList.add('check');
      const target = GC.selMoves.find((x) => algToSq(x.to) === sq);
      if (target) {
        const mark = document.createElement('span');
        mark.className = p ? 'ring' : 'dot';
        el.appendChild(mark);
      }
    }
    chessCaptures();
  }

  function chessCaptures() {
    const lost = GC.game.captured();
    const glyphOf = (t, c) => pieceGlyph({ t, c });
    const strip = (c) => ['q', 'r', 'b', 'n', 'p'].flatMap((t) => Array(lost[c][t]).fill(glyphOf(t, c))).join('');
    capTopEl.textContent = strip('b');
    capBottomEl.textContent = strip('w');
  }

  function chessMyColor() {
    if (mode === 'local') return GC.game.turn();
    if (mode === 'ai') return GC.me;
    return online && online.seat ? sideOf('chess', online.seat) : null;
  }

  function chessOnSquare(dp) {
    if (over || gameEl.hidden) return;
    if (GC.thinking) return;
    if (mode === 'ai' && GC.game.turn() === oppSide('chess', GC.me)) return;
    if (mode === 'online' && (!online || online.room?.status !== 'playing')) return;
    if (mode === 'online' && online.seat && GC.game.turn() !== sideOf('chess', online.seat)) return;
    const sq = chessDispToSq(dp);
    const bdArr = GC.game.boardArray();
    if (GC.selected >= 0) {
      const ms = GC.selMoves.filter((x) => algToSq(x.to) === sq);
      if (ms.length) {
        if (ms.some((x) => x.promotion)) { chessPromo(ms); return; }
        chessApply(ms[0]);
        return;
      }
      // 易位手势 2：选中王后直接点己方车（chess.js 只认王走两格）
      const clicked = bdArr[sq];
      const selSq = chessDispToSq(GC.selected);
      const selP = bdArr[selSq];
      if (clicked && clicked.t === 'r' && clicked.c === chessMyColor() && selP && selP.t === 'k' && selP.c === clicked.c) {
        const homeRow = clicked.c === 'w' ? 7 : 0;
        if ((sq >> 3) === homeRow) {
          const castle = GC.selMoves.find((x) =>
            (x.flags.includes('k') && algToSq(x.to) === homeRow * 8 + 6 && sq === homeRow * 8 + 7) ||
            (x.flags.includes('q') && algToSq(x.to) === homeRow * 8 + 2 && sq === homeRow * 8 + 0));
          if (castle) { chessApply(castle); return; }
        }
      }
    }
    const p = bdArr[sq];
    const myColor = chessMyColor();
    if (p && p.c === myColor && (mode !== 'online' || GC.game.turn() === myColor)) {
      GC.selected = sq;
      GC.selMoves = GC.game.movesAt(sqToAlg(sq));
      GC.selPiece = p.t;
      chessRender();
    } else {
      GC.selected = -1;
      GC.selMoves = [];
      GC.selPiece = null;
      chessRender();
    }
  }

  let chessPendingPromo = null;
  function chessPromo(ms) {
    chessPendingPromo = ms;
    const row = $('#ch-promo-row');
    row.textContent = '';
    const seen = new Set();
    for (const m of ms) {
      if (seen.has(m.promotion)) continue;
      seen.add(m.promotion);
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = pieceGlyph({ t: m.promotion, c: m.color });
      b.addEventListener('click', () => {
        $('#ch-promo').hidden = true;
        const list = chessPendingPromo;
        chessPendingPromo = null;
        if (list) {
          const pick = list.find((x) => x.promotion === m.promotion) || list[0];
          chessApply(pick);
        }
      });
      row.appendChild(b);
    }
    $('#ch-promo').hidden = false;
  }

  /* 应用走法（v 为 chess.js verbose move：from/to 代数坐标） */
  function chessApply(v) {
    const rec = GC.game.apply(v.from, v.to, v.promotion);
    if (!rec) return;
    GC.selected = -1;
    GC.selMoves = [];
    GC.selPiece = null;
    chessAfterMove();
  }

  function chessAfterMove() {
    render();
    if (mode === 'online' && online) onlinePush(); // 先同步，再判终局（否则对手看不到最后一手）
    const status = GC.game.status();
    if (status.over) { chessFinish(status); return; }
    if (mode === 'ai' && GC.game.turn() !== GC.me) chessAiReply();
  }

  async function chessAiReply() {
    GC.thinking = true;
    renderStatus();
    const fen = GC.game.fen();
    const mv = await chessAiMove(fen, GC.level);
    GC.thinking = false;
    if (!mv || over || kind !== 'chess' || mode !== 'ai') { render(); return; }
    chessApply(mv);
  }

  function chessStatusText(status) {
    const loser = GC.game.turn() === 'w' ? '白' : '黑';
    const winner = loser === '白' ? '黑' : '白';
    if (status.reason === 'checkmate') {
      if (mode === 'ai') return winner === SIDE_NAME.chess[GC.me] ? '将杀 —— 你赢了 🎉' : '将杀 —— 你输了 😵';
      if (mode === 'online') return `将杀 —— ${winner}方胜`;
      return `将杀 —— ${winner}方胜`;
    }
    if (status.reason === 'stalemate') return '逼和 —— 和棋 🤝';
    if (status.reason === 'fifty') return '五十回合无进展 —— 和棋 🤝';
    if (status.reason === 'repetition') return '三次重复局面 —— 和棋 🤝';
    return '双方子力不足 —— 和棋 🤝';
  }

  function chessFinish(status) {
    const text = chessStatusText(status);
    endGame(text);
    if (status.reason === 'checkmate') {
      const w = status.winner; // 'w' | 'b'
      const winSide = w === 'w' ? 'first' : 'second'; // 白 = 先手
      if (mode === 'online' && online) onlineMarkFinished(winSide === 'first' ? 'first' : 'second');
    } else if (mode === 'online' && online) {
      onlineMarkFinished('draw');
    }
    if (mode === 'ai') {
      const myWin = status.reason === 'checkmate' && SIDE_NAME.chess[GC.me] === (status.winner === 'w' ? '白' : '黑');
      recordGame(status.reason === 'checkmate' ? (myWin ? 'win' : 'loss') : 'draw');
    }
  }

  function chessNew() {
    GC.game = new ChessGame();
    GC.selected = -1;
    GC.selMoves = [];
    GC.selPiece = null;
    GC.thinking = false;
    flipped = mode === 'ai' ? GC.me === 'b' : false;
    chessBuild();
    chessRender();
  }

  /* ================================================================
     二、五子棋（1 黑先行 / 2 白；level 0-2）
     ================================================================ */
  const GG = {
    bd: null, me: 1, vsAI: true, level: 1, history: [],
    lastIdx: null, winLine: null, moves: [],
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

  function gomokuRender() {
    for (let i = 0; i < 225; i++) gomokuPaint(i);
    if (GG.lastIdx != null && GG.bd[GG.lastIdx]) boardEl.children[GG.lastIdx].classList.add('gk-last');
    if (GG.winLine) for (const k of GG.winLine) boardEl.children[k].classList.add('gk-winline');
  }

  function gomokuNew(opts) {
    GG.bd = Gomoku.emptyBoard();
    GG.history = [];
    GG.moves = [];
    GG.me = opts.me;
    GG.vsAI = opts.vsAI;
    GG.level = opts.level;
    GG.lastIdx = null;
    GG.winLine = null;
    GG.turnNow = 1;
    gomokuBuild();
    gomokuRender();
  }

  async function gomokuAiMove() {
    thinking = true;
    renderStatus();
    const aiColor = oppSide('gomoku', GG.me);
    const r = await callAi('gomoku', GG.bd, aiColor, GG.level);
    const fallback = r && r.idx != null ? r : await Promise.resolve(AI_LOCAL.gomoku(GG.bd, aiColor, GG.level));
    thinking = false;
    if (!fallback || kind !== 'gomoku' || over) { renderStatus(); return; }
    gomokuPlace(fallback.idx);
  }

  function gomokuPlace(i) {
    if (over || !GG.bd || GG.bd[i]) return;
    GG.history.push({ bd: Int8Array.from(GG.bd), turnNow: GG.turnNow, i });
    GG.bd[i] = GG.turnNow;
    GG.moves.push(i);
    GG.lastIdx = i;
    if (mode === 'online' && online) onlinePush(); // 先同步，再判终局
    const line = Gomoku.checkWin(GG.bd, i);
    if (line) {
      GG.winLine = line;
      gomokuRender();
      gomokuEnd(GG.turnNow, (GG.turnNow === 1 ? '黑方' : '白方') + '五连获胜 🎉');
      return;
    }
    GG.turnNow = GG.turnNow === 1 ? 2 : 1;
    gomokuRender();
    renderStatus();
    if (GG.vsAI && GG.turnNow !== GG.me && kind === 'gomoku' && !over) gomokuAiMove();
  }

  function gomokuEnd(winnerSide, text) {
    endGame(text);
    if (mode === 'online' && online) onlineMarkFinished(winnerSide === 1 ? 'first' : 'second');
    if (GG.vsAI) recordGame(winnerSide === GG.me ? 'win' : 'loss');
  }

  function gomokuUndo() {
    if (!GG.history.length) return;
    const steps = GG.vsAI && GG.history.length >= 2 ? 2 : 1;
    for (let k = 0; k < steps && GG.history.length; k++) {
      const h = GG.history.pop();
      GG.moves.pop();
      GG.bd = Int8Array.from(h.bd);
      GG.turnNow = h.turnNow;
    }
    GG.lastIdx = GG.history.length ? GG.history[GG.history.length - 1].i : null;
    GG.winLine = null;
    over = false; resultText = ''; recorded = false;
    gomokuRender();
  }

  /* ================================================================
     三、围棋（1 黑 / 2 白；level 0-2）
     ================================================================ */
  const GO = {
    bd: null, turn: 1, ko: -1, passes: 0, history: [], moves: [],
    caps: { 1: 0, 2: 0 }, lastIdx: null,
    vsAI: true, level: 1, me: 1,
  };

  const GO_STARS = [[3, 3], [3, 9], [3, 15], [9, 3], [9, 9], [9, 15], [15, 3], [15, 9], [15, 15]];

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
    for (const [r, c] of GO_STARS) {
      const star = document.createElement('span');
      star.className = 'go-star';
      star.style.left = ((c + 0.5) / 19 * 100).toFixed(4) + '%';
      star.style.top = ((r + 0.5) / 19 * 100).toFixed(4) + '%';
      boardEl.appendChild(star);
    }
  }
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
    GO.history = []; GO.moves = []; GO.caps = { 1: 0, 2: 0 }; GO.lastIdx = null;
    GO.vsAI = opts.vsAI; GO.level = opts.level; GO.me = opts.me ?? 1;
    goBuild();
    goRender();
  }

  function goPlayAt(i) {
    const snap = { bd: Int8Array.from(GO.bd), turn: GO.turn, ko: GO.ko, passes: GO.passes, caps: { ...GO.caps }, lastIdx: GO.lastIdx };
    const r = Go.play(GO.bd, i, GO.turn, GO.ko);
    if (!r.ok) return false;
    GO.history.push(snap);
    GO.moves.push(i);
    GO.caps[GO.turn] += r.captured.length;
    GO.ko = r.ko;
    GO.passes = 0;
    GO.lastIdx = i;
    GO.turn = GO.turn === 1 ? 2 : 1;
    goRender();
    renderStatus();
    if (mode === 'online' && online) onlinePush(); // 先同步，再触发后续
    if (GO.vsAI && GO.turn !== GO.me && kind === 'go' && !over) goAiMove();
    return true;
  }

  async function goAiMove() {
    thinking = true;
    renderStatus();
    const aiColor = oppSide('go', GO.me);
    const r = await callAi('go', GO.bd, aiColor, GO.ko, GO.level);
    const fallback = r && (r.pass || r.idx != null) ? r : await Promise.resolve(AI_LOCAL.go(GO.bd, aiColor, GO.ko, GO.level));
    thinking = false;
    if (!fallback || kind !== 'go' || over) { renderStatus(); return; }
    if (fallback.pass || fallback.idx == null) { goPass(true); return; }
    goPlayAt(fallback.idx);
  }

  function goPass(ai) {
    GO.history.push({ bd: Int8Array.from(GO.bd), turn: GO.turn, ko: GO.ko, passes: GO.passes, caps: { ...GO.caps }, lastIdx: GO.lastIdx });
    GO.moves.push(-1);
    GO.passes++;
    GO.ko = -1;
    GO.turn = GO.turn === 1 ? 2 : 1;
    GO.lastIdx = null;
    goRender();
    if (mode === 'online' && online) onlinePush(); // 先同步，再判双停
    if (GO.passes >= 2) { goScoreEnd(); return; }
    renderStatus();
    if (!over && GO.vsAI && GO.turn !== GO.me && kind === 'go') goAiMove();
  }

  function goScoreEnd() {
    const t = Go.score(GO.bd);
    const whiteTotal = t.white + Go.KOMI;
    const diff = Math.round(Math.abs(t.black - whiteTotal) * 2) / 2;
    const blackWin = t.black > whiteTotal;
    const text = `黑 ${t.black} 子 · 白 ${whiteTotal} 子（贴 ${Go.KOMI}）—— ` +
      (Math.abs(t.black - whiteTotal) < 1e-9 ? '和棋 🤝' : blackWin ? '黑胜 ' + diff + ' 子' : '白胜 ' + diff + ' 子');
    goRender();
    endGame(text);
    if (mode === 'online' && online) onlineMarkFinished(Math.abs(t.black - whiteTotal) < 1e-9 ? 'draw' : blackWin ? 'first' : 'second');
    if (GO.vsAI) {
      const myIsBlack = GO.me === 1;
      const iWin = blackWin === myIsBlack;
      recordGame(iWin ? 'win' : 'loss');
    }
  }

  function goUndo() {
    if (!GO.history.length) return;
    const steps = GO.vsAI && GO.history.length >= 2 ? 2 : 1;
    for (let k = 0; k < steps && GO.history.length; k++) {
      const h = GO.history.pop();
      GO.moves.pop();
      GO.bd = Int8Array.from(h.bd);
      GO.turn = h.turn; GO.ko = h.ko; GO.passes = h.passes; GO.caps = { ...h.caps };
      GO.lastIdx = h.lastIdx ?? null;
    }
    over = false; resultText = ''; recorded = false;
    goRender();
  }

  /* ================================================================
     四、中国象棋（'r' 红先行 / 'b' 黑；level 0-3）
     ================================================================ */
  const XQ = {
    st: null, history: [], moves: [], selected: -1, targets: [],
    vsAI: true, level: 2, me: 'r', lastMove: null,
  };
  const XQ_CHAR = {
    r: { k: '帥', a: '仕', b: '相', n: '傌', r: '俥', c: '炮', p: '兵' },
    b: { k: '將', a: '士', b: '象', n: '馬', r: '車', c: '砲', p: '卒' },
  };

  const enc = (bd) => bd.map((p) => (p ? (p.c === 'r' ? p.t.charCodeAt(0) : -p.t.charCodeAt(0)) : 0));
  const dec = (arr) => arr.map((v) => {
    if (v === 0) return null;
    return v > 0 ? { t: String.fromCharCode(v), c: 'r' } : { t: String.fromCharCode(-v), c: 'b' };
  });

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
    XQ.moves = [];
    XQ.selected = -1; XQ.targets = []; XQ.lastMove = null;
    XQ.vsAI = opts.vsAI;
    XQ.level = opts.level;
    XQ.me = opts.me || 'r';
    xiangqiBuild();
    xiangqiRender();
  }

  async function xiangqiAiMove() {
    thinking = true;
    renderStatus();
    const r = await callAi('xiangqi', XQ.st, { level: XQ.level });
    const fallback = r && r.move ? r : await Promise.resolve(AI_LOCAL.xiangqi(XQ.st, { level: XQ.level }));
    thinking = false;
    if (!fallback || !fallback.move || kind !== 'xiangqi' || over) { renderStatus(); return; }
    xiangqiApply(fallback.move);
  }

  function xiangqiApply(m) {
    XQ.history.push({ bd: enc(XQ.st.bd), turn: XQ.st.turn, half: XQ.st.half || 0, key: Xiangqi.positionKey(XQ.st) });
    Xiangqi.makeMove(XQ.st, m);
    XQ.moves.push({ f: m.from, t: m.to });
    XQ.lastMove = { from: m.from, to: m.to };
    XQ.selected = -1; XQ.targets = [];
    render(); // 含棋盘 + 状态栏 + 按钮态
    if (mode === 'online' && online) onlinePush(); // 先同步，再判终局
    const status = Xiangqi.gameStatus(XQ.st, { repetition: xiangqiRepetitions() });
    if (status.over) {
      let text;
      if (status.reason === 'repetition') text = '三次重复局面 —— 和棋 🤝';
      else if (status.reason === 'natural') text = '60 回合无吃子 —— 和棋 🤝';
      else {
        const winner = status.winner === 'r' ? '红方' : '黑方';
        text = XQ.vsAI
          ? (status.winner === XQ.me ? '将死对方 —— 你赢了 🎉' : '被将死 —— 你输了 😵')
          : `${winner}胜 🎉`;
      }
      endGame(text);
      const winIsFirst = status.winner === 'r';
      if (mode === 'online' && online) onlineMarkFinished(status.winner ? (winIsFirst ? 'first' : 'second') : 'draw');
      if (XQ.vsAI) recordGame(status.winner ? (status.winner === XQ.me ? 'win' : 'loss') : 'draw');
      renderStatus();
      return;
    }
    if (XQ.vsAI && XQ.st.turn !== XQ.me && kind === 'xiangqi' && !over) xiangqiAiMove();
  }

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
      XQ.moves.pop();
      XQ.st.bd = dec(h.bd);
      XQ.st.turn = h.turn;
      XQ.st.half = h.half || 0;
    }
    XQ.selected = -1; XQ.targets = []; XQ.lastMove = null;
    over = false; resultText = ''; recorded = false;
    xiangqiRender();
  }

  /* ================================================================
     棋盘点击分发 / 状态栏 / 按钮
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
    if (mode === 'online' && (!online || online.room?.status !== 'playing')) return;
    if (mode === 'online' && online.seat && GG.turnNow !== sideOf('gomoku', online.seat)) return;
    gomokuPlace(i);
  }

  function xiangqiClick(i) {
    if (over || gameEl.hidden) return;
    if (XQ.vsAI && XQ.st.turn !== XQ.me) return;
    if (mode === 'online' && (!online || online.room?.status !== 'playing')) return;
    if (mode === 'online' && online.seat && XQ.st.turn !== sideOf('xiangqi', online.seat)) return;
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

  function goClick(i) {
    if (over || gameEl.hidden) return;
    if (GO.vsAI && GO.turn !== GO.me) return;
    if (mode === 'online' && (!online || online.room?.status !== 'playing')) return;
    if (mode === 'online' && online.seat && GO.turn !== sideOf('go', online.seat)) return;
    goPlayAt(i);
  }

  function startGame(kindKey) {
    onlineCleanup();
    kind = kindKey;
    mode = sel.mode === 'online' ? 'online' : sel.mode === 'local' ? 'local' : 'ai';
    over = false; resultText = ''; recorded = false;
    startTime = Date.now();
    const lvl = sel.level[kind];
    if (kind === 'chess') {
      GC.level = lvl;
      GC.me = sel.side.chess;
      chessNew();
      showGame(modeChipText());
      if (mode === 'ai' && GC.game.turn() !== GC.me) chessAiReply();
    } else if (kind === 'gomoku') {
      GG.me = +sel.side.gomoku;
      GG.vsAI = mode === 'ai';
      GG.level = lvl;
      gomokuNew({ me: GG.me, vsAI: GG.vsAI, level: GG.level });
      showGame(modeChipText());
      if (GG.vsAI && GG.me === 2) gomokuAiMove();
    } else if (kind === 'xiangqi') {
      XQ.me = sel.side.xiangqi;
      XQ.vsAI = mode === 'ai';
      XQ.level = lvl;
      xiangqiNew({ vsAI: XQ.vsAI, level: XQ.level, me: XQ.me });
      showGame(modeChipText());
      if (XQ.vsAI && XQ.me === 'b') xiangqiAiMove();
    } else if (kind === 'go') {
      GO.me = +sel.side.go;
      GO.vsAI = mode === 'ai';
      GO.level = lvl;
      goNew({ vsAI: GO.vsAI, level: GO.level, me: GO.me });
      showGame(modeChipText());
      if (GO.vsAI && GO.me === 2) goAiMove();
    }
  }

  function modeChipText() {
    if (mode === 'local') return KIND_LABEL[kind] + ' · 双人同屏';
    if (mode === 'online') return KIND_LABEL[kind] + ' · 联机';
    const sideName = SIDE_NAME[kind][currentMySide()];
    return KIND_LABEL[kind] + ' · 人机' + DIFF_LABELS[kind][sel.level[kind]] + ' · 执' + sideName;
  }
  function currentMySide() {
    if (kind === 'chess') return GC.me;
    if (kind === 'gomoku') return GG.me;
    if (kind === 'xiangqi') return XQ.me;
    return GO.me;
  }

  function renderStatus() {
    let s = '';
    if (over) s = resultText;
    else if (kind === 'chess') {
      if (mode === 'ai') s = GC.thinking ? 'AI 思考中…' : (GC.game.turn() === GC.me ? '你的回合' : 'AI 回合');
      else if (online) {
        if (online.room?.status === 'waiting') s = `等待对手加入 — 房间码 ${online.code}`;
        else if (online.room?.status === 'finished') s = online.room.result || '对局结束';
        else {
          const my = online.seat ? sideOf('chess', online.seat) : null;
          s = `${online.room?.host_name || '先手'} ⚔ ${online.room?.guest_name || '后手'} · ${my && GC.game.turn() === my ? '你走' : '对方走'}`;
        }
      }
    } else if (kind === 'gomoku') {
      s = thinking ? 'AI 思考中…' : (GG.vsAI ? (GG.turnNow === GG.me ? '你的回合（' + SIDE_NAME.gomoku[GG.me] + '）' : 'AI 回合') : (GG.turnNow === 1 ? '黑方回合' : '白方回合'));
    } else if (kind === 'xiangqi') {
      s = thinking ? 'AI 思考中…' : (XQ.vsAI ? (XQ.st.turn === XQ.me ? '你的回合（' + SIDE_NAME.xiangqi[XQ.me] + '）' : 'AI 回合') : (XQ.st.turn === 'r' ? '红方回合' : '黑方回合'));
    } else if (kind === 'go') {
      s = thinking ? 'AI 思考中…' : (GO.vsAI ? (GO.turn === GO.me ? '你的回合（' + SIDE_NAME.go[GO.me] + '）' : 'AI 回合') : (GO.turn === 1 ? '黑方回合' : '白方回合'));
    }
    if (!over && s) {
      if (kind === 'go' && GO.passes > 0) s += ` · 对方已停一手，再停一手即终局`;
      if (kind === 'chess') {
        const san = GC.game.sanHistory();
        if (san.length) s += ` · 上一步 ${san[san.length - 1]}`;
      }
      if (kind === 'gomoku' && GG.moves.length) {
        const i = GG.moves[GG.moves.length - 1];
        s += ` · 上一手 (${((i / 15) | 0) + 1},${(i % 15) + 1})`;
      }
      if (kind === 'xiangqi' && XQ.lastMove) s += ` · 上一步 (${Math.floor(XQ.lastMove.from / 9) + 1},${XQ.lastMove.from % 9 + 1})->(${Math.floor(XQ.lastMove.to / 9) + 1},${XQ.lastMove.to % 9 + 1})`;
    }
    statusEl.textContent = s;
    updateButtons();
  }

  function render() {
    if (kind === 'chess') chessRender();
    else if (kind === 'gomoku') gomokuRender();
    else if (kind === 'xiangqi') xiangqiRender();
    else if (kind === 'go') goRender();
    updateButtons();
    renderStatus();
  }

  function updateButtons() {
    const flipBtn = $('#ch-flip');
    const restartBtn = $('#ch-restart');
    const undoBtn = $('#ch-undo');
    const resignBtn = $('#ch-resign');
    flipBtn.hidden = kind !== 'chess';
    restartBtn.hidden = mode === 'online';
    undoBtn.hidden = mode === 'online'; // 联机禁悔棋；人机撤两步、双人同屏撤一步
    resignBtn.hidden = mode === 'local';
    $('#ch-pass').hidden = kind !== 'go';
    const hist = kind === 'chess' ? GC.game.moveCount()
      : kind === 'gomoku' ? GG.history.length
        : kind === 'xiangqi' ? XQ.history.length
          : kind === 'go' ? GO.history.length : 0;
    undoBtn.disabled = thinking || GC.thinking || over || !hist;
    resignBtn.disabled = over;
  }

  function endGame(text) {
    over = true;
    resultText = text;
    showDialog('对局结束', text);
    renderStatus();
  }

  /* ---------- 战绩上报（人机 / 联机；双人同屏不记） ---------- */
  function recordGame(result) {
    if (recorded || mode === 'local' || !result) return;
    recorded = true;
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    let movesN = 0;
    if (kind === 'chess') movesN = GC.game.moveCount();
    else if (kind === 'gomoku') movesN = GG.moves.length;
    else if (kind === 'xiangqi') movesN = XQ.moves.length;
    else if (kind === 'go') movesN = GO.moves.filter((x) => x >= 0).length;
    let side = currentMySide();
    let difficulty = mode === 'online' ? 'online' : String(sel.level[kind]);
    if (mode === 'online' && online?.seat) side = sideOf(kind, online.seat);
    recordResult(kind, result, difficulty, String(side), movesN, seconds);
  }
  async function recordResult(kindKey, result, difficulty, side, moves, seconds) {
    if (!cloudSb) return;
    try {
      await cloudSb.from('chess_results').insert({
        kind: kindKey,
        name: myName() || '游客',
        result,
        difficulty,
        side,
        moves: Math.min(moves, 9999),
        seconds: Math.min(seconds, 86399),
        user_id: cloudUser?.id || null,
      });
    } catch (e) {
      console.warn('[棋] 战绩上报失败：', e?.message || e);
    }
  }

  /* ---------- 按钮动作 ---------- */
  $('#ch-exit').addEventListener('click', () => {
    onlineCleanup();
    kind = null;
    showLauncher();
    refreshLb();
  });
  $('#ch-undo').addEventListener('click', () => {
    if (mode === 'online' || thinking || GC.thinking || over) return;
    if (kind === 'chess') {
      if (!GC.game.moveCount()) return;
      GC.game.undo();
      if (mode === 'ai' && GC.game.turn() !== GC.me && GC.game.moveCount()) GC.game.undo();
      GC.selected = -1; GC.selMoves = []; GC.selPiece = null;
      GC.thinking = false;
      over = false; resultText = ''; recorded = false;
      chessRender();
      renderStatus();
    } else if (kind === 'gomoku') gomokuUndo();
    else if (kind === 'xiangqi') xiangqiUndo();
    else if (kind === 'go') goUndo();
  });
  $('#ch-resign').addEventListener('click', () => {
    if (over) return;
    if (mode === 'ai') {
      recordGame('loss');
      endGame('你认输了 —— AI 获胜');
    } else if (mode === 'online' && online && online.seat) {
      const winnerSeat = online.seat === 'first' ? 'second' : 'first';
      onlineMarkFinished(winnerSeat);
      endGame('你认输了 —— 对方胜');
    } else if (mode === 'local') {
      const loserName = kind === 'chess' ? (GC.game.turn() === 'w' ? '白方' : '黑方')
        : kind === 'gomoku' ? (GG.turnNow === 1 ? '黑方' : '白方')
          : kind === 'xiangqi' ? (XQ.st.turn === 'r' ? '红方' : '黑方')
            : (GO.turn === 1 ? '黑方' : '白方');
      endGame(loserName + '认输 —— ' + (loserName === '白方' ? '黑方' : loserName === '黑方' ? '白方' : loserName === '红方' ? '黑方' : '红方') + '胜');
    }
  });
  $('#ch-pass').addEventListener('click', () => { if (kind === 'go' && !over) goPass(false); });
  $('#ch-restart')?.addEventListener('click', () => { if (kind && mode !== 'online') startGame(kind); });
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
    const w = boardEl.clientWidth;
    const h = boardEl.clientHeight;
    if (w > 0) boardEl.style.setProperty('--ch-piece', (w / 8 * 0.74).toFixed(1) + 'px');
    if (w > 0) boardEl.style.setProperty('--gk-stone', (w / 15 * 0.72).toFixed(1) + 'px');
    const wq = Math.min(w, h * 9 / 10);
    if (wq > 0) boardEl.style.setProperty('--xq-piece', (wq / 9 * 0.82).toFixed(1) + 'px');
    if (w > 0) boardEl.style.setProperty('--go-stone', (w / 19 * 0.92).toFixed(1) + 'px');
  }
  window.addEventListener('resize', fitBoard);
  window.addEventListener('orientationchange', fitBoard);

  /* ================================================================
     联机（四棋通用 board_rooms）
     state 为局面真相：chess={fen}，xiangqi={bd,turn,half}，
     gomoku={bd}，go={bd,turn,ko,passes,caps}。moves 为着法列表。
     ================================================================ */
  const roomInitialState = (k) => ({
    chess: () => ({ fen: START_FEN }),
    xiangqi: () => { const st = Xiangqi.initState(); return { bd: enc(st.bd), turn: st.turn, half: 0 }; },
    gomoku: () => ({ bd: Array.from(Gomoku.emptyBoard()) }),
    go: () => ({ bd: Array.from(Go.emptyBoard()), turn: 1, ko: -1, passes: 0, caps: { 1: 0, 2: 0 } }),
  })[k]();

  function localRoomState(k) {
    if (k === 'chess') return { fen: GC.game.fen() };
    if (k === 'xiangqi') return { bd: enc(XQ.st.bd), turn: XQ.st.turn, half: XQ.st.half || 0 };
    if (k === 'gomoku') return { bd: Array.from(GG.bd) };
    return { bd: Array.from(GO.bd), turn: GO.turn, ko: GO.ko, passes: GO.passes, caps: { ...GO.caps } };
  }
  function localRoomMoves(k) {
    if (k === 'chess') return GC.game.sanHistory();
    if (k === 'xiangqi') return XQ.moves.slice();
    if (k === 'gomoku') return GG.moves.slice();
    return GO.moves.slice();
  }

  /* 把云端局面接到本地（含 lastMove / 回合推导） */
  function adoptRoomState(k, state, moves) {
    if (k === 'chess') {
      if (state?.fen && GC.game.fen() !== state.fen) {
        GC.game.load(state.fen);
        GC.selected = -1; GC.selMoves = []; GC.selPiece = null;
      }
    } else if (k === 'xiangqi') {
      if (state?.bd) {
        const bd = dec(state.bd);
        if (JSON.stringify(enc(XQ.st.bd)) !== JSON.stringify(state.bd) || XQ.st.turn !== state.turn) {
          XQ.st.bd = bd;
          XQ.st.turn = state.turn || 'r';
          XQ.st.half = state.half || 0;
          XQ.selected = -1; XQ.targets = [];
        }
      }
      XQ.lastMove = movesTail(moves);
    } else if (k === 'gomoku') {
      if (state?.bd) {
        const bd = Int8Array.from(state.bd);
        if (!GG.bd || bd.length !== GG.bd.length || bd.some((v, j) => v !== GG.bd[j])) {
          GG.bd = bd;
          GG.turnNow = (moves?.length || 0) % 2 ? 2 : 1;
        }
      }
      const tail = movesTail(moves);
      GG.lastIdx = tail != null && tail >= 0 ? tail : null;
    } else if (k === 'go') {
      if (state?.bd) {
        const bd = Int8Array.from(state.bd);
        const bdDiff = !GO.bd || bd.length !== GO.bd.length || bd.some((v, j) => v !== GO.bd[j]);
        // 停一手不改棋盘：回合或停着数变了也要接住
        if (bdDiff || GO.turn !== (state.turn || 1) || GO.passes !== (state.passes || 0)) {
          GO.bd = bd;
          GO.turn = state.turn || 1;
          GO.ko = state.ko ?? -1;
          GO.passes = state.passes || 0;
          GO.caps = { 1: state.caps?.[1] || 0, 2: state.caps?.[2] || 0 };
        }
      }
      const tail = movesTail(moves);
      GO.lastIdx = tail != null && tail >= 0 ? tail : null;
    }
  }
  function movesTail(moves) {
    if (!moves || !moves.length) return null;
    const t = moves[moves.length - 1];
    if (typeof t === 'number') return t;
    if (typeof t === 'object') return { from: t.f, to: t.t };
    return null;
  }

  function sideOf(k, seat) {
    const first = { chess: 'w', xiangqi: 'r', gomoku: 1, go: 1 }[k];
    return seat === 'first' ? first : oppSide(k, first);
  }

  async function createRoom() {
    if (!cloudSb) { showDialog('联机不可用', '云端未连接，稍后再试。'); return; }
    const k = sel.kind;
    const name = await ensureName();
    const code = genCode();
    const mySeatSide = sel.side[k];
    const firstSide = { chess: 'w', xiangqi: 'r', gomoku: 1, go: 1 }[k];
    const iAmFirst = String(mySeatSide) === String(firstSide);
    const payload = {
      code,
      kind: k,
      state: roomInitialState(k),
      moves: [],
      host_name: name,
      host_side: String(mySeatSide),
      guest_name: '',
      status: 'waiting',
      result: '',
    };
    const { error } = await cloudSb.from('board_rooms').insert(payload);
    if (error) { showDialog('创建失败', error.message); return; }
    // seat 指的是「先手位 / 后手位」，不是加入顺序
    startBoardOnline(code, iAmFirst ? 'first' : 'second', payload);
  }

  async function joinRoom() {
    if (!cloudSb) { showDialog('联机不可用', '云端未连接，稍后再试。'); return; }
    const code = ($('#ch-code-input').value || '').trim().toUpperCase();
    if (!code) return;
    const { data, error } = await cloudSb.from('board_rooms').select('*').eq('code', code).maybeSingle();
    if (error || !data) { showDialog('房间不存在', '检查一下房间码？'); return; }
    const remembered = store.get('ch-seat2-' + code, null);
    const firstSide = { chess: 'w', xiangqi: 'r', gomoku: 1, go: 1 }[data.kind];
    const hostIsFirst = String(data.host_side) === String(firstSide);
    const guestSeat = hostIsFirst ? 'second' : 'first';
    if (data.status === 'waiting' && !data.guest_name && !remembered) {
      const name = await ensureName();
      const { error: uerr } = await cloudSb.from('board_rooms')
        .update({ guest_name: name, status: 'playing', updated_at: new Date().toISOString() })
        .eq('code', code);
      if (uerr) { showDialog('加入失败', uerr.message); return; }
      data.guest_name = name;
      data.status = 'playing';
      startBoardOnline(code, guestSeat, data);
      return;
    }
    if (remembered === 'first' || remembered === 'second') { startBoardOnline(code, remembered, data); return; }
    startBoardOnline(code, null, data);
  }

  function startBoardOnline(code, seat, room) {
    onlineCleanup();
    kind = room.kind;
    mode = 'online';
    over = false; resultText = ''; recorded = false;
    flipped = seat === 'second';
    startTime = Date.now();
    online = { code, kind, seat, channel: null, poll: null, room, finishedShown: false };
    if (seat) store.set('ch-seat2-' + code, seat);
    if (kind === 'chess') {
      GC.game = new ChessGame();
      GC.selected = -1; GC.selMoves = []; GC.selPiece = null; GC.thinking = false;
      chessBuild();
    } else if (kind === 'xiangqi') {
      XQ.st = Xiangqi.initState(); XQ.history = []; XQ.moves = [];
      XQ.selected = -1; XQ.targets = []; XQ.lastMove = null;
      xiangqiBuild();
    } else if (kind === 'gomoku') {
      GG.bd = Gomoku.emptyBoard(); GG.history = []; GG.moves = [];
      GG.lastIdx = null; GG.winLine = null; GG.turnNow = 1;
      gomokuBuild();
    } else if (kind === 'go') {
      GO.bd = Go.emptyBoard(); GO.history = []; GO.moves = [];
      GO.turn = 1; GO.ko = -1; GO.passes = 0; GO.caps = { 1: 0, 2: 0 }; GO.lastIdx = null;
      goBuild();
    }
    adoptRoomState(kind, room.state, room.moves);
    showGame(KIND_LABEL[kind] + ' · 联机 · ' + (seat ? (seat === 'first' ? '先手' : '后手') : '观战'));
    roomChip.hidden = false;
    roomChip.textContent = '房间 ' + code;
    if (cloudSb) {
      online.channel = cloudSb.channel('board-room-' + code)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'board_rooms', filter: 'code=eq.' + code },
          (payload) => { if (payload.new) onlineOnRoom(payload.new); })
        .subscribe();
      online.poll = setInterval(async () => {
        if (!cloudSb || document.hidden) return;
        const { data } = await cloudSb.from('board_rooms').select('*').eq('code', code).maybeSingle();
        if (data) onlineOnRoom(data);
      }, 4000);
    }
    render();
  }

  function onlineOnRoom(room) {
    if (!online || gameEl.hidden || kind !== online.kind) return;
    online.room = room;
    adoptRoomState(kind, room.state, room.moves);
    const status = kind === 'chess' ? GC.game.status() : null;
    if (room.status === 'finished' && !over) {
      over = true;
      if (!online.finishedShown) {
        online.finishedShown = true;
        endGame(onlineResultText(room.result));
      }
      // 对方标记的终局也要上报我自己的战绩
      if (online.seat && !recorded && room.result) {
        recorded = true;
        recordResult(online.kind, room.result === 'draw' ? 'draw' : room.result === online.seat ? 'win' : 'loss',
          'online', String(sideOf(online.kind, online.seat)), 0, Math.floor((Date.now() - startTime) / 1000));
      }
    } else if (status && status.over && !over && !online.finishedShown) {
      online.finishedShown = true;
      endGame(room.result ? onlineResultText(room.result) : chessStatusText(status));
    }
    render();
  }

  function onlineResultText(r) {
    if (!r) return '对局结束';
    const host = online.room?.host_name || '先手';
    const guest = online.room?.guest_name || '后手';
    const firstLabel = { chess: '白', xiangqi: '红', gomoku: '黑', go: '黑' }[kind];
    if (r === 'draw') return '和棋 🤝';
    const winnerName = r === 'first' ? `${host}（${firstLabel}）` : `${guest}（${oppSideName(kind, firstLabel)}）`;
    return `${winnerName} 获胜 🎉`;
  }
  function oppSideName(k, s) {
    return ({ 白: '黑', 黑: '白', 红: '黑' })[s] || s;
  }

  function onlinePush() {
    if (!online || !cloudSb || over) return;
    cloudSb.from('board_rooms').update({
      state: localRoomState(online.kind),
      moves: localRoomMoves(online.kind),
      updated_at: new Date().toISOString(),
    }).eq('code', online.code).then(({ error }) => {
      if (error) console.warn('[棋] 走子同步失败：', error.message);
    });
  }

  function onlineMarkFinished(result) {
    if (!online || !cloudSb || !result) return;
    if (online.room && online.room.status === 'finished') return;
    online.room = { ...(online.room || {}), status: 'finished', result };
    cloudSb.from('board_rooms').update({
      status: 'finished', result, updated_at: new Date().toISOString(),
    }).eq('code', online.code).then(({ error }) => {
      if (error) console.warn('[棋] 终局同步失败：', error.message);
    });
    // 上报自己的战绩
    if (online.seat && !recorded) {
      recorded = true;
      recordResult(online.kind, result === 'draw' ? 'draw' : result === online.seat ? 'win' : 'loss', 'online', String(sideOf(online.kind, online.seat)), 0, Math.floor((Date.now() - startTime) / 1000));
    }
  }

  function onlineCleanup() {
    if (online) {
      if (online.channel) cloudSb?.removeChannel(online.channel);
      if (online.poll) clearInterval(online.poll);
      online = null;
    }
    roomChip.hidden = true;
  }

  function genCode() {
    const abc = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    let s = '';
    for (let i = 0; i < 4; i++) s += abc[(Math.random() * abc.length) | 0];
    return s;
  }

  /* ================================================================
     启动器
     ================================================================ */
  const sel = store.get('ch-sel-v2', null) || {
    kind: 'chess', mode: 'ai',
    side: { chess: 'w', xiangqi: 'r', gomoku: 1, go: 1 },
    level: { chess: 2, xiangqi: 2, gomoku: 1, go: 1 },
  };
  if (!sel.side || !sel.level) { sel.side = { chess: 'w', xiangqi: 'r', gomoku: 1, go: 1 }; sel.level = { chess: 2, xiangqi: 2, gomoku: 1, go: 1 }; }

  const DIFF_CHIPS = {
    chess: [['0', '新手'], ['1', '业余'], ['2', '棋手'], ['3', '大师']],
    xiangqi: [['0', '入门'], ['1', '初级'], ['2', '中级'], ['3', '高级']],
    gomoku: [['0', '简单'], ['1', '中等'], ['2', '困难']],
    go: [['0', '简单'], ['1', '中等'], ['2', '困难']],
  };
  const diffWrap = $('#sel-diff');
  const sideWrap = $('#sel-side-wrap');
  const onlineWrap = $('#sel-online-wrap');

  function renderSel() {
    for (const b of document.querySelectorAll('#sel-kind .ch-chip')) b.classList.toggle('on', b.dataset.v === sel.kind);
    for (const b of document.querySelectorAll('#sel-mode .ch-chip')) b.classList.toggle('on', b.dataset.v === sel.mode);
    onlineWrap.hidden = sel.mode !== 'online';
    // 执子 chips（四棋都有）
    const sideDiv = $('#sel-side');
    sideDiv.textContent = '';
    for (const [v, label] of Object.entries(SIDE_LABELS[sel.kind])) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ch-chip' + (String(sel.side[sel.kind]) === v ? ' on' : '');
      b.dataset.v = v;
      b.textContent = label;
      b.addEventListener('click', () => {
        sel.side[sel.kind] = sel.kind === 'chess' || sel.kind === 'xiangqi' ? v : +v;
        store.set('ch-sel-v2', sel);
        renderSel();
      });
      sideDiv.appendChild(b);
    }
    // 难度 chips
    diffWrap.textContent = '';
    for (const [v, label] of DIFF_CHIPS[sel.kind]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ch-chip' + (String(sel.level[sel.kind]) === v ? ' on' : '');
      b.dataset.v = v;
      b.textContent = label;
      b.addEventListener('click', () => {
        sel.level[sel.kind] = +v;
        store.set('ch-sel-v2', sel);
        renderSel();
      });
      diffWrap.appendChild(b);
    }
    store.set('ch-sel-v2', sel);
  }
  for (const b of document.querySelectorAll('#sel-kind .ch-chip')) {
    b.addEventListener('click', () => { sel.kind = b.dataset.v; renderSel(); });
  }
  for (const b of document.querySelectorAll('#sel-mode .ch-chip')) {
    b.addEventListener('click', () => { sel.mode = b.dataset.v; renderSel(); });
  }

  $('#ch-start').addEventListener('click', async () => {
    if (sel.mode === 'online') { await createRoom(); return; }
    startGame(sel.kind);
  });

  // 联机房间控件
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

  /* ================================================================
     排行榜（chess_results + get_chess_leaderboard RPC）
     ================================================================ */
  const lbModal = $('#ch-lb');
  let lbTab = 'chess';
  function lbRenderTabs() {
    const tabs = $('#lb-tabs');
    tabs.textContent = '';
    for (const k of KINDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ch-chip' + (lbTab === k ? ' on' : '');
      b.textContent = KIND_LABEL[k];
      b.addEventListener('click', () => { lbTab = k; lbRenderTabs(); refreshLb(); });
      tabs.appendChild(b);
    }
  }
  async function refreshLb() {
    const body = $('#lb-body');
    const note = $('#lb-note');
    if (!body) return;
    if (!cloudSb) {
      body.innerHTML = '<p class="ch-lb-empty">云端未连接，暂时拿不到排行榜。</p>';
      if (note) note.textContent = '';
      return;
    }
    body.innerHTML = '<p class="ch-lb-empty">加载中…</p>';
    const { data, error } = await cloudSb.rpc('get_chess_leaderboard', { p_kind: lbTab });
    if (error) {
      body.innerHTML = '<p class="ch-lb-empty">排行榜暂不可用（' + (error.message || '数据库未更新') + '）。</p>';
      if (note) note.textContent = '';
      return;
    }
    if (!data || !data.length) {
      body.innerHTML = '<p class="ch-lb-empty">还没有人上榜 —— 打完一局人机或联机就能上榜。</p>';
      if (note) note.textContent = '';
      return;
    }
    const meName = myName();
    const rows = data.map((r, i) => {
      const rate = r.games > 0 ? Math.round((r.wins / r.games) * 100) : 0;
      const me = meName && r.name === meName ? ' class="me"' : '';
      return `<tr${me}><td>${i + 1}</td><td>${escapeHtml(r.name)}</td><td>${r.wins}</td><td>${r.draws}</td><td>${r.losses}</td><td>${rate}%</td></tr>`;
    }).join('');
    body.innerHTML = `<table class="ch-lb-table"><thead><tr><th>#</th><th>昵称</th><th>胜</th><th>平</th><th>负</th><th>胜率</th></tr></thead><tbody>${rows}</tbody></table>`;
    if (note) note.textContent = `按胜场排序 · ${KIND_LABEL[lbTab]}共 ${data.reduce((a, r) => a + r.games, 0)} 局`;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const lbBtn = $('#ch-lb-btn');
  if (lbBtn) lbBtn.addEventListener('click', () => { lbModal.hidden = false; lbRenderTabs(); refreshLb(); });
  const lbClose = $('#lb-close');
  if (lbClose) lbClose.addEventListener('click', () => { lbModal.hidden = true; });
  if (lbModal) lbModal.addEventListener('click', (e) => { if (e.target === lbModal) lbModal.hidden = true; });

  /* ---------- 键盘 ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (!modalEl().hidden || (lbModal && !lbModal.hidden)) {
      if (e.key === 'Escape' || e.key === 'Enter') { closeDialog(); if (lbModal) lbModal.hidden = true; }
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
    const step = { ArrowUp: -8, ArrowDown: 8, ArrowLeft: -1, ArrowRight: 1 };
    if (e.key in step) {
      e.preventDefault();
      if (GC.selected < 0) { chessOnSquare(flipped ? 63 : 56); return; }
      const curDisp = chessSqToDisp(GC.selected);
      const nextDisp = curDisp + step[e.key];
      if (nextDisp < 0 || nextDisp > 63) return;
      if ((step[e.key] === -1 || step[e.key] === 1) && (nextDisp >> 3) !== (curDisp >> 3)) return;
      chessOnSquare(nextDisp);
    } else if (e.key === 'Enter' && GC.selected >= 0) {
      e.preventDefault();
      chessOnSquare(chessSqToDisp(GC.selected));
    } else if (e.key === 'Escape') {
      if (document.fullscreenElement || document.webkitFullscreenElement) return;
      $('#ch-exit').click();
    }
  });

  /* ---------- 启动 ---------- */
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
  renderSel();
  initCloud();
})();
