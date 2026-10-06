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

/* 判断 i 是否是 color 的「真眼」（近似）：四邻全是己方或边界，
   且该点落在己方棋群内部。填真眼通常自毁，AI 必须回避。 */
function isOwnEye(bd, i, color) {
  for (const n of NB(i)) if (bd[n] !== color) return false;
  // 四邻都是自己 → 至少是眼位；再看对角线是否有对方子制造假眼
  const r = (i / SIZE) | 0, c = i % SIZE;
  let diagOpp = 0;
  for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
    if (bd[rr * SIZE + cc] === (color === 1 ? 2 : 1)) diagOpp++;
  }
  return diagOpp <= 1; // 对角线上对手子不超过一个 → 视为真眼
}

export function aiMove(bd, color, koPoint, hard) {
  const opp = color === 1 ? 2 : 1;
  let best = null, bestScore = -Infinity;
  let anyLegal = false;
  const noise = hard ? 5 : 35;
  for (const i of candidates(bd)) {
    if (bd[i] !== 0) continue;
    // 先跳过自己的真眼（除非能提子或能救活自己）
    const eye = isOwnEye(bd, i, color);
    const trial = Int8Array.from(bd);
    const r = play(trial, i, color, koPoint);
    if (!r.ok) continue;
    anyLegal = true;
    let s = 0;
    // 1) 提子：直接价值最高
    s += r.captured.length * 140;
    // 2) 救活己方只剩一气的棋群
    const seenOwn = new Set();
    for (const n of NB(i)) {
      if (bd[n] !== color || seenOwn.has(n)) continue;
      const g0 = group(bd, n);
      g0.stones.forEach((x) => seenOwn.add(x));
      if (g0.libs === 1) {
        const g1 = group(trial, n);
        if (g1.libs >= 2) s += 110 * g0.stones.length;
      }
    }
    // 3) 打吃对方棋群
    const seenOpp = new Set();
    for (const n of NB(i)) {
      if (trial[n] !== opp || seenOpp.has(n)) continue;
      const g = group(trial, n);
      g.stones.forEach((x) => seenOpp.add(x));
      if (g.libs === 1) s += 95 * g.stones.length;
    }
    // 4) 落子后自己只剩一气且没提到子 → 送吃
    const own = group(trial, i);
    if (own.libs === 1 && r.captured.length === 0) s -= 150 * own.stones.length;
    // 5) 线位价值：三线四线最佳
    const rr = (i / SIZE) | 0, cc = i % SIZE;
    const edge = Math.min(rr, cc, SIZE - 1 - rr, SIZE - 1 - cc);
    if (edge === 0) s -= hard ? 55 : 20;
    else if (edge === 1) s -= 6;
    else if (edge === 2 || edge === 3) s += 18;
    // 6) 邻近棋子（有接触才有战斗）
    let near = 0;
    for (const n of NB(i)) {
      if (bd[n] === opp) { s += 8; near++; }
      else if (bd[n] === color) { s += 4; near++; }
    }
    // 7) 不要填自己的眼（真眼重罚，假眼轻罚）
    if (eye) s -= r.captured.length > 0 ? 30 : 900;
    // 8) 避免下在对方厚势的紧气处：四周都是对方子且己方无援
    let oppN = 0, ownN = 0;
    for (const n of NB(i)) { if (bd[n] === opp) oppN++; else if (bd[n] === color) ownN++; }
    if (oppN >= 3 && ownN === 0) s -= 60;
    s += Math.random() * noise;
    if (s > bestScore) { bestScore = s; best = i; }
  }
  if (best == null) return { pass: true };
  // 若最优手是明显亏损（填真眼且无收益），宁可不走 —— 交给「停一手」
  if (bestScore < -400 && !anyLegal) return { pass: true };
  if (bestScore < -700) return { pass: true };
  return { idx: best };
}
