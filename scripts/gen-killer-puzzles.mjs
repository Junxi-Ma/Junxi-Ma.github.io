// 生成杀手数独静态题库：每档 PER_TIER 题，全部走与页面同一套出题器，再逐题独立复核。
// node scripts/gen-killer-puzzles.mjs           # 重新生成题库
// node scripts/gen-killer-puzzles.mjs --check   # 只校验现有题库（只读）
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { isNoGuess, solveKillerLogically } from '../public/tools/sudoku/sudoku-logic.mjs';
import { TIERS, generateKiller, checkKiller } from '../public/tools/sudoku/killer-gen.mjs';

const file = new URL('../public/tools/sudoku/killer-puzzles.json', import.meta.url);
const checkOnly = process.argv[2] === '--check';
assert(process.argv.length <= 3 && (process.argv.length === 2 || checkOnly),
  '用法：node scripts/gen-killer-puzzles.mjs [--check]');

const PREFIX = { easy: 'e', medium: 'm', hard: 'h', expert: 'x' };
const PER_TIER = 48;
const tiers = Object.keys(TIERS);

/* 出题器与题库都靠这两个函数，先确认它们本身没坏。 */
const sample = Int8Array.from('530070000600195000098000060800060003400803001700020006060000280000419005000080079', Number);
assert(isNoGuess(sample), '普通难度基准题应能纯推导推完');
assert(!isNoGuess(new Uint8Array(81)), '空盘不应通过');
assert.equal(solveKillerLogically([]).status, 'invalid', '缺笼子不应通过');

const stats = [];
if (checkOnly) {
  const bank = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(bank.puzzles).sort(), [...tiers].sort(), '题库档位不全');
  for (const tier of tiers) {
    const pool = bank.puzzles[tier];
    assert.ok(pool.length >= PER_TIER, `${tier}: 只有 ${pool.length} 题`);
    assert.equal(new Set(pool.map((p) => p.id)).size, pool.length, `${tier}: 题号重复`);
    const clues = [];
    for (const p of pool) {
      const err = checkKiller(p, tier);
      assert.equal(err, null, `${tier}/${p.id}: ${err}`);
      clues.push(p.c.filter(([, cells]) => cells.length === 1).length);
    }
    stats.push({ tier, count: pool.length,
      cages: `${Math.min(...pool.map((p) => p.c.length))}–${Math.max(...pool.map((p) => p.c.length))}`,
      clues: `${Math.min(...clues)}–${Math.max(...clues)}` });
  }
  console.table(stats);
} else {
  const bank = { v: 2, puzzles: {} };
  for (const tier of tiers) {
    const pool = [];
    for (let n = 1; n <= PER_TIER; n++) {
      const p = generateKiller(tier);
      assert.ok(p, `${tier}: 出题器连续失败，请放宽 tries`);
      const id = PREFIX[tier] + String(n).padStart(2, '0');
      pool.push({ id, ...p });
    }
    bank.puzzles[tier] = pool;
    stats.push({ tier, count: pool.length,
      cages: `${Math.min(...pool.map((p) => p.c.length))}–${Math.max(...pool.map((p) => p.c.length))}`,
      clues: `${Math.min(...pool.map((p) => p.c.filter(([, cells]) => cells.length === 1).length))}`
        + `–${Math.max(...pool.map((p) => p.c.filter(([, cells]) => cells.length === 1).length))}` });
  }
  // 写回后再按 --check 的同一套判定复核一遍，避免只信生成器自己。
  for (const tier of tiers) for (const p of bank.puzzles[tier]) {
    assert.equal(checkKiller(p, tier), null, `${tier}/${p.id} 复核未通过`);
  }
  const output = '{\n  "v": 2,\n  "puzzles": {\n' + tiers.map((tier) =>
    `    "${tier}": [\n${bank.puzzles[tier].map((p) => '      ' + JSON.stringify(p)).join(',\n')}\n    ]`,
  ).join(',\n') + '\n  }\n}\n';
  writeFileSync(file, output);
  console.table(stats);
  console.log('写出', output.length, '字节 /', tiers.length * PER_TIER, '题');
}
