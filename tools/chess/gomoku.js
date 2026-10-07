/* ============================================================
   gomoku.js — 五子棋规则 + AI
   棋盘 15×15，1 = 黑（先手），2 = 白。
   规则：五连即胜（无禁手，休闲规则）。
   AI：增量式「落点威胁分」缓存 + negamax α-β（强制挡五/必胜手短路）
       + VCF 连续冲四搜索（只算四连强制手，保守不误判）。
       三档难度：简单 = 一步启发 + 随机；中等 = 4 层；困难 = 8 层 + VCF。
   评分口诀：成五 >> 活四 > 双四/冲四 > 四三 > 双活三 > 活三 > 眠三 > 活二。
   ============================================================ */

export const SIZE = 15;
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
const N = SIZE * SIZE;

export function emptyBoard() { return new Int8Array(N); }

/* 返回获胜的连续点索引数组；未成五返回 null */
export function checkWin(bd, idx) {
  const side = bd[idx];
  if (!side) return null;
  const r = (idx / SIZE) | 0, c = idx % SIZE;
  for (const [dr, dc] of DIRS) {
    const line = [idx];
    for (let k = 1; k < SIZE; k++) {
      const rr = r + dr * k, cc = c + dc * k;
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE || bd[rr * SIZE + cc] !== side) break;
      line.push(rr * SIZE + cc);
    }
    for (let k = 1; k < SIZE; k++) {
      const rr = r - dr * k, cc = c - dc * k;
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE || bd[rr * SIZE + cc] !== side) break;
      line.unshift(rr * SIZE + cc);
    }
    if (line.length >= 5) return line;
  }
  return null;
}

export function hasWin(bd, idx) { return checkWin(bd, idx) !== null; }

/* ---------- 棋型打分 ---------- */
const PAT = {
  FIVE: 10000000,
  OPEN_FOUR: 1000000,
  FOUR: 30000,
  OPEN_THREE: 15000,
  THREE: 800,
  OPEN_TWO: 400,
  TWO: 80,
};

/* 单方向扫描：以 (r,c) 为落点（假定该点已属于 side），统计连子/开口/跳型 */
function dirStats(bd, r, c, dr, dc, side) {
  let cnt = 1;
  let openEnds = 0;
  let jump = false;
  for (const sign of [1, -1]) {
    let k = 1;
    while (true) {
      const rr = r + dr * k * sign, cc = c + dc * k * sign;
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) break;
      if (bd[rr * SIZE + cc] !== side) break;
      cnt++; k++;
    }
    const rr = r + dr * k * sign, cc = c + dc * k * sign;
    if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
    if (bd[rr * SIZE + cc] === 0) {
      openEnds++;
      const r2 = r + dr * (k + 1) * sign, c2 = c + dc * (k + 1) * sign;
      if (r2 >= 0 && r2 < SIZE && c2 >= 0 && c2 < SIZE && bd[r2 * SIZE + c2] === side) jump = true;
    }
  }
  return { cnt, openEnds, jump };
}

function lineScoreOf(st) {
  const { cnt, openEnds, jump } = st;
  if (cnt >= 5) return PAT.FIVE;
  if (openEnds === 0) return 0;
  if (cnt === 4) return openEnds === 2 ? PAT.OPEN_FOUR : PAT.FOUR;
  if (cnt === 3 && jump && openEnds >= 1) return PAT.FOUR;
  if (cnt === 3) return openEnds === 2 ? PAT.OPEN_THREE : PAT.THREE;
  if (cnt === 2 && jump && openEnds === 2) return PAT.OPEN_THREE;
  if (cnt === 2) return openEnds === 2 ? PAT.OPEN_TWO : PAT.TWO;
  return openEnds === 2 ? 30 : 5;
}

/* 假设 side 在 i 落子，四个方向的启发分之和（含双威胁加成） */
function scorePoint(bd, i, side) {
  const r = (i / SIZE) | 0, c = i % SIZE;
  let total = 0;
  let four = 0, openThree = 0;
  for (const [dr, dc] of DIRS) {
    const s = lineScoreOf(dirStats(bd, r, c, dr, dc, side));
    total += s;
    if (s >= PAT.FOUR && s < PAT.OPEN_THREE) four++;
    else if (s === PAT.OPEN_THREE) openThree++;
  }
  if (four + (total >= PAT.OPEN_FOUR ? 1 : 0) >= 2) total += 600000;       // 双四 / 活四+四
  else if (four >= 1 && openThree >= 1) total += 150000;                    // 四三
  else if (openThree >= 2) total += 50000;                                  // 双活三
  return total;
}

/* ============================================================
   搜索引擎：增量维护「每个空点若落子」的双边威胁分
   ============================================================ */
class Engine {
  constructor(bd) {
    this.bd = Int8Array.from(bd);
    this.pt = [new Int32Array(N), new Int32Array(N)]; // pt[s][i]：空点 i 若被 s 落子的分
    this.tot = [0, 0];                                 // 只累计「空点」的分
    this.nearCnt = new Uint8Array(N);                  // 2 格邻域内的子数（候选点判定）
    for (let i = 0; i < N; i++) if (this.bd[i]) this.markNear(i, 1);
    for (let i = 0; i < N; i++) if (!this.bd[i] && this.nearCnt[i] > 0) { this.addPt(i, 1); this.addPt(i, 2); }
  }
  markNear(i, d) {
    const r = (i / SIZE) | 0, c = i % SIZE;
    for (let dr = -2; dr <= 2; dr++)
      for (let dc = -2; dc <= 2; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE) this.nearCnt[rr * SIZE + cc] += d;
      }
  }
  addPt(i, side) {
    const v = scorePoint(this.bd, i, side);
    this.pt[side - 1][i] = v;
    this.tot[side - 1] += v;
  }
  addPtBoth(j) { if (!this.bd[j]) { this.addPt(j, 1); this.addPt(j, 2); } }
  /* 落子，返回撤销记录（受影响点的旧分） */
  make(i, side) {
    this.bd[i] = side;
    this.markNear(i, 1);
    const p1 = this.pt[0], p2 = this.pt[1];
    this.tot[0] -= p1[i]; this.tot[1] -= p2[i];
    p1[i] = 0; p2[i] = 0;
    const undo = { list: [] };
    for (const j of this.refreshList(i)) {
      undo.list.push(j, p1[j], p2[j]);
      this.tot[0] -= p1[j]; this.tot[1] -= p2[j];
    }
    for (let k = 0; k < undo.list.length; k += 3) this.addPtBoth(undo.list[k]);
    return undo;
  }
  unmake(i, undo) {
    this.bd[i] = 0;
    this.markNear(i, -1);
    const p1 = this.pt[0], p2 = this.pt[1];
    const l = undo.list;
    for (let k = 0; k < l.length; k += 3) {
      const j = l[k];
      this.tot[0] += l[k + 1] - p1[j];
      this.tot[1] += l[k + 2] - p2[j];
      p1[j] = l[k + 1];
      p2[j] = l[k + 2];
    }
    this.addPt(i, 1); this.addPt(i, 2); // 落点重新变空，恢复其威胁分
  }
  /* 落点沿四向距离 ≤4 的点（这些点经四条线受落子影响） */
  refreshList(i) {
    const out = [];
    const r = (i / SIZE) | 0, c = i % SIZE;
    for (let d = -4; d <= 4; d++) {
      if (d === 0) continue;
      if (c + d >= 0 && c + d < SIZE) out.push(r * SIZE + c + d);
      if (r + d >= 0 && r + d < SIZE) out.push((r + d) * SIZE + c);
      if (r + d >= 0 && r + d < SIZE && c + d >= 0 && c + d < SIZE) out.push((r + d) * SIZE + c + d);
      if (r + d >= 0 && r + d < SIZE && c - d >= 0 && c - d < SIZE) out.push((r + d) * SIZE + c - d);
    }
    return out;
  }
  /* 空点且在棋群附近 */
  isCandidate(i) { return this.bd[i] === 0 && this.nearCnt[i] > 0; }
  /* side 的所有「落子即成五」点 */
  fivePoints(side) {
    const pt = this.pt[side - 1], bd = this.bd, out = [];
    for (let i = 0; i < N; i++) if (bd[i] === 0 && pt[i] >= PAT.FIVE) out.push(i);
    return out;
  }
  evalFor(me) { return this.tot[me - 1] - this.tot[(me === 1 ? 2 : 1) - 1]; }
  candidates() {
    const out = [];
    const bd = this.bd;
    for (let i = 0; i < N; i++) if (bd[i] === 0 && this.nearCnt[i] > 0) out.push(i);
    if (!out.length) out.push(((SIZE / 2) | 0) * SIZE + ((SIZE / 2) | 0));
    return out;
  }
}

const WIN = 1e9;
const opp = (s) => (s === 1 ? 2 : 1);

/* 候选点按「我方 + 对方威胁分」排序取前 K */
function orderedCands(eng, me, k) {
  const cands = eng.candidates();
  const p1 = eng.pt[me - 1], p2 = eng.pt[opp(me) - 1];
  const arr = [];
  for (const i of cands) arr.push({ i, s: p1[i] + p2[i] * 0.9 });
  arr.sort((a, b) => b.s - a.s);
  return arr.slice(0, k).map((x) => x.i);
}

function negamax(eng, depth, alpha, beta, me, ply, ctx) {
  if ((++ctx.nodes & 2047) === 0 && Date.now() > ctx.deadline) { ctx.stop = true; return alpha; }
  const myFive = eng.fivePoints(me);
  if (myFive.length) return WIN - ply;               // 我能直接成五
  const theirFive = eng.fivePoints(opp(me));
  let moves;
  if (theirFive.length) {
    if (depth <= 0) return -WIN + ply + 1;           // 叶子处对方下一步成五，必败
    if (theirFive.length >= 2) return -WIN + ply + 2; // 双五点挡不住
    moves = theirFive;                                // 强制挡五
  } else {
    if (depth <= 0) return eng.evalFor(me);
    moves = orderedCands(eng, me, ctx.k);
    if (!moves.length) return 0;
  }
  let best = -Infinity;
  for (const i of moves) {
    const undo = eng.make(i, me);
    const v = -negamax(eng, depth - 1, -beta, -alpha, opp(me), ply + 1, ctx);
    eng.unmake(i, undo);
    if (ctx.stop) return alpha;
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

/* VCF：side 连续用冲四强制进攻。返回是否必胜（保守：对方反四时不追） */
function vcf(eng, side, ply, maxPly) {
  if (eng.fivePoints(side).length) return true;
  if (ply >= maxPly) return false;
  const pt = eng.pt[side - 1];
  const bd = eng.bd;
  const fours = [];
  for (let i = 0; i < N; i++) {
    // 四连强制手：冲四与活四都算（活四两端成五，威胁点 ≥2 直接受理）
    if (bd[i] === 0 && pt[i] >= PAT.FOUR && pt[i] < PAT.FIVE) fours.push(i);
  }
  for (const i of fours) {
    const undo = eng.make(i, side);
    const threats = eng.fivePoints(side);
    let win = false;
    if (threats.length >= 2) {
      win = true; // 双四点，对方只能挡一个
    } else if (threats.length === 1) {
      const blocker = threats[0];
      const undo2 = eng.make(blocker, opp(side));
      // 对方挡子后若形成自己的五点（反杀），这条四链不成立（保守）
      if (!eng.fivePoints(opp(side)).length && vcf(eng, side, ply + 2, maxPly)) win = true;
      eng.unmake(blocker, undo2);
    }
    eng.unmake(i, undo);
    if (win) return true;
  }
  return false;
}

/* ============================================================
   AI 入口：bestMove(bd, me, level) → { idx }
   level: 0 简单 | 1 中等 | 2 困难
   ============================================================ */
const LEVEL_CFG = [
  { depth: 1, k: 10, noise: 260, timeMs: 200, vcf: 0, pool: 4, poolRate: 0.55 },
  { depth: 5, k: 12, noise: 0, timeMs: 1000, vcf: 8, pool: 1, poolRate: 0 },
  { depth: 10, k: 16, noise: 0, timeMs: 3000, vcf: 12, pool: 1, poolRate: 0 },
];

export function bestMove(bd, me, level = 1) {
  const cfg = LEVEL_CFG[level] || LEVEL_CFG[1];
  const eng = new Engine(bd);
  const cands = eng.candidates();
  if (cands.length === 1) return { idx: cands[0] };

  // 1) 我能成五 → 直接赢
  const myFive = eng.fivePoints(me);
  if (myFive.length) return { idx: myFive[0], win: true };
  // 2) 对方能成五 → 必堵
  const theirFive = eng.fivePoints(opp(me));
  if (theirFive.length) {
    let best = theirFive[0], bestS = -Infinity;
    for (const i of theirFive) {
      const s = eng.pt[me - 1][i] + eng.pt[opp(me) - 1][i];
      if (s > bestS) { bestS = s; best = i; }
    }
    return { idx: best, forced: true };
  }
  // 3) VCF 先探：困难/中等档，若存在连续冲四必胜直接走第一手
  if (cfg.vcf > 0 && vcf(eng, me, 0, cfg.vcf)) {
    const pick = vcfFirstMove(eng, me, cfg.vcf);
    if (pick != null) return { idx: pick, vcf: true };
  }
  // 4) αβ 迭代加深
  const ctx = { nodes: 0, deadline: Date.now() + cfg.timeMs, stop: false, k: cfg.k };
  const rootMoves = orderedCands(eng, me, Math.max(cfg.k * 2, 20));
  let scored = rootMoves.map((i) => ({ i, v: 0 }));
  for (let depth = 1; depth <= cfg.depth; depth++) {
    let alpha = -Infinity;
    const round = [];
    let stop = false;
    for (const { i } of scored) {
      const undo = eng.make(i, me);
      let v = -negamax(eng, depth - 1, -WIN, alpha === -Infinity ? WIN : -alpha, opp(me), 1, ctx);
      eng.unmake(i, undo);
      if (ctx.stop) { stop = true; break; }
      v += cfg.noise ? (Math.random() - 0.5) * cfg.noise : 0;
      round.push({ i, v });
      if (v > alpha) alpha = v;
    }
    if (round.length) {
      round.sort((a, b) => b.v - a.v);
      scored = round.concat(scored.filter((x) => !round.some((r) => r.i === x.i)));
    }
    if (stop) break;
    if (alpha > WIN / 2) break; // 已见必胜
  }
  // 简单档：从前几名里随机挑，手感更像人
  if (cfg.pool > 1 && Math.random() < cfg.poolRate) {
    const top = scored.slice(0, Math.min(cfg.pool, scored.length));
    return { idx: top[(Math.random() * top.length) | 0].i };
  }
  return { idx: scored[0]?.i ?? cands[0] };
}

/* VCF 命中后找第一手：重跑一遍取第一个能达成必胜的四点 */
function vcfFirstMove(eng, me, maxPly) {
  const pt = eng.pt[me - 1];
  const bd = eng.bd;
  for (let i = 0; i < N; i++) {
    if (bd[i] !== 0 || pt[i] < PAT.FOUR || pt[i] >= PAT.OPEN_THREE) continue;
    const undo = eng.make(i, me);
    const threats = eng.fivePoints(me);
    let ok = false;
    if (threats.length >= 2) ok = true;
    else if (threats.length === 1) {
      const b = threats[0];
      const undo2 = eng.make(b, opp(me));
      if (!eng.fivePoints(opp(me)).length && vcf(eng, me, 2, maxPly)) ok = true;
      eng.unmake(b, undo2);
    }
    eng.unmake(i, undo);
    if (ok) return i;
  }
  return null;
}
