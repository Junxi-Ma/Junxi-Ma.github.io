/* ============================================================
   solver.test.mjs — 求解器单元测试（Node 直接跑）：

       node tools/cube-solver/solver.test.mjs

   覆盖：移动可逆性 / 排名函数成对 / 角边模型与贴纸模型一致 /
        非法状态识别 / 随机打乱求解回放必须复原
   ============================================================ */
import {
  solvedFacelets, isSolved, applyMove, applyMoves, invertMove, MOVES18,
  faceletsToCubie, applyCubie, parseScramble, randomScramble, solve,
  CubeError, combRank, uncombRank, permSign,
} from './solver.js';

let pass = 0; let fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg} ${extra}`); }
};
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const solved = solvedFacelets();

/* ---------- 1. 贴纸移动的基本性质 ---------- */
console.log('\n[1] 贴纸移动');
ok(isSolved(solved), '复原态判定正确');

let invBad = [];
for (const m of MOVES18) {
  if (!same(applyMove(applyMove(solved, m), invertMove(m)), solved)) invBad.push(m);
}
ok(invBad.length === 0, `全部 ${MOVES18.length} 个基本步骤的逆步可还原`, invBad.join(','));

let f4 = solved;
for (let i = 0; i < 4; i++) f4 = applyMove(f4, 'R');
ok(same(f4, solved), 'R ×4 = 复原');

let fs = solved;
for (let i = 0; i < 6; i++) fs = applyMoves(fs, parseScramble("R U R' U'"));
ok(same(fs, solved), "(R U R' U') ×6 = 复原");

ok(parseScramble("r U2 f'").length === 3, '记号解析（宽松容错）');

/* ---------- 2. 排名函数成对 ---------- */
console.log('\n[2] 排名函数');
let badRank = 0;
for (let r = 0; r < 495; r++) if (combRank(uncombRank(r)) !== r) badRank++;
ok(badRank === 0, 'combRank(uncombRank(r)) === r（全部 495 个）', `bad=${badRank}`);

ok(permSign([0, 1, 2, 3]) === 1, '恒等置换 sign = +1');
ok(permSign([1, 0, 2, 3]) === -1, '对换 sign = -1');
ok(permSign([1, 2, 0, 3]) === 1, '三轮换 sign = +1');

/* ---------- 3. 角/边模型与贴纸模型一致（最关键） ---------- */
console.log('\n[3] 角边模型 ≡ 贴纸模型');
let mismatch = 0; let tested = 0;
for (let t = 0; t < 15; t++) {
  const scr = applyMoves(solved, randomScramble(30));
  const st = faceletsToCubie(scr);
  for (const m of MOVES18) {
    tested++;
    const a = applyCubie(st, m);
    const b = faceletsToCubie(applyMove(scr, m));
    if (!same([...a.cp], [...b.cp]) || !same([...a.co], [...b.co]) ||
        !same([...a.ep], [...b.ep]) || !same([...a.eo], [...b.eo])) mismatch++;
  }
}
ok(mismatch === 0, `${tested} 次「单步」对比全部一致`, `mismatch=${mismatch}`);

// 连续多步的一致性
let multiBad = 0;
for (let t = 0; t < 10; t++) {
  const seq = randomScramble(12);
  const a = applyMoves(solved, seq);
  const b = applyMoves(solved, seq.slice(0, 4));
  const st = faceletsToCubie(b);
  let cur = st;
  for (const m of seq.slice(4)) cur = applyCubie(cur, m);
  const b2 = faceletsToCubie(a);
  if (!same([...cur.cp], [...b2.cp]) || !same([...cur.co], [...b2.co]) ||
      !same([...cur.ep], [...b2.ep]) || !same([...cur.eo], [...b2.eo])) multiBad++;
}
ok(multiBad === 0, '多步序列的角边模型一致', `bad=${multiBad}`);

/* ---------- 4. 非法状态必须被拒绝 ---------- */
console.log('\n[4] 非法状态识别');
const caught = (fn) => { try { fn(); return null; } catch (e) { return e; } };

// 单角扭转（URF：U[2][2]=8, R[0][0]=9, F[0][2]=20）
{
  const f = solved.slice();
  const [a, b, c] = [f[8], f[9], f[20]];
  f[8] = c; f[9] = a; f[20] = b;
  const e = caught(() => faceletsToCubie(f));
  ok(e instanceof CubeError && e.code === 'twist',
    '单个角块扭转 → 报 twist', `got ${e && e.code}`);
}

// 单边翻转（UF：U[2][1]=7, F[0][1]=19）
{
  const f = solved.slice();
  [f[7], f[19]] = [f[19], f[7]];
  const e = caught(() => faceletsToCubie(f));
  ok(e instanceof CubeError && e.code === 'flip',
    '单条边翻转 → 报 flip', `got ${e && e.code}`);
}

// 换掉一个贴纸颜色 → 分片对不存在
{
  const f = solved.slice();
  f[8] = 'D';   // URF 角贴纸改成 D → 出现 {D,R,F} 这种不存在的角
  const e = caught(() => faceletsToCubie(f));
  ok(e instanceof CubeError, '非法色组合被拒绝', `got ${e && e.code}`);
}

// 复原态必须通过
{
  const st = caught(() => faceletsToCubie(solved));
  ok(st === null, '复原态通过合法性检查');
}

/* ---------- 5. 随机打乱 → 求解 → 回放验证 ---------- */
console.log('\n[5] 求解（核心）');
const TRIALS = 12;
let solvedAll = true;
const times = []; const lens = [];

for (let i = 0; i < TRIALS; i++) {
  const scramble = randomScramble(i < 8 ? 25 : 50);
  const start = applyMoves(solved, scramble);
  let res;
  try {
    res = solve(start, { timeoutMs: 60000 });
  } catch (e) {
    ok(false, `trial ${i} 求解失败：${e.message}`);
    solvedAll = false;
    continue;
  }
  times.push(res.ms);
  lens.push(res.moves.length);
  if (!isSolved(applyMoves(start, res.moves))) {
    ok(false, `trial ${i} 解法回放后未复原`);
    solvedAll = false;
  }
}
ok(solvedAll, `${TRIALS} 个随机状态全部解出且复原`);
if (times.length) {
  console.log(`    步数 ${Math.min(...lens)}–${Math.max(...lens)}` +
    `（平均 ${(lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(1)}），` +
    `耗时 ${Math.min(...times)}–${Math.max(...times)} ms`);
}

// 指定公式
{
  const seq = parseScramble("R U R' U R U2 R'");   // Sune
  const start = applyMoves(solved, seq);
  const res = solve(start);
  ok(isSolved(applyMoves(start, res.moves)), 'Sune 打乱可解');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
