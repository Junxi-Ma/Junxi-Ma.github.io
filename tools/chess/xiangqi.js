/* ============================================================
   xiangqi.js — 中国象棋规则 + AI
   棋盘 9×10，index = r*9+c；r0 = 黑方底线（上），r9 = 红方底线（下）。
   side: 'r' 红（先行）| 'b' 黑。
   规则：宫内行走、士斜象眼塞、马蹩腿、炮翻山、兵过河横行、将帅对脸；
   终局：被将杀或困毙（无合法着法即负）。
   AI：negamax + α-β（搜索中放行伪合法着、以吃将作为终局惩罚，速度优先），
       评估 = 子力 + 过河兵加成。
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
  return { bd, turn: 'r' };
}

export function cloneState(st) {
  return { bd: st.bd.map((p) => (p ? { ...p } : null)), turn: st.turn };
}

/* 走子 = { from, to, captured } */
export function makeMove(st, m) {
  const piece = st.bd[m.from];
  const captured = st.bd[m.to];
  st.bd[m.from] = null;
  st.bd[m.to] = { t: piece.t, c: piece.c };
  st.turn = st.turn === 'r' ? 'b' : 'r';
  return captured;
}
export function unmakeMove(st, m, captured) {
  st.bd[m.from] = { t: st.bd[m.to].t, c: st.bd[m.to].c };
  st.bd[m.to] = captured;
  st.turn = st.turn === 'r' ? 'b' : 'r';
}

function kingSq(bd, side) {
  for (let i = 0; i < 90; i++) {
    const p = bd[i];
    if (p && p.t === 'k' && p.c === side) return i;
  }
  return -1;
}

function kingsFacing(bd) {
  const krSq = kingSq(bd, 'r'), kbSq = kingSq(bd, 'b');
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
    if (!leavesOwnKingHanging(st, m)) out.push(m);
  }
  return out;
}

/* 走 m 后，m.c 一方是否被将/对脸（在副本上判定） */
function leavesOwnKingHanging(st, m) {
  const copy = cloneState(st);
  const captured = makeMove(copy, m);
  void captured;
  const mover = m.c;
  return inCheck(copy, mover) || kingsFacing(copy.bd);
}

export function gameStatus(st) {
  if (genLegal(st).length === 0) {
    return { over: true, winner: st.turn === 'r' ? 'b' : 'r' };
  }
  return { over: false, winner: null };
}

/* ---------- AI ---------- */
const VAL = { k: 10000, r: 600, c: 300, n: 270, b: 120, a: 120, p: 70 };

function evaluate(st) {
  let s = 0;
  for (let i = 0; i < 90; i++) {
    const p = st.bd[i];
    if (!p) continue;
    let v = VAL[p.t];
    if (p.t === 'p') {
      const r = (i / 9) | 0;
      if ((p.c === 'r' && r <= 4) || (p.c === 'b' && r >= 5)) v += 60;
    }
    s += p.c === 'r' ? v : -v;
  }
  return st.turn === 'r' ? s : -s;
}

function negamax(st, depth, alpha, beta) {
  // 伪合法搜索：吃将即大胜；送将（走后被将/对脸）跳过
  const moves = genPseudo(st);
  if (!moves.length) return -100000 + depth;
  for (const m of moves) {
    if (m.captured && m.captured.t === 'k') return 100000 + depth;
  }
  if (depth === 0) return evaluate(st);
  let best = -Infinity;
  for (const m of moves) {
    const cap = makeMove(st, m);
    const mover = st.turn === 'r' ? 'b' : 'r';
    if (inCheck(st, mover)) { unmakeMove(st, m, cap); continue; }
    const v = -negamax(st, depth - 1, -beta, -alpha);
    unmakeMove(st, m, cap);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  if (best === -Infinity) return -100000 + depth; // 全部送将 = 必败
  return best;
}

export function findBestMove(state, depth = 2) {
  const st = cloneState(state);
  const legal = genLegal(st);
  if (!legal.length) return null;
  let best = legal[0], alpha = -Infinity;
  const scored = [];
  for (const m of legal) {
    const cap = makeMove(st, m);
    const v = -negamax(st, depth - 1, -Infinity, alpha === -Infinity ? Infinity : -alpha + 1);
    unmakeMove(st, m, cap);
    scored.push({ m, v });
    if (v > alpha) { alpha = v; best = m; }
  }
  return { move: best, score: alpha, ranked: scored.sort((a, b) => b.v - a.v) };
}
