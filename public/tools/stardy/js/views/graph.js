/**
 * Stardy — 知识树径向总览图（SVG）
 *
 * 布局承自前身 Vue 版：中心为科目，一级章均匀分布在内环，
 * 子节点按所属章的扇区向外分布，最多画 3 层（超出折叠为 +N）。
 * 父子线为实线；前置/拓展/易混关系为彩色虚线。
 * 点击节点跳回大纲并选中。
 */

import { escapeHtml } from '../models.js?v=5';

const LINK_COLOR = { 前置: '#d97706', 拓展: '#15803d', 易混: '#dc2626' };

export function renderRadialGraph(container, subject, nodes, links, { onPick = null } = {}) {
  if (!nodes.length) {
    container.innerHTML = `<div class="sdy-empty">知识树还是空的，先用 AI 建树或手动添加节点。</div>`;
    return;
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kidsOf = new Map();
  for (const n of nodes) {
    const k = n.pid && byId.has(n.pid) ? n.pid : '__root__'; // 悬空 pid 按根处理
    if (!kidsOf.has(k)) kidsOf.set(k, []);
    kidsOf.get(k).push(n);
  }
  for (const list of kidsOf.values()) list.sort((a, b) => (a.order || 0) - (b.order || 0));
  const roots = kidsOf.get('__root__') || [];

  const W = Math.min(1100, container.clientWidth || 900);
  const H = 560;
  const cx = W / 2, cy = H / 2;
  const R = [86, 176, 262]; // 三层半径
  const MAX_KIDS = 12;

  const positions = new Map(); // id -> {x, y, level, angle}
  const edges = [];           // {x1,y1,x2,y2}
  const linkEdges = [];       // {x1,y1,x2,y2,label}
  const labels = [];          // {x,y,text,level,id,anchor}

  // 一级章：均分圆周，从顶部开始
  const nRoots = roots.length;
  roots.forEach((root, i) => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / nRoots;
    const p = { x: cx + R[0] * Math.cos(ang), y: cy + R[0] * Math.sin(ang), level: 0, angle: ang };
    positions.set(root.id, p);
    edges.push({ x1: cx, y1: cy, x2: p.x, y2: p.y });
    labels.push({ ...p, text: root.title, id: root.id });

    // 子节点：在该章扇区内分布
    const kids = (kidsOf.get(root.id) || []).slice(0, MAX_KIDS);
    const overflow = (kidsOf.get(root.id) || []).length - kids.length;
    const sector = (2 * Math.PI) / Math.max(nRoots, 3);
    kids.forEach((k, j) => {
      const spread = sector * 0.72;
      const a = ang - spread / 2 + (kids.length === 1 ? spread / 2 : (spread * j) / (kids.length - 1));
      const level = kids.some((g) => g.pid === k.id) ? 2 : 1; // 有孩子 → 占第 2 环，孩子进第 3 环
      const rr = R[level];
      const q = { x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a), level, angle: a };
      positions.set(k.id, q);
      edges.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y });
      labels.push({ ...q, text: k.title, id: k.id });

      // 孙节点（细节层，最多画 4 个）
      const gkids = (kidsOf.get(k.id) || []).slice(0, 4);
      gkids.forEach((g, gi) => {
        const ga = a + (gi - (gkids.length - 1) / 2) * 0.16;
        const gq = { x: cx + R[2] * Math.cos(ga), y: cy + R[2] * Math.sin(ga), level: 2, angle: ga };
        positions.set(g.id, gq);
        edges.push({ x1: q.x, y1: q.y, x2: gq.x, y2: gq.y });
        labels.push({ ...gq, text: g.title, id: g.id });
      });
    });
    if (overflow > 0) {
      labels.push({ x: cx + (R[1] + 30) * Math.cos(ang), y: cy + (R[1] + 30) * Math.sin(ang), text: `+${overflow}…`, id: null, more: true });
    }
  });

  // 关系虚线（两端都已定位）
  for (const l of links) {
    const a = positions.get(l.from);
    const b = positions.get(l.to);
    if (a && b) linkEdges.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, label: l.label });
  }

  const trunc = (s) => (s.length > 8 ? s.slice(0, 8) + '…' : s);

  container.innerHTML = `
    <div class="sdy-panel" style="padding:8px">
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" class="sdy-radial">
        ${linkEdges.map((e) => `
          <line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}"
            stroke="${LINK_COLOR[e.label] || '#888'}" stroke-width="1.4" stroke-dasharray="5 4" opacity="0.55"/>`).join('')}
        ${edges.map((e) => `<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="var(--border-strong)" stroke-width="1.2" opacity="0.6"/>`).join('')}
        ${[...positions.entries()].map(([id, p]) => `
          <circle cx="${p.x}" cy="${p.y}" r="${p.level === 0 ? 9 : 6.5}"
            class="sdy-radial-node" data-id="${id}"
            fill="${p.level === 0 ? 'var(--accent-fill)' : 'var(--card-bg)'}"
            stroke="${p.level === 0 ? 'var(--accent-strong)' : 'var(--border-strong)'}" stroke-width="1.6"/>`).join('')}
        <circle cx="${cx}" cy="${cy}" r="30" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.5"/>
        <text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="13" fill="var(--text-1)" style="font-weight:600">${escapeHtml(trunc(subject.name))}</text>
        ${labels.map((l) => {
          const flip = l.x > cx + 12;
          return `<text x="${l.x + (flip ? 12 : -12)}" y="${l.y + 4}" text-anchor="${flip ? 'start' : 'end'}" font-size="${l.more ? 11 : 12}"
            fill="${l.more ? 'var(--text-3)' : 'var(--text-1)'}" ${l.id ? `class="sdy-radial-label" data-id="${l.id}"` : ''}>${escapeHtml(trunc(l.text))}</text>`;
        }).join('')}
      </svg>
      <div class="sdy-row" style="justify-content:center;padding:4px 0 8px;gap:16px">
        ${Object.entries(LINK_COLOR).map(([k, c]) => `<span class="sdy-field__hint"><span style="display:inline-block;width:18px;border-top:2px dashed ${c};vertical-align:middle;margin-right:4px"></span>${k}</span>`).join('')}
        <span class="sdy-field__hint">点击节点回到大纲</span>
      </div>
    </div>`;

  for (const el of container.querySelectorAll('[data-id]')) {
    el.addEventListener('click', () => {
      if (onPick) onPick(el.dataset.id);
    });
  }
}
