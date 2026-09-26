/* ============================================================
   solver.js — 魔方状态模型 + 两阶段求解器（Kociemba 思路）

   · 贴纸模型（54 格）用于输入与显示
   · 角/边模型（置换 + 朝向）用于求解
   · 合法性：分片配对 → 朝向和 → 奇偶性（四条充要条件）
   · 求解：阶段一用 (角朝向 / 边朝向 / 中层块位置) 三张剪枝表把状态
            推进到 G1 子群；阶段二用 (角置换 / 边置换 / 中层置换) 三张表
            解回复原。均为 IDA*，多取几个阶段一解逐个试阶段二。
   · 返回前把解法回放到贴纸上做最终校验。

   纯函数、无 DOM，可在 Node 中单元测试（见 solver.test.mjs）。
   ============================================================ */

/* ================= 向量 ================= */
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const veq = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** 右手系绕轴 ±90° */
function rot(v, axis, dir) {
  const [x, y, z] = v;
  if (axis === 1) return dir > 0 ? [z, y, -x] : [-z, y, x];
  if (axis === 0) return dir > 0 ? [x, -z, y] : [x, z, -y];
  return dir > 0 ? [-y, x, z] : [y, -x, z];
}

/* ================= 贴纸布局 =================
   X=右 Y=上 Z=前；每面按「从外侧正看」的行列定义 */
export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];

const NORMAL = {
  U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1],
  D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1],
};

function slotPos(face, r, c) {
  switch (face) {
    case 'U': return [c - 1, 1, r - 1];
    case 'D': return [c - 1, -1, 1 - r];
    case 'F': return [c - 1, 1 - r, 1];
    case 'B': return [1 - c, 1 - r, -1];
    case 'L': return [-1, 1 - r, c - 1];
    default:  return [1, 1 - r, 1 - c]; // R
  }
}

const FACE_BASE = {};
FACES.forEach((f, i) => { FACE_BASE[f] = i * 9; });

const keyOf = (p, n) => `${p[0]},${p[1]},${p[2]}|${n[0]},${n[1]},${n[2]}`;

const FOLD = [];               // 54 × {p, n}
const INDEX = new Map();       // key → 贴纸下标
FACES.forEach((f) => {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const i = FACE_BASE[f] + r * 3 + c;
      const p = slotPos(f, r, c);
      const n = NORMAL[f];
      FOLD[i] = { p, n };
      INDEX.set(keyOf(p, n), i);
    }
  }
});

export function solvedFacelets() {
  const out = new Array(54);
  for (let i = 0; i < 54; i++) out[i] = FACES[Math.floor(i / 9)];
  return out;
}

export function isSolved(f) {
  return f.every((v, i) => v === FACES[Math.floor(i / 9)]);
}

/* ================= 记号 ================= */
export const MOVE_FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
export const MOVES18 = [];
MOVE_FACES.forEach((f) => MOVES18.push(f, `${f}2`, `${f}'`));
export const PHASE2_MOVES = [
  'U', 'U2', "U'", 'D', 'D2', "D'", 'F2', 'B2', 'L2', 'R2',
];

const MOVE_DEF = {
  U: { axis: 1, layer: 1, dir: -1 },
  D: { axis: 1, layer: -1, dir: 1 },
  R: { axis: 0, layer: 1, dir: -1 },
  L: { axis: 0, layer: -1, dir: 1 },
  F: { axis: 2, layer: 1, dir: -1 },
  B: { axis: 2, layer: -1, dir: 1 },
};

export class CubeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function parseMove(m) {
  const face = m[0];
  const suffix = m.slice(1);
  const def = MOVE_DEF[face];
  if (!def || (suffix !== '' && suffix !== '2' && suffix !== "'")) {
    throw new CubeError('bad-move', `未知步骤：${m}`);
  }
  return { suffix, def };
}

/** 单步作用到贴纸 */
export function applyMove(f, m) {
  const { suffix, def } = parseMove(m);
  const times = suffix === '2' ? 2 : 1;
  const dir = def.dir * (suffix === "'" ? -1 : 1);
  const out = new Array(54);
  for (let i = 0; i < 54; i++) {
    const { p, n } = FOLD[i];
    if (p[def.axis] !== def.layer) { out[i] = f[i]; continue; }
    let pp = p; let nn = n;
    for (let t = 0; t < times; t++) {
      pp = rot(pp, def.axis, -dir);   // 取逆：新格子的颜色来自逆旋转前
      nn = rot(nn, def.axis, -dir);
    }
    out[i] = f[INDEX.get(keyOf(pp, nn))];
  }
  return out;
}

export function applyMoves(f, moves) {
  let cur = f;
  for (const m of moves) cur = applyMove(cur, m);
  return cur;
}

export function invertMove(m) {
  const s = m.slice(1);
  if (s === '2') return `${m[0]}2`;
  return s === "'" ? m[0] : `${m[0]}'`;
}

export function parseScramble(text) {
  const out = [];
  for (const tok of String(text).replace(/[\n\r\t]/g, ' ').split(/\s+/)) {
    if (!tok) continue;
    const t = tok.toUpperCase().replace(/’/g, "'");
    if (!/^([URFDLB])([2']?)$/.test(t)) {
      throw new CubeError('bad-scramble', `看不懂的记号：「${tok}」`);
    }
    out.push(t);
  }
  return out;
}

const WHERE = { U: '上面', D: '下面', R: '右面', L: '左面', F: '前面', B: '后面' };
export function describeMove(m) {
  const s = m.slice(1);
  const w = WHERE[m[0]] || m;
  if (s === '2') return `${w}转 180°`;
  return s === "'" ? `${w}逆时针 90°` : `${w}顺时针 90°`;
}

export function randomScramble(n = 22) {
  const out = [];
  let prev = '';
  while (out.length < n) {
    const f = MOVE_FACES[(Math.random() * 6) | 0];
    if (f === prev) continue;              // 同面连续视为冗余
    prev = f;
    const s = ['', '2', "'"][(Math.random() * 3) | 0];
    out.push(f + s);
  }
  return out;
}

/* ================= 块定义 ================= */
function allCornerPos() {
  const out = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    out.push([x, y, z]);
  }
  return out;
}
function allEdgePos() {
  const out = [];
  for (const f of FOLD) {
    const p = f.p;
    const abs = p.map(Math.abs);
    if (abs.filter((v) => v === 0).length === 1 &&
        !out.some((q) => veq(q, p))) out.push(p);
  }
  return out;
}

const CORNER_SLOTS = allCornerPos();        // 8，下标即块 id
const EDGE_SLOTS = allEdgePos();            // 12，下标即块 id

/** 角块规范贴纸顺序：y 法线打头，且 (n1,n2,n3) 为右手系（全局旋向一致） */
function cornerOrder(pos) {
  const y = [0, Math.sign(pos[1]), 0];
  const x = [Math.sign(pos[0]), 0, 0];
  const z = [0, 0, Math.sign(pos[2])];
  return veq(cross(y, x), z) ? [y, x, z] : [y, z, x];
}

/** 边块规范顺序：y 优先；中层块 z 优先（与标准朝向定义一致） */
function edgeOrder(pos) {
  if (pos[1] !== 0) {
    return [[0, Math.sign(pos[1]), 0], pos[0] !== 0 ? [Math.sign(pos[0]), 0, 0] : [0, 0, Math.sign(pos[2])]];
  }
  return [[0, 0, Math.sign(pos[2])], [Math.sign(pos[0]), 0, 0]];
}

const fi = (pos, n) => INDEX.get(keyOf(pos, n));
const CORNER_ORDER = CORNER_SLOTS.map(cornerOrder);
const EDGE_ORDER = EDGE_SLOTS.map(edgeOrder);

const SOLVED = solvedFacelets();
const CORNER_HOME = CORNER_ORDER.map((ns, i) => ns.map((n) => SOLVED[fi(CORNER_SLOTS[i], n)]));
const EDGE_HOME = EDGE_ORDER.map((ns, i) => ns.map((n) => SOLVED[fi(EDGE_SLOTS[i], n)]));

const CORNER_TYPES = new Map();
CORNER_HOME.forEach((ls, id) => CORNER_TYPES.set([...ls].sort().join(''), id));
const EDGE_TYPES = new Map();
EDGE_HOME.forEach((ls, id) => EDGE_TYPES.set([...ls].sort().join(''), id));

const rotL = (a, k) => a.slice(k).concat(a.slice(0, k));

/* ================= 贴纸 → 状态（含校验） ================= */
export function faceletsToCubie(f) {
  const cp = new Int8Array(8);
  const co = new Int8Array(8);
  const ep = new Int8Array(12);
  const eo = new Int8Array(12);

  // 1) 配对
  const seenC = new Map();
  for (let i = 0; i < 8; i++) {
    const letters = CORNER_ORDER[i].map((n) => f[fi(CORNER_SLOTS[i], n)]);
    const type = CORNER_TYPES.get([...letters].sort().join(''));
    if (type === undefined) {
      throw new CubeError('corner-missing',
        `角块 ${letters.join('')} 在标准魔方上不存在 —— 配色可能排反了（每个角应含 1 个黄白 + 2 个侧面色）`);
    }
    seenC.set(type, (seenC.get(type) || 0) + 1);
    cp[i] = type;
    const home = CORNER_HOME[type];
    const shift = [0, 1, 2].find((k) => rotL(home, k).join('') === letters.join(''));
    if (shift === undefined) {
      throw new CubeError('corner-mirror',
        `角块 ${letters.join('')} 的贴纸顺序是镜像的，物理上不可能出现`);
    }
    co[i] = shift;
  }
  for (const [t, n] of seenC) {
    if (n > 1) throw new CubeError('corner-dup', `角块 ${CORNER_HOME[t].join('')} 出现了 ${n} 次`);
  }

  const seenE = new Map();
  for (let i = 0; i < 12; i++) {
    const letters = EDGE_ORDER[i].map((n) => f[fi(EDGE_SLOTS[i], n)]);
    const type = EDGE_TYPES.get([...letters].sort().join(''));
    if (type === undefined) {
      throw new CubeError('edge-missing',
        `边块 ${letters.join('')} 在标准魔方上不存在 —— 每条边应是两个相邻面的颜色`);
    }
    seenE.set(type, (seenE.get(type) || 0) + 1);
    ep[i] = type;
    eo[i] = EDGE_HOME[type].join('') === letters.join('') ? 0 : 1;
  }
  for (const [t, n] of seenE) {
    if (n > 1) throw new CubeError('edge-dup', `边块 ${EDGE_HOME[t].join('')} 出现了 ${n} 次`);
  }

  // 2) 朝向和
  if (co.reduce((a, b) => a + b, 0) % 3 !== 0) {
    throw new CubeError('twist', '有角块被单独扭转（朝向总和不是 3 的倍数），无法还原');
  }
  if (eo.reduce((a, b) => a + b, 0) % 2 !== 0) {
    throw new CubeError('flip', '有边块被翻转（朝向总和为奇数），无法还原');
  }

  // 3) 奇偶性
  if (permSign(cp) !== permSign(ep)) {
    throw new CubeError('parity', '有两块需要互换（置换奇偶性冲突），无法还原');
  }

  return { cp, co, ep, eo };
}

export function permSign(p) {
  const seen = new Array(p.length).fill(false);
  let sign = 1;
  for (let i = 0; i < p.length; i++) {
    if (seen[i]) continue;
    let len = 0; let j = i;
    while (!seen[j]) { seen[j] = true; j = p[j]; len++; }
    if (len % 2 === 0) sign = -sign;   // 偶长度轮换 = 奇置换
  }
  return sign;
}

/* ================= 角/边移动表（由复原态反推） ================= */
const MOVE_CACHE = new Map();
function cubieMove(m) {
  if (!MOVE_CACHE.has(m)) {
    MOVE_CACHE.set(m, faceletsToCubie(applyMove(SOLVED, m)));
  }
  return MOVE_CACHE.get(m);
}

/** 函数式应用（供测试与推导） */
export function applyCubie(st, m) {
  const d = cubieMove(m);
  const cp = new Int8Array(8); const co = new Int8Array(8);
  const ep = new Int8Array(12); const eo = new Int8Array(12);
  for (let i = 0; i < 8; i++) {
    const s = d.cp[i];
    cp[i] = st.cp[s];
    co[i] = (st.co[s] + d.co[i]) % 3;
  }
  for (let i = 0; i < 12; i++) {
    const s = d.ep[i];
    ep[i] = st.ep[s];
    eo[i] = (st.eo[s] + d.eo[i]) % 2;
  }
  return { cp, co, ep, eo };
}

function applyCubieMany(st, moves) {
  let cur = st;
  for (const m of moves) cur = applyCubie(cur, m);
  return cur;
}

export function cloneState(st) {
  return { cp: st.cp.slice(), co: st.co.slice(), ep: st.ep.slice(), eo: st.eo.slice() };
}

/* ================= 坐标 ================= */
const twistRank = (co) => co.reduce((a, c) => a * 3 + c, 0);
const flipRank = (eo) => eo.reduce((a, e) => a * 2 + e, 0);

/** 中层块所在的槽位下标（升序） */
function slicePositions(st) {
  const out = [];
  for (let i = 0; i < 12; i++) if (EDGE_SLOTS[st.ep[i]][1] === 0) out.push(i);
  return out;
}

const BINOM = (() => {
  const t = Array.from({ length: 13 }, () => new Array(13).fill(1));
  for (let i = 1; i < 13; i++) for (let j = 1; j < i; j++) t[i][j] = t[i - 1][j - 1] + t[i - 1][j];
  return t;
})();
const binom = (n, k) => (k < 0 || k > n ? 0 : BINOM[n][k]);

/** 组合数排名（字典序），与 uncombRank 必须成对 */
export function combRank(pos, n = 12, k = 4) {
  let rank = 0; let c = 0;
  for (let i = 0; i < n && c < k; i++) {
    if (pos[c] === i) { c++; continue; }
    rank += binom(n - 1 - i, k - c - 1);
  }
  return rank;
}
export function uncombRank(rank, n = 12, k = 4) {
  const pos = [];
  let r = rank; let i = 0;
  for (let need = k; need > 0 && i < n; need--) {
    while (i < n) {
      const b = binom(n - 1 - i, need - 1);
      if (r < b) { pos.push(i); i++; break; }
      r -= b; i++;
      if (i >= n) return pos;   // 保底：非法 rank 直接退出
    }
  }
  return pos;
}

/** 排列排名（Lehmer 码） */
function permRank(arr, universe) {
  const idx = new Map(universe.map((v, i) => [v, i]));
  let rank = 0;
  const n = arr.length;
  for (let i = 0; i < n; i++) {
    let less = 0;
    const ai = idx.get(arr[i]);
    for (let j = i + 1; j < n; j++) if (idx.get(arr[j]) < ai) less++;
    rank = rank * (n - i) + less;
  }
  return rank;
}

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320];

/* ================= 阶段二坐标 ================= */
const CORNER_IDS = [0, 1, 2, 3, 4, 5, 6, 7];
/** 边块下标拆分：U/D 层 8 个、中层 4 个 */
const UD_EDGE_IDX = [];
const SLICE_EDGE_IDX = [];
EDGE_SLOTS.forEach((p, i) => (p[1] !== 0 ? UD_EDGE_IDX : SLICE_EDGE_IDX).push(i));
/** 值域（块 id = 家乡槽位下标，故与槽位下标同集合） */
const UD_PIECE_IDS = UD_EDGE_IDX.slice();
const SLICE_PIECE_IDS = SLICE_EDGE_IDX.slice();

/* 表初始化用（一次性，可分配） */
const extractCp = (st) => st.cp;
const extractEp8 = (st) => Int8Array.from(UD_EDGE_IDX.map((i) => st.ep[i]));
const extractSp = (st) => Int8Array.from(SLICE_EDGE_IDX.map((i) => st.ep[i]));

/* 热路径用：复用缓冲，逐节点零分配 */
const _ep8 = new Int8Array(8);
const _sp = new Int8Array(4);
const _slice = new Int8Array(4);
const ep8Of = (st) => {
  for (let i = 0; i < 8; i++) _ep8[i] = st.ep[UD_EDGE_IDX[i]];
  return _ep8;
};
const spOf = (st) => {
  for (let i = 0; i < 4; i++) _sp[i] = st.ep[SLICE_EDGE_IDX[i]];
  return _sp;
};
/** 中层块所在槽位（已按 i 升序，天然有序） */
const sliceInto = (st) => {
  let n = 0;
  for (let i = 0; i < 12; i++) if (EDGE_SLOTS[st.ep[i]][1] === 0) _slice[n++] = i;
  return _slice;
};

/* 排名用的预建索引数组（值域极小，直接用数组比 Map 快一个量级） */
function indexArray(universe, size) {
  const a = new Int8Array(size).fill(-1);
  universe.forEach((v, i) => { a[v] = i; });
  return a;
}
const IDX_CORNER = indexArray(CORNER_IDS, 8);
const IDX_UD = indexArray(UD_PIECE_IDS, 12);
const IDX_SLICE = indexArray(SLICE_PIECE_IDS, 12);

function rankCorner(p) {
  let rank = 0;
  for (let i = 0; i < 8; i++) {
    const ai = IDX_CORNER[p[i]];
    let less = 0;
    for (let j = i + 1; j < 8; j++) if (IDX_CORNER[p[j]] < ai) less++;
    rank = rank * (8 - i) + less;
  }
  return rank;
}
function rankEp8(p) {
  let rank = 0;
  for (let i = 0; i < 8; i++) {
    const ai = IDX_UD[p[i]];
    let less = 0;
    for (let j = i + 1; j < 8; j++) if (IDX_UD[p[j]] < ai) less++;
    rank = rank * (8 - i) + less;
  }
  return rank;
}
function rankSp(p) {
  let rank = 0;
  for (let i = 0; i < 4; i++) {
    const ai = IDX_SLICE[p[i]];
    let less = 0;
    for (let j = i + 1; j < 4; j++) if (IDX_SLICE[p[j]] < ai) less++;
    rank = rank * (4 - i) + less;
  }
  return rank;
}

/* ================= 剪枝表 ================= */
let TABLES = null;

function bfsPerm(start, universe, transition) {
  const size = FACT[universe.length];
  const dist = new Int16Array(size).fill(-1);
  const r0 = permRank(start, universe);
  dist[r0] = 0;
  let frontier = [start.slice()];
  let d = 0;
  while (frontier.length) {
    d++;
    const next = [];
    for (const arr of frontier) {
      for (const m of PHASE2_MOVES) {
        const t = transition(arr, m);
        const r = permRank(t, universe);
        if (dist[r] === -1) { dist[r] = d; next.push(t); }
      }
    }
    frontier = next;
  }
  return dist;
}

export function buildTables() {
  if (TABLES) return TABLES;

  /* ---------- 阶段一 ---------- */
  const distTwist = new Int8Array(6561).fill(-1);   // 3^8
  const distFlip = new Int8Array(4096).fill(-1);    // 2^12（12 条边全参与排名）
  const distSlice = new Int16Array(495).fill(-1);   // C(12,4)
  distTwist[0] = 0; distFlip[0] = 0;
  // 中层槽位组合的「真实」目标排名 —— 不能想当然用 0（0 对应的是前四个槽位）
  const sliceGoalRank = combRank(SLICE_EDGE_IDX);
  distSlice[sliceGoalRank] = 0;

  { // 角朝向
    let front = [Int8Array.from([0, 0, 0, 0, 0, 0, 0, 0])];
    let d = 0;
    while (front.length) {
      d++;
      const next = [];
      for (const co of front) {
        for (const m of MOVES18) {
          const dm = cubieMove(m);
          const nc = new Int8Array(8);
          for (let i = 0; i < 8; i++) nc[i] = (co[dm.cp[i]] + dm.co[i]) % 3;
          const k = twistRank(nc);
          if (distTwist[k] === -1) { distTwist[k] = d; next.push(nc); }
        }
      }
      front = next;
    }
  }
  { // 边朝向
    let front = [new Int8Array(12)];
    let d = 0;
    while (front.length) {
      d++;
      const next = [];
      for (const eo of front) {
        for (const m of MOVES18) {
          const dm = cubieMove(m);
          const ne = new Int8Array(12);
          for (let i = 0; i < 12; i++) ne[i] = (eo[dm.ep[i]] + dm.eo[i]) % 2;
          const k = flipRank(ne);
          if (distFlip[k] === -1) { distFlip[k] = d; next.push(ne); }
        }
      }
      front = next;
    }
  }
  { // 中层块位置集合
    let front = [SLICE_EDGE_IDX.slice()];
    let d = 0;
    const done = new Set([sliceGoalRank]);
    while (front.length) {
      d++;
      const next = [];
      for (const pos of front) {
        const set = new Set(pos);
        for (const m of MOVES18) {
          const dm = cubieMove(m);
          const inv = new Int8Array(12);       // inv[p] = 块从槽 p 移到的槽
          for (let j = 0; j < 12; j++) inv[dm.ep[j]] = j;
          const nset = [];
          for (const p of set) nset.push(inv[p]);
          nset.sort((a, b) => a - b);
          const k = combRank(nset);
          if (!done.has(k)) { done.add(k); distSlice[k] = d; next.push(nset); }
        }
      }
      front = next;
    }
  }

  /* ---------- 阶段二 ---------- */
  const solved = faceletsToCubie(SOLVED);
  const distCp = bfsPerm(extractCp(solved), CORNER_IDS, (arr, m) => {
    const dm = cubieMove(m);
    return Int8Array.from(arr.map((_, i) => arr[dm.cp[i]]));
  });
  const distEp8 = bfsPerm(extractEp8(solved), UD_PIECE_IDS, (arr, m) => {
    const dm = cubieMove(m);
    return Int8Array.from(UD_EDGE_IDX.map((slot) => arr[UD_EDGE_IDX.indexOf(dm.ep[slot])]));
  });
  const distSp = bfsPerm(extractSp(solved), SLICE_PIECE_IDS, (arr, m) => {
    const dm = cubieMove(m);
    return Int8Array.from(SLICE_EDGE_IDX.map((slot) => arr[SLICE_EDGE_IDX.indexOf(dm.ep[slot])]));
  });

  TABLES = { distTwist, distFlip, distSlice, distCp, distEp8, distSp };
  return TABLES;
}

/* ================= 启发函数 ================= */
export function h1(st) {
  const t = buildTables();
  let tw = 0;
  for (let i = 0; i < 8; i++) tw = tw * 3 + st.co[i];
  let fl = 0;
  for (let i = 0; i < 12; i++) fl = fl * 2 + st.eo[i];
  return Math.max(
    t.distTwist[tw],
    t.distFlip[fl],
    t.distSlice[combRank(sliceInto(st))],
  );
}

export function coord2(st) {
  const t = buildTables();
  return Math.max(
    t.distCp[rankCorner(st.cp)],
    t.distEp8[rankEp8(ep8Of(st))],
    t.distSp[rankSp(spOf(st))],
  );
}


/** 诊断：把 h1 的三个分量拆开（仅供测试用） */
export function h1debug(st) {
  const t = buildTables();
  const tw = twistRank(st.co);
  const fl = flipRank(st.eo);
  const sl = combRank(slicePositions(st));
  return {
    tw, fl, sl,
    dTw: t.distTwist[tw], dFl: t.distFlip[fl], dSl: t.distSlice[sl],
    co: [...st.co], eo: [...st.eo], slice: slicePositions(st),
  };
}

/* ================= IDA* ================= */
const LAYER = {};
MOVES18.forEach((m) => {
  const { def } = parseMove(m);
  LAYER[m] = def.axis * 2 + (def.layer > 0 ? 1 : 0);
});
const layerOf = (m) => LAYER[m];

/**
 * 迭代加深。到达目标时调用 onGoal(路径)；
 * onGoal 返回 true → 停止；返回 false → 继续找下一个解。
 */
/* 每层专用排序缓冲：按深度预分配，避免逐节点内存分配 */
const ORD_M = Array.from({ length: 24 }, () => new Array(18));
const ORD_H = Array.from({ length: 24 }, () => new Float64Array(18));

export function ida(start, moves, hFn, maxDepth, { maxNodes, deadline, want }) {
  const st = cloneState(start);
  const path = [];
  const solutions = [];
  let nodes = 0;

  function dfs(depth, bound, prevLayer, knownH) {
    if (++nodes > maxNodes) throw new CubeError('timeout', '求解超时');
    if ((nodes & 1023) === 0 && Date.now() > deadline) {
      throw new CubeError('timeout', '求解超时');
    }
    const hh = knownH === undefined ? hFn(st) : knownH;   // 子节点的 h 在排序时已算过
    if (depth + hh > bound) return false;
    if (hh === 0) {
      solutions.push(path.slice());
      return solutions.length >= want;
    }
    // 候选按启发值升序：先走最有希望的分支，树会小几个数量级
    const M = ORD_M[depth]; const H = ORD_H[depth];
    let n = 0;
    for (const m of moves) {
      if (layerOf(m) === prevLayer) continue;
      M[n] = m;
      applyInPlace(st, m);
      H[n] = hFn(st);
      applyInPlace(st, invertMove(m));
      n++;
    }
    for (let a = 1; a < n; a++) {              // 插入排序（n≤18，无分配）
      const km = M[a]; const kh = H[a];
      let b = a - 1;
      while (b >= 0 && H[b] > kh) { M[b + 1] = M[b]; H[b + 1] = H[b]; b--; }
      M[b + 1] = km; H[b + 1] = kh;
    }

    for (let a = 0; a < n; a++) {
      const m = M[a];
      path.push(m);
      applyInPlace(st, m);                      // 进子层
      const stop = dfs(depth + 1, bound, layerOf(m), H[a]);
      applyInPlace(st, invertMove(m));          // 逆步精确还原，零分配
      if (stop) return true;
      path.pop();
    }
    return false;
  }

  try {
    for (let bound = hFn(st); bound <= maxDepth; bound++) {
      if (dfs(0, bound, -1)) break;
      if (nodes >= maxNodes || Date.now() >= deadline) break;
    }
  } catch (e) {
    if (e.code !== 'timeout') throw e;
    // 超时：把已找到的解带走
  }
  return solutions;
}

const _cp = new Int8Array(8); const _co = new Int8Array(8);
const _ep = new Int8Array(12); const _eo = new Int8Array(12);

/** 原地应用一步（用模块级暂存，非重入——只在递归归还后调用） */
function applyInPlace(st, m) {
  const d = cubieMove(m);
  for (let i = 0; i < 8; i++) {
    const s = d.cp[i];
    _cp[i] = st.cp[s];
    _co[i] = (st.co[s] + d.co[i]) % 3;
  }
  for (let i = 0; i < 12; i++) {
    const s = d.ep[i];
    _ep[i] = st.ep[s];
    _eo[i] = (st.eo[s] + d.eo[i]) % 2;
  }
  st.cp.set(_cp); st.co.set(_co);
  st.ep.set(_ep); st.eo.set(_eo);
}

/* ================= 求解入口 ================= */
export function solve(facelets, opts = {}) {
  const t0 = Date.now();
  const deadline = t0 + (opts.timeoutMs || 20000);

  const st = faceletsToCubie(facelets);      // 非法状态在此抛出（中文原因）
  buildTables();

  const nodeBudget = opts.maxNodes || 5e7;

  const p1s = ida(st, MOVES18, h1, 13, {
    maxNodes: nodeBudget,
    deadline,
    want: opts.phase1Tries || 12,
  });
  if (!p1s.length) {
    throw new CubeError('no-solution', '未能在限定步数内求解（可换一个打乱重试）');
  }

  let lastErr = null;
  for (const p1 of p1s) {
    const mid = applyCubieMany(st, p1);
    let p2 = [];
    try {
      p2 = ida(mid, PHASE2_MOVES, coord2, 22, { maxNodes: nodeBudget, deadline, want: 1 });
    } catch (e) {
      lastErr = e;
      if (e.code === 'timeout' && Date.now() >= deadline) throw e;
      continue;
    }
    // 阶段一可能已直接解完（p2 为空）——只要状态确实复原就接受
    if (!p2.length && coord2(mid) !== 0) continue;
    const full = p1.concat(p2[0] || []);
    verify(facelets, full);
    return { moves: full, ms: Date.now() - t0 };
  }
  throw lastErr || new CubeError('no-solution', '未能求解这个状态');
}

/** 安全网：把解法回放到贴纸上确认真的复原 */
function verify(facelets, moves) {
  if (!isSolved(applyMoves(facelets, moves))) {
    throw new CubeError('verify-failed', '内部校验失败：解法回放后未复原');
  }
}
