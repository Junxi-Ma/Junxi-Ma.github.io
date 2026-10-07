/* ============================================================
   engine.js — 国际象棋：规则 + AI
   规则权威：vendor/chess.js（MIT，chessjs.org）——易位、吃过路兵、
             升变、将杀、逼和、五十回合、三次重复、子力不足全部由它判定，
             不再自研规则（历史教训：自研易位在 UI 层漏了「王吃到车」手势）。
   AI 主力：vendor/stockfish.wasm.js（Web Worker，GPLv3，niklasf/stockfish.js
             10.0.2 多变体构建）——四档难度 = Skill Level + 深度/时限组合。
   AI 兜底：本文件内置的 negamax + α-β + 静态搜索（Worker 加载失败时降级）。
   坐标：内部兜底引擎 sq 0 = a8，7 = h8，56 = a1，63 = h1。
   ============================================================ */
import { Chess } from './vendor/chess.js?v=21';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/* 棋子字形：加 U+FE0E 强制文本呈现（避免部分平台渲染成彩色 emoji） */
export const GLYPHS = {
  w: { k: '\u2654', q: '\u2655', r: '\u2656', b: '\u2657', n: '\u2658', p: '\u2659' },
  b: { k: '\u265A', q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F' },
};
export const pieceGlyph = (p) => GLYPHS[p.c][p.t] + '\uFE0E';

/* ---------- 对局包装：chess.js 的薄壳，供 UI 使用 ---------- */
export class ChessGame {
  constructor() { this.g = new Chess(); }

  /* 载入局面（联机同步用），非法 FEN 返回 false 且保持原局面 */
  load(fen) {
    try { return this.g.load(fen); } catch { return false; }
  }

  /* 某格的合法走法（verbose）。sq 为代数坐标如 'e2' */
  movesAt(sq) { return this.g.moves({ square: sq, verbose: true }); }

  /* 全部合法走法（verbose） */
  movesAll() { return this.g.moves({ verbose: true }); }

  /* 应用走法，非法返回 null（chess.js 严格模式下抛错，这里转成 null） */
  apply(from, to, promotion) {
    try { return this.g.move({ from, to, promotion: promotion || undefined }); }
    catch { return null; }
  }

  undo() { return this.g.undo(); }

  fen() { return this.g.fen(); }
  turn() { return this.g.turn(); }
  inCheck() { return this.g.inCheck(); }
  /* 64 数组（0=a8 … 63=h1）：{t, c} 或 null，渲染直接用 */
  boardArray() {
    const rows = this.g.board();
    const out = new Array(64).fill(null);
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const p = rows[r][c];
        out[r * 8 + c] = p ? { t: p.type, c: p.color } : null;
      }
    return out;
  }
  /* 王的位置（sq 索引），找不到返回 -1 */
  kingSq(color) {
    const rows = this.g.board();
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const p = rows[r][c];
        if (p && p.type === 'k' && p.color === color) return r * 8 + c;
      }
    return -1;
  }
  /* 上一手（{from, to} 索引）或 null */
  lastMove() {
    const h = this.g.history({ verbose: true });
    if (!h.length) return null;
    const m = h[h.length - 1];
    return { from: algToSq(m.from), to: algToSq(m.to) };
  }
  sanHistory() { return this.g.history(); }
  moveCount() { return this.g.history().length; }

  /* 被吃子统计：{ w: {p,n,b,r,q}, b: {...} }（各色损失的子） */
  captured() {
    const start = { p: 8, n: 2, b: 2, r: 2, q: 1 };
    const cnt = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
    for (const row of this.g.board())
      for (const p of row) if (p && p.type !== 'k') cnt[p.color][p.type]++;
    for (const c of ['w', 'b'])
      for (const t of ['p', 'n', 'b', 'r', 'q']) cnt[c][t] = Math.max(0, start[t] - cnt[c][t]);
    return cnt;
  }

  /* 终局判定：{ over, reason, winner }。reason: checkmate|stalemate|fifty|repetition|material */
  status() {
    const g = this.g;
    if (!g.isGameOver()) return { over: false, reason: '', winner: null };
    if (g.isCheckmate()) return { over: true, reason: 'checkmate', winner: g.turn() === 'w' ? 'b' : 'w' };
    if (g.isStalemate()) return { over: true, reason: 'stalemate', winner: null };
    if (g.isThreefoldRepetition()) return { over: true, reason: 'repetition', winner: null };
    if (g.isInsufficientMaterial()) return { over: true, reason: 'material', winner: null };
    return { over: true, reason: 'fifty', winner: null };
  }
}

export const sqToAlg = (sq) => String.fromCharCode(97 + (sq & 7)) + (8 - (sq >> 3));
export const algToSq = (alg) => (alg.charCodeAt(0) - 97) + (8 - +alg[1]) * 8;

/* ============================================================
   Stockfish Worker（懒加载 + 失败自动降级 asm.js，再失败走内置兜底）
   ============================================================ */
const SF_SOURCES = ['./vendor/stockfish.wasm.js?v=21', './vendor/stockfish-asm.js?v=21'];
let sfWorker = null;
let sfInitPromise = null;

function ensureStockfish() {
  if (sfInitPromise) return sfInitPromise;
  sfInitPromise = new Promise((resolve) => {
    const tryLoad = (i) => {
      if (i >= SF_SOURCES.length) { resolve(null); return; }
      let worker = null;
      try {
        worker = new Worker(new URL(SF_SOURCES[i], import.meta.url));
      } catch { tryLoad(i + 1); return; }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { worker.terminate(); } catch { /* 忽略 */ }
        tryLoad(i + 1);
      }, 8000);
      worker.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        tryLoad(i + 1);
      };
      worker.onmessage = (e) => {
        if (String(e.data) === 'uciok' && !settled) {
          settled = true;
          clearTimeout(timer);
          sfWorker = worker;
          resolve(worker);
        }
      };
      worker.postMessage('uci');
    };
    tryLoad(0);
  });
  return sfInitPromise;
}

/* 一次只发一个 go（对局天然串行），等待 bestmove */
function sfBestMove(fen, { skill, depth, movetime }) {
  return new Promise((resolve) => {
    const w = sfWorker;
    if (!w) { resolve(null); return; }
    const onMsg = (e) => {
      const line = String(e.data);
      if (line.startsWith('bestmove')) {
        w.removeEventListener('message', onMsg);
        const uci = line.split(/\s+/)[1] || '';
        resolve(uci && uci !== '(none)' ? uci : null);
      }
    };
    w.addEventListener('message', onMsg);
    w.postMessage('setoption name Skill Level value ' + skill);
    w.postMessage('position fen ' + fen);
    w.postMessage('go depth ' + depth + ' movetime ' + movetime);
  });
}

const uciToMove = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });

/* ---------- 四档难度（Skill Level 0~20 + 深度/时限；fb = 内置兜底参数） ---------- */
export const CHESS_LEVELS = [
  { label: '新手', sf: { skill: 0, depth: 1, movetime: 300 }, fb: { maxDepth: 1, timeMs: 200, skill: 0 } },
  { label: '业余', sf: { skill: 3, depth: 4, movetime: 600 }, fb: { maxDepth: 2, timeMs: 400, skill: 1 } },
  { label: '棋手', sf: { skill: 10, depth: 11, movetime: 1200 }, fb: { maxDepth: 4, timeMs: 900, skill: 2 } },
  { label: '大师', sf: { skill: 20, depth: 24, movetime: 2500 }, fb: { maxDepth: 6, timeMs: 2500, skill: 3 } },
];

/* AI 走子入口：优先 Stockfish，失败降级内置搜索。返回 {from,to,promotion}（代数坐标） */
export async function chessAiMove(fen, level) {
  const cfg = CHESS_LEVELS[level] || CHESS_LEVELS[2];
  await ensureStockfish();
  if (sfWorker) {
    const uci = await sfBestMove(fen, cfg.sf);
    if (uci) return uciToMove(uci);
  }
  const st = parseFEN(fen);
  const best = findBestMove(st, cfg.fb);
  if (!best) return null;
  return { from: sqToAlg(best.from), to: sqToAlg(best.to), promotion: best.promo || undefined };
}

/* ============================================================
   内置兜底引擎（negamax + α-β + 静态搜索 + 迭代加深）
   规则实现曾按 perft(1/2/3) = 20/400/8902 校验，仅用于 Worker 不可用时的降级。
   ============================================================ */
export function parseFEN(fen) {
  const [pos, turn, cast, ep, half, full] = fen.trim().split(/\s+/);
  const board = new Array(64).fill(null);
  let i = 0;
  for (const ch of pos) {
    if (ch === '/') continue;
    if (ch >= '1' && ch <= '8') { i += +ch; continue; }
    const c = ch === ch.toUpperCase() ? 'w' : 'b';
    board[i++] = { t: ch.toLowerCase(), c };
  }
  return {
    board,
    turn,
    castling: { K: cast.includes('K'), Q: cast.includes('Q'), k: cast.includes('k'), q: cast.includes('q') },
    ep: ep && ep !== '-' ? (ep.charCodeAt(0) - 97) + (8 - +ep[1]) * 8 : -1,
    half: +(half || 0),
    full: +(full || 1),
  };
}

const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function onBoard(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

function isAttacked(st, r, c, by) {
  const bd = st.board;
  const pd = by === 'w' ? 1 : -1;
  for (const dc of [-1, 1]) {
    const rr = r + pd, cc = c + dc;
    if (onBoard(rr, cc)) {
      const p = bd[rr * 8 + cc];
      if (p && p.c === by && p.t === 'p') return true;
    }
  }
  for (const [dr, dc] of KN) {
    const rr = r + dr, cc = c + dc;
    if (onBoard(rr, cc)) {
      const p = bd[rr * 8 + cc];
      if (p && p.c === by && p.t === 'n') return true;
    }
  }
  for (const [dr, dc] of KG) {
    const rr = r + dr, cc = c + dc;
    if (onBoard(rr, cc)) {
      const p = bd[rr * 8 + cc];
      if (p && p.c === by && p.t === 'k') return true;
    }
  }
  for (const [dr, dc] of DIAG) {
    let rr = r + dr, cc = c + dc;
    while (onBoard(rr, cc)) {
      const p = bd[rr * 8 + cc];
      if (p) {
        if (p.c === by && (p.t === 'b' || p.t === 'q')) return true;
        break;
      }
      rr += dr; cc += dc;
    }
  }
  for (const [dr, dc] of ORTH) {
    let rr = r + dr, cc = c + dc;
    while (onBoard(rr, cc)) {
      const p = bd[rr * 8 + cc];
      if (p) {
        if (p.c === by && (p.t === 'r' || p.t === 'q')) return true;
        break;
      }
      rr += dr; cc += dc;
    }
  }
  return false;
}

export function kingSq(st, color) {
  for (let i = 0; i < 64; i++) {
    const p = st.board[i];
    if (p && p.t === 'k' && p.c === color) return i;
  }
  return -1;
}
export function inCheck(st, color) {
  const k = kingSq(st, color);
  return k >= 0 && isAttacked(st, k >> 3, k & 7, color === 'w' ? 'b' : 'w');
}

function pushPawn(st, from, r, c, out) {
  const p = st.board[from];
  const dir = p.c === 'w' ? -1 : 1;
  const startR = p.c === 'w' ? 6 : 1;
  const promoR = p.c === 'w' ? 0 : 7;
  const r1 = r + dir;
  if (onBoard(r1, c) && !st.board[r1 * 8 + c]) {
    if (r1 === promoR) {
      for (const promo of ['q', 'r', 'b', 'n']) out.push({ from, to: r1 * 8 + c, t: 'p', c: p.c, captured: null, promo, flag: '' });
    } else {
      out.push({ from, to: r1 * 8 + c, t: 'p', c: p.c, captured: null, promo: null, flag: '' });
      if (r === startR && !st.board[(r + 2 * dir) * 8 + c])
        out.push({ from, to: (r + 2 * dir) * 8 + c, t: 'p', c: p.c, captured: null, promo: null, flag: 'double' });
    }
  }
  for (const dc of [-1, 1]) {
    const cc = c + dc;
    if (!onBoard(r1, cc)) continue;
    const to = r1 * 8 + cc;
    const victim = st.board[to];
    if (victim && victim.c !== p.c) {
      if (r1 === promoR) {
        for (const promo of ['q', 'r', 'b', 'n']) out.push({ from, to, t: 'p', c: p.c, captured: victim, promo, flag: '' });
      } else out.push({ from, to, t: 'p', c: p.c, captured: victim, promo: null, flag: '' });
    } else if (!victim && to === st.ep) {
      out.push({ from, to, t: 'p', c: p.c, captured: { t: 'p', c: p.c === 'w' ? 'b' : 'w' }, promo: null, flag: 'ep' });
    }
  }
}

function genPseudo(st) {
  const out = [];
  const bd = st.board;
  const me = st.turn;
  for (let from = 0; from < 64; from++) {
    const p = bd[from];
    if (!p || p.c !== me) continue;
    const r = from >> 3, c = from & 7;
    if (p.t === 'p') { pushPawn(st, from, r, c, out); continue; }
    if (p.t === 'n' || p.t === 'k') {
      for (const [dr, dc] of (p.t === 'n' ? KN : KG)) {
        const rr = r + dr, cc = c + dc;
        if (!onBoard(rr, cc)) continue;
        const to = rr * 8 + cc, v = bd[to];
        if (!v || v.c !== me) out.push({ from, to, t: p.t, c: me, captured: v || null, promo: null, flag: '' });
      }
      if (p.t === 'k') {
        const home = me === 'w' ? 60 : 4;
        if (from === home && !isAttacked(st, r, c, me === 'w' ? 'b' : 'w')) {
          const kRight = me === 'w' ? st.castling.K : st.castling.k;
          const qRight = me === 'w' ? st.castling.Q : st.castling.q;
          const rK = me === 'w' ? 63 : 7, rQ = me === 'w' ? 56 : 0;
          const enemy = me === 'w' ? 'b' : 'w';
          if (kRight && bd[rK] && bd[rK].t === 'r' && bd[rK].c === me &&
              !bd[home + 1] && !bd[home + 2] &&
              !isAttacked(st, r, c + 1, enemy) && !isAttacked(st, r, c + 2, enemy))
            out.push({ from, to: home + 2, t: 'k', c: me, captured: null, promo: null, flag: 'castleK' });
          if (qRight && bd[rQ] && bd[rQ].t === 'r' && bd[rQ].c === me &&
              !bd[home - 1] && !bd[home - 2] && !bd[home - 3] &&
              !isAttacked(st, r, c - 1, enemy) && !isAttacked(st, r, c - 2, enemy))
            out.push({ from, to: home - 2, t: 'k', c: me, captured: null, promo: null, flag: 'castleQ' });
        }
      }
      continue;
    }
    const dirs = p.t === 'b' ? DIAG : p.t === 'r' ? ORTH : [...DIAG, ...ORTH];
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (onBoard(rr, cc)) {
        const to = rr * 8 + cc, v = bd[to];
        if (!v) out.push({ from, to, t: p.t, c: me, captured: null, promo: null, flag: '' });
        else {
          if (v.c !== me) out.push({ from, to, t: p.t, c: me, captured: v, promo: null, flag: '' });
          break;
        }
        rr += dr; cc += dc;
      }
    }
  }
  return out;
}

function makeMove(st, m) {
  const undo = {
    captured: null, ep: st.ep, half: st.half, full: st.full,
    castling: { ...st.castling },
  };
  const bd = st.board;
  bd[m.from] = null;
  if (m.flag === 'ep') {
    const capSq = m.to + (m.c === 'w' ? 8 : -8);
    undo.captured = bd[capSq];
    bd[capSq] = null;
  } else if (m.captured) {
    undo.captured = bd[m.to];
  }
  bd[m.to] = { t: m.promo || m.t, c: m.c };
  if (m.flag === 'castleK') {
    bd[m.to - 1] = bd[m.to + 1]; bd[m.to + 1] = null;
  } else if (m.flag === 'castleQ') {
    bd[m.to + 1] = bd[m.to - 2]; bd[m.to - 2] = null;
  }
  if (m.t === 'k') {
    if (m.c === 'w') { st.castling.K = false; st.castling.Q = false; }
    else { st.castling.k = false; st.castling.q = false; }
  }
  if (m.from === 63 || m.to === 63) st.castling.K = false;
  if (m.from === 56 || m.to === 56) st.castling.Q = false;
  if (m.from === 7 || m.to === 7) st.castling.k = false;
  if (m.from === 0 || m.to === 0) st.castling.q = false;
  st.ep = m.flag === 'double' ? (m.from + m.to) / 2 : -1;
  st.half = (m.t === 'p' || m.captured) ? 0 : st.half + 1;
  if (st.turn === 'b') st.full++;
  st.turn = st.turn === 'w' ? 'b' : 'w';
  return undo;
}

function unmakeMove(st, m, undo) {
  const bd = st.board;
  bd[m.from] = { t: m.t, c: m.c };
  bd[m.to] = null;
  if (m.flag === 'ep') {
    bd[m.to + (m.c === 'w' ? 8 : -8)] = undo.captured;
  } else if (undo.captured) {
    bd[m.to] = undo.captured;
  }
  if (m.flag === 'castleK') { bd[m.to + 1] = bd[m.to - 1]; bd[m.to - 1] = null; }
  if (m.flag === 'castleQ') { bd[m.to - 2] = bd[m.to + 1]; bd[m.to + 1] = null; }
  st.castling = undo.castling;
  st.ep = undo.ep;
  st.half = undo.half;
  st.full = undo.full;
  st.turn = st.turn === 'w' ? 'b' : 'w';
}

function genLegal(st) {
  const out = [];
  for (const m of genPseudo(st)) {
    const undo = makeMove(st, m);
    if (!inCheck(st, m.c)) out.push(m);
    unmakeMove(st, m, undo);
  }
  return out;
}

const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const PST = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};
const PST_END_K = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];

function evaluate(st) {
  let score = 0, heavy = 0;
  const bd = st.board;
  for (let i = 0; i < 64; i++) {
    const p = bd[i];
    if (!p) continue;
    if (p.t === 'p' || p.t === 'r' || p.t === 'q') heavy++;
    const r = i >> 3, c = i & 7;
    const idx = p.c === 'w' ? i : (7 - r) * 8 + c;
    const pst = p.t === 'k' ? 0 : PST[p.t][idx];
    const v = VAL[p.t] + pst;
    score += p.c === 'w' ? v : -v;
  }
  if (heavy <= 6) {
    for (const color of ['w', 'b']) {
      const k = kingSq(st, color);
      if (k < 0) continue;
      const r = k >> 3, c = k & 7;
      const idx = color === 'w' ? k : (7 - r) * 8 + c;
      const v = PST_END_K[idx] - PST.k[idx];
      score += color === 'w' ? v : -v;
    }
  }
  return st.turn === 'w' ? score : -score;
}

function orderMoves(st, moves) {
  for (const m of moves) {
    m.score = 0;
    if (m.captured) m.score += 10 * VAL[m.captured.t] - VAL[m.t];
    if (m.promo) m.score += VAL[m.promo];
  }
  moves.sort((a, b) => b.score - a.score);
  return moves;
}

function quiescence(st, alpha, beta, depth) {
  const stand = evaluate(st);
  if (depth === 0) return stand;
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  const caps = genPseudo(st).filter((m) => m.captured || m.promo);
  orderMoves(st, caps);
  for (const m of caps) {
    const undo = makeMove(st, m);
    if (inCheck(st, m.c)) { unmakeMove(st, m, undo); continue; }
    const v = -quiescence(st, -beta, -alpha, depth - 1);
    unmakeMove(st, m, undo);
    if (v >= beta) return beta;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

function negamax(st, depth, alpha, beta, ctx) {
  ctx.nodes++;
  if ((ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) { ctx.stop = true; return alpha; }
  if (depth === 0) return quiescence(st, alpha, beta, 8);
  const moves = orderMoves(st, genPseudo(st));
  let legalCount = 0, best = -Infinity;
  for (const m of moves) {
    const undo = makeMove(st, m);
    if (inCheck(st, m.c)) { unmakeMove(st, m, undo); continue; }
    legalCount++;
    const v = -negamax(st, depth - 1, -beta, -alpha, ctx);
    unmakeMove(st, m, undo);
    if (ctx.stop) return alpha;
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  if (!legalCount) return inCheck(st, st.turn) ? -100000 + (ctx.rootDepth - depth) : 0;
  return best;
}

function findBestMove(state, { maxDepth = 3, timeMs = 800, skill = 3 } = {}) {
  const st = cloneState(state);
  const ctx = { nodes: 0, deadline: Date.now() + timeMs, stop: false, rootDepth: maxDepth };
  const rootMoves = orderMoves(st, genLegal(st));
  if (!rootMoves.length) return null;
  let bestMove = rootMoves[0];
  for (let depth = 1; depth <= maxDepth; depth++) {
    ctx.rootDepth = depth;
    let alpha = -Infinity, best = null;
    const scored = [];
    for (const m of rootMoves) {
      const undo = makeMove(st, m);
      const v = -negamax(st, depth - 1, -Infinity, alpha === -Infinity ? Infinity : -alpha + 1, ctx);
      unmakeMove(st, m, undo);
      if (ctx.stop) break;
      scored.push({ m, v });
      if (v > alpha) { alpha = v; best = m; }
    }
    if (best && (!ctx.stop || scored.length === rootMoves.length)) bestMove = best;
    if (ctx.stop) break;
    rootMoves.sort((a, b) => {
      const sa = scored.find((x) => x.m === a)?.v ?? -Infinity;
      const sb = scored.find((x) => x.m === b)?.v ?? -Infinity;
      return sb - sa;
    });
    if (Math.abs(alpha) > 90000) break;
  }
  if (skill === 0 && Math.random() < 0.5) {
    const pool = rootMoves.slice(0, Math.min(rootMoves.length, 6));
    return pool[(Math.random() * pool.length) | 0];
  }
  if (skill === 1 && Math.random() < 0.25) {
    const pool = rootMoves.slice(0, Math.min(rootMoves.length, 4));
    return pool[(Math.random() * pool.length) | 0];
  }
  return bestMove;
}

function cloneState(st) {
  return {
    board: st.board.map((p) => (p ? { ...p } : null)),
    turn: st.turn,
    castling: { ...st.castling },
    ep: st.ep,
    half: st.half,
    full: st.full,
  };
}
