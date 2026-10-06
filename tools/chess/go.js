/* ============================================================
   go.js — 围棋规则 + 启发式 AI
   19×19，index = r*19+c；1 = 黑，2 = 白。
   规则：气、提子、禁自杀、简单劫；数子采用中国规则（子 + 空域，白贴 7.5）。
   AI：启发式——提子 / 救气紧 / 打吃 / 线位价值 / 避免自杀与填眼。
   ============================================================ */

export const SIZE = 19;
export const KOMI = 7.5;

const NB = (i) => {
  const r = (i / SIZE) | 0, c = i % SIZE, out = [];
  if (r > 0) out.push(i - SIZE);
  if (r < SIZE - 1) out.push(i + SIZE);
  if (c > 0) out.push(i - 1);
  if (c < SIZE - 1) out.push(i + 1);
  return out;
};

export function emptyBoard() { return new Int8Array(SIZE * SIZE); }

/* i 所在棋群的棋子与气数 */
export function group(bd, i) {
  const color = bd[i];
  const stones = [i];
  const seen = new Uint8Array(SIZE * SIZE);
  seen[i] = 1;
  const libs = new Set();
  const stack = [i];
  while (stack.length) {
    const x = stack.pop();
    for (const n of NB(x)) {
      if (bd[n] === 0) libs.add(n);
      else if (bd[n] === color && !seen[n]) { seen[n] = 1; stones.push(n); stack.push(n); }
    }
  }
  return { stones, libs: libs.size };
}

/* 在副本语义下尝试落子：合法返回 { ok, captured, ko } 并原地生效；非法 { ok:false } */
export function play(bd, i, color, koPoint) {
  if (bd[i] !== 0 || i === koPoint) return { ok: false };
  const opp = color === 1 ? 2 : 1;
  bd[i] = color;
  const captured = [];
  for (const n of NB(i)) {
    if (bd[n] === opp) {
      const g = group(bd, n);
      if (g.libs === 0) for (const s of g.stones) { bd[s] = 0; captured.push(s); }
    }
  }
  const own = group(bd, i);
  if (own.libs === 0) {
    // 自杀：还原
    bd[i] = 0;
    for (const s of captured) bd[s] = opp;
    return { ok: false };
  }
  const ko = captured.length === 1 && own.stones.length === 1 && own.libs === 1 ? captured[0] : -1;
  return { ok: true, captured, ko };
}

/* 中国规则数子：黑 = 子 + 黑空，白 = 子 + 白空（另加贴目由调用方处理） */
export function score(bd) {
  const seen = new Uint8Array(SIZE * SIZE);
  let black = 0, white = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (bd[i] === 1) black++;
    else if (bd[i] === 2) white++;
  }
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (bd[i] !== 0 || seen[i]) continue;
    const region = [i];
    seen[i] = 1;
    const stack = [i];
    let touchB = false, touchW = false;
    while (stack.length) {
      const x = stack.pop();
      for (const n of NB(x)) {
        if (bd[n] === 0) { if (!seen[n]) { seen[n] = 1; region.push(n); stack.push(n); } }
        else if (bd[n] === 1) touchB = true;
        else touchW = true;
      }
    }
    if (touchB && !touchW) black += region.length;
    else if (touchW && !touchB) white += region.length;
  }
  return { black, white };
}

/* ---------- AI ---------- */
function candidates(bd) {
  const near = new Uint8Array(SIZE * SIZE);
  let hasStone = false;
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (!bd[i]) continue;
    hasStone = true;
    const r = (i / SIZE) | 0, c = i % SIZE;
    for (let dr = -2; dr <= 2; dr++)
      for (let dc = -2; dc <= 2; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && !bd[rr * SIZE + cc]) near[rr * SIZE + cc] = 1;
      }
  }
  const out = [];
  if (!hasStone) { out.push(((SIZE / 2) | 0) * SIZE + ((SIZE / 2) | 0)); return out; }
  for (let i = 0; i < SIZE * SIZE; i++) if (near[i]) out.push(i);
  return out;
}

export function aiMove(bd, color, koPoint, hard) {
  const opp = color === 1 ? 2 : 1;
  let best = null, bestScore = -Infinity;
  for (const i of candidates(bd)) {
    const trial = Int8Array.from(bd);
    const r = play(trial, i, color, koPoint);
    if (!r.ok) continue;
    let s = 0;
    s += r.captured.length * 120;                       // 提子
    // 救己方气紧棋群
    for (const n of NB(i)) {
      if (bd[n] === color) {
        const g0 = group(bd, n);
        if (g0.libs === 1) {
          const g1 = group(trial, n);
          if (g1.libs >= 2) s += 90 * g0.stones.length;
        }
      }
    }
    // 打吃（使对方棋群变气紧）
    for (const n of NB(i)) {
      if (trial[n] === opp) {
        const g = group(trial, n);
        if (g.libs === 1) s += 85 * g.stones.length;
      }
    }
    // 避免送吃（落子后己群只剩一气且无提子）
    const own = group(trial, i);
    if (own.libs === 1 && r.captured.length === 0) s -= 120 * own.stones.length;
    // 线位：三线四线佳，第一线早中盘减分
    const rr = (i / SIZE) | 0, cc = i % SIZE;
    const edge = Math.min(rr, cc, SIZE - 1 - rr, SIZE - 1 - cc);
    if (edge === 0) s -= hard ? 45 : 15;
    else if (edge === 2 || edge === 3) s += 16;
    // 邻子价值
    for (const n of NB(i)) {
      if (bd[n] === opp) s += 7;
      else if (bd[n] === color) s += 4;
    }
    // 避免填自己的眼
    let allOwn = true;
    for (const n of NB(i)) if (bd[n] !== color) allOwn = false;
    if (allOwn) s -= 600;
    s += Math.random() * (hard ? 5 : 35);
    if (s > bestScore) { bestScore = s; best = i; }
  }
  if (best == null) return { pass: true };
  return { idx: best };
}
