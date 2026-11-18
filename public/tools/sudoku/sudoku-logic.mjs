// Shared, deterministic candidate propagation. No whole-grid guesses or backtracking.
const ALL = 0x3fe;
const CELLS = Array.from({ length: 81 }, (_, i) => i);
const DIGITS = Array.from({ length: 9 }, (_, i) => 2 << i);
const singleton = (m) => m !== 0 && !(m & (m - 1));
const digit = (m) => Math.log2(m);
const HOUSE_OF = CELLS.map((i) => [Math.floor(i / 9), 9 + i % 9,
  18 + 3 * Math.floor(i / 27) + Math.floor(i % 9 / 3)]);
const HOUSES = Array.from({ length: 27 }, (_, h) => CELLS.filter((i) => HOUSE_OF[i].includes(h)));
const PEERS = CELLS.map((i) => CELLS.filter((j) => i !== j && HOUSE_OF[i].some((h) => HOUSE_OF[j].includes(h))));
const LOCKS = HOUSES.map((unit, a) => HOUSES.flatMap((other, b) => {
  const inside = unit.filter((i) => HOUSE_OF[i].includes(b));
  return a !== b && inside.length > 1
    ? [{ inside, outside: other.filter((i) => !HOUSE_OF[i].includes(a)) }]
    : [];
}));

const SUM = new Uint8Array(ALL + 1);
for (let m = 2; m <= ALL; m += 2) SUM[m] = SUM[m & (m - 1)] + digit(m & -m);

function candidates(board) {
  if (board?.length !== 81) return null;
  const masks = new Uint16Array(81);
  for (const i of CELLS) {
    const value = board[i];
    if (!Number.isInteger(value) || value < 0 || value > 9) return null;
    masks[i] = value ? 1 << value : ALL;
  }
  return masks;
}

function propagate(masks, cages = [], cageOf = [], extraSums = []) {
  const propagated = new Uint8Array(81);
  let change;
  const keep = (i, allowed) => {
    const m = masks[i] & allowed;
    if (m !== masks[i]) { masks[i] = m; change = true; }
  };
  do {
    change = false;
    for (const i of CELLS) {
      const bit = masks[i];
      if (!singleton(bit) || propagated[i]) continue;
      propagated[i] = 1;
      for (const j of PEERS[i]) keep(j, ~bit);
    }
    for (let h = 0; h < 27; h++) {
      const house = HOUSES[h];
      for (const bit of DIGITS) {
        let only = -1;
        for (const i of house) {
          if (!(masks[i] & bit)) continue;
          if (only !== -1) { only = -2; break; }
          only = i;
        }
        if (only === -1) return false;
        if (only >= 0) keep(only, bit);
      }
      for (const { inside, outside } of LOCKS[h]) {
        let confined = 0;
        for (const i of inside) confined |= masks[i];
        for (const i of house) if (!inside.includes(i)) confined &= ~masks[i];
        if (confined) for (const i of outside) keep(i, ~confined);
      }
      for (const i of house) {
        const pair = masks[i];
        if (!pair || singleton(pair) || !singleton(pair & (pair - 1))) continue;
        if (house.filter((j) => masks[j] === pair).length === 2) {
          for (const j of house) if (masks[j] !== pair) keep(j, ~pair);
        }
      }
    }
    if (change) continue; // Exhaust simpler rules before looking at sums.
    for (const { cells, sum } of cages) {
      const match = cageSupports(cells, sum, masks);
      if (!match) return false;
      cells.forEach((i, k) => keep(i, match.support[k]));
      // A digit present in every feasible combination is locked to its cage positions.
      for (const bit of DIGITS) {
        if (!(match.required & bit)) continue;
        const sites = cells.filter((i) => masks[i] & bit);
        for (const h of HOUSE_OF[sites[0]]) {
          if (sites.every((i) => HOUSE_OF[i].includes(h))) {
            for (const i of HOUSES[h]) if (cageOf[i] !== cageOf[sites[0]]) keep(i, ~bit);
          }
        }
      }
    }
    if (change) continue;
    for (const { cells, sum, conflict } of extraSums) {
      const support = sumSupports(cells, sum, conflict, masks);
      if (!support) return false;
      cells.forEach((i, k) => keep(i, support[k]));
    }
  } while (change && masks.every(Boolean));
  return masks.every(Boolean);
}

// Match distinct digits to cage cells by subset DP. Walk the reachable subsets
// backwards to keep precisely the digits supported at each position.
function cageSupports(cells, sum, masks) {
  const forward = [new Set([0])];
  for (const i of cells) {
    const next = new Set();
    for (const used of forward.at(-1)) {
      for (let bits = masks[i] & ~used; bits; bits &= bits - 1) {
        const after = used | (bits & -bits);
        if (SUM[after] <= sum) next.add(after);
      }
    }
    if (!next.size) return null;
    forward.push(next);
  }
  let valid = new Set([...forward.at(-1)].filter((m) => SUM[m] === sum));
  if (!valid.size) return null;
  let required = ALL;
  for (const m of valid) required &= m;
  const support = new Uint16Array(cells.length);
  for (let k = cells.length - 1; k >= 0; k--) {
    const previous = new Set();
    for (const used of forward[k]) {
      for (let bits = masks[cells[k]] & ~used; bits; bits &= bits - 1) {
        const bit = bits & -bits;
        if (valid.has(used | bit)) { support[k] |= bit; previous.add(used); }
      }
    }
    valid = previous;
  }
  return { support, required };
}

const REGIONS = HOUSES.map((cells) => ({ cells, sum: 45 }));
for (let a = 0; a < 27; a++) {
  for (let b = a + 1; b < (Math.floor(a / 9) + 1) * 9; b++) {
    REGIONS.push({ cells: [...HOUSES[a], ...HOUSES[b]], sum: 90 });
  }
}

function rule45(cages, cageOf) {
  const sums = new Map();
  const add = (cells, sum) => {
    // ponytail: match up to three boundary cells; larger regions are intentionally skipped.
    if (!cells.length || cells.length > 3) return;
    cells.sort((a, b) => a - b);
    const key = `${cells}:${sum}`;
    if (sums.has(key)) return;
    const conflict = (a, b) => cells.length > b && (
      PEERS[cells[a]].includes(cells[b]) || cageOf[cells[a]] === cageOf[cells[b]]);
    sums.set(key, { cells, sum, conflict: [conflict(0, 1), conflict(0, 2), conflict(1, 2)] });
  };
  for (const { cells, sum } of REGIONS) {
    const region = new Set(cells);
    const covered = new Set();
    const outside = [];
    let containedSum = 0, touchingSum = 0;
    for (const cage of cages) {
      const extra = cage.cells.filter((i) => !region.has(i));
      if (extra.length === cage.cells.length) continue;
      touchingSum += cage.sum;
      outside.push(...extra);
      if (!extra.length) {
        containedSum += cage.sum;
        for (const i of cage.cells) covered.add(i);
      }
    }
    add(cells.filter((i) => !covered.has(i)), sum - containedSum);
    add(outside, touchingSum - sum);
  }
  return [...sums.values()];
}

// A 45-rule boundary may include equal digits when cells are not peers or cage-mates.
function sumSupports(cells, sum, [ab, ac, bc], masks) {
  const [a, b, c] = cells;
  const support = [0, 0, 0];
  for (let as = masks[a]; as; as &= as - 1) {
    const x = as & -as;
    const remainder = sum - digit(x);
    if (b === undefined) {
      if (!remainder) support[0] |= x;
      continue;
    }
    for (let bs = masks[b] & ~(ab ? x : 0); bs; bs &= bs - 1) {
      const y = bs & -bs;
      const z = remainder - digit(y);
      if (c === undefined ? z !== 0 : z < 1 || z > 9 || !(masks[c] & (1 << z) & ~(ac ? x : 0) & ~(bc ? y : 0))) continue;
      support[0] |= x;
      support[1] |= y;
      support[2] |= 1 << z;
    }
  }
  return support[0] ? support : null;
}

/** Check a classic 81-cell numeric board (0 = empty). Does not mutate it. */
export function isNoGuess(board) {
  const masks = candidates(board);
  return !!masks && propagate(masks) && masks.every(singleton);
}

/** Solve by deduction only. Cages are [sum, cells]; board has optional givens. */
export function solveKillerLogically(cages, board = new Uint8Array(81)) {
  const masks = candidates(board);
  if (!masks || !Array.isArray(cages)) return { status: 'invalid' };
  const cageOf = new Int8Array(81).fill(-1);
  const groups = [];
  for (const cage of cages) {
    if (!Array.isArray(cage)) return { status: 'invalid' };
    const [sum, cells] = cage;
    if (!Number.isInteger(sum) || sum < 1 || sum > 45 || !Array.isArray(cells)
      || !cells.length || cells.length > 9) return { status: 'invalid' };
    for (const i of cells) {
      if (!Number.isInteger(i) || i < 0 || i >= 81 || cageOf[i] !== -1) return { status: 'invalid' };
      cageOf[i] = groups.length;
    }
    if (cells.length === 1) {
      if (sum > 9 || !(masks[cells[0]] & (1 << sum))) return { status: 'invalid' };
      masks[cells[0]] = 1 << sum;
    }
    groups.push({ sum, cells });
  }
  if (cageOf.includes(-1) || !propagate(masks, groups, cageOf, rule45(groups, cageOf))) return { status: 'invalid' };
  const values = Uint8Array.from(masks, (m) => singleton(m) ? digit(m) : 0);
  return { status: values.includes(0) ? 'stalled' : 'solved', values, masks };
}
