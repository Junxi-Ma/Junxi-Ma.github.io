/**
 * Stardy — 知识树 3D 总览（球面布局 · 自研投影，零依赖）
 *
 * 布局：章节沿球面经度带分布（章在赤道，子/孙节点按层级抬纬度），
 * 每章独立色相；节点挂在 3D 球面上，拖拽旋转、滚轮缩放。
 * 深度透视：远的节点更小更淡，近的大而清晰——天然缓解标签堆叠。
 * 点击节点跳回大纲选中；关系虚线颜色区分前置/拓展/易混。
 */

import { escapeHtml } from '../models.js?v=9';

const LINK_COLOR = { 前置: '#d97706', 拓展: '#15803d', 易混: '#dc2626' };

export function renderRadialGraph(container, subject, nodes, links, { onPick = null } = {}) {
  if (!nodes.length) {
    container.innerHTML = `<div class="sdy-empty">知识树还是空的，先用 AI 建树或手动添加节点。</div>`;
    return;
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kidsOf = new Map();
  for (const n of nodes) {
    const k = n.pid && byId.has(n.pid) ? n.pid : '__root__';
    if (!kidsOf.has(k)) kidsOf.set(k, []);
    kidsOf.get(k).push(n);
  }
  for (const list of kidsOf.values()) list.sort((a, b) => (a.order || 0) - (b.order || 0));
  const roots = kidsOf.get('__root__') || [];

  const W = Math.max(720, Math.min(1100, container.clientWidth || 900));
  const H = 620;
  const RAD = 260;          // 球面半径（世界坐标）
  const FOV = 950;          // 透视距离

  // ---- 球面布局：每章一条经度带 ----
  const nRoots = roots.length;
  const hueOf = (i) => Math.round((i * 360) / Math.max(nRoots, 1) + 165) % 360;
  const GOLDEN = 2.39996;
  const points = [];        // { id, lon, lat, hue, level, label, more }

  roots.forEach((root, i) => {
    const hue = hueOf(i);
    const centerLon = (i * 2 * Math.PI) / nRoots;
    const sector = (2 * Math.PI) / Math.max(nRoots, 3);
    const bandShift = ((i % 4) - 1.5) * 0.22; // 每章纬度带错开，避免各章子节点挤同一纬度
    points.push({ id: root.id, lon: centerLon, lat: 0, hue, level: 0, label: root.title, more: false });

    const kids = (kidsOf.get(root.id) || []).slice(0, 12);
    kids.forEach((k, j) => {
      const lat = bandShift + (-0.62 + (1.24 * (j + 0.5)) / Math.max(kids.length, 1));
      const lon = centerLon + sector * 0.62 * Math.sin(j * GOLDEN);
      points.push({ id: k.id, lon, lat, hue, level: 1, label: k.title, more: false });
      const gkids = (kidsOf.get(k.id) || []).slice(0, 4);
      gkids.forEach((g, gi) => {
        points.push({
          id: g.id,
          lon: lon + sector * 0.3 * Math.sin((gi + 1) * GOLDEN),
          lat: lat + (lat >= 0 ? 0.3 : -0.3) + 0.08 * Math.sin(gi * GOLDEN),
          hue, level: 2, label: g.title, more: false,
        });
      });
    });
    const overflow = (kidsOf.get(root.id) || []).length - kids.length;
    if (overflow > 0) {
      points.push({ id: null, lon: centerLon + sector * 0.3, lat: lat0(kids.length), hue, level: 1, label: `+${overflow}…`, more: true });
      function lat0(n) { return 0.62 + 0.12; }
    }
  });

  // ---- 视角状态 ----
  let yaw = 0.55, pitch = -0.55, zoom = 1.05;
  const project = (lon, lat) => {
    const x0 = Math.cos(lat) * Math.sin(lon + yaw);
    const z0 = Math.cos(lat) * Math.cos(lon + yaw);
    const y0 = Math.sin(lat);
    const y1 = y0 * Math.cos(pitch) - z0 * Math.sin(pitch);
    const z1 = y0 * Math.sin(pitch) + z0 * Math.cos(pitch);
    const s = (FOV / (FOV + z1)) * zoom;
    return { x: W / 2 + x0 * RAD * s, y: H / 2 + y1 * RAD * s, z: z1, s };
  };

  // ---- DOM 骨架（一次构建，旋转只更新属性） ----
  const trunc = (s) => (String(s).length > 10 ? String(s).slice(0, 10) + '…' : s);
  const ptEls = new Map();
  const edgeEls = [];

  container.innerHTML = `
    <div class="sdy-panel" style="padding:10px;overflow:hidden">
      <svg id="sdy-g3d" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;touch-action:none;cursor:grab" class="sdy-radial">
        <defs>
          <filter id="sdy-node-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feDropShadow dx="0" dy="1" stdDeviation="2.2" flood-color="rgba(15,25,20,0.35)"/>
          </filter>
        </defs>
        <circle id="g3d-sphere" cx="${W / 2}" cy="${H / 2}" r="${RAD * zoom}" fill="none" stroke="var(--border)" stroke-width="1" stroke-dasharray="2 7" opacity="0.5"/>
        <g id="g3d-edges"></g>
        <g id="g3d-nodes"></g>
        <circle cx="${W / 2}" cy="${H / 2}" r="36" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"/>
        <circle cx="${W / 2}" cy="${H / 2}" r="28" fill="var(--card-bg)" opacity="0.92"/>
        <text x="${W / 2}" y="${H / 2 - 2}" text-anchor="middle" font-size="13.5" font-weight="700" fill="var(--text-1)" style="font-family:var(--font-serif)">${escapeHtml(trunc(subject.name))}</text>
        <text x="${W / 2}" y="${H / 2 + 15}" text-anchor="middle" font-size="10" fill="var(--text-3)" style="font-family:var(--font-mono)">${nodes.length} 节点 · 拖动旋转</text>
      </svg>
      <div class="sdy-row" style="justify-content:center;padding:2px 0 8px;gap:16px">
        ${Object.entries(LINK_COLOR).map(([k, c]) => `<span class="sdy-field__hint"><span style="display:inline-block;width:16px;border-top:2px dashed ${c};vertical-align:middle;margin-right:4px"></span>${k}</span>`).join('')}
        <span class="sdy-field__hint">拖动旋转 · 滚轮缩放 · 点击节点回大纲</span>
      </div>
    </div>`;

  const svg = container.querySelector('#sdy-g3d');
  const sphereRing = container.querySelector('#g3d-sphere');
  const gEdges = container.querySelector('#g3d-edges');
  const gNodes = container.querySelector('#g3d-nodes');

  // 关系线（3D 弦）
  const linkPaths = [];
  for (const l of links) {
    const a = points.find((p) => p.id === l.from);
    const b = points.find((p) => p.id === l.to);
    if (a && b) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', LINK_COLOR[l.label] || '#888');
      path.setAttribute('stroke-width', '1.6');
      path.setAttribute('stroke-dasharray', '6 5');
      gEdges.appendChild(path);
      linkPaths.push({ path, a, b });
    }
  }
  // 父子线（3D 弦，章色）
  for (const n of points) {
    if (!n.id) continue;
    const parent = byId.get(n.id)?.pid;
    const p = parent ? points.find((q) => q.id === parent) : null;
    if (!p) continue;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', `hsl(${n.hue} 45% 55%)`);
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('opacity', '0.45');
    gEdges.insertBefore(path, gEdges.firstChild);
    edgeEls.push({ path, a: p, b: n });
  }
  // 节点（circle + text 成组）
  for (const p of points) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'sdy-g3d-node');
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('filter', 'url(#sdy-node-glow)');
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.textContent = trunc(p.label);
    text.setAttribute('style', 'paint-order:stroke;font-family:var(--font-sans)');
    if (p.id && onPick) {
      g.addEventListener('click', () => onPick(p.id));
      g.style.cursor = 'pointer';
    }
    g.appendChild(circle);
    g.appendChild(text);
    gNodes.appendChild(g);
    ptEls.set(p.id || 'more-' + p.label, { g, circle, text, p });
  }

  // ---- 渲染（旋转/缩放时只更新属性，按深度排序） ----
  function update() {
    sphereRing.setAttribute('r', String(RAD * zoom));
    for (const { path, a, b } of linkPaths) {
      const pa = project(a.lon, a.lat), pb = project(b.lon, b.lat);
      const depth = ((pa.z + pb.z) / 2 / RAD + 1) / 2; // 0 后 → 1 前
      path.setAttribute('d', `M ${pa.x} ${pa.y} L ${pb.x} ${pb.y}`);
      path.setAttribute('opacity', (0.15 + depth * 0.45).toFixed(2));
    }
    for (const { path, a, b } of edgeEls) {
      const pa = project(a.lon, a.lat), pb = project(b.lon, b.lat);
      const depth = ((pa.z + pb.z) / 2 / RAD + 1) / 2;
      path.setAttribute('d', `M ${pa.x} ${pa.y} L ${pb.x} ${pb.y}`);
      path.setAttribute('opacity', (0.12 + depth * 0.4).toFixed(2));
    }
    const order = [...ptEls.entries()]
      .map(([key, el]) => ({ key, el, pr: project(el.p.lon, el.p.lat) }))
      .sort((x, y) => x.pr.z - y.pr.z); // 远的先画
    for (const { el, pr } of order) {
      const p = el.p;
      const depth = (pr.z / RAD + 1) / 2;          // 0 后 → 1 前
      const front = 1 - depth;                      // 1 最前
      const r = p.level === 0 ? (9 + front * 5) * pr.s : (5 + front * 3.5) * pr.s;
      const op = 0.25 + front * 0.75;
      el.g.setAttribute('transform', `translate(${pr.x.toFixed(1)} ${pr.y.toFixed(1)})`);
      el.g.setAttribute('opacity', op.toFixed(2));
      el.circle.setAttribute('r', r.toFixed(1));
      el.circle.setAttribute('fill', p.level === 0 ? `hsl(${p.hue} 60% 52%)` : `hsl(${p.hue} 55% 88%)`);
      el.circle.setAttribute('stroke', p.level === 0 ? `hsl(${p.hue} 55% 38%)` : `hsl(${p.hue} 45% 55%)`);
      el.circle.setAttribute('stroke-width', (p.level === 0 ? 2.2 : 1.5).toFixed(1));
      el.text.setAttribute('x', (r + 5).toFixed(1));
      el.text.setAttribute('y', '4');
      el.text.setAttribute('text-anchor', 'start');
      el.text.setAttribute('font-size', ((p.level === 0 ? 12.5 : 11) * Math.max(0.75, pr.s)).toFixed(1));
      el.text.setAttribute('font-weight', p.level === 0 ? '700' : '500');
      el.text.setAttribute('fill', p.level === 0 ? `hsl(${p.hue} 50% 28%)` : 'var(--text-2)');
      el.text.setAttribute('stroke', 'var(--card-bg)');
      el.text.setAttribute('stroke-width', '2.5');
    }
  }
  update();

  // ---- 交互：拖拽旋转 + 滚轮缩放 ----
  let dragging = false, lastX = 0, lastY = 0;
  svg.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    svg.style.cursor = 'grabbing';
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw += (e.clientX - lastX) * 0.008;
    pitch = Math.max(-1.1, Math.min(1.1, pitch + (e.clientY - lastY) * 0.006));
    lastX = e.clientX; lastY = e.clientY;
    update();
  });
  svg.addEventListener('pointerup', (e) => {
    dragging = false;
    svg.style.cursor = 'grab';
    try { svg.releasePointerCapture(e.pointerId); } catch {}
  });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom = Math.max(0.55, Math.min(2.4, zoom * (e.deltaY < 0 ? 1.12 : 0.9)));
    update();
  }, { passive: false });
}
