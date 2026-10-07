/* ============================================================
   xiangqi.js — 中国象棋规则 + AI
   棋盘 9×10，index = r*9+c；r0 = 黑方底线（上），r9 = 红方底线（下）。
   side: 'r' 红（先行）| 'b' 黑。
   规则：宫内行走、士斜象眼塞、马蹩腿、炮翻山、兵过河横行、将帅对脸、
         困毙判负、60 回合无吃子判和（自然限着）。
   合法性判定：makeMove/unmakeMove 原地往返（旧实现每步克隆全盘，慢一个量级）。
   AI：negamax + α-β + Zobrist 置换表 + 迭代加深 + 吃子静态搜索
       + 杀手走法/历史启发 + 分兵种位置表评估。四档难度。
   ============================================================ */

export const ROWS = 10, COLS = 9;
const onB = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 9;
const inPalace = (r, c, side) => c >= 3 && c <= 5 && r >= 0 && r <= 9 && (side === 'r' ? r >= 7 : r <= 2);

export function initState() {
  const bd = new Array(90).fill(null);
  const back = ['r', 'n', 'b', 'a', 'k', 'a', 'b', 'n', 'r'];
  for (let c = 0; c < 9; c++) {
    bd[c] = { t: back[c], c: 'b' };
    bd[81 + c] = { t: back[c], c: 'r' };
  }
  bd[19] = { t: 'c', c: 'b' }; bd[25] = { t: 'c', c: 'b' };
  bd[64] = { t: 'c', c: 'r' }; bd[70] = { t: 'c', c: 'r' };
  for (let c = 0; c < 9; c += 2) {
    bd[27 + c] = { t: 'p', c: 'b' };
    bd[54 + c] = { t: 'p', c: 'r' };
  }
  return { bd, turn: 'r', half: 0 };
}

export function cloneState(st) {
  return { bd: st.bd.map((p) => (p ? { ...p } : null)), turn: st.turn, half: st.half || 0 };
}

/* 走子 = { from, to, captured, c }。half（无吃子半回合数）记录在 m.preHalf 以便撤销还原 */
export function makeMove(st, m) {
  const piece = st.bd[m.from];
  const captured = st.bd[m.to];
  m.preHalf = st.half || 0;
  st.bd[m.from] = null;
  st.bd[m.to] = { t: piece.t, c: piece.c };
  st.turn = st.turn === 'r' ? 'b' : 'r';
  st.half = captured ? 0 : (st.half || 0) + 1;
  return captured;
}
export function unmakeMove(st, m, captured) {
  st.bd[m.from] = { t: st.bd[m.to].t, c: st.bd[m.to].c };
  st.bd[m.to] = captured;
  st.turn = st.turn === 'r' ? 'b' : 'r';
  st.half = m.preHalf ?? 0;
}

function kingSq(bd, side) {
  for (let i = 0; i < 90; i++) {
    const p = bd[i];
    if (p && p.t === 'k' && p.c === side) return i;
  }
  return -1;
}

export function kingsFacing(bd) {
  const krSq = kingSq(bd, 'r'), kbSq = kingSq(bd, 'b');
  if (krSq < 0 || kbSq < 0) return false;
  if (krSq % 9 !== kbSq % 9) return false;
  const c = krSq % 9;
  const rMin = Math.min(krSq, kbSq) / 9 | 0, rMax = Math.max(krSq, kbSq) / 9 | 0;
  for (let r = rMin + 1; r < rMax; r++)
    if (bd[r * 9 + c]) return false;
  return true;
}

/* (r,c) 是否被 side 的马攻击（马腿未蹩）——马腿以马的位置取长轴相邻格 */
function horseAttacks(bd, r, c, side) {
  const L = [[-2, -1, 1, -1], [-2, 1, 1, 1], [2, -1, -1, -1], [2, 1, -1, 1], [-1, -2, -1, 1], [1, -2, 1, 1], [-1, 2, -1, -1], [1, 2, 1, -1]];
  for (const [hr, hc, lr, lc] of L) {
    const rr = r + hr, cc = c + hc;
    if (!onB(rr, cc)) continue;
    const p = bd[rr * 9 + cc];
    if (p && p.c === side && p.t === 'n' && !bd[(r + lr) * 9 + (c + lc)]) return true;
  }
  return false;
}

export function inCheck(st, side) {
  const bd = st.bd;
  const k = kingSq(bd, side);
  if (k < 0) return true;
  const enemy = side === 'r' ? 'b' : 'r';
  const kr = (k / 9) | 0, kc = k % 9;
  // 车 / 炮（同线扫描：第一个子是车或将→将；隔一子是炮→将）
  for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let rr = kr + dr, cc = kc + dc, screen = false;
    while (onB(rr, cc)) {
      const p = bd[rr * 9 + cc];
      if (p) {
        if (p.c === enemy) {
          if (!screen && (p.t === 'r' || p.t === 'k')) return true;
          if (screen && p.t === 'c') return true;
        }
        if (!screen) screen = true;
        else break;
      }
      rr += dr; cc += dc;
    }
  }
  if (horseAttacks(bd, kr, kc, enemy)) return true;
  // 兵：正前方与（过河后）两侧
  const pAt = (r, c) => {
    if (!onB(r, c)) return false;
    const p = bd[r * 9 + c];
    return p && p.c === enemy && p.t === 'p';
  };
  if (side === 'r') {
    if (pAt(kr - 1, kc)) return true;
    if (kr >= 5 && (pAt(kr, kc - 1) || pAt(kr, kc + 1))) return true;
  } else {
    if (pAt(kr + 1, kc)) return true;
    if (kr <= 4 && (pAt(kr, kc - 1) || pAt(kr, kc + 1))) return true;
  }
  // 将帅对脸视同被将
  if (kingsFacing(bd)) return true;
  return false;
}

export function genPseudo(st) {
  const out = [];
  const bd = st.bd, me = st.turn;
  const push = (from, rr, cc) => {
    const v = bd[rr * 9 + cc];
    if (!v || v.c !== me) out.push({ from, to: rr * 9 + cc, captured: v || null, c: me });
  };
  for (let from = 0; from < 90; from++) {
    const p = bd[from];
    if (!p || p.c !== me) continue;
    const r = (from / 9) | 0, c = from % 9;
    switch (p.t) {
      case 'k':
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const rr = r + dr, cc = c + dc;
          if (inPalace(rr, cc, me)) push(from, rr, cc);
        }
        break;
      case 'a':
        for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const rr = r + dr, cc = c + dc;
          if (inPalace(rr, cc, me)) push(from, rr, cc);
        }
        break;
      case 'b':
        for (const [dr, dc] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
          const rr = r + dr, cc = c + dc;
          if (!onB(rr, cc)) continue;
          if (me === 'r' && rr < 5) continue;
          if (me === 'b' && rr > 4) continue;
          if (bd[((r + dr / 2) | 0) * 9 + ((c + dc / 2) | 0)]) continue;
          push(from, rr, cc);
        }
        break;
      case 'n': {
        const L = [[-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0], [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1]];
        for (const [dr, dc, lr, lc] of L) {
          const rr = r + dr, cc = c + dc;
          if (!onB(rr, cc)) continue;
          if (bd[(r + lr) * 9 + (c + lc)]) continue;
          push(from, rr, cc);
        }
        break;
      }
      case 'r':
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          let rr = r + dr, cc = c + dc;
          while (onB(rr, cc)) {
            const v = bd[rr * 9 + cc];
            if (!v) { out.push({ from, to: rr * 9 + cc, captured: null, c: me }); }
            else { if (v.c !== me) out.push({ from, to: rr * 9 + cc, captured: v, c: me }); break; }
            rr += dr; cc += dc;
          }
        }
        break;
      case 'c':
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          let rr = r + dr, cc = c + dc, jumped = false;
          while (onB(rr, cc)) {
            const v = bd[rr * 9 + cc];
            if (!jumped) {
              if (!v) out.push({ from, to: rr * 9 + cc, captured: null, c: me });
              else jumped = true;
            } else if (v) {
              if (v.c !== me) out.push({ from, to: rr * 9 + cc, captured: v, c: me });
              break;
            }
            rr += dr; cc += dc;
          }
        }
        break;
      case 'p': {
        const fwd = me === 'r' ? -1 : 1;
        if (onB(r + fwd, c)) push(from, r + fwd, c);
        const crossed = me === 'r' ? r <= 4 : r >= 5;
        if (crossed) {
          if (onB(r, c - 1)) push(from, r, c - 1);
          if (onB(r, c + 1)) push(from, r, c + 1);
        }
        break;
      }
    }
  }
  return out;
}

export function genLegal(st) {
  const out = [];
  for (const m of genPseudo(st)) {
    const cap = makeMove(st, m);
    if (!inCheck(st, m.c)) out.push(m);
    unmakeMove(st, m, cap);
  }
  return out;
}

export function gameStatus(st, opts) {
  if (genLegal(st).length === 0) {
    // 无合法着法即负（被将杀或困毙，两者在中国象棋里都判负）
    return { over: true, winner: st.turn === 'r' ? 'b' : 'r', reason: 'no-moves' };
  }
  // 60 回合（120 半回合）无吃子：自然限着，判和
  if ((st.half || 0) >= 120) {
    return { over: true, winner: null, reason: 'natural' };
  }
  // 三次重复局面按和棋处理
  if (opts && opts.repetition >= 3) {
    return { over: true, winner: null, reason: 'repetition' };
  }
  return { over: false, winner: null };
}

/* 局面指纹：只含子力布置与轮走方（中国象棋无易位/过路兵） */
export function positionKey(st) {
  let s = '';
  for (let i = 0; i < 90; i++) {
    const p = st.bd[i];
    s += p ? (p.c === 'r' ? p.t.toUpperCase() : p.t) : '.';
  }
  return s + '|' + st.turn;
}

/* ============================================================
   AI
   ============================================================ */
const VAL = { k: 6000, r: 600, c: 285, n: 270, b: 120, a: 120, p: 30 };
const MATE = 100000;

/* 分兵种位置表（红方视角；r0 = 对方底线在上。黑方取 r → 9-r 镜像） */
const PST = {
  p: [
      9,  9,  9, 11, 13, 11,  9,  9,  9,
     19, 24, 34, 42, 44, 42, 34, 24, 19,
     19, 24, 32, 37, 37, 37, 32, 24, 19,
     19, 23, 27, 29, 30, 29, 27, 23, 19,
     14, 18, 20, 27, 29, 27, 20, 18, 14,
      7,  0, 13,  0, 16,  0, 13,  0,  7,
      7,  0,  7,  0, 15,  0,  7,  0,  7,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
  ],
  n: [
      4,  8, 16, 12,  4, 12, 16,  8,  4,
      4, 10, 28, 16,  8, 16, 28, 10,  4,
     12, 14, 16, 20, 18, 20, 16, 14, 12,
      8, 24, 18, 24, 20, 24, 18, 24,  8,
      6, 16, 14, 18, 16, 18, 14, 16,  6,
      4, 12, 16, 14, 12, 14, 16, 12,  4,
      2,  6,  8,  6, 10,  6,  8,  6,  2,
      4,  2,  8,  8,  4,  8,  8,  2,  4,
      0,  2,  4,  4, -2,  4,  4,  2,  0,
      0, -4,  0,  0,  0,  0,  0, -4,  0,
  ],
  r: [
     14, 14, 12, 18, 16, 18, 12, 14, 14,
     16, 20, 18, 24, 26, 24, 18, 20, 16,
     12, 12, 12, 18, 18, 18, 12, 12, 12,
     12, 18, 16, 22, 22, 22, 16, 18, 12,
     12, 14, 12, 18, 18, 18, 12, 14, 12,
     12, 16, 14, 20, 20, 20, 14, 16, 12,
      6, 10,  8, 14, 14, 14,  8, 10,  6,
      4,  8,  6, 14, 12, 14,  6,  8,  4,
      8,  4,  8, 16,  8, 16,  8,  4,  8,
     -2, 10,  6, 14, 12, 14,  6, 10, -2,
  ],
  c: [
      6,  4,  0, -10, -12, -10,  0,  4,  6,
      2,  2,  0,  -4, -14,  -4,  0,  2,  2,
      2,  2,  0, -10,  -8, -10,  0,  2,  2,
      0,  0, -2,   4,  10,   4, -2,  0,  0,
      0,  0,  0,   2,   8,   2,  0,  0,  0,
     -2,  0,  4,   2,   6,   2,  4,  0, -2,
      0,  0,  0,   2,   4,   2,  0,  0,  0,
      4,  0,  8,   6,  10,   6,  8,  0,  4,
      0,  2,  4,   6,   6,   6,  4,  2,  0,
      0,  0,  2,   6,   6,   6,  2,  0,  0,
  ],
  a: [
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0,  3,  0,  3,  0,  0,  0,
      0,  0,  0,  0, 10,  0,  0,  0,  0,
      0,  0,  0,  5,  0,  5,  0,  0,  0,
  ],
  b: [
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0, 18,  0,  0,  0, 18,  0,  0,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
     18,  0,  0,  0, 20,  0,  0,  0, 18,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  6,  0,  0,  0,  6,  0,  0,
  ],
  k: [
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0, -8, -9, -8,  0,  0,  0,
      0,  0,  0,  1,  5,  1,  0,  0,  0,
      0,  0,  0,  8, 10,  8,  0,  0,  0,
  ],
};

function evaluate(st) {
  let s = 0;
  const bd = st.bd;
  for (let i = 0; i < 90; i++) {
    const p = bd[i];
    if (!p) continue;
    const r = (i / 9) | 0, c = i % 9;
    const v = VAL[p.t] + (p.c === 'r' ? PST[p.t][i] : PST[p.t][(9 - r) * 9 + c]);
    s += p.c === 'r' ? v : -v;
  }
  return st.turn === 'r' ? s : -s;
}

/* ---------- Zobrist 哈希（双 32 位：h1 作键，h2 作校验锁） + 置换表 ---------- */
const TYPE_IDX = { k: 0, a: 1, b: 2, n: 3, r: 4, c: 5, p: 6 };
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0);
  };
}
const ZOB_A = new Int32Array(90 * 14);
const ZOB_B = new Int32Array(90 * 14);
{
  const ra = mulberry32(0x9E3779B9), rb = mulberry32(0x85EBCA6B);
  for (let i = 0; i < ZOB_A.length; i++) { ZOB_A[i] = ra() | 0; ZOB_B[i] = rb() | 0; }
}
const TURN_A = mulberry32(0xC2B2AE35)() | 0, TURN_B = mulberry32(0x27D4EB2F)() | 0;
const pieceKeyA = (p, sq) => ZOB_A[sq * 14 + (p.c === 'r' ? 0 : 7) + TYPE_IDX[p.t]];
const pieceKeyB = (p, sq) => ZOB_B[sq * 14 + (p.c === 'r' ? 0 : 7) + TYPE_IDX[p.t]];

function hashState(st) {
  let h1 = 0, h2 = 0;
  for (let i = 0; i < 90; i++) {
    const p = st.bd[i];
    if (p) { h1 ^= pieceKeyA(p, i); h2 ^= pieceKeyB(p, i); }
  }
  if (st.turn === 'b') { h1 ^= TURN_A; h2 ^= TURN_B; }
  return [h1 | 0, h2 | 0];
}

/* 走子增量哈希：在搜索内部包装 make/unmake。moving 为走完后的目标格棋子 */
function hashMove(h1, h2, m, moving, captured) {
  h1 ^= pieceKeyA(moving, m.from) ^ pieceKeyA(moving, m.to);
  h2 ^= pieceKeyB(moving, m.from) ^ pieceKeyB(moving, m.to);
  if (captured) { h1 ^= pieceKeyA(captured, m.to); h2 ^= pieceKeyB(captured, m.to); }
  h1 ^= TURN_A; h2 ^= TURN_B;
  return [h1 | 0, h2 | 0];
}

const TT = new Map(); // h1 → { lock: h2, d, f(0 exact 1 lower 2 upper), s, mFrom, mTo }
let ttGeneration = 0;

/* ---------- 走法排序 ---------- */
function orderScore(m, ctx, ply, ttMove) {
  if (ttMove && m.from === ttMove.from && m.to === ttMove.to) return 1e7;
  if (m.captured) return 1e6 + VAL[m.captured.t] * 10 - VAL[m.t];
  const kl = ctx.killers[ply];
  if (kl && kl.length >= 4) {
    if (kl[0] === m.from && kl[1] === m.to) return 1e5;
    if (kl[2] === m.from && kl[3] === m.to) return 99999;
  }
  return ctx.history[m.from * 90 + m.to] | 0;
}

function quiescence(st, alpha, beta, ctx, ply, qdepth = 10) {
  const stand = evaluate(st);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (qdepth <= 0) return alpha; // 静态搜索深度上限，防长兑爆炸
  const caps = genPseudo(st).filter((m) => m.captured);
  caps.sort((a, b) => (VAL[b.captured.t] * 10 - VAL[b.t]) - (VAL[a.captured.t] * 10 - VAL[a.t]));
  const mover = st.turn;
  for (const m of caps) {
    if (m.captured.t === 'k') return MATE - ply; // 王被吃 = 对方违规送将，直接赢
    const cap = makeMove(st, m);
    if (inCheck(st, mover)) { unmakeMove(st, m, cap); continue; }
    const v = -quiescence(st, -beta, -alpha, ctx, ply + 1, qdepth - 1);
    unmakeMove(st, m, cap);
    if (v >= beta) return beta;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

function negamax(st, depth, alpha, beta, ctx, ply) {
  ctx.nodes++;
  if ((ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) { ctx.stop = true; return alpha; }
  if (ctx.stop) return alpha;
  if (depth <= 0) return quiescence(st, alpha, beta, ctx, ply);

  const key = ctx.h1;
  const e = TT.get(key);
  let ttMove = null;
  if (e && e.lock === ctx.h2) {
    ttMove = e.mFrom >= 0 ? { from: e.mFrom, to: e.mTo } : null;
    if (e.d >= depth) {
      if (e.f === 0) return e.s;
      if (e.f === 1 && e.s > alpha) alpha = e.s;
      else if (e.f === 2 && e.s < beta) beta = e.s;
      if (alpha >= beta) return e.s;
    }
  }

  const moves = genPseudo(st);
  const mover = st.turn;
  for (const m of moves) m.ord = orderScore(m, ctx, ply, ttMove);
  moves.sort((a, b) => b.ord - a.ord);

  let best = -Infinity, bestMove = null, legalCount = 0, flag = 2; // upper
  for (const m of moves) {
    const cap = makeMove(st, m);
    if (inCheck(st, mover)) { unmakeMove(st, m, cap); continue; }
    legalCount++;
    const [sh1, sh2] = [ctx.h1, ctx.h2];
    [ctx.h1, ctx.h2] = hashMove(sh1, sh2, m, st.bd[m.to], cap);
    const v = -negamax(st, depth - 1, -beta, -alpha, ctx, ply + 1);
    ctx.h1 = sh1; ctx.h2 = sh2;
    unmakeMove(st, m, cap);
    if (ctx.stop) return alpha;
    if (v > best) { best = v; bestMove = m; }
    if (v > alpha) { alpha = v; flag = 0; }
    if (alpha >= beta) {
      flag = 1;
      if (!m.captured) { // 杀手走法 + 历史启发
        const kl = ctx.killers[ply] || (ctx.killers[ply] = [0, 0, 0, 0]);
        if (kl[0] !== m.from || kl[1] !== m.to) { kl[2] = kl[0]; kl[3] = kl[1]; kl[0] = m.from; kl[1] = m.to; }
        ctx.history[m.from * 90 + m.to] += depth * depth;
      }
      break;
    }
  }
  if (!legalCount) return -(MATE - ply); // 被将杀/困毙
  if (!ctx.stop) TT.set(key, { lock: ctx.h2, d: depth, f: flag, s: best, mFrom: bestMove ? bestMove.from : -1, mTo: bestMove ? bestMove.to : -1, gen: ttGeneration });
  return best;
}

/* ---------- 四档难度 ----------
   0 入门：1 层 + 大随机 | 1 初级：2 层 + 小随机
   2 中级：5 层（约 1s）   | 3 高级：迭代加深至 10 层或 2.8s */
const LEVEL_CFG = [
  { depth: 1, timeMs: 150, noise: 90 },
  { depth: 2, timeMs: 350, noise: 25 },
  { depth: 5, timeMs: 1000, noise: 0 },
  { depth: 10, timeMs: 2800, noise: 0 },
];

export function findBestMove(state, opts) {
  const { level = 2 } = opts || {};
  const cfg = LEVEL_CFG[level] || LEVEL_CFG[2];
  const st = cloneState(state);
  const legal = genLegal(st);
  if (!legal.length) return null;

  ttGeneration++;
  if (TT.size > 260000) TT.clear();

  const ctx = {
    nodes: 0, deadline: Date.now() + cfg.timeMs, stop: false,
    killers: [], history: new Int32Array(90 * 90),
  };
  [ctx.h1, ctx.h2] = hashState(st);

  let best = legal[0], bestScore = -Infinity;
  const scoredAll = [];
  for (let depth = 1; depth <= cfg.depth; depth++) {
    let alpha = -Infinity;
    const scored = [];
    let stopped = false;
    for (const m of legal) {
      const cap = makeMove(st, m);
      const [sh1, sh2] = [ctx.h1, ctx.h2];
      [ctx.h1, ctx.h2] = hashMove(sh1, sh2, m, st.bd[m.to], cap);
      const v = -negamax(st, depth - 1, -Infinity, alpha === -Infinity ? Infinity : -alpha, ctx, 1);
      ctx.h1 = sh1; ctx.h2 = sh2;
      unmakeMove(st, m, cap);
      if (ctx.stop) { stopped = true; break; }
      scored.push({ m, v });
      if (v > alpha) { alpha = v; best = m; }
    }
    if (scored.length && (!stopped || scored.length === legal.length)) {
      scored.sort((a, b) => b.v - a.v);
      scoredAll.length = 0; scoredAll.push(...scored);
      best = scored[0].m; bestScore = scored[0].v;
    }
    if (stopped) break;
    if (Math.abs(bestScore) > MATE / 2) break; // 已见杀棋
  }
  if (cfg.noise && scoredAll.length) {
    for (const s of scoredAll) s.vn = s.v + (Math.random() - 0.5) * cfg.noise;
    scoredAll.sort((a, b) => b.vn - a.vn);
    best = scoredAll[0].m;
  }
  return { move: best, score: bestScore, ranked: scoredAll.slice(0, 8) };
}
