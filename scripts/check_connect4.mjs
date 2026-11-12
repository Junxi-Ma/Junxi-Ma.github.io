import assert from 'node:assert/strict';
import { emptyBoard, landing, LINES, winningLine, replay, bestMove } from '../tools/connect4/engine.js';
assert.equal(LINES.length, 76);
assert.equal(new Set(LINES.map(l => l.join(','))).size, 76);
for (const line of LINES) {
  const bd = emptyBoard(); line.forEach(i => bd[i] = 1);
  assert.deepEqual(winningLine(bd), line);
  for (const i of line) assert.deepEqual(winningLine(bd, i), line);
  bd[line[0]] = 2; assert.equal(winningLine(bd), null);
}
const bd = emptyBoard();
for (let z = 0; z < 4; z++) { assert.equal(landing(bd, 5), z * 16 + 5); bd[z * 16 + 5] = z % 2 + 1; }
assert.equal(landing(bd, 5), -1);
for (const col of [-1, 16, 1.5, undefined, '5']) assert.equal(landing(bd, col), -1);
assert.equal(replay([5, 5, 5, 5, 5]), null);
assert.equal(replay([0, 4, 1, 4, 2, 4, 3, 8]), null);
assert.equal(replay([0, 4, 1, 4, 2, 4, 3])[3], 1);
assert.equal(replay([NaN]), null);
const tactical = emptyBoard(); tactical[0] = tactical[1] = tactical[2] = 1;
assert.equal(bestMove(tactical, 1, 2), 3);
assert.equal(bestMove(tactical, 2, 2), 3);
const before = Array.from(tactical); bestMove(tactical, 2, 1); assert.deepEqual(Array.from(tactical), before);
for (const level of [0, 1, 2]) {
  const board = emptyBoard(), original = Array.from(board), move = bestMove(board, 1, level);
  assert.ok(landing(board, move) >= 0); assert.deepEqual(Array.from(board), original);
}
console.log('PASS: all 76 lines, gravity, full/invalid columns, legal replay, tactical AI, and search immutability');
