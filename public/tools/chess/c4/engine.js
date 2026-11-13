/* 4×4×4 重力四子棋：坐标 i = z * 16 + y * 4 + x，底层 z=0。 */
export const emptyBoard = () => new Int8Array(64);
export const label = (col) => String.fromCharCode(65 + col % 4) + (Math.floor(col / 4) + 1);
export function landing(bd, col) {
  if (!Number.isInteger(col) || col < 0 || col > 15) return -1;
  for (let z = 0; z < 4; z++) if (!bd[z * 16 + col]) return z * 16 + col;
  return -1;
}
export const LINES = [];
for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
  if (!dx && !dy && !dz) continue;
  if ((dz || dy || dx) < 0) continue;
  for (let z = 0; z < 4; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const end = [x + 3 * dx, y + 3 * dy, z + 3 * dz];
    if (end.some(v => v < 0 || v > 3)) continue;
    LINES.push(Array.from({ length: 4 }, (_, n) => (z + n * dz) * 16 + (y + n * dy) * 4 + x + n * dx));
  }
}
const through = Array.from({ length: 64 }, (_, i) => LINES.filter(l => l.includes(i)));
export function winningLine(bd, last) {
  return (last == null ? LINES : through[last] || []).find(l => bd[l[0]] && l.every(i => bd[i] === bd[l[0]])) || null;
}
export function replay(moves) {
  if (!Array.isArray(moves) || moves.length > 64) return null;
  const bd = emptyBoard();
  for (const col of moves) {
    if (winningLine(bd)) return null;
    const i = landing(bd, col);
    if (i < 0) return null;
    bd[i] = bd.reduce((n, v) => n + !!v, 0) % 2 + 1;
  }
  return bd;
}
export function bestMove(board, me, level = 1) {
  const bd = Int8Array.from(board), enemy = 3 - me;
  const order = [5, 6, 9, 10, 1, 2, 4, 7, 8, 11, 13, 14, 0, 3, 12, 15];
  const legal = () => order.filter(c => landing(bd, c) >= 0);
  const instant = side => legal().find(c => { const i = landing(bd, c); bd[i] = side; const win = !!winningLine(bd, i); bd[i] = 0; return win; });
  const win = instant(me); if (win != null) return win;
  const block = instant(enemy); if (block != null) return block;
  const available = legal(); if (!available.length) return -1;
  if (level === 0) return available[Math.floor(Math.random() * available.length)];
  const evaluate = side => {
    let score = 0;
    for (const line of LINES) {
      let a = 0, b = 0;
      for (const i of line) { if (bd[i] === side) a++; else if (bd[i]) b++; }
      if (!b) score += [0, 2, 18, 140, 100000][a];
      if (!a) score -= [0, 2, 18, 140, 100000][b];
    }
    return score;
  };
  // ponytail: bounded alpha-beta; transposition caching only if deeper levels are added.
  let nodes = 0;
  const deadline = performance.now() + (level === 2 ? 650 : 180);
  function search(side, depth, alpha, beta, last) {
    if (last != null && winningLine(bd, last)) return -100000 - depth;
    if (++nodes % 128 === 0 && performance.now() > deadline) throw new Error('budget');
    const choices = legal();
    if (!choices.length) return 0;
    if (!depth) return evaluate(side);
    let score = -Infinity;
    for (const col of choices) {
      const i = landing(bd, col); bd[i] = side;
      let value;
      try { value = -search(3 - side, depth - 1, -beta, -alpha, i); } finally { bd[i] = 0; }
      score = Math.max(score, value); alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return score;
  }
  let best = available[0];
  for (let depth = 1; depth <= (level === 2 ? 5 : 3); depth++) {
    let pick = best, alpha = -Infinity;
    try {
      for (const col of [best, ...available.filter(c => c !== best)]) {
        const i = landing(bd, col); bd[i] = me;
        let value;
        try { value = -search(enemy, depth - 1, -Infinity, -alpha, i); } finally { bd[i] = 0; }
        if (value > alpha) { alpha = value; pick = col; }
      }
      best = pick;
    } catch (err) { if (err.message !== 'budget') throw err; break; }
  }
  return best;
}

