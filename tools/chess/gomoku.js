/* ============================================================
   gomoku.js — 五子棋规则 + AI
   棋盘 15×15，1 = 黑（先手），2 = 白。
   AI：启发式评估——对每个候选点按四个方向的连子/开端打分，
       进攻分 + 防守分加权，困难档再做必胜/必防检测。
   ============================================================ */

export const SIZE = 15;
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

export function emptyBoard() { return new Int8Array(SIZE * SIZE); }

/* 返回获胜的五个（或更多）连续点索引数组；未成五返回 null。
   旧实现返回布尔值，而 app.js 直接把返回值当数组用（line.forEach），
   于是「胜利线高亮」永远不生效，且 truthy 判断掩盖了类型错误。 */
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

/* 布尔便捷包装（外部若只需要「是否成五」） */
export function hasWin(bd, idx) { return checkWin(bd, idx) !== null; }

/* 逐方向统计「以 i 为落点」的连子数、两端封闭情况，并识别活三/冲四/活四等棋型。
   返回该方向的 { cnt, open, gapA, gapB }：
   - cnt   ：与 i 相连的同色子数（含 i）
   - open  ：两端是否为空（0/1/2）
   - 同时探测「隔一子的跳型」以识别跳活三等，避免 AI 只认贴身的连子。 */
const PATTERNS = {
  FIVE: 10000000,   // 成五
  OPEN_FOUR: 500000, // 活四（两端开口的四连）—— 必胜
  FOUR: 20000,       // 冲四（一端被堵的四连，或跳四）
  OPEN_THREE: 12000, // 活三
  THREE: 600,        // 眠三
  OPEN_TWO: 350,
  TWO: 60,
};

/* 单方向扫描。以 (r,c) 为落点（假定该点已属于 side），沿 (dr,dc) 的正负两侧统计：
   - cnt     ：贴身的同色连子总数（含落点本身）
   - openEnds：两端「最近一格为空」的端数（0/1/2），即该连子是否可延伸
   - jump    ：某一端「空一格后仍是同色」的跳型标志（用于识别跳活三/跳四）
   注意：旧实现把「遇到空格就停」和「记录第一个空点」混在一起，
   导致 open 恒为 0，五连与活四都识别不出来。 */
function dirStats(bd, r, c, dr, dc, side) {
  let cnt = 1;
  let openEnds = 0;
  let jump = false;
  for (const sign of [1, -1]) {
    let k = 1;
    // 先走连续同色子
    while (true) {
      const rr = r + dr * k * sign, cc = c + dc * k * sign;
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) break;
      if (bd[rr * SIZE + cc] !== side) break;
      cnt++; k++;
    }
    // 再看紧跟的那一格
    const rr = r + dr * k * sign, cc = c + dc * k * sign;
    if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue; // 边界封死
    if (bd[rr * SIZE + cc] === 0) {
      openEnds++;
      // 探测跳型：空一格之后是否还有同色子
      const r2 = r + dr * (k + 1) * sign, c2 = c + dc * (k + 1) * sign;
      if (r2 >= 0 && r2 < SIZE && c2 >= 0 && c2 < SIZE && bd[r2 * SIZE + c2] === side) jump = true;
    }
    // 否则被对方子封死该端
  }
  return { cnt, openEnds, jump };
}

function lineScoreOf(stats) {
  const { cnt, openEnds, jump } = stats;
  if (cnt >= 5) return PATTERNS.FIVE;
  if (openEnds === 0) return 0;
  if (cnt === 4) return openEnds === 2 ? PATTERNS.OPEN_FOUR : PATTERNS.FOUR;
  // 跳四（如 X_XXX / XX_X）：本身就是冲四
  if (cnt === 3 && jump && openEnds >= 1) return PATTERNS.FOUR;
  if (cnt === 3) return openEnds === 2 ? PATTERNS.OPEN_THREE : PATTERNS.THREE;
  // 跳三：XX_X 之类，按活三的下位处理
  if (cnt === 2 && jump && openEnds === 2) return PATTERNS.OPEN_THREE;
  if (cnt === 2) return openEnds === 2 ? PATTERNS.OPEN_TWO : PATTERNS.TWO;
  return openEnds === 2 ? 30 : 5;
}

/* 假设 side 在 i 落子，四个方向的启发分之和；同时返回是否形成活四/成五 */
function scorePoint(bd, i, side, detail) {
  const r = (i / SIZE) | 0, c = i % SIZE;
  let total = 0;
  if (detail) { detail.five = false; detail.openFour = 0; detail.four = 0; detail.openThree = 0; }
  for (const [dr, dc] of DIRS) {
    const st = dirStats(bd, r, c, dr, dc, side);
    const s = lineScoreOf(st);
    total += s;
    if (detail) {
      if (s === PATTERNS.FIVE) detail.five = true;
      else if (s === PATTERNS.OPEN_FOUR) detail.openFour++;
      else if (s === PATTERNS.FOUR) detail.four++;
      else if (s === PATTERNS.OPEN_THREE) detail.openThree++;
    }
  }
  // 双四 / 四三 / 双活三 都是「双重威胁」，单纯相加不足以体现其致命性
  if (detail) {
    const dblFour = detail.four + detail.openFour >= 2;
    const fourThree = (detail.four + detail.openFour >= 1) && detail.openThree >= 1;
    const dblThree = detail.openThree >= 2;
    if (dblFour) total += 400000;
    else if (fourThree) total += 120000;
    else if (dblThree) total += 40000;
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

/* AI 落子。
   决策优先级（先手必杀，再谈分值）：
     1. 自己能成五 → 直接赢
     2. 对方能成五 → 必堵（若有多点则堵分值最高的）
     3. 自己能造活四/双四 → 直接走
     4. 对方能造活四 → 必须压制
     5. 其余按「进攻 + 防守 × 权重」评分，困难档不加随机噪声 */
export function bestMove(bd, me, hard) {
  const opp = me === 1 ? 2 : 1;
  const cands = candidates(bd);
  if (!cands.length) return { idx: null };

  let best = cands[0], bestScore = -Infinity;
  let blockFive = -1, blockFiveScore = -Infinity;
  let myWin = -1, myStrong = -1, myStrongScore = -Infinity;
  let oppStrong = -1, oppStrongScore = -Infinity;

  for (const i of cands) {
    if (bd[i]) continue;
    const mine = { five: false, openFour: 0, four: 0, openThree: 0 };
    const theirs = { five: false, openFour: 0, four: 0, openThree: 0 };
    const atk = scorePoint(bd, i, me, mine);
    const def = scorePoint(bd, i, opp, theirs);

    if (mine.five) { myWin = i; break; }                    // 1
    if (theirs.five && def > blockFiveScore) { blockFive = i; blockFiveScore = def; } // 2

    // 自己能造活四 或 双四 → 必胜手
    if (mine.openFour >= 1 || (mine.four + mine.openFour) >= 2) {
      if (atk > myStrongScore) { myStrong = i; myStrongScore = atk; }
    }
    // 对方能造活四 → 必须优先压制
    if (theirs.openFour >= 1 || (theirs.four + theirs.openFour) >= 2) {
      if (def > oppStrongScore) { oppStrong = i; oppStrongScore = def; }
    }

    const w = hard ? 0.85 : 0.6;
    const s = atk + def * w + Math.random() * (hard ? 4 : 55);
    if (s > bestScore) { bestScore = s; best = i; }
  }

  if (myWin >= 0) return { idx: myWin, win: true };      // 1
  if (blockFive >= 0) return { idx: blockFive, win: true }; // 2（被迫堵）
  if (myStrong >= 0) return { idx: myStrong, win: true };   // 3
  if (oppStrong >= 0) return { idx: oppStrong, win: false }; // 4
  return { idx: best, win: bestScore >= PATTERNS.OPEN_FOUR };
}
