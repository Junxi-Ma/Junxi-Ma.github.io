/* ============================================================
   go.js — 围棋规则 + 蒙特卡洛 AI
   19×19，index = r*19+c；1 = 黑，2 = 白。
   规则：气、提子、禁自杀、简单劫；数子采用中国规则（子 + 空域，白贴 7.5）。
   AI：先验启发（提子/救活/打吃/线位/贴子）+ 纯蒙特卡洛模拟（AMAF 胜率图
       与先验贝叶斯融合）。三档难度 = 模拟时长。
   ============================================================ */

export const SIZE = 19;
export const KOMI = 7.5;
const N = SIZE * SIZE;

const NB = (i) => {
  const r = (i / SIZE) | 0, c = i % SIZE, out = [];
  if (r > 0) out.push(i - SIZE);
  if (r < SIZE - 1) out.push(i + SIZE);
  if (c > 0) out.push(i - 1);
  if (c < SIZE - 1) out.push(i + 1);
  return out;
};

export function emptyBoard() { return new Int8Array(N); }

/* i 所在棋群的棋子与气数 */
export function group(bd, i) {
  const color = bd[i];
  const stones = [i];
  const seen = new Uint8Array(N);
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
    bd[i] = 0;
    for (const s of captured) bd[s] = opp;
    return { ok: false };
  }
  const ko = captured.length === 1 && own.stones.length === 1 && own.libs === 1 ? captured[0] : -1;
  return { ok: true, captured, ko };
}

/* 中国规则数子：黑 = 子 + 黑空，白 = 子 + 白空（另加贴目由调用方处理） */
export function score(bd) {
  const seen = new Uint8Array(N);
  let black = 0, white = 0;
  for (let i = 0; i < N; i++) {
    if (bd[i] === 1) black++;
    else if (bd[i] === 2) white++;
  }
  for (let i = 0; i < N; i++) {
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

/* ---------- 通用启发 ---------- */
/* 真眼近似：四邻全己方，对角对手子 ≤1 */
function isOwnEye(bd, i, color) {
  for (const n of NB(i)) if (bd[n] !== color) return false;
  const r = (i / SIZE) | 0, c = i % SIZE;
  let diagOpp = 0;
  for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
    if (bd[rr * SIZE + cc] === (color === 1 ? 2 : 1)) diagOpp++;
  }
  return diagOpp <= 1;
}

function candidates(bd) {
  const near = new Uint8Array(N);
  let hasStone = false;
  for (let i = 0; i < N; i++) {
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
  for (let i = 0; i < N; i++) if (near[i]) out.push(i);
  return out;
}

/* 先验分：提子 / 救一气棋群 / 打吃 / 线位 / 接触。只算启发不模拟 */
function priorScore(bd, i, color, koPoint) {
  const opp = color === 1 ? 2 : 1;
  const trial = Int8Array.from(bd);
  const r = play(trial, i, color, koPoint);
  if (!r.ok) return null;
  let s = 0;
  s += r.captured.length * 140;                       // 提子
  const seenOwn = new Set();
  for (const n of NB(i)) {
    if (bd[n] !== color || seenOwn.has(n)) continue;
    const g0 = group(bd, n);
    g0.stones.forEach((x) => seenOwn.add(x));
    if (g0.libs === 1) {
      const g1 = group(trial, n);
      if (g1.libs >= 2) s += 110 * g0.stones.length;  // 救活被打吃的己方棋群
    }
  }
  const seenOpp = new Set();
  for (const n of NB(i)) {
    if (trial[n] !== opp || seenOpp.has(n)) continue;
    const g = group(trial, n);
    g.stones.forEach((x) => seenOpp.add(x));
    if (g.libs === 1) s += 95 * g.stones.length;      // 打吃对方
  }
  const own = group(trial, i);
  if (own.libs === 1 && r.captured.length === 0) s -= 150 * own.stones.length; // 送吃
  const rr = (i / SIZE) | 0, cc = i % SIZE;
  const edge = Math.min(rr, cc, SIZE - 1 - rr, SIZE - 1 - cc);
  if (edge === 0) s -= 55;                            // 一线
  else if (edge === 1) s -= 6;
  else if (edge === 2 || edge === 3) s += 18;         // 三四线
  let oppN = 0, ownN = 0;
  for (const n of NB(i)) { if (bd[n] === opp) oppN++; else if (bd[n] === color) ownN++; }
  if (oppN >= 3 && ownN === 0) s -= 60;               // 深入对方厚势
  if (isOwnEye(bd, i, color)) s -= r.captured.length > 0 ? 30 : 900; // 填真眼
  return { s, captured: r.captured.length };
}

/* ============================================================
   蒙特卡洛 AI
   ============================================================ */
const LEVEL_MS = [280, 800, 1900]; // 简单 / 中等 / 困难 的模拟预算

export function aiMove(bd, color, koPoint, level = 1) {
  const opp = color === 1 ? 2 : 1;
  const cands = candidates(bd);
  if (!cands.length) return { pass: true };

  // 先验 + 一次合法性试下
  const priors = [];
  let anyLegal = false;
  for (const i of cands) {
    const p = priorScore(bd, i, color, koPoint);
    if (!p) continue;
    anyLegal = true;
    priors.push({ i, s: p.s, captured: p.captured });
  }
  if (!priors.length) return { pass: true };
  // 有提子 / 有救活这种硬机会直接走（先验极大值）
  priors.sort((a, b) => b.s - a.s);
  const top = priors[0];
  if (top.s >= 140) return { idx: top.i };
  // 盘面已无正着（只剩填眼之类）→ 停一手，交给双停终局
  if (top.s <= -500) return { pass: true };

  // 蒙特卡洛：AMAF 胜率图与先验融合
  const visits = new Int32Array(N);
  const wins = new Int32Array(N);
  const deadline = Date.now() + (LEVEL_MS[level] ?? LEVEL_MS[1]);
  const maxMoves = 240;
  let playouts = 0;
  // 模拟用候选池：邻域点为主，混入少量全局随机点防止漏大场
  const globalPool = [];
  for (let i = 0; i < N; i++) if (bd[i] === 0 && !cands.includes(i)) globalPool.push(i);
  while (Date.now() < deadline && playouts < 6000) {
    playouts++;
    const pbd = Int8Array.from(bd);
    let pko = koPoint;
    let turn = color;
    let passes = 0;
    const played = [[], []]; // played[sideIdx] 本局各方落点
    let made = 0;
    while (passes < 2 && made < maxMoves) {
      let placed = -1;
      // 每手随机取点：70% 邻域池 + 30% 全局池，跳过真眼
      for (let attempt = 0; attempt < 24; attempt++) {
        const pool = Math.random() < 0.72 ? cands : globalPool;
        if (!pool.length) continue;
        const j = pool[(Math.random() * pool.length) | 0];
        if (pbd[j] !== 0) continue;
        if (isOwnEye(pbd, j, turn) && attempt < 16) continue; // 眼位低优先，兜底仍可走
        const r = play(pbd, j, turn, pko);
        if (!r.ok) continue;
        placed = j;
        played[turn - 1].push(j);
        pko = r.ko;
        break;
      }
      if (placed < 0) { passes++; pko = -1; }
      else passes = 0;
      turn = turn === 1 ? 2 : 1;
      made++;
    }
    const t = score(pbd);
    const blackWin = t.black > t.white + KOMI;
    const iWin = (color === 1) === blackWin;
    // AMAF 记账：本局所有落点都记一笔，AI 赢则记胜（不区分实际哪方落子）
    if (iWin) {
      for (const j of played[0]) wins[j]++;
      for (const j of played[1]) wins[j]++;
    }
    for (const j of played[0]) visits[j]++;
    for (const j of played[1]) visits[j]++;
  }

  // 融合：value = (amafSum + K*priorNorm) / (visits + K)。K = 先验伪计数
  const K = 20;
  const priorNorm = Math.max(...priors.map((p) => p.s)) || 1;
  let best = null, bestV = -Infinity;
  for (const p of priors) {
    const v0 = visits[p.i];
    const amaf = v0 > 0 ? wins[p.i] / v0 : 0.5;
    const prior = Math.max(0, Math.min(1, 0.5 + p.s / (2 * priorNorm)));
    const value = (amaf * v0 + prior * K) / (v0 + K);
    const noise = level === 0 ? Math.random() * 0.18 : level === 1 ? Math.random() * 0.06 : 0;
    const v = value + noise;
    if (v > bestV) { bestV = v; best = p.i; }
  }
  if (best == null) return { pass: true };
  // 局面已经没便宜可占（比如只剩单官且自己大幅领先时）交给停一手逻辑：
  // 领先方在对方停一手后也停 → 由 app 的双停终局处理，这里不主动停。
  return { idx: best, playouts };
}
