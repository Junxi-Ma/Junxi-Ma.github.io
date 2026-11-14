/**
 * Stardy — 知识树径向总览图（SVG）
 *
 * 视觉：每章沿色环分配独立色相（子节点继承章色的浅色变体），
 * 连线用柔和的二次贝塞尔曲线，节点带柔光投影与入场动画，
 * 中心为科目名双圆徽章，底层有极淡的同心参考环。
 * 交互：点击节点跳回大纲选中；关系虚线颜色区分前置/拓展/易混。
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
  const cx = W / 2, cy = H / 2;
  const R = [118, 216, 306];
  const MAX_KIDS = 10;

  const positions = new Map(); // id -> { x, y, level, hue, angle }
  const edges = [];            // 父子曲线 { x1,y1,x2,y2,hue }
  const linkEdges = [];        // 关系曲线 { x1,y1,x2,y2,label }
  const labels = [];           // { x,y,text,id,hue,level,more }

  const nRoots = roots.length;
  const hueOf = (i) => Math.round((i * 360) / Math.max(nRoots, 1) + 165) % 360;

  roots.forEach((root, i) => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / nRoots;
    const hue = hueOf(i);
    const p = { x: cx + R[0] * Math.cos(ang), y: cy + R[0] * Math.sin(ang), level: 0, hue, angle: ang };
    positions.set(root.id, p);
    edges.push({ x1: cx, y1: cy, x2: p.x, y2: p.y, hue });
    labels.push({ ...p, text: root.title, id: root.id, hue });

    const kids = (kidsOf.get(root.id) || []).slice(0, MAX_KIDS);
    const overflow = (kidsOf.get(root.id) || []).length - kids.length;
    const sector = (2 * Math.PI) / Math.max(nRoots, 3);
    kids.forEach((k, j) => {
      const spread = sector * 0.72;
      const a = ang - spread / 2 + (kids.length === 1 ? spread / 2 : (spread * j) / (kids.length - 1));
      const hasKids = nodes.some((x) => x.pid === k.id);
      const level = hasKids ? 2 : 1;
      const rr = R[level];
      const q = { x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a), level, hue, angle: a };
      positions.set(k.id, q);
      edges.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, hue });
      labels.push({ ...q, text: k.title, id: k.id, hue });

      const gkids = (kidsOf.get(k.id) || []).slice(0, 3);
      gkids.forEach((g, gi) => {
        const ga = a + (gi - (gkids.length - 1) / 2) * 0.15;
        const gq = { x: cx + R[2] * Math.cos(ga), y: cy + R[2] * Math.sin(ga), level: 2, hue, angle: ga };
        positions.set(g.id, gq);
        edges.push({ x1: q.x, y1: q.y, x2: gq.x, y2: gq.y, hue });
        labels.push({ ...gq, text: g.title, id: g.id, hue });
      });
    });
    if (overflow > 0) {
      labels.push({
        x: cx + (R[1] + 44) * Math.cos(ang + sector * 0.3),
        y: cy + (R[1] + 44) * Math.sin(ang + sector * 0.3),
        text: `+${overflow}…`, id: null, more: true, hue,
      });
    }
  });

  for (const l of links) {
    const a = positions.get(l.from);
    const b = positions.get(l.to);
    if (a && b) linkEdges.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, label: l.label });
  }

  // 曲线：二次贝塞尔，控制点取中点沿中垂线外推
  const curve = (e) => {
    const mx = (e.x1 + e.x2) / 2, my = (e.y1 + e.y2) / 2;
    const dx = e.x2 - e.x1, dy = e.y2 - e.y1;
    const len = Math.hypot(dx, dy) || 1;
    const off = Math.min(26, len * 0.14) * (mx < cx ? -1 : 1);
    const cxp = mx + (-dy / len) * off;
    const cyp = my + (dx / len) * off;
    return `M ${e.x1} ${e.y1} Q ${cxp} ${cyp} ${e.x2} ${e.y2}`;
  };

  const trunc = (s) => (String(s).length > 9 ? String(s).slice(0, 9) + '…' : s);
  const animDelay = (seed) => `${Math.round(((Math.abs(seed) * 37) % 900))}ms`;

  container.innerHTML = `
    <div class="sdy-panel" style="padding:10px;overflow:hidden">
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" class="sdy-radial">
        <defs>
          <filter id="sdy-node-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="rgba(20,30,25,0.3)"/>
          </filter>
        </defs>
        ${R.map((r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 6" opacity="0.5"/>`).join('')}
        ${linkEdges.map((e) => `<path d="${curve(e)}" fill="none" stroke="${LINK_COLOR[e.label] || '#888'}" stroke-width="1.6" stroke-dasharray="6 5" opacity="0.5" class="sdy-radial-anim"/>`).join('')}
        ${edges.map((e, i) => `<path d="${curve(e)}" fill="none" stroke="hsl(${e.hue} 45% 55%)" stroke-width="1.6" opacity="0.42" class="sdy-radial-anim" data-anim="${animDelay(i)}"/>`).join('')}
        <circle cx="${cx}" cy="${cy}" r="40" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2" class="sdy-radial-anim"/>
        <circle cx="${cx}" cy="${cy}" r="32" fill="var(--card-bg)" opacity="0.92"/>
        <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="14" font-weight="700" fill="var(--text-1)" style="font-family:var(--font-serif)">${escapeHtml(trunc(subject.name))}</text>
        <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="10" fill="var(--text-3)" style="font-family:var(--font-mono)">${nodes.length} 节点</text>
        ${[...positions.entries()].map(([id, p]) => `
          <circle cx="${p.x}" cy="${p.y}" r="${p.level === 0 ? 11 : 7}"
            class="sdy-radial-node sdy-radial-anim" data-id="${id}" data-anim="${animDelay(p.angle * 1e5)}"
            fill="${p.level === 0 ? `hsl(${p.hue} 60% 52%)` : `hsl(${p.hue} 55% 88%)`}"
            stroke="${p.level === 0 ? `hsl(${p.hue} 55% 38%)` : `hsl(${p.hue} 45% 55%)`}" stroke-width="${p.level === 0 ? 2.4 : 1.6}"
            filter="url(#sdy-node-glow)"/>`).join('')}
        ${labels.map((l, i) => {
          const flip = l.x >= cx;
          const fill = l.more ? 'var(--text-3)' : (l.level === 0 ? `hsl(${l.hue} 50% 30%)` : `hsl(${l.hue} 40% 28%)`);
          return `<text x="${l.x + (flip ? 14 : -14)}" y="${l.y + 4}" text-anchor="${flip ? 'start' : 'end'}" font-size="${l.more ? 11 : 12.5}"
            font-weight="${l.more ? 400 : 600}"
            fill="${fill}" stroke="var(--card-bg)" stroke-width="3" paint-order="stroke" stroke-linejoin="round"
            ${l.id ? `class="sdy-radial-label sdy-radial-anim" data-id="${l.id}" data-anim="${animDelay(i + 3)}"` : 'class="sdy-radial-anim"'}>${escapeHtml(trunc(l.text))}</text>`;
        }).join('')}
      </svg>
      <div class="sdy-row" style="justify-content:center;padding:2px 0 8px;gap:16px">
        ${Object.entries(LINK_COLOR).map(([k, c]) => `<span class="sdy-field__hint"><span style="display:inline-block;width:16px;border-top:2px dashed ${c};vertical-align:middle;margin-right:4px"></span>${k}</span>`).join('')}
        <span class="sdy-field__hint">点击节点回到大纲</span>
      </div>
    </div>`;

  for (const el of container.querySelectorAll('[data-id]')) {
    el.addEventListener('click', () => {
      if (onPick) onPick(el.dataset.id);
    });
  }
}
