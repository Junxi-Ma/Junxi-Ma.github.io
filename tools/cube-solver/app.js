/* ============================================================
   app.js — 魔方还原助手界面
   · Three.js 三维魔方（贴纸模型驱动，面→材质索引显式映射）
   · 二维展开图输入：选色 + 点击涂色
   · 校验 → 求解 → 逐步动画演示
   ============================================================ */
import * as THREE from 'three';
import {
  solvedFacelets, applyMove, solve, parseScramble, randomScramble,
  describeMove, FACES, buildTables,
} from './solver.js';

/* ================= 配色（唯一来源） ================= */
const FACE_COLORS = {
  U: '#ffffff',
  D: '#ffd500',
  R: '#b71234',
  L: '#ff5800',
  F: '#009b48',
  B: '#0046ad',
};
const FACE_LABELS = { U: '上', D: '下', R: '右', L: '左', F: '前', B: '后' };
const COLOR_NAMES = { U: '白', D: '黄', R: '红', L: '橙', F: '绿', B: '蓝' };
const FACE_BASE = { U: 0, R: 9, F: 18, D: 27, L: 36, B: 45 };

// 每步在三维中的旋转轴与基准角（顺时针对应 solver 的无前缀方向）
const MOVE_ANIM = {
  U: { axis: 'y', base: -Math.PI / 2 },
  D: { axis: 'y', base:  Math.PI / 2 },
  R: { axis: 'x', base: -Math.PI / 2 },
  L: { axis: 'x', base:  Math.PI / 2 },
  F: { axis: 'z', base: -Math.PI / 2 },
  B: { axis: 'z', base:  Math.PI / 2 },
};

const INNER_COLOR = '#1a1a1d';

/* ================= 状态 ================= */
let facelets = solvedFacelets();
let selectedColor = 'U';
let solution = null;       // { moves: [...], ms }
let stepIndex = 0;         // 当前已执行到第几步
let animating = false;
let playing = false;

/* ================= 中心色与状态换算 ================= */

/** 六个中心贴纸当前的颜色（字母）—— 中心不动，定义各面的颜色归属 */
function centerOfFaces() {
  const out = {};
  for (const f of FACES) out[f] = facelets[FACE_BASE[f] + 4];
  return out;
}

/** 每面同色即算复原（不要求颜色对号，支持任意持握方向 / 异配色魔方） */
function isCubeSolved() {
  return FACES.every((f) => {
    const c = facelets[FACE_BASE[f] + 4];
    for (let i = 0; i < 9; i++) if (facelets[FACE_BASE[f] + i] !== c) return false;
    return true;
  });
}

/** 把「涂色字母」按中心色翻译成「面字母」再交给求解器。
    标准配色下是恒等变换；魔方整体换色或换持握方向也能正确求解。 */
function faceletsForSolve() {
  const centers = centerOfFaces();
  const toFace = {};
  for (const f of FACES) {
    if (toFace[centers[f]]) throw new Error('六个中心颜色必须各不相同');
    toFace[centers[f]] = f;
  }
  return facelets.map((l) => toFace[l]);
}

/* ================= 三维场景 ================= */
const stage = document.getElementById('stage');
let scene, camera, renderer, cubeGroup, pivot;
const cubelets = [];

/** 给定 cubelet 坐标 (x,y,z) ∈ {-1,0,1} 与面，返回贴纸下标 */
function faceletIndex(x, y, z, face) {
  const b = FACE_BASE[face];
  switch (face) {
    case 'U': return b + (z + 1) * 3 + (x + 1);
    case 'D': return b + (1 - z) * 3 + (x + 1);
    case 'R': return b + (1 - y) * 3 + (1 - z);
    case 'L': return b + (1 - y) * 3 + (z + 1);
    case 'F': return b + (1 - y) * 3 + (x + 1);
    case 'B': return b + (1 - y) * 3 + (1 - x);
  }
}

function faceColor(letter) {
  return FACE_COLORS[letter] || INNER_COLOR;
}

function makeMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.45,
    metalness: 0.05,
  });
}

function createCubelets() {
  const geo = new THREE.BoxGeometry(0.94, 0.94, 0.94);
  // Three BoxGeometry 材质顺序：[+X, -X, +Y, -Y, +Z, -Z] = [R, L, U, D, F, B]
  const FACE_BY_MAT = ['R', 'L', 'U', 'D', 'F', 'B'];

  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const mats = FACE_BY_MAT.map((face) => {
          const onSurface = { R: x === 1, L: x === -1, U: y === 1, D: y === -1, F: z === 1, B: z === -1 }[face];
          if (!onSurface) return makeMaterial(INNER_COLOR);
          const idx = faceletIndex(x, y, z, face);
          return makeMaterial(faceColor(facelets[idx]));
        });
        const mesh = new THREE.Mesh(geo, mats);
        mesh.position.set(x, y, z);
        cubeGroup.add(mesh);
        cubelets.push({ mesh, x, y, z });
      }
    }
  }
}

/** 根据当前 facelets 重绘所有 cubelet 颜色（不动位置） */
function updateCubeletColors() {
  const FACE_BY_MAT = ['R', 'L', 'U', 'D', 'F', 'B'];
  for (const c of cubelets) {
    FACE_BY_MAT.forEach((face, i) => {
      const onSurface = { R: c.x === 1, L: c.x === -1, U: c.y === 1, D: c.y === -1, F: c.z === 1, B: c.z === -1 }[face];
      if (!onSurface) return;
      const idx = faceletIndex(c.x, c.y, c.z, face);
      c.mesh.material[i].color.set(faceColor(facelets[idx]));
    });
  }
}

function initThree() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(4.2, 3.6, 5.2);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  stage.appendChild(renderer.domElement);

  // 灯光
  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(5, 8, 6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-6, -2, -4);
  scene.add(fill);

  cubeGroup = new THREE.Group();
  scene.add(cubeGroup);

  // 黑色内核（略小于魔方外表面，填充方块间隙形成描边，不遮挡彩色面）
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(2.9, 2.9, 2.9),
    new THREE.MeshBasicMaterial({ color: 0x0a0a0a })
  );
  cubeGroup.add(shell);

  // 动画枢轴（仅在旋转某层时承载该层 cubelets）
  pivot = new THREE.Group();
  cubeGroup.add(pivot);

  createCubelets();

  resize();
  window.addEventListener('resize', resize);
  setupOrbit();
  animate();
}

function resize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

/* 简易轨道控制：拖拽旋转、滚轮缩放 */
function setupOrbit() {
  let isDown = false, lastX = 0, lastY = 0;
  let rotY = -0.6, rotX = 0.5;
  cubeGroup.rotation.set(rotX, rotY, 0);

  const onDown = (e) => {
    isDown = true;
    lastX = e.clientX ?? e.touches?.[0]?.clientX;
    lastY = e.clientY ?? e.touches?.[0]?.clientY;
    stage.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!isDown) return;
    const cx = e.clientX ?? e.touches?.[0]?.clientX;
    const cy = e.clientY ?? e.touches?.[0]?.clientY;
    rotY += (cx - lastX) * 0.01;
    rotX += (cy - lastY) * 0.01;
    rotX = Math.max(-1.3, Math.min(1.3, rotX));
    cubeGroup.rotation.set(rotX, rotY, 0);
    lastX = cx; lastY = cy;
  };
  const onUp = () => { isDown = false; };
  stage.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const s = 1 + e.deltaY * 0.001;
    camera.position.multiplyScalar(s);
    const d = camera.position.length();
    if (d < 4) camera.position.setLength(4);
    if (d > 14) camera.position.setLength(14);
  }, { passive: false });
}

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

/* ================= 旋转动画 ================= */
function animateMove(move, duration = 380) {
  return new Promise((resolve) => {
    const face = move[0];
    const suffix = move.slice(1);
    const { axis, base } = MOVE_ANIM[face];
    let angle = base;
    if (suffix === "'") angle = -base;
    else if (suffix === '2') angle = base * 2;

    // 收集该层的 cubelets
    const axisIdx = { x: 0, y: 1, z: 2 }[axis];
    const layer = { U: 1, D: -1, R: 1, L: -1, F: 1, B: -1 }[face];
    const inLayer = cubelets.filter((c) => c.mesh.position.getComponent(axisIdx) === layer);

    // 把 layer cubelets 挂到 pivot（pivot 在原点，位置不变）
    for (const c of inLayer) pivot.attach(c.mesh);

    const start = performance.now();
    const from = pivot.rotation[axis];
    const to = from + angle;

    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      pivot.rotation[axis] = from + (to - from) * eased;
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        pivot.rotation[axis] = to;
        // 归还到 cubeGroup，重置位置/旋转
        for (const c of inLayer) {
          cubeGroup.attach(c.mesh);
          c.mesh.position.set(c.x, c.y, c.z);
          c.mesh.rotation.set(0, 0, 0);
        }
        pivot.rotation.set(0, 0, 0);
        // 用 solver 结果刷新贴纸颜色与展开图
        facelets = applyMove(facelets, move);
        updateCubeletColors();
        renderNet();
        resolve();
      }
    }
    requestAnimationFrame(tick);
  });
}

/* ================= 二维展开图 ================= */
const netEl = document.getElementById('net');

function renderNet() {
  netEl.innerHTML = '';
  // 布局：U 在上方中间；L F R B 中间一行；D 在下方中间
  const layout = [
    [null, 'U', null, null],
    ['L', 'F', 'R', 'B'],
    [null, 'D', null, null],
  ];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const face = layout[row][col];
      if (!face) {
        const empty = document.createElement('div');
        netEl.appendChild(empty);
        continue;
      }
      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.flexDirection = 'column';
      wrap.style.gap = '2px';

      const faceEl = document.createElement('div');
      faceEl.className = 'cs-face cs-face--' + face;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const idx = FACE_BASE[face] + r * 3 + c;
          const cell = document.createElement('div');
          cell.className = 'cs-sticker' + (r === 1 && c === 1 ? ' is-center' : '');
          cell.style.background = faceColor(facelets[idx]);
          cell.dataset.face = face;
          cell.dataset.r = r;
          cell.dataset.c = c;
          cell.title = `${FACE_LABELS[face]}面 第${r + 1}行第${c + 1}列`;
          faceEl.appendChild(cell);
        }
      }
      wrap.appendChild(faceEl);
      const label = document.createElement('div');
      label.className = 'cs-face-label';
      label.textContent = FACE_LABELS[face];
      wrap.appendChild(label);
      netEl.appendChild(wrap);
    }
  }
}

netEl.addEventListener('click', (e) => {
  const cell = e.target.closest('.cs-sticker');
  if (!cell || animating) return;
  const face = cell.dataset.face;
  const idx = FACE_BASE[face] + (+cell.dataset.r) * 3 + (+cell.dataset.c);
  facelets[idx] = selectedColor;
  cell.style.background = faceColor(selectedColor);
  updateCubeletColors();
  invalidateSolution();
});

netEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const cell = e.target.closest('.cs-sticker');
  if (!cell || animating) return;
  const face = cell.dataset.face;
  const idx = FACE_BASE[face] + (+cell.dataset.r) * 3 + (+cell.dataset.c);
  const order = FACES;
  const cur = order.indexOf(facelets[idx]);
  facelets[idx] = order[(cur + 1) % order.length];
  cell.style.background = faceColor(facelets[idx]);
  updateCubeletColors();
  invalidateSolution();
});

/* ================= 调色板 ================= */
const paletteEl = document.getElementById('palette');
function renderPalette() {
  paletteEl.innerHTML = '';
  for (const f of FACES) {
    const sw = document.createElement('div');
    sw.className = 'cs-swatch' + (f === selectedColor ? ' is-active' : '');
    sw.style.background = FACE_COLORS[f];
    sw.dataset.face = f;
    sw.title = `${COLOR_NAMES[f]}色`;
    const lbl = document.createElement('span');
    lbl.className = 'cs-swatch-label';
    lbl.textContent = COLOR_NAMES[f];
    sw.appendChild(lbl);
    paletteEl.appendChild(sw);
  }
}
paletteEl.addEventListener('click', (e) => {
  const sw = e.target.closest('.cs-swatch');
  if (!sw) return;
  selectedColor = sw.dataset.face;
  renderPalette();
});

/* 面颜色图例：随中心色实时显示当前各面的颜色归属 */
function renderLegend() {
  const el = document.getElementById('face-legend');
  const centers = centerOfFaces();
  el.innerHTML = FACES.map((f) =>
    `<span><i style="background:${FACE_COLORS[centers[f]]}"></i>${FACE_LABELS[f]}面</span>`
  ).join('');
}

/* ================= 状态提示 ================= */
const statusEl = document.getElementById('status');
function setStatus(msg, kind = '') {
  statusEl.textContent = msg;
  statusEl.className = 'cs-status' + (kind ? ' is-' + kind : '');
}

/* ================= 求解 ================= */
const solutionEl = document.getElementById('solution');
const moveListEl = document.getElementById('move-list');
const currentMoveEl = document.getElementById('current-move');
const solutionMetaEl = document.getElementById('solution-meta');
const btnSolve = document.getElementById('btn-solve');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnPlay = document.getElementById('btn-play');
const btnJumpStart = document.getElementById('btn-jump-start');
const speedEl = document.getElementById('speed');

function invalidateSolution() {
  solution = null;
  stepIndex = 0;
  solutionEl.hidden = true;
  stopPlay();
  renderLegend();
  setStatus('展开图已变化，需要重新求解');
}

async function doSolve() {
  if (animating) return;
  // 先做一次轻量合法性提示
  if (isCubeSolved()) {
    setStatus('当前已是复原状态，无需求解。', 'ok');
    return;
  }
  btnSolve.disabled = true;
  setStatus('正在求解…');
  // 让出主线程以便 UI 刷新
  await new Promise((r) => setTimeout(r, 30));
  let res;
  try {
    res = solve(faceletsForSolve(), { timeoutMs: 60000 });
  } catch (e) {
    btnSolve.disabled = false;
    setStatus('无法求解：' + e.message, 'err');
    return;
  }
  btnSolve.disabled = false;
  solution = res;
  stepIndex = 0;
  showSolution();
  setStatus(`求解成功，共 ${res.moves.length} 步，耗时 ${res.ms} ms`, 'ok');
  updateMoveChips();
}

function showSolution() {
  solutionEl.hidden = false;
  solutionMetaEl.textContent = `· ${solution.moves.length} 步 · ${solution.ms} ms`;
  moveListEl.innerHTML = solution.moves.map((m, i) =>
    `<span class="cs-move-chip" data-i="${i}">${m}</span>`
  ).join('');
  currentMoveEl.textContent = '—';
}

function updateMoveChips() {
  [...moveListEl.children].forEach((chip, i) => {
    chip.classList.toggle('is-current', i === stepIndex - 1);
    chip.classList.toggle('is-done', i < stepIndex - 1);
  });
}

moveListEl.addEventListener('click', (e) => {
  const chip = e.target.closest('.cs-move-chip');
  if (!chip || animating || !solution) return;
  const target = +chip.dataset.i;
  jumpToStep(target + 1);
});

async function nextStep() {
  if (animating || !solution || stepIndex >= solution.moves.length) return;
  animating = true;
  const idx = stepIndex;
  const m = solution.moves[idx];
  currentMoveEl.textContent = `${m}  (${describeMove(m)})`;
  await animateMove(m, +speedEl.value);
  stepIndex = idx + 1;
  animating = false;
  updateMoveChips();
  if (stepIndex >= solution.moves.length) {
    currentMoveEl.textContent = '✓ 还原完成';
    setStatus('还原完成！', 'ok');
    stopPlay();
  }
}

async function prevStep() {
  if (animating || !solution || stepIndex <= 0) return;
  animating = true;
  const idx = stepIndex - 1;
  const m = solution.moves[idx];
  const inv = invertMove(m);
  currentMoveEl.textContent = `↶ ${m}  (回退：${describeMove(inv)})`;
  await animateMove(inv, +speedEl.value);
  stepIndex = idx;
  animating = false;
  updateMoveChips();
  if (stepIndex === 0) currentMoveEl.textContent = '—';
}

function invertMove(m) {
  const s = m.slice(1);
  if (s === '2') return m;
  return s === "'" ? m[0] : m[0] + "'";
}

async function jumpToStep(target) {
  if (animating || !solution) return;
  animating = true;
  // 快速回放到目标：直接应用公式差，不做动画
  stopPlay();
  const from = stepIndex;
  if (target === from) { animating = false; return; }
  if (target > from) {
    for (let i = from; i < target; i++) {
      facelets = applyMove(facelets, solution.moves[i]);
    }
  } else {
    for (let i = from - 1; i >= target; i--) {
      facelets = applyMove(facelets, invertMove(solution.moves[i]));
    }
  }
  stepIndex = target;
  updateCubeletColors();
  renderNet();
  currentMoveEl.textContent = target === 0 ? '—'
    : `${solution.moves[target - 1]}  (${describeMove(solution.moves[target - 1])})`;
  if (stepIndex >= solution.moves.length) currentMoveEl.textContent = '✓ 还原完成';
  updateMoveChips();
  animating = false;
}

/* 自动播放 */
async function startPlay() {
  if (animating || !solution) return;
  if (stepIndex >= solution.moves.length) stepIndex = 0;
  playing = true;
  btnPlay.textContent = '⏸ 暂停';
  const gap = Math.max(60, +speedEl.value * 0.15);
  while (playing && stepIndex < solution.moves.length) {
    await nextStep();
    if (!playing) break;
    await new Promise((r) => setTimeout(r, gap));
  }
  playing = false;
  btnPlay.textContent = '▶ 自动播放';
}
function stopPlay() {
  playing = false;
  btnPlay.textContent = '▶ 自动播放';
}

/* ================= 按钮绑定 ================= */
btnSolve.addEventListener('click', doSolve);
btnNext.addEventListener('click', nextStep);
btnPrev.addEventListener('click', prevStep);
btnPlay.addEventListener('click', () => playing ? stopPlay() : startPlay());
btnJumpStart.addEventListener('click', () => jumpToStep(0));

document.getElementById('btn-reset').addEventListener('click', () => {
  if (animating) return;
  facelets = solvedFacelets();
  updateCubeletColors();
  renderNet();
  invalidateSolution();
  setStatus('已重置为复原状态', 'ok');
});

document.getElementById('btn-scramble').addEventListener('click', async () => {
  if (animating) return;
  const seq = randomScramble(22);
  facelets = solvedFacelets();
  invalidateSolution();
  setStatus('正在打乱…');
  for (const m of seq) {
    await animateMove(m, 180);
  }
  renderNet();
  setStatus('已随机打乱，可点击「验证并求解」', 'ok');
});

/* ================= 启动 ================= */
initThree();
renderPalette();
renderNet();
renderLegend();
setStatus('在展开图上涂出当前魔方状态，或点「随机打乱」试玩');
/* 空闲时预建剪枝表（约 0.5s），首次点「验证并求解」就不用等这一步 */
setTimeout(() => { try { buildTables(); } catch { /* 求解时会再建 */ } }, 2500);
