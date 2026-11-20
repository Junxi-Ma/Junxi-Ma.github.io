// 推导器正确性验证（soundness）。
// masks 只减不增，所以「最终 masks 仍包含真解」⟺「整个推导过程从未删掉正确值」。
// 这一条同时覆盖三件事：有真解时不能判无解；判 solved 时结果必为真解；判 stalled 时没删过正确候选。
import assert from 'node:assert/strict';
import { randomFullGrid, solveKillerLogically, isNoGuess, solveLogically } from '../public/tools/sudoku/sudoku-logic.mjs';
import { TIERS } from '../public/tools/sudoku/killer-gen.mjs';

const NEIGH = Array.from({ length: 81 }, (_, i) => {
  const r = (i / 9) | 0, c = i % 9, out = [];
  if (c > 0) out.push(i - 1);
  if (c < 8) out.push(i + 1);
  if (r > 0) out.push(i - 9);
  if (r < 8) out.push(i + 9);
  return out;
});
const shuffled = (n) => {
  const list = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [list[i], list[j]] = [list[j], list[i]]; }
  return list;
};
function grow(grid, weights, maxSize) {
  const open = new Uint8Array(81).fill(1);
  const cages = [];
  for (const seed of shuffled(81)) {
    if (!open[seed]) continue;
    open[seed] = 0;
    const cells = [seed];
    let digits = 1 << grid[seed];
    let x = Math.random(), want = weights.length;
    for (let k = 0; k < weights.length; k++) { x -= weights[k]; if (x < 0) { want = k + 1; break; } }
    want = Math.min(want, maxSize);
    while (cells.length < want) {
      const fits = [];
      for (const i of cells) for (const j of NEIGH[i]) if (open[j] && !(digits & (1 << grid[j]))) fits.push(j);
      if (!fits.length) break;
      const next = fits[(Math.random() * fits.length) | 0];
      open[next] = 0; cells.push(next); digits |= 1 << grid[next];
    }
    cells.sort((a, b) => a - b);
    cages.push([cells.reduce((s, i) => s + grid[i], 0), cells]);
  }
  return cages;
}

const stats = { cases: 0, solved: 0, stalled: 0, invalid: 0 };
let checks = 0;

function check(cages, board, grid, label) {
  const r = solveKillerLogically(cages, board);
  checks++;
  assert.notEqual(r.status, 'invalid', `${label}：盘面有真解，推导器却判无解`);
  stats[r.status]++;
  for (let i = 0; i < 81; i++) {
    assert.ok(r.masks[i] & (1 << grid[i]),
      `${label}：第 ${i} 格真值 ${grid[i]} 被删掉了，剩 ${r.masks[i].toString(2)}`);
  }
  if (r.status === 'solved') {
    assert.equal(r.values.join(''), Array.from(grid).join(''), `${label}：推导结果不是真解`);
    // 再独立核一遍约束，防止「推出来的单例本身违反行列宫或笼子」
    const v = r.values;
    for (let u = 0; u < 9; u++) {
      assert.equal(new Set(v.slice(u * 9, u * 9 + 9)).size, 9, `${label}：第 ${u} 行重复`);
      assert.equal(new Set([...Array(9)].map((_, k) => v[k * 9 + u])).size, 9, `${label}：第 ${u} 列重复`);
    }
    for (const [sum, cells] of cages) {
      assert.equal(cells.reduce((s, i) => s + v[i], 0), sum, `${label}：笼子和值不符`);
      assert.equal(new Set(cells.map((i) => v[i])).size, cells.length, `${label}：笼内重复`);
    }
  }
}

const perTier = Number(process.argv[2] ?? 200);
for (const [tier, cfg] of Object.entries(TIERS)) {
  for (let n = 0; n < perTier; n++) {
    const grid = randomFullGrid();
    const cages = grow(grid, cfg.sizes, cfg.sizes.length);
    // 空盘：只有笼子约束
    check(cages, new Uint8Array(81), grid, `${tier} 空盘`);
    stats.cases++;
    // 补 1 个和 3 个明数（都取自真解）
    for (const k of [1, 3]) {
      const board = new Uint8Array(81);
      for (const i of shuffled(81).slice(0, k)) board[i] = grid[i];
      check(cages, board, grid, `${tier} ${k}明数`);
      stats.cases++;
    }
  }
}

// 普通数独：isNoGuess 判 true 时结果必须等于原盘
let classic = 0;
for (let n = 0; n < Number(process.argv[3] ?? 300); n++) {
  const grid = randomFullGrid();
  const puzzle = Int8Array.from(grid);
  for (const i of shuffled(81).slice(0, 40 + ((Math.random() * 20) | 0))) puzzle[i] = 0;
  if (isNoGuess(puzzle)) {
    const r = solveLogically(Uint8Array.from(puzzle));
    classic++;
    assert.equal(r.status, 'solved', '普通数独：isNoGuess 为真却推不完');
    assert.equal(r.values.join(''), Array.from(grid).join(''), '普通数独：推导结果不是真解');
  }
}

// 普通数独的 soundness：masks 必须始终包含真解，且 isNoGuess 与 solveLogically 判定一致
let classicSound = 0;
for (let n = 0; n < Number(process.argv[3] ?? 300); n++) {
  const grid = randomFullGrid();
  const puzzle = Int8Array.from(grid);
  for (const i of shuffled(81).slice(0, 30 + ((Math.random() * 40) | 0))) puzzle[i] = 0;
  const r = solveLogically(Uint8Array.from(puzzle));
  assert.notEqual(r.status, 'invalid', '普通数独：盘面有真解，推导器却判无解');
  for (let i = 0; i < 81; i++) {
    assert.ok(r.masks[i] & (1 << grid[i]), `普通数独：第 ${i} 格真值被删`);
  }
  assert.equal(isNoGuess(Uint8Array.from(puzzle)), r.status === 'solved', '普通数独：两条入口判定不一致');
  classicSound++;
}

console.log('推导器验证通过', { ...stats, isNoGuess为真的样本: classic, 普通数独soundness检验: classicSound });
