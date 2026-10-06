/* ============================================================
   engine.js — 国际象棋规则引擎 + AI
   规则：全兵种走法、王车易位、吃过路兵、升变、将军/将杀/逼和、
         50 回合与子力不足和棋
   AI：negamax + α-β 剪枝 + 静态搜索（quiescence）+ 迭代加深，
       评估 = 子力 + 分兵种位置表（chessprogramming.org
       "Simplified Evaluation Function"，Tomasz Michniewski）
   坐标：sq 0 = a8，7 = h8，56 = a1，63 = h1（r = sq>>3 从上数）
   ============================================================ */

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/* 棋子字形：加 U+FE0E 强制文本呈现（避免部分平台渲染成彩色 emoji） */
export const GLYPHS = {
  w: { k: '\u2654', q: '\u2655', r: '\u2656', b: '\u2657', n: '\u2658', p: '\u2659' },
  b: { k: '\u265A', q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F' },
};
export const pieceGlyph = (p) => GLYPHS[p.c][p.t] + '\uFE0E';

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

export function toFEN(st) {
  let pos = '';
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = st.board[r * 8 + c];
      if (!p) { empty++; continue; }
      if (empty) { pos += empty; empty = 0; }
      pos += p.c === 'w' ? p.t.toUpperCase() : p.t;
    }
    if (empty) pos += empty;
    if (r < 7) pos += '/';
  }
  const cst = (st.castling.K ? 'K' : '') + (st.castling.Q ? 'Q' : '') + (st.castling.k ? 'k' : '') + (st.castling.q ? 'q' : '');
  const ep = st.ep >= 0 ? String.fromCharCode(97 + (st.ep & 7)) + (8 - (st.ep >> 3)) : '-';
  return `${pos} ${st.turn} ${cst || '-'} ${ep} ${st.half} ${st.full}`;
}

/* ---------- 攻击检测 ---------- */
const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function onBoard(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

/* (r,c) 是否被 by 方攻击 */
export function isAttacked(st, r, c, by) {
  const bd = st.board;
  // 兵：白兵在 (r+1, c±1) 攻击 (r,c)
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

/* ---------- 走子生成 ----------
   move = { from, to, t(子种), c(方), captured(子或null), promo(null|'q'...),
            flag: '' | 'ep' | 'castleK' | 'castleQ' | 'double' } */

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

export function genPseudo(st) {
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
        // 王车易位：王在原位、有权利、中间无子、王不经 checkout
        const home = me === 'w' ? 60 : 4; // e1 / e8
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

export function makeMove(st, m) {
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
    const r = m.to >> 3;
    bd[m.to - 1] = bd[m.to + 1]; bd[m.to + 1] = null; // 车入位
  } else if (m.flag === 'castleQ') {
    const r = m.to >> 3;
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

export function unmakeMove(st, m, undo) {
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

export function genLegal(st) {
  const out = [];
  for (const m of genPseudo(st)) {
    const undo = makeMove(st, m);
    if (!inCheck(st, m.c)) out.push(m);
    unmakeMove(st, m, undo);
  }
  return out;
}

/* ---------- SAN ---------- */
export function moveToSan(st, m, legal) {
  if (m.flag === 'castleK') return withSuffix(st, m, 'O-O');
  if (m.flag === 'castleQ') return withSuffix(st, m, 'O-O-O');
  let s = '';
  if (m.t === 'p') {
    if (m.captured) s += String.fromCharCode(97 + (m.from & 7)) + 'x';
    s += sqName(m.to);
    if (m.promo) s += '=' + m.promo.toUpperCase();
  } else {
    s += m.t.toUpperCase();
    const rivals = (legal || genLegal(st)).filter((x) => x.t === m.t && x.to === m.to && x.from !== m.from);
    if (rivals.length) {
      const sameFile = rivals.some((x) => (x.from & 7) === (m.from & 7));
      const sameRank = rivals.some((x) => (x.from >> 3) === (m.from >> 3));
      if (!sameFile) s += String.fromCharCode(97 + (m.from & 7));
      else if (!sameRank) s += String(8 - (m.from >> 3));
      else s += sqName(m.from);
    }
    if (m.captured) s += 'x';
    s += sqName(m.to);
  }
  return withSuffix(st, m, s);
}
function sqName(sq) { return String.fromCharCode(97 + (sq & 7)) + (8 - (sq >> 3)); }
function withSuffix(st, m, s) {
  const undo = makeMove(st, m);
  const enemy = st.turn;
  if (inCheck(st, enemy)) s += genLegal(st).length === 0 ? '#' : '+';
  unmakeMove(st, m, undo);
  return s;
}

/* ---------- 终局判定 ---------- */
export function gameStatus(st, opts) {
  const legal = genLegal(st);
  if (!legal.length) {
    if (inCheck(st, st.turn)) return { over: true, result: st.turn === 'w' ? '0-1' : '1-0', reason: 'checkmate' };
    return { over: true, result: '1/2-1/2', reason: 'stalemate' };
  }
  if (st.half >= 100) return { over: true, result: '1/2-1/2', reason: 'fifty' };
  // 子力不足：王 vs 王、王+单轻子 vs 王，以及王+双马 vs 王等必然和棋
  const pieces = st.board.filter(Boolean).filter((p) => p.t !== 'k');
  const hasPawnRookQueen = pieces.some((p) => p.t === 'p' || p.t === 'r' || p.t === 'q');
  if (!hasPawnRookQueen) {
    const majors = pieces.filter((p) => p.t === 'b' || p.t === 'n');
    // 无兵/车/后时：没有子，或只剩一个轻子 => 和棋（马或象单兵难胜）
    if (majors.length <= 1) return { over: true, result: '1/2-1/2', reason: 'material' };
  }
  // 三次重复局面（含当前局面在内，出现 3 次即可判和）
  if (opts && opts.repetition && opts.repetition >= 3) {
    return { over: true, result: '1/2-1/2', reason: 'repetition' };
  }
  return { over: false, result: '', reason: '' };
}

/* 局面的「易位 + 吃过路兵」无关指纹，用于重复局面统计。
   按 FIDE 规则，重复判定只看棋子位置与轮走方，不看 half/full。 */
export function repetitionKey(st) {
  const bd = st.board.map((p) => (p ? (p.c === 'w' ? p.t.toUpperCase() : p.t) : '.')).join('');
  return bd + ' ' + st.turn + ' ' +
    (st.castling.K ? 'K' : '') + (st.castling.Q ? 'Q' : '') +
    (st.castling.k ? 'k' : '') + (st.castling.q ? 'q' : '') + ' ' + st.ep;
}

/* ---------- AI ----------
   评估 = 子力 + 分兵种位置表；黑方按行镜像。
   negamax + α-β + 走子排序（MVV-LVA）+ 吃子静态搜索。 */
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
  // 残局（重子少）换王的位置表
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

/* 迭代加深找最佳走法。skill: 0 新手（带随机性）~3 大师 */export function findBestMove(state, { maxDepth = 3, timeMs = 800, skill = 3 } = {}) {
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
    if (Math.abs(alpha) > 90000) break; // 已见杀棋
  }
  // 低难度：一定比例走随机好棋（不至于每步最优）
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

export function cloneState(st) {
  return {
    board: st.board.map((p) => (p ? { ...p } : null)),
    turn: st.turn,
    castling: { ...st.castling },
    ep: st.ep,
    half: st.half,
    full: st.full,
  };
}
