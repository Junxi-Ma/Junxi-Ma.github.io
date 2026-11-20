/* 杀手数独出题：铺一张随机终盘，在终盘上长出连通的笼子，只收「共享推导器不猜就能推完」的那一版。
   推导规则只会剔除任何解都用不上的值，所以推完即唯一 —— 判可推导也就是判唯一。

   出一题就是反复试：试不中直接换一张终盘重来，不补明数、不降低标准。
   难度只有两个变量，都朝同一方向走：
     · keep  —— 留几个单格笼。单格笼本身就是明数，留得越少越难。
     · sizes —— 笼子大小权重。笼子越大，一个和值摊到每格的信息越少，越难。
   实测最难一档（5 格笼、零明数）纯推导命中率 0.73%，所以那一档要试一百多次才出一题。 */
import { randomFullGrid, solveKillerLogically } from './sudoku-logic.mjs?v=3';

const NEIGH = Array.from({ length: 81 }, (_, i) => {
  const r = (i / 9) | 0, c = i % 9, out = [];
  if (c > 0) out.push(i - 1);
  if (c < 8) out.push(i + 1);
  if (r > 0) out.push(i - 9);
  if (r < 8) out.push(i + 9);
  return out;
});

export const TIERS = {
  easy: { sizes: [0.34, 0.44, 0.22], keep: 18, tries: 60 },
  medium: { sizes: [0.20, 0.32, 0.29, 0.19], keep: 10, tries: 120 },
  hard: { sizes: [0.10, 0.26, 0.32, 0.22, 0.10], keep: 5, tries: 400 },
  expert: { sizes: [0.04, 0.20, 0.32, 0.28, 0.16], keep: 0, tries: 1500 },
};

const shuffled = (n, rnd) => {
  const list = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

function pickSize(weights, rnd) {
  let x = rnd();
  for (let k = 0; k < weights.length; k++) {
    x -= weights[k];
    if (x < 0) return k + 1;
  }
  return weights.length;
}

const sumOf = (grid, cells) => cells.reduce((sum, i) => sum + grid[i], 0);
const distinct = (grid, cells) => new Set(cells.map((i) => grid[i])).size === cells.length;

/* 逐个未分配的格子当种子，向外长到目标大小。终盘本身合法，所以长出来的笼和值就等于笼内数字之和。 */
function growCages(grid, weights, rnd) {
  const open = new Uint8Array(81).fill(1);
  const cages = [];
  for (const seed of shuffled(81, rnd)) {
    if (!open[seed]) continue;
    open[seed] = 0;
    const cells = [seed];
    let digits = 1 << grid[seed];
    for (let want = pickSize(weights, rnd); cells.length < want;) {
      const fits = [];
      for (const i of cells) {
        for (const j of NEIGH[i]) if (open[j] && !(digits & (1 << grid[j]))) fits.push(j);
      }
      if (!fits.length) break;
      const next = fits[(rnd() * fits.length) | 0];
      open[next] = 0;
      cells.push(next);
      digits |= 1 << grid[next];
    }
    cells.sort((a, b) => a - b);
    cages.push([sumOf(grid, cells), cells]);
  }
  return cages;
}

/* 单格笼太多就并进相邻笼（合并后不超 maxSize、笼内数字不重复），把明数压到 keep。 */
function absorbSingles(grid, cages, maxSize, keep, rnd) {
  const owner = new Int8Array(81).fill(-1);
  cages.forEach(([, cells], k) => { for (const i of cells) owner[i] = k; });
  const alive = cages.map(() => true);
  let singles = cages.filter(([, cells]) => cells.length === 1).length;
  for (const [k, [sum, cells]] of cages.entries()) {
    if (singles <= keep) break;
    if (cells.length !== 1 || !alive[k]) continue;
    const i = cells[0];
    const fits = NEIGH[i].map((j) => owner[j]).filter((o) => o >= 0 && alive[o] && o !== k
      && cages[o][1].length < maxSize && distinct(grid, [...cages[o][1], i]));
    if (!fits.length) continue;
    const target = fits[(rnd() * fits.length) | 0];
    // 目标笼自己也是个单格笼时，这次合并一次吃掉两个明数。
    const eaten = cages[target][1].length === 1 ? 2 : 1;
    cages[target] = [sum + cages[target][0], [...cages[target][1], i].sort((a, b) => a - b)];
    alive[k] = false;
    owner[i] = target;
    singles -= eaten;
  }
  return cages.filter((_, k) => alive[k]);
}

/**
 * 造一题。试到上限还造不出返回 null，由调用方回退到静态题库。
 * 返回 { s, c }，与 killer-puzzles.json 里的一题同构。
 */
export function generateKiller(tier, { rnd = Math.random, tries } = {}) {
  const cfg = TIERS[tier];
  if (!cfg) throw new Error('未知难度：' + tier);
  for (let t = 0, limit = tries ?? cfg.tries; t < limit; t++) {
    const grid = randomFullGrid(rnd);
    const cages = absorbSingles(grid, growCages(grid, cfg.sizes, rnd), cfg.sizes.length, cfg.keep, rnd);
    if (cages.filter(([, cells]) => cells.length === 1).length > cfg.keep) continue;
    if (solveKillerLogically(cages).status !== 'solved') continue;
    return { s: Array.from(grid).join(''), c: cages };
  }
  return null;
}

/** 校验一题是否符合出题契约；返回 null 表示通过，否则是原因。题库脚本与自检共用。 */
export function checkKiller(p, tier) {
  const cfg = TIERS[tier];
  if (!cfg) return '未知难度';
  if (typeof p?.s !== 'string' || !/^[1-9]{81}$/.test(p.s)) return '终盘不是 81 位数字';
  const grid = Uint8Array.from(p.s, Number);
  if (!Array.isArray(p.c) || !p.c.length) return '缺少笼子';
  const covered = new Uint8Array(81);
  let singles = 0;
  for (const cage of p.c) {
    if (!Array.isArray(cage) || cage.length !== 2) return '笼子结构不对';
    const [sum, cells] = cage;
    if (!Number.isInteger(sum) || !Array.isArray(cells) || !cells.length || cells.length > cfg.sizes.length)
      return '笼子和值或格数不对';
    if (sumOf(grid, cells) !== sum) return '笼子和值不等于终盘之和';
    if (!distinct(grid, cells)) return '笼内有重复数字';
    for (const i of cells) {
      if (!Number.isInteger(i) || i < 0 || i >= 81 || covered[i]) return '笼子越界或重叠';
      covered[i] = 1;
    }
    if (cells.length === 1) singles++;
  }
  if (covered.includes(0)) return '有格子没有笼子';
  if (singles > cfg.keep) return `明数 ${singles} 超出 ${tier} 上限 ${cfg.keep}`;
  const result = solveKillerLogically(p.c);
  if (result.status !== 'solved') return `不能纯推导推完（${result.status}）`;
  if (result.values.join('') !== p.s) return '推导结果与终盘不一致';
  return null;
}
