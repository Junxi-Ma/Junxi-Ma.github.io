// Repair the existing bank, without generating replacement grids or cages.
// node scripts/gen-killer-puzzles.mjs          # rebuild optional givens in place
// node scripts/gen-killer-puzzles.mjs --check  # read-only regression and bank check
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { isNoGuess, solveKillerLogically } from '../public/tools/sudoku/sudoku-logic.mjs';

const file = new URL('../public/tools/sudoku/killer-puzzles.json', import.meta.url);
const tiers = ['easy', 'medium', 'hard', 'expert'];
const checkOnly = process.argv[2] === '--check';
assert(process.argv.length <= 3 && (process.argv.length === 2 || checkOnly),
  'Usage: node scripts/gen-killer-puzzles.mjs [--check]');
const text = readFileSync(file, 'utf8');
const bank = JSON.parse(text);
assert.equal(bank.v, 1);
assert.deepEqual(Object.keys(bank.puzzles).sort(), [...tiers].sort());

const puzzle = Int8Array.from('530070000600195000098000060800060003400803001700020006060000280000419005000080079', Number);
const before = puzzle.slice();
assert(isNoGuess(puzzle), 'classic puzzle must solve by deduction');
assert.deepEqual(puzzle, before, 'classic validation must not mutate its input');
assert(!isNoGuess(new Uint8Array(81)), 'empty classic puzzle must stall');
assert(!isNoGuess(Int8Array.from('100007090030020008009600500005300900010080002600004000300000010040000007007000300', Number)),
  'a unique but logic-stalled classic puzzle must not pass');
puzzle[1] = puzzle[0];
assert(!isNoGuess(puzzle), 'duplicate classic givens must not pass');
assert(!isNoGuess([0]), 'malformed classic puzzle must not pass');
assert.equal(solveKillerLogically([]).status, 'invalid', 'missing cages must not pass');

const clueBoard = (p, indices = p.g ?? []) => {
  const board = new Uint8Array(81);
  for (const i of indices) board[i] = Number(p.s[i]);
  return board;
};

const stats = [];
for (const tier of tiers) {
  const pool = bank.puzzles[tier];
  assert.equal(pool.length, 16, `${tier}: expected 16 puzzles`);
  assert.equal(new Set(pool.map((p) => p.id)).size, pool.length, `${tier}: duplicate IDs`);
  let original = 0, final = 0, added = 0;
  const clueCounts = [];
  for (const p of pool) {
    const name = `${tier}/${p.id}`;
    assert.match(p.s, /^[1-9]{81}$/, `${name}: malformed solution`);
    assert(isNoGuess(Uint8Array.from(p.s, Number)), `${name}: invalid solution grid`);
    const singles = new Set();
    for (const [sum, cells] of p.c) {
      const digits = cells.map((i) => Number(p.s[i]));
      assert.equal(new Set(digits).size, cells.length, `${name}: repeated digit in cage`);
      assert.equal(digits.reduce((a, b) => a + b, 0), sum, `${name}: wrong cage sum`);
      if (cells.length === 1) singles.add(cells[0]);
    }
    // The original puzzle is exactly the same cages without the added givens.
    const base = solveKillerLogically(p.c);
    assert.notEqual(base.status, 'invalid', `${name}: invalid cages`);
    if (base.status === 'solved') original++;
    if (!checkOnly) {
      delete p.g;
      // Bound repair to one given, chosen in board order. Each run uses an
      // explicit added clue; the validator itself never assumes a value.
      if (base.status === 'stalled') {
        for (let i = 0; i < 81; i++) {
          if (!base.values[i] && solveKillerLogically(p.c, clueBoard(p, [i])).status === 'solved') {
            p.g = [i];
            break;
          }
        }
      }
    }
    const given = p.g === undefined ? [] : p.g;
    assert(Array.isArray(given) && given.length <= 1 && given.every((i) =>
      Number.isInteger(i) && i >= 0 && i < 81 && !singles.has(i) && !base.values[i]),
    `${name}: invalid or redundant added given`);
    const result = given.length ? solveKillerLogically(p.c, clueBoard(p)) : base;
    assert.equal(result.status, 'solved', `${name}: stalls without guessing`);
    assert.equal(result.values.join(''), p.s, `${name}: deduction differs from stored solution`);
    final++;
    added += given.length;
    clueCounts.push(singles.size + given.length);
  }
  stats.push({ tier, original: `${original}/${pool.length}`, final: `${final}/${pool.length}`,
    added, visibleClues: `${Math.min(...clueCounts)}–${Math.max(...clueCounts)}` });
}
console.table(stats);

if (!checkOnly) {
  const output = '{\n  "v": 1,\n  "puzzles": {\n' + tiers.map((tier) =>
    `    "${tier}": [\n${bank.puzzles[tier].map((p) => '      ' + JSON.stringify(p)).join(',\n')}\n    ]`,
  ).join(',\n') + '\n  }\n}\n';
  if (output !== text) writeFileSync(file, output);
}
