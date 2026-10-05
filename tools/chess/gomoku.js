/* ============================================================
   gomoku.js — 五子棋规则 + AI
   棋盘 15×15，1 = 黑（先手），2 = 白。
   AI：启发式评估——对每个候选点按四个方向的连子/开端打分，
       进攻分 + 防守分加权，困难档再做必胜/必防检测。
   ============================================================ */

export const SIZE = 15;
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

export function emptyBoard() { return new Int8Array(SIZE * SIZE); }

export function checkWin(bd, idx) {
  const side = bd[idx];
  if (!side) return false;
  const r = (idx / SIZE) | 0, c = idx % SIZE;
  for (const [dr, dc] of DIRS) {
    let cnt = 1;
    for (let k = 1; k < 5; k++) {
      const rr = r + dr * k, cc = c + dc * k;
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE || bd[rr * SIZE + cc] !== side) break;
      cnt++;
    }
    for (let k = 1; k < 5; k++) {
      const rr = r - dr * k, cc = c - dc * k;
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE || bd[rr * SIZE + cc] !== side) break;
      cnt++;
    }
    if (cnt >= 5) return true;
  }
  return false;
}

function lineScore(cnt, open) {
  if (cnt >= 5) return 10000000;
  if (open === 0) return 0;
  if (cnt === 4) return open === 2 ? 1000000 : 15000;
  if (cnt === 3) return open === 2 ? 20000 : 800;
  if (cnt === 2) return open === 2 ? 400 : 60;
  return open === 2 ? 30 : 5;
}

/* 假设 side 在 i 落子，四个方向的启发分之和 */
function scorePoint(bd, i, side) {
  const r = (i / SIZE) | 0, c = i % SIZE;
  let total = 0;
  for (const [dr, dc] of DIRS) {
    let cnt = 1, open = 0;
    for (const sign of [1, -1]) {
      let k = 1;
      while (true) {
        const rr = r + dr * k * sign, cc = c + dc * k * sign;
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) break;
        const v = bd[rr * SIZE + cc];
        if (v === side) { cnt++; k++; continue; }
        if (v === 0) open++;
        break;
      }
    }
    total += lineScore(cnt, open);
  }
  return total;
}

function candidates(bd) {
  const out = [];
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
  if (!hasStone) return [((SIZE / 2) | 0) * SIZE + ((SIZE / 2) | 0)];
  for (let i = 0; i < SIZE * SIZE; i++) if (near[i]) out.push(i);
  return out;
}

/* AI 落子。hard = 困难（更重的防守权重 + 抓必胜点）；否则带随机性 */
export function bestMove(bd, me, hard) {
  const opp = me === 1 ? 2 : 1;
  let best = -1, bestScore = -Infinity;
  for (const i of candidates(bd)) {
    const atk = scorePoint(bd, i, me);
    const def = scorePoint(bd, i, opp);
    if (atk >= 10000000) return { idx: i, win: true };   // 我方成五
    if (def >= 10000000) { best = i; bestScore = 9e6; continue; } // 对方将成五 → 必堵
    const s = atk + def * (hard ? 0.95 : 0.75) + Math.random() * (hard ? 6 : 60);
    if (s > bestScore) { bestScore = s; best = i; }
  }
  return { idx: best, win: bestScore >= 9e6 };
}
