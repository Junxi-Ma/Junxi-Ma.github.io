/* ============================================================
   app.js — 魔方还原助手界面 (Redesigned)
   · Three.js 三维高质感魔方（带倒角拟真、多光源与快捷视角预设）
   · 二维展开图录入：智能画笔用量统计、一键填面、高亮中心
   · 求解演播室：时间轴进度滑块、分步动作大看板、自动连续演示
   ============================================================ */
import * as THREE from 'three';
import {
  solvedFacelets, applyMove, solve, randomScramble,
  describeMove, FACES,
} from './solver.js';

/* ================= 配色（唯一来源） ================= */
const FACE_COLORS = {
  U: '#f5f5f7', // 纯白偏微暖银白
  D: '#ffd000', // 经典暖亮黄
  R: '#d91e36', // 经典正红
  L: '#ff6200', // 亮橙
  F: '#00a854', // 鲜活翡翠绿
  B: '#0052cc', // 经典宝石蓝
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

const INNER_COLOR = '#121316';

/* ================= 状态 ================= */
let facelets = solvedFacelets();
let selectedColor = 'U';
let solution = null;       // { moves: [...], ms }
let stepIndex = 0;         // 当前已执行到第几步
let animating = false;
let playing = false;

/* 轨道旋转角度状态 */
let rotX = 0.52, rotY = -0.65;

/* ================= 辅助计算 ================= */

/** 六个中心贴纸当前的颜色（字母）—— 中心不动，定义各面的颜色归属 */
function centerOfFaces() {
  const out = {};
  for (const f of FACES) out[f] = facelets[FACE_BASE[f] + 4];
  return out;
}

/** 统计各个颜色的当前贴纸用量 (每种颜色应恰好 9 块) */
function getColorCounts() {
  const counts = { U: 0, D: 0, R: 0, L: 0, F: 0, B: 0 };
  for (let i = 0; i < 54; i++) {
    const c = facelets[i];
    if (counts[c] !== undefined) counts[c]++;
  }
  return counts;
}

/** 每面同色即算复原（不要求颜色对号，支持任意持握方向 / 异配色魔方） */
function isCubeSolved() {
  return FACES.every((f) => {
    const c = facelets[FACE_BASE[f] + 4];
    for (let i = 0; i < 9; i++) if (facelets[FACE_BASE[f] + i] !== c) return false;
    return true;
  });
}

/** 把「涂色字母」按中心色翻译成「面字母」再交给求解器 */
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

function makeMaterial(color, isSurface = false) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: isSurface ? 0.32 : 0.85,
    metalness: isSurface ? 0.08 : 0.1,
  });
}

function createCubelets() {
  // 方块略小一点（0.95），留下均匀的微黑色间隙缝隙
  const geo = new THREE.BoxGeometry(0.942, 0.942, 0.942);
  const FACE_BY_MAT = ['R', 'L', 'U', 'D', 'F', 'B'];

  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const mats = FACE_BY_MAT.map((face) => {
          const onSurface = { R: x === 1, L: x === -1, U: y === 1, D: y === -1, F: z === 1, B: z === -1 }[face];
          if (!onSurface) return makeMaterial(INNER_COLOR, false);
          const idx = faceletIndex(x, y, z, face);
          return makeMaterial(faceColor(facelets[idx]), true);
        });
        const mesh = new THREE.Mesh(geo, mats);
        mesh.position.set(x, y, z);
        cubeGroup.add(mesh);
        cubelets.push({ mesh, x, y, z });
      }
    }
  }
}

/** 根据当前 facelets 重绘所有 cubelet 颜色 */
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
  camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(4.5, 3.8, 5.4);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  stage.appendChild(renderer.domElement);

  // 精雕高质感多光源体系
  const ambient = new THREE.AmbientLight(0xffffff, 0.72);
  scene.add(ambient);

  // 主高光灯
  const key = new THREE.DirectionalLight(0xfff6ea, 1.15);
  key.position.set(6, 9, 7);
  scene.add(key);

  // 侧边冷调补光
  const fill = new THREE.DirectionalLight(0xdde9ff, 0.55);
  fill.position.set(-7, 2, -5);
  scene.add(fill);

  // 底部微光漫反射
  const bottomRim = new THREE.DirectionalLight(0xffffff, 0.25);
  bottomRim.position.set(0, -6, 2);
  scene.add(bottomRim);

  cubeGroup = new THREE.Group();
  scene.add(cubeGroup);

  // 纯黑高质感内核，填补缝隙
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(2.88, 2.88, 2.88),
    new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 0.9 })
  );
  cubeGroup.add(shell);

  // 动画枢轴
  pivot = new THREE.Group();
  cubeGroup.add(pivot);

  createCubelets();

  resize();
  window.addEventListener('resize', resize);
  setupOrbit();
  setupViewControls();
  animate();
}

function resize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

/* 简易轨道控制：拖拽旋转、滚轮缩放 */
function setupOrbit() {
  let isDown = false, lastX = 0, lastY = 0;
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
    rotY += (cx - lastX) * 0.009;
    rotX += (cy - lastY) * 0.009;
    rotX = Math.max(-1.4, Math.min(1.4, rotX));
    cubeGroup.rotation.set(rotX, rotY, 0);
    lastX = cx; lastY = cy;
  };
  const onUp = () => { isDown = false; };
  stage.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const s = 1 + e.deltaY * 0.0009;
    camera.position.multiplyScalar(s);
    const d = camera.position.length();
    if (d < 4.2) camera.position.setLength(4.2);
    if (d > 13) camera.position.setLength(13);
  }, { passive: false });
}

/* 视角预设与平滑过渡 */
function setPerspective(targetX, targetY, duration = 300) {
  const startX = rotX, startY = rotY;
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    rotX = startX + (targetX - startX) * eased;
    rotY = startY + (targetY - startY) * eased;
    cubeGroup.rotation.set(rotX, rotY, 0);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function setupViewControls() {
  document.getElementById('btn-cam-iso').addEventListener('click', () => setPerspective(0.52, -0.65));
  document.getElementById('btn-cam-front').addEventListener('click', () => setPerspective(0, 0));
  document.getElementById('btn-cam-top').addEventListener('click', () => setPerspective(1.57, 0));
  document.getElementById('btn-cam-right').addEventListener('click', () => setPerspective(0, -1.57));
  document.getElementById('btn-cam-reset').addEventListener('click', () => {
    setPerspective(0.52, -0.65);
    camera.position.set(4.5, 3.8, 5.4);
    camera.lookAt(0, 0, 0);
  });
}

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

/* ================= 旋转动画 ================= */
function animateMove(move, duration = 340) {
  return new Promise((resolve) => {
    const face = move[0];
    const suffix = move.slice(1);
    const { axis, base } = MOVE_ANIM[face];
    let angle = base;
    if (suffix === "'") angle = -base;
    else if (suffix === '2') angle = base * 2;

    const axisIdx = { x: 0, y: 1, z: 2 }[axis];
    const layer = { U: 1, D: -1, R: 1, L: -1, F: 1, B: -1 }[face];
    const inLayer = cubelets.filter((c) => c.mesh.position.getComponent(axisIdx) === layer);

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
        for (const c of inLayer) {
          cubeGroup.attach(c.mesh);
          c.mesh.position.set(c.x, c.y, c.z);
          c.mesh.rotation.set(0, 0, 0);
        }
        pivot.rotation.set(0, 0, 0);
        facelets = applyMove(facelets, move);
        updateCubeletColors();
        renderNet();
        renderPalette();
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
  // 经典十字展开布局：
  // Row 0: [null, U, null, null]
  // Row 1: [L,    F, R,    B]
  // Row 2: [null, D, null, null]
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

      const box = document.createElement('div');
      box.className = 'cs-face-box';

      // 面标题与一键铺满按钮
      const header = document.createElement('div');
      header.className = 'cs-face-header';
      header.innerHTML = `
        <span class="cs-face-name">${FACE_LABELS[face]}面 (${face})</span>
        <button type="button" class="cs-face-fill-btn" title="用当前选中的画笔颜色快速填满这面" data-fill="${face}">填满</button>
      `;
      box.appendChild(header);

      const faceEl = document.createElement('div');
      faceEl.className = 'cs-face cs-face--' + face;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const idx = FACE_BASE[face] + r * 3 + c;
          const cell = document.createElement('div');
          const isCenter = (r === 1 && c === 1);
          cell.className = 'cs-sticker' + (isCenter ? ' is-center' : '');
          cell.style.background = faceColor(facelets[idx]);
          cell.dataset.face = face;
          cell.dataset.r = r;
          cell.dataset.c = c;
          cell.title = `${FACE_LABELS[face]}面 第${r + 1}行第${c + 1}列${isCenter ? ' (中心色)' : ''}`;
          faceEl.appendChild(cell);
        }
      }
      box.appendChild(faceEl);
      netEl.appendChild(box);
    }
  }
}

// 点击贴纸涂色
netEl.addEventListener('click', (e) => {
  // 检查是否点击了面的填满按钮
  const fillBtn = e.target.closest('.cs-face-fill-btn');
  if (fillBtn && !animating) {
    fillFace(fillBtn.dataset.fill, selectedColor);
    return;
  }

  const cell = e.target.closest('.cs-sticker');
  if (!cell || animating) return;
  const face = cell.dataset.face;
  const idx = FACE_BASE[face] + (+cell.dataset.r) * 3 + (+cell.dataset.c);
  facelets[idx] = selectedColor;
  cell.style.background = faceColor(selectedColor);
  updateCubeletColors();
  renderPalette();
  invalidateSolution();
});

// 右键点击贴纸循环切换颜色
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
  renderPalette();
  invalidateSolution();
});

/** 一键填满某一面 */
function fillFace(face, colorKey) {
  if (animating) return;
  const base = FACE_BASE[face];
  for (let i = 0; i < 9; i++) {
    facelets[base + i] = colorKey;
  }
  updateCubeletColors();
  renderNet();
  renderPalette();
  invalidateSolution();
  setStatus(`已将「${FACE_LABELS[face]}面」填为 ${COLOR_NAMES[colorKey]}色`, 'ok');
}

/* ================= 调色板与用量卡片 ================= */
const paletteEl = document.getElementById('palette');

function renderPalette() {
  paletteEl.innerHTML = '';
  const counts = getColorCounts();

  for (const f of FACES) {
    const card = document.createElement('div');
    card.className = 'cs-swatch-card' + (f === selectedColor ? ' is-active' : '');
    card.dataset.face = f;

    const count = counts[f];
    let countCls = 'is-exact';
    let countTxt = `${count} / 9`;
    if (count === 9) {
      countTxt = `9 / 9 ✓`;
      countCls = 'is-exact';
    } else if (count > 9) {
      countTxt = `${count} / 9 多${count - 9}`;
      countCls = 'is-over';
    } else {
      countTxt = `${count} / 9 差${9 - count}`;
      countCls = 'is-under';
    }

    card.innerHTML = `
      <div class="cs-swatch-color" style="background:${FACE_COLORS[f]}"></div>
      <div class="cs-swatch-info">
        <span class="cs-swatch-name">${COLOR_NAMES[f]}色 (${FACE_LABELS[f]}面)</span>
        <span class="cs-swatch-count ${countCls}">${countTxt}</span>
      </div>
    `;

    paletteEl.appendChild(card);
  }
  renderLegend();
}

paletteEl.addEventListener('click', (e) => {
  const card = e.target.closest('.cs-swatch-card');
  if (!card) return;
  selectedColor = card.dataset.face;
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
  statusEl.querySelector('.cs-status-text').textContent = msg;
  statusEl.className = 'cs-status-pill' + (kind ? ' is-' + kind : '');
}

/* ================= 求解与播放器 ================= */
const solutionEl = document.getElementById('solution');
const moveListEl = document.getElementById('move-list');
const currentMoveEl = document.getElementById('current-move');
const currentDescEl = document.getElementById('current-desc');
const solutionMetaEl = document.getElementById('solution-meta');
const timelineFillEl = document.getElementById('timeline-fill');
const timelineTrackEl = document.getElementById('timeline-track');
const stepCounterEl = document.getElementById('step-counter');
const stepPercentEl = document.getElementById('step-percent');

const btnSolve = document.getElementById('btn-solve');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnPlay = document.getElementById('btn-play');
const btnJumpStart = document.getElementById('btn-jump-start');
const btnJumpEnd = document.getElementById('btn-jump-end');
const speedEl = document.getElementById('speed');

function invalidateSolution() {
  solution = null;
  stepIndex = 0;
  solutionEl.hidden = true;
  stopPlay();
  renderLegend();
  setStatus('展开图状态已修改，请点击计算还原步骤');
}

/** 详细动作中文解释 */
function formatMoveDesc(m) {
  if (!m) return '等待开始演示';
  const desc = describeMove(m);
  return `${desc}（${m}）`;
}

function updateProgress() {
  if (!solution) return;
  const total = solution.moves.length;
  const pct = total === 0 ? 0 : Math.round((stepIndex / total) * 100);
  timelineFillEl.style.width = `${pct}%`;
  stepCounterEl.textContent = `${stepIndex} / ${total} 步`;
  stepPercentEl.textContent = `${pct}%`;

  if (stepIndex === 0) {
    currentMoveEl.textContent = '—';
    currentDescEl.textContent = '起点：等待开始演示';
  } else if (stepIndex <= total) {
    const m = solution.moves[stepIndex - 1];
    currentMoveEl.textContent = m;
    currentDescEl.textContent = formatMoveDesc(m);
  }
}

async function doSolve() {
  if (animating) return;

  // 检查合法性：每种颜色是否各9块
  const counts = getColorCounts();
  const illegal = Object.entries(counts).filter(([_, c]) => c !== 9);
  if (illegal.length > 0) {
    const detail = illegal.map(([k, c]) => `${COLOR_NAMES[k]}色:${c}`).join('，');
    setStatus(`各颜色必须各 9 块（当前：${detail}）`, 'err');
    return;
  }

  // 先做一次轻量合法性提示
  if (isCubeSolved()) {
    setStatus('当前魔方各面已完全复原，无需求解。', 'ok');
    return;
  }

  btnSolve.disabled = true;
  setStatus('正在搜索最优还原公式…');
  await new Promise((r) => setTimeout(r, 40));

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
  setStatus(`求解成功！共 ${res.moves.length} 步，耗时 ${res.ms} ms`, 'ok');
  updateMoveChips();
  updateProgress();

  // 平滑滚动到播放控制台
  solutionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showSolution() {
  solutionEl.hidden = false;
  solutionMetaEl.textContent = `· 共 ${solution.moves.length} 步 · 算法用时 ${solution.ms} ms`;
  moveListEl.innerHTML = solution.moves.map((m, i) =>
    `<span class="cs-move-chip" data-i="${i}">${m}</span>`
  ).join('');
}

function updateMoveChips() {
  [...moveListEl.children].forEach((chip, i) => {
    chip.classList.toggle('is-current', i === stepIndex - 1);
    chip.classList.toggle('is-done', i < stepIndex - 1);
  });
  // 滚动到当前步骤
  const curChip = moveListEl.children[stepIndex - 1];
  if (curChip) {
    curChip.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
}

moveListEl.addEventListener('click', (e) => {
  const chip = e.target.closest('.cs-move-chip');
  if (!chip || animating || !solution) return;
  const target = +chip.dataset.i;
  jumpToStep(target + 1);
});

// 点击进度条跳转
timelineTrackEl.addEventListener('click', (e) => {
  if (!solution || animating) return;
  const rect = timelineTrackEl.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const target = Math.round(ratio * solution.moves.length);
  jumpToStep(target);
});

async function nextStep() {
  if (animating || !solution || stepIndex >= solution.moves.length) return;
  animating = true;
  const idx = stepIndex;
  const m = solution.moves[idx];
  stepIndex = idx + 1;
  updateProgress();
  updateMoveChips();
  await animateMove(m, +speedEl.value);
  animating = false;

  if (stepIndex >= solution.moves.length) {
    currentMoveEl.textContent = '✓';
    currentDescEl.textContent = '恭喜！魔方已完全还原！';
    setStatus('魔方已成功完成全部步骤还原！', 'ok');
    stopPlay();
  }
}

async function prevStep() {
  if (animating || !solution || stepIndex <= 0) return;
  animating = true;
  const idx = stepIndex - 1;
  const m = solution.moves[idx];
  const inv = invertMove(m);
  stepIndex = idx;
  updateProgress();
  updateMoveChips();
  await animateMove(inv, +speedEl.value);
  animating = false;
  updateProgress();
}

function invertMove(m) {
  const s = m.slice(1);
  if (s === '2') return m;
  return s === "'" ? m[0] : m[0] + "'";
}

async function jumpToStep(target) {
  if (animating || !solution) return;
  animating = true;
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
  renderPalette();
  updateProgress();
  updateMoveChips();
  if (stepIndex >= solution.moves.length) {
    currentMoveEl.textContent = '✓';
    currentDescEl.textContent = '还原完成！';
  }
  animating = false;
}

/* 自动演示控制 */
async function startPlay() {
  if (animating || !solution) return;
  if (stepIndex >= solution.moves.length) {
    await jumpToStep(0);
  }
  playing = true;
  btnPlay.querySelector('.ico-play').style.display = 'none';
  btnPlay.querySelector('.ico-pause').style.display = 'inline';
  btnPlay.querySelector('span').textContent = '暂停演示';

  const gap = Math.max(60, +speedEl.value * 0.15);
  while (playing && stepIndex < solution.moves.length) {
    await nextStep();
    if (!playing) break;
    await new Promise((r) => setTimeout(r, gap));
  }
  stopPlay();
}

function stopPlay() {
  playing = false;
  btnPlay.querySelector('.ico-play').style.display = 'inline';
  btnPlay.querySelector('.ico-pause').style.display = 'none';
  btnPlay.querySelector('span').textContent = '自动演示';
}

/* ================= 按钮绑定 ================= */
btnSolve.addEventListener('click', doSolve);
btnNext.addEventListener('click', nextStep);
btnPrev.addEventListener('click', prevStep);
btnPlay.addEventListener('click', () => (playing ? stopPlay() : startPlay()));
btnJumpStart.addEventListener('click', () => jumpToStep(0));
btnJumpEnd.addEventListener('click', () => jumpToStep(solution ? solution.moves.length : 0));

// 一键填面主按钮
document.getElementById('btn-fill-face').addEventListener('click', () => {
  // 默认填入当前选中的面或上层U
  fillFace(selectedColor, selectedColor);
});

// 复原初始
document.getElementById('btn-reset').addEventListener('click', () => {
  if (animating) return;
  facelets = solvedFacelets();
  updateCubeletColors();
  renderNet();
  renderPalette();
  invalidateSolution();
  setStatus('已重置为标准复原状态', 'ok');
});

// 随机打乱
document.getElementById('btn-scramble').addEventListener('click', async () => {
  if (animating) return;
  const seq = randomScramble(20);
  facelets = solvedFacelets();
  invalidateSolution();
  setStatus('正在打乱魔方…');
  for (const m of seq) {
    await animateMove(m, 140);
  }
  renderNet();
  renderPalette();
  setStatus('已完成随机打乱，可点击「计算还原步骤」', 'ok');
});

/* ================= 启动 ================= */
initThree();
renderNet();
renderPalette();
setStatus('在展开图涂色录入魔方状态，中心贴纸确定面归属');
