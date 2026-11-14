/**
 * Stardy — 科目工作台：总览 / 知识树 / 资料 / 卡片 / 设置
 * （测验标签在阶段三开放）
 */

import db from '../db.js?v=3';
import * as S from '../scheduler.js?v=3';
import {
  escapeHtml, renderMarkdown, renderCloze, parseCloze, clozeOrds, suggestClozes,
  newCard, newNode, newLink, fmtInterval, STATE_INFO, uid,
} from '../models.js?v=3';
import { toast, openModal, confirmBox, promptBox } from '../ui.js?v=3';
import {
  exportSubjectFile, exportAllFile, readJsonFile, importPayload,
  cloudReady, cloudUser, cloudMeta, cloudUpload, cloudRestore, makeRestorePoint,
} from '../backup.js?v=3';
import { startReview } from './review.js?v=3';
import { cascadeDeleteSubject } from './home.js?v=3';
import { openAiBuildTree, openAiGenCards, renderReviewConsole } from './ai.js?v=3';
import { parseFile, kindLabel } from '../parse.js?v=3';
import { loadAiConfig, saveAiConfig, chat, aiUsage } from '../ai.js?v=3';

const TABS = [
  { id: 'overview', label: '总览' },
  { id: 'tree', label: '知识树' },
  { id: 'docs', label: '资料' },
  { id: 'cards', label: '卡片' },
  { id: 'quiz', label: '测验', disabled: true },
  { id: 'settings', label: '设置' },
];

export async function renderWorkspace(root, subjectId, tab = 'overview') {
  const subject = await db.get('subjects', subjectId);
  if (!subject) { toast('科目不存在', true); location.hash = '#/'; return; }
  document.title = `${subject.name} · Stardy 学习系统`;

  const [cards, nodes, docs, pendingN] = await Promise.all([
    db.byIndex('cards', 'subjectId', subjectId),
    db.byIndex('nodes', 'subjectId', subjectId),
    db.byIndex('docs', 'subjectId', subjectId),
    db.count('pending', 'subjectId', subjectId),
  ]);
  const due = S.dueCounts(cards);
  const tabs = pendingN > 0
    ? [...TABS.slice(0, 5), { id: 'ainote', label: '审核', badge: pendingN }, TABS[5]]
    : TABS;
  if (!tabs.some((t) => t.id === tab)) tab = 'overview';

  root.innerHTML = `
    <div class="container tool sdy-view">
      <div class="sdy-ws-head">
        <div>
          <h2 class="sdy-ws-title">${escapeHtml(subject.name)}</h2>
          <p class="sdy-ws-intro">${escapeHtml(subject.intro || '')}</p>
        </div>
        <div class="sdy-ws-actions">
          <button class="btn" id="ws-newcard">✚ 新卡片</button>
          <button class="btn btn--primary" id="ws-review">▶ 开始复习${due.total ? `（${due.total}）` : ''}</button>
        </div>
      </div>
      <nav class="sdy-tabs" id="ws-tabs">
        ${tabs.map((t) => `
          <button class="sdy-tab${t.id === tab ? ' on' : ''}" data-tab="${t.id}" ${t.disabled ? 'data-disabled="1"' : ''}
            title="${t.disabled ? '阶段三开放' : ''}">
            ${t.label}${!t.disabled && t.id === 'tree' && nodes.length ? `<span class="sdy-tab__n">${nodes.length}</span>` : ''}
            ${!t.disabled && t.id === 'cards' ? `<span class="sdy-tab__n">${cards.length}</span>` : ''}
            ${!t.disabled && t.id === 'docs' && docs.length ? `<span class="sdy-tab__n">${docs.length}</span>` : ''}
            ${t.badge ? `<span class="sdy-tab__n">${t.badge}</span>` : ''}
          </button>`).join('')}
      </nav>
      <div id="ws-panel"></div>
    </div>`;

  root.querySelector('#ws-review').addEventListener('click', () => startReview(subjectId));
  root.querySelector('#ws-newcard').addEventListener('click', () => openCardEditor(subject, { onDone: () => gotoTab(root, subjectId, tab) }));
  for (const b of root.querySelectorAll('#ws-tabs .sdy-tab')) {
    b.addEventListener('click', () => {
      if (b.dataset.disabled) { toast('阶段三开放，敬请期待'); return; }
      location.hash = `#/s/${subjectId}/${b.dataset.tab}`;
    });
  }

  const panel = root.querySelector('#ws-panel');
  const render = {
    overview: renderOverview,
    tree: renderTree,
    docs: renderDocs,
    cards: renderCards,
    ainote: renderAinote,
    settings: renderSettings,
  }[tab] || renderOverview;
  await render(panel, subject, root);
}

/** hash 一致的内部跳转（同 hash 时手动渲染，否则交给路由） */
function gotoTab(root, subjectId, tab) {
  const h = '#/s/' + subjectId + '/' + tab;
  if (location.hash === h || (tab === 'overview' && (location.hash === '#/' || location.hash === ''))) {
    gotoTab(root, subjectId, tab);
  } else {
    location.hash = h;
  }
}

/** 审核台标签页 */
async function renderAinote(panel, subject, root) {
  await renderReviewConsole(panel, subject, (mode) => {
    gotoTab(root, subject.id, mode === 'tree' ? 'tree' : 'overview');
  });
}

/* ============================================================
   总览
   ============================================================ */

async function renderOverview(panel, subject) {
  const [cards, revlog] = await Promise.all([
    db.byIndex('cards', 'subjectId', subject.id),
    db.byIndex('revlog', 'subjectId', subject.id),
  ]);
  const due = S.dueCounts(cards);
  const retention = S.retention(revlog);
  const fc = S.forecast(cards, 30);
  const hm = S.heatmap(revlog, 182);
  const maxFc = Math.max(1, ...fc.map((b) => b.n));
  const maxHm = Math.max(1, ...hm.map((d) => d.n));
  const stateDist = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const c of cards) if (c.fsrs) stateDist[c.fsrs.state] = (stateDist[c.fsrs.state] || 0) + 1;

  panel.innerHTML = `
    <div class="sdy-ov-due">
      <div class="sdy-ov-due__cell sdy-ov-due__cell--go"><b>${due.total}</b><span>今日待学</span></div>
      <div class="sdy-ov-due__cell"><b>${due.new}</b><span>新卡</span></div>
      <div class="sdy-ov-due__cell"><b>${due.learn}</b><span>学习中到期</span></div>
      <div class="sdy-ov-due__cell"><b>${due.review}</b><span>复习到期</span></div>
      <div class="sdy-ov-due__cell"><b>${cards.filter((c) => c.suspended).length}</b><span>已暂停</span></div>
    </div>

    <div class="sdy-panel" style="margin-top:16px">
      <p class="sdy-panel__title">卡片状态分布</p>
      <div class="sdy-row">
        ${[0, 1, 2, 3].map((st) => `
          <span class="sdy-chip sdy-chip--${STATE_INFO[st].cls}">${STATE_INFO[st].name} ${stateDist[st] || 0}</span>`).join('')}
        ${cards.filter((c) => c.flags & 1).length ? `<span class="sdy-chip sdy-chip--leech">陷阱卡 ${cards.filter((c) => c.flags & 1).length}</span>` : ''}
        ${retention != null ? `<span class="sdy-chip sdy-chip--muted">复习保持率 ${(retention * 100).toFixed(0)}%</span>` : ''}
        <span class="sdy-chip sdy-chip--muted">累计答题 ${revlog.length}</span>
        <span class="sdy-grow"></span>
        <button class="btn btn--primary btn--sm" data-review>▶ 开始复习</button>
      </div>
    </div>

    <div class="sdy-panel">
      <p class="sdy-panel__title">未来 30 天复习预测</p>
      <div class="sdy-forecast">
        ${fc.map((b) => `<div class="sdy-forecast__bar" style="height:${Math.max(2, (b.n / maxFc) * 100)}%"><span class="tip">${b.day.getMonth() + 1}/${b.day.getDate()} · ${b.n} 张</span></div>`).join('')}
      </div>
      <div class="sdy-forecast__axis">
        ${[0, 5, 10, 15, 20, 25, 29].map((i) => `<span>${fc[i].day.getMonth() + 1}/${fc[i].day.getDate()}</span>`).join('')}
      </div>
    </div>

    <div class="sdy-panel">
      <p class="sdy-panel__title">近半年学习热图（每格一天）</p>
      <div class="sdy-heatmap">
        ${hm.map((d) => {
          const lv = d.n === 0 ? '' : d.n <= 5 ? '1' : d.n <= 15 ? '2' : d.n <= 40 ? '3' : '4';
          const today = d.day === new Date().toISOString().slice(0, 10) && false; // 用本地日
          const cls = lv ? ` data-lv="${lv}"` : '';
          const title = `${d.day}：${d.n} 次答题`;
          return `<span class="sdy-heat-cell${d.day === todayLocal() ? ' today' : ''}"${cls} title="${title}"></span>`;
        }).join('')}
      </div>
    </div>`;

  panel.querySelector('[data-review]').addEventListener('click', () => startReview(subject.id));
}

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ============================================================
   知识树
   ============================================================ */

// 展开状态按科目记忆（session 内）
const expandedMap = new Map();

async function renderTree(panel, subject, root) {
  const [nodes, links, cards, docs] = await Promise.all([
    db.byIndex('nodes', 'subjectId', subject.id),
    db.byIndex('links', 'subjectId', subject.id),
    db.byIndex('cards', 'subjectId', subject.id),
    db.byIndex('docs', 'subjectId', subject.id),
  ]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kidsOf = new Map();
  for (const n of nodes) {
    const k = n.pid || '__root__';
    if (!kidsOf.has(k)) kidsOf.set(k, []);
    kidsOf.get(k).push(n);
  }
  for (const list of kidsOf.values()) list.sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!expandedMap.has(subject.id)) expandedMap.set(subject.id, new Set(nodes.map((n) => n.id)));

  let selectedId = panel.dataset.sel && byId.get(panel.dataset.sel) ? panel.dataset.sel : nodes[0]?.id || null;

  const cardCountOf = (nid) => cards.filter((c) => c.nid === nid).length;
  const pathOf = (n) => {
    const parts = [];
    let cur = n;
    while (cur) { parts.unshift(cur.title); cur = cur.pid ? byId.get(cur.pid) : null; }
    return parts;
  };

  const rowHtml = (n, depth) => {
    const kids = kidsOf.get(n.id) || [];
    const expanded = expandedMap.get(subject.id).has(n.id);
    const cardsN = cardCountOf(n.id);
    return `
      <div class="sdy-tree__item" data-node="${n.id}">
        <div class="sdy-tree__row${n.id === selectedId ? ' on' : ''}" data-sel="${n.id}">
          <span class="sdy-tree__caret${kids.length ? (expanded ? '' : ' closed') : ' ghost'}" data-caret="${n.id}">${kids.length ? '▼' : ''}</span>
          <span class="sdy-tree__title${depth === 0 ? ' is-root' : ''}">${escapeHtml(n.title)}</span>
          <span class="sdy-tree__badges">
            ${cardsN ? `<span class="sdy-chip sdy-chip--muted">${cardsN} 卡</span>` : ''}
          </span>
        </div>
        ${kids.length && expanded ? `<div class="sdy-tree__kids">${kids.map((k) => rowHtml(k, depth + 1)).join('')}</div>` : ''}
      </div>`;
  };

  const roots = kidsOf.get('__root__') || [];
  const sel = selectedId ? byId.get(selectedId) : null;

  panel.innerHTML = `
    <div class="sdy-row" style="margin-bottom:12px">
      <button class="btn btn--sm" id="tr-addroot">✚ 章节点</button>
      <button class="btn btn--sm" id="tr-ai">🤖 AI 建树</button>
      <span class="sdy-grow"></span>
      <span class="sdy-chip sdy-chip--muted">${nodes.length} 个节点 · ${links.length} 条关系</span>
    </div>
    <div class="sdy-tree-wrap">
      <div class="sdy-panel sdy-tree">
        ${roots.length ? roots.map((n) => rowHtml(n, 0)).join('') : `
          <div class="sdy-empty">
            知识树还是空的。<br>
            点「🤖 AI 建树」从已上传的课件 / 资料自动提取（产出先入审核台）；<br>
            也可以「✚ 章节点」手动搭框架，再在节点上出卡。
          </div>`}
      </div>
      <div class="sdy-panel sdy-node-detail" id="tr-detail">${sel ? nodeDetailHtml(sel) : '<p style="color:var(--text-3)">选择左侧节点查看详情</p>'}</div>
    </div>`;

  function nodeDetailHtml(n) {
    const linkRows = links.filter((l) => l.from === n.id || l.to === n.id).map((l) => {
      const other = byId.get(l.from === n.id ? l.to : l.from);
      const dir = l.from === n.id ? '→' : '←';
      return `<div class="sdy-row" style="margin-bottom:6px">
        <span class="sdy-chip sdy-chip--muted">${escapeHtml(l.label)}</span>
        <span style="font-size:var(--fs-sm);color:var(--text-2)">${dir} ${escapeHtml(other?.title || '(已删除)')}</span>
        <button class="btn btn--sm btn--ghost" data-dellink="${l.id}">删</button>
      </div>`;
    }).join('');
    return `
      <h3 class="sdy-node-detail__title">${escapeHtml(n.title)}</h3>
      <p class="sdy-node-detail__path">${escapeHtml(pathOf(n).join(' › '))}</p>
      ${n.sourceRef ? `<p class="sdy-node-detail__path">📎 出处：${escapeHtml(n.sourceRef.docName || '')}${n.sourceRef.quote ? `<br>「${escapeHtml(String(n.sourceRef.quote).slice(0, 80))}…」` : ''}</p>` : ''}
      <div class="sdy-md">${n.detail ? renderMarkdown(n.detail) : '<p style="color:var(--text-3)">暂无正文</p>'}</div>
      ${n.formula ? `<div class="sdy-md" style="margin-top:10px">${renderMarkdown(n.formula)}</div>` : ''}
      <div class="sdy-modal__acts" style="justify-content:flex-start;margin-top:16px">
        <button class="btn btn--sm btn--primary" data-ncard="qa">＋ 问答卡</button>
        <button class="btn btn--sm" data-ncard="cloze">＋ 挖空卡</button>
        <button class="btn btn--sm" data-nedit>编辑</button>
        <button class="btn btn--sm" data-naddchild>＋ 子节点</button>
        <button class="btn btn--sm" data-nlink>＋ 关系</button>
        <button class="btn btn--sm btn--ghost" data-ndel style="color:var(--danger-fg)">删除</button>
      </div>
      ${links.length ? `<p class="sdy-panel__title" style="margin-top:16px">关系标注</p>${linkRows}` : ''}`;
  }

  const rerender = () => renderTree(panel, subject);

  // 选择 / 折叠
  for (const row of panel.querySelectorAll('[data-sel]')) {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-caret]')) return;
      panel.dataset.sel = row.dataset.sel;
      rerender();
    });
  }
  for (const caret of panel.querySelectorAll('[data-caret]')) {
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      const set = expandedMap.get(subject.id);
      const id = caret.dataset.caret;
      if (set.has(id)) set.delete(id); else set.add(id);
      rerender();
    });
  }

  // 节点操作
  panel.querySelector('#tr-addroot')?.addEventListener('click', () => openNodeEditor(subject, { pid: null, onDone: rerender }));
  panel.querySelector('#tr-ai')?.addEventListener('click', () => {
    openAiBuildTree(subject, docs, () => gotoTab(root, subject.id, 'ainote'));
  });
  const bindDetail = (sel2, fn) => panel.querySelector(sel2)?.addEventListener('click', fn);

  if (sel) {
    bindDetail('[data-naddchild]', () => openNodeEditor(subject, { pid: sel.id, onDone: rerender }));
    bindDetail('[data-nedit]', () => openNodeEditor(subject, { node: sel, onDone: rerender }));
    bindDetail('[data-ncard]', (e) => openCardEditor(subject, { nid: sel.id, kind: e.currentTarget.dataset.ncard, onDone: () => gotoTab(root, subject.id, 'tree') }));
    bindDetail('[data-ndel]', async () => {
      const nKids = countDescendants(sel.id);
      const ok = await confirmBox({
        title: `删除节点「${sel.title}」？`,
        body: `将连同其 ${nKids} 个子节点、关联卡片与关系一起删除。`,
        confirmText: '删除', danger: true,
      });
      if (!ok) return;
      const doomed = collectDescendants(sel.id);
      for (const id of doomed) {
        for (const c of cards.filter((x) => x.nid === id)) await db.del('cards', c.id);
        await db.del('nodes', id);
      }
      for (const l of links.filter((l2) => doomed.includes(l2.from) || doomed.includes(l2.to))) await db.del('links', l.id);
      panel.dataset.sel = '';
      toast('已删除');
      rerender();
    });
    bindDetail('[data-nlink]', () => {
      const others = nodes.filter((n) => n.id !== sel.id);
      if (!others.length) { toast('先创建其他节点再连关系', true); return; }
      const { box, close } = openModal({
        title: `添加关系（从「${sel.title}」出发）`,
        bodyHtml: `
          <div class="sdy-field">
            <label class="sdy-field__label">类型</label>
            <select class="sdy-select" id="lk-label">
              <option value="前置">前置（先学这个才好懂）</option>
              <option value="拓展">拓展（相关延伸）</option>
              <option value="易混">易混（经常搞混，注意对比）</option>
            </select>
          </div>
          <div class="sdy-field">
            <label class="sdy-field__label">指向节点</label>
            <select class="sdy-select" id="lk-target">
              ${others.map((o) => `<option value="${o.id}">${escapeHtml(pathOf(o).join(' › '))}</option>`).join('')}
            </select>
          </div>
          <div class="sdy-modal__acts">
            <button class="btn" data-a="cancel">取消</button>
            <button class="btn btn--primary" data-a="ok">添加</button>
          </div>`,
      });
      box.querySelector('[data-a="cancel"]').onclick = close;
      box.querySelector('[data-a="ok"]').onclick = async () => {
        const label = box.querySelector('#lk-label').value;
        const to = box.querySelector('#lk-target').value;
        await db.put('links', newLink(subject.id, sel.id, to, label));
        close(); toast('已添加关系'); rerender();
      };
    });
    for (const btn of panel.querySelectorAll('[data-dellink]')) {
      btn.addEventListener('click', async () => {
        await db.del('links', btn.dataset.dellink);
        rerender();
      });
    }
  }

  function countDescendants(id) { return collectDescendants(id).length - 1; }
  function collectDescendants(id) {
    const out = [id];
    const walk = (pid) => {
      for (const n of nodes.filter((x) => x.pid === pid)) { out.push(n.id); walk(n.id); }
    };
    walk(id);
    return out;
  }
}

function openNodeEditor(subject, { node = null, pid = null, onDone = null }) {
  const nodesPromise = db.byIndex('nodes', 'subjectId', subject.id);
  nodesPromise.then((nodes) => {
    const { box, close } = openModal({
      title: node ? '编辑节点' : '新建节点',
      bodyHtml: `
        <div class="sdy-field">
          <label class="sdy-field__label">父节点</label>
          <select class="sdy-select" id="ne-pid">
            <option value="">（章根节点）</option>
            ${nodes.filter((n) => !node || n.id !== node.id).map((n) => `<option value="${n.id}"${n.id === (node ? node.pid : pid) ? ' selected' : ''}>${escapeHtml(n.title)}</option>`).join('')}
          </select>
        </div>
        <div class="sdy-field">
          <label class="sdy-field__label">标题 *</label>
          <input class="sdy-input" id="ne-title" maxlength="60" value="${escapeHtml(node?.title || '')}" placeholder="例如：第二章 温度">
        </div>
        <div class="sdy-field">
          <label class="sdy-field__label">正文（支持 Markdown 与 $公式$）</label>
          <textarea class="sdy-textarea" id="ne-detail" placeholder="要点、解释、例子……">${escapeHtml(node?.detail || '')}</textarea>
        </div>
        <div class="sdy-field">
          <label class="sdy-field__label">核心公式（可选，单独一块展示）</label>
          <textarea class="sdy-textarea" id="ne-formula" style="min-height:56px" placeholder="$$T = T_0 + a t$$">${escapeHtml(node?.formula || '')}</textarea>
        </div>
        <div class="sdy-modal__acts">
          <button class="btn" data-a="cancel">取消</button>
          <button class="btn btn--primary" data-a="ok">${node ? '保存' : '创建'}</button>
        </div>`,
    });
    box.querySelector('#ne-title').focus();
    box.querySelector('[data-a="cancel"]').onclick = close;
    box.querySelector('[data-a="ok"]').onclick = async () => {
      const title = box.querySelector('#ne-title').value.trim();
      if (!title) { toast('请填写标题', true); return; }
      const pidVal = box.querySelector('#ne-pid').value || null;
      if (node) {
        // 防止把自己的后代选为父节点形成环
        if (pidVal && isDescendant(node.id, pidVal, nodes)) { toast('不能把子节点选为父节点', true); return; }
        node.pid = pidVal;
        node.title = title;
        node.detail = box.querySelector('#ne-detail').value;
        node.formula = box.querySelector('#ne-formula').value;
        node.updatedAt = Date.now();
        await db.put('nodes', node);
      } else {
        const n = newNode(subject.id, pidVal, title, box.querySelector('#ne-detail').value, box.querySelector('#ne-formula').value);
        await db.put('nodes', n);
      }
      close(); toast('已保存');
      if (onDone) onDone();
    };
  });
}

function isDescendant(rootId, maybeChildId, nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let cur = byId.get(maybeChildId);
  while (cur) {
    if (cur.id === rootId) return true;
    cur = cur.pid ? byId.get(cur.pid) : null;
  }
  return false;
}

/* ============================================================
   资料
   ============================================================ */

async function renderDocs(panel, subject, root) {
  const docs = await db.byIndex('docs', 'subjectId', subject.id);
  panel.innerHTML = `
    <div class="sdy-panel">
      <p class="sdy-panel__title">上传资料</p>
      <div id="dc-dropzone" class="sdy-dropzone" tabindex="0">
        <div style="font-size:30px">📄</div>
        <p style="margin:6px 0 2px;font-weight:600;color:var(--text-1)">点击选择 或 拖拽文件到这里</p>
        <p class="sdy-field__hint">支持 PDF / PPTX / DOCX / MD / TXT，可多选；PDF 按字号自动重建章节结构，扫描件（无文字层）会在列表中标注，OCR 阶段三开放。旧版 .ppt / .doc 请先另存为新格式。</p>
        <input type="file" id="dc-file" multiple accept=".pdf,.pptx,.ppsx,.docx,.md,.markdown,.txt,.text" hidden>
      </div>
      <div id="dc-status" class="sdy-field__hint" style="margin-top:8px" hidden></div>
    </div>
    <div class="sdy-panel">
      <p class="sdy-panel__title">已上传资料（${docs.length}）</p>
      ${docs.length ? `<div class="sdy-cardlist">${docs.map((d) => `
        <div class="sdy-cardrow">
          <div class="sdy-cardrow__main" data-view="${d.id}">
            <div class="sdy-cardrow__front">${escapeHtml(d.name)}</div>
            <div class="sdy-cardrow__meta">
              <span class="sdy-chip sdy-chip--muted">${escapeHtml(kindLabel(d.kind))}</span>
              <span>${d.chars} 字</span>
              ${d.outline ? `<span>${d.outline.length} 个标题</span>` : ''}
              ${d.scanned ? '<span class="sdy-chip sdy-chip--leech">疑似扫描件</span>' : ''}
              <span>${new Date(d.addedAt).toLocaleString('zh-CN')}</span>
            </div>
          </div>
          <div class="sdy-cardrow__acts">
            ${d.outline ? `<button class="btn btn--sm" data-tree="${d.id}">🤖 建树</button>` : ''}
            <button class="btn btn--sm btn--ghost" data-del="${d.id}" style="color:var(--danger-fg)">删除</button>
          </div>
        </div>`).join('')}</div>` : `
        <div class="sdy-soon">
          <div class="ic">🗂️</div>
          <p>还没有资料。上传后即可「AI 建树」提取知识体系（产出先进审核台，你确认后才入库）。</p>
        </div>`}
    </div>`;

  // 上传区样式
  const style = document.createElement('style');
  if (!document.getElementById('sdy-dropzone-style')) {
    style.id = 'sdy-dropzone-style';
    style.textContent = `
      .sdy-dropzone { border: 1.5px dashed var(--border-strong); border-radius: var(--radius-card); padding: 22px; text-align: center; cursor: pointer; transition: border-color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease); }
      .sdy-dropzone:hover, .sdy-dropzone.dragover { border-color: var(--accent); background: var(--accent-soft); }`;
    document.head.appendChild(style);
  }

  const fileEl = panel.querySelector('#dc-file');
  const zone = panel.querySelector('#dc-dropzone');
  const statusEl = panel.querySelector('#dc-status');
  const showStatus = (t, hide = false) => { statusEl.textContent = t; statusEl.hidden = hide; };

  zone.addEventListener('click', () => fileEl.click());
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fileEl.click(); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    handleFiles([...e.dataTransfer.files]);
  });
  fileEl.addEventListener('change', () => {
    handleFiles([...fileEl.files]);
    fileEl.value = '';
  });

  async function handleFiles(files) {
    if (!files.length) return;
    let ok = 0, fail = 0;
    for (const f of files) {
      showStatus(`解析中：${f.name}…`);
      try {
        const r = await parseFile(f, (p) => {
          if (p && p.total) showStatus(`解析中：${f.name}（第 ${p.page}/${p.total} 页）…`);
        });
        const scanned = r.pagesInfo ? r.pagesInfo.every((pg) => pg.chars < 20) : false;
        await db.put('docs', newDoc(subject.id, f.name, r.kind, r.text, r.outline, scanned));
        ok++;
      } catch (e) {
        fail++;
        toast(`${f.name}：${e.message}`, true, 4200);
      }
    }
    showStatus('', true);
    if (ok) toast(`已导入 ${ok} 份资料${fail ? `，${fail} 份失败` : ''}`);
    renderDocs(panel, subject, root);
  }

  for (const b of panel.querySelectorAll('[data-view]')) {
    b.addEventListener('click', () => {
      const d = docs.find((x) => x.id === b.dataset.view);
      openModal({
        title: d.name, wide: true,
        bodyHtml: `<pre class="sdy-code" style="max-height:50vh;white-space:pre-wrap">${escapeHtml(d.text.slice(0, 8000))}${d.text.length > 8000 ? '\n…（已截断）' : ''}</pre>`,
      });
    });
  }
  for (const b of panel.querySelectorAll('[data-tree]')) {
    b.addEventListener('click', () => {
      const d = docs.find((x) => x.id === b.dataset.tree);
      openAiBuildTree(subject, [d], () => gotoTab(root, subject.id, 'ainote'));
    });
  }
  for (const b of panel.querySelectorAll('[data-del]')) {
    b.addEventListener('click', async () => {
      if (!(await confirmBox({ title: '删除这份资料？', body: '只删除资料文本，已生成的节点与卡片不受影响。', confirmText: '删除', danger: true }))) return;
      await db.del('docs', b.dataset.del);
      renderDocs(panel, subject, root);
    });
  }
}

/* ============================================================
   卡片浏览 + 编辑器
   ============================================================ */

const cardFilters = { q: '', state: 'all', kind: 'all', sort: 'created' };

async function renderCards(panel, subject, root) {
  const [cards, nodes] = await Promise.all([
    db.byIndex('cards', 'subjectId', subject.id),
    db.byIndex('nodes', 'subjectId', subject.id),
  ]);
  // 给 AI 出卡用：标记已有卡片的节点
  const nodesForAi = nodes.map((n) => ({ ...n, _hasCards: cards.some((c) => c.nid === n.id) }));
  const nodePath = new Map();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    const parts = [];
    let cur = n;
    while (cur) { parts.unshift(cur.title); cur = cur.pid ? byId.get(cur.pid) : null; }
    nodePath.set(n.id, parts.join(' › '));
  }

  let list = cards;
  if (cardFilters.q) {
    const q = cardFilters.q.toLowerCase();
    list = list.filter((c) => (c.front || '').toLowerCase().includes(q) || (c.back || '').toLowerCase().includes(q) || (c.clozeText || '').toLowerCase().includes(q));
  }
  if (cardFilters.state !== 'all') {
    list = cardFilters.state === 'suspended' ? list.filter((c) => c.suspended)
      : cardFilters.state === 'leech' ? list.filter((c) => c.flags & 1)
      : list.filter((c) => !c.suspended && c.fsrs?.state === Number(cardFilters.state));
  }
  if (cardFilters.kind !== 'all') list = list.filter((c) => c.kind === cardFilters.kind);
  list = [...list].sort((a, b) => cardFilters.sort === 'due'
    ? new Date(a.fsrs?.dueAt || 0) - new Date(b.fsrs?.dueAt || 0)
    : (b.createdAt || 0) - (a.createdAt || 0));

  const previewText = (c) => c.kind === 'cloze'
    ? c.clozeText.replace(/\{\{c\d+::([^:{}]*)(?:::[^{}]*)?\}\}/g, '＿＿')
    : c.front;

  panel.innerHTML = `
    <div class="sdy-filters">
      <input class="sdy-input" id="cf-q" placeholder="搜索卡片内容…" value="${escapeHtml(cardFilters.q)}" style="min-width:180px">
      <select class="sdy-select" id="cf-state">
        <option value="all">全部状态</option>
        <option value="0" ${cardFilters.state === '0' ? 'selected' : ''}>新卡</option>
        <option value="1" ${cardFilters.state === '1' ? 'selected' : ''}>学习中</option>
        <option value="2" ${cardFilters.state === '2' ? 'selected' : ''}>复习</option>
        <option value="3" ${cardFilters.state === '3' ? 'selected' : ''}>重学</option>
        <option value="suspended" ${cardFilters.state === 'suspended' ? 'selected' : ''}>已暂停</option>
        <option value="leech" ${cardFilters.state === 'leech' ? 'selected' : ''}>陷阱卡</option>
      </select>
      <select class="sdy-select" id="cf-kind">
        <option value="all">全部类型</option>
        <option value="qa" ${cardFilters.kind === 'qa' ? 'selected' : ''}>问答</option>
        <option value="cloze" ${cardFilters.kind === 'cloze' ? 'selected' : ''}>挖空</option>
      </select>
      <select class="sdy-select" id="cf-sort">
        <option value="created" ${cardFilters.sort === 'created' ? 'selected' : ''}>按创建时间</option>
        <option value="due" ${cardFilters.sort === 'due' ? 'selected' : ''}>按到期时间</option>
      </select>
      <span class="sdy-grow"></span>
      <button class="btn btn--sm" id="cf-aigen">🤖 AI 出卡</button>
      <button class="btn btn--primary btn--sm" id="cf-new">✚ 新卡片</button>
    </div>
    <div class="sdy-cardlist">
      ${list.length ? list.map((c) => {
        const st = c.suspended ? { name: '已暂停', cls: 'muted' } : STATE_INFO[c.fsrs?.state ?? 0];
        const dueLabel = c.fsrs && c.fsrs.state !== 0
          ? '到期 ' + new Date(c.fsrs.dueAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : '未学习';
        return `
        <div class="sdy-cardrow">
          <div class="sdy-cardrow__main" data-edit="${c.id}">
            <div class="sdy-cardrow__front">${escapeHtml(String(previewText(c)).slice(0, 120))}</div>
            <div class="sdy-cardrow__meta">
              <span class="sdy-chip sdy-chip--${st.cls}">${st.name}</span>
              <span class="sdy-chip sdy-chip--muted">${c.kind === 'cloze' ? `挖空 c${c.ord}` : '问答'}</span>
              ${c.flags & 1 ? '<span class="sdy-chip sdy-chip--leech">陷阱</span>' : ''}
              <span>${dueLabel}</span>
              ${c.fsrs?.lapses ? `<span>遗忘 ${c.fsrs.lapses} 次</span>` : ''}
              ${c.nid && nodePath.get(c.nid) ? `<span>📎 ${escapeHtml(nodePath.get(c.nid))}</span>` : ''}
            </div>
          </div>
          <div class="sdy-cardrow__acts">
            <button class="btn btn--sm" data-susp="${c.id}">${c.suspended ? '恢复' : '暂停'}</button>
            <button class="btn btn--sm btn--ghost" data-delc="${c.id}" style="color:var(--danger-fg)">删除</button>
          </div>
        </div>`;
      }).join('') : `
        <div class="sdy-empty">
          ${cards.length ? '没有符合筛选条件的卡片。' : `
            还没有卡片。<br>
            点「✚ 新卡片」手动创建问答卡或挖空卡；<br>
            也可以先去「知识树」搭结构，再从节点上一键出卡；<br>
            阶段二开放后可由 AI 从课件批量生成卡片（经审核入库）。`}
        </div>`}
    </div>`;

  const rerender = () => renderCards(panel, subject, root);
  let debounce = null;
  panel.querySelector('#cf-q').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { cardFilters.q = e.target.value.trim(); rerender(); }, 240);
  });
  for (const [sel, key] of [['#cf-state', 'state'], ['#cf-kind', 'kind'], ['#cf-sort', 'sort']]) {
    panel.querySelector(sel).addEventListener('change', (e) => { cardFilters[key] = e.target.value; rerender(); });
  }
  panel.querySelector('#cf-new').addEventListener('click', () => openCardEditor(subject, { onDone: () => gotoTab(root, subject.id, 'cards') }));
  panel.querySelector('#cf-aigen').addEventListener('click', () => {
    openAiGenCards(subject, nodesForAi, () => gotoTab(root, subject.id, 'ainote'));
  });
  for (const el of panel.querySelectorAll('[data-edit]')) {
    el.addEventListener('click', () => openCardEditor(subject, { card: cards.find((c) => c.id === el.dataset.edit), onDone: rerender }));
  }
  for (const b of panel.querySelectorAll('[data-susp]')) {
    b.addEventListener('click', async () => {
      const c = cards.find((x) => x.id === b.dataset.susp);
      c.suspended = !c.suspended;
      c.updatedAt = Date.now();
      await db.put('cards', c);
      rerender();
    });
  }
  for (const b of panel.querySelectorAll('[data-delc]')) {
    b.addEventListener('click', async () => {
      const c = cards.find((x) => x.id === b.dataset.delc);
      const extra = c.kind === 'cloze' ? '（若它是同一挖空笔记的兄弟卡之一，其余兄弟不受影响）' : '';
      if (!(await confirmBox({ title: '删除这张卡片？', body: '复习进度将一并删除。' + extra, confirmText: '删除', danger: true }))) return;
      await db.del('cards', c.id);
      rerender();
    });
  }
}

/**
 * 卡片编辑器（新建 / 编辑；问答与挖空两种类型）。
 * 新建挖空卡若含多个 cN，自动拆成同 noteId 的多张兄弟卡。
 */
export function openCardEditor(subject, { card = null, nid = null, kind = 'qa', onDone = null } = {}) {
  const nodesPromise = db.byIndex('nodes', 'subjectId', subject.id);
  const isCloze = card ? card.kind === 'cloze' : kind === 'cloze';
  nodesPromise.then((nodes) => {
    const { box, close } = openModal({
      title: card ? '编辑卡片' : '新建卡片',
      wide: true,
      bodyHtml: `
        ${card ? '' : `
        <div class="sdy-row" style="margin-bottom:14px" id="ce-kind">
          <button class="btn btn--sm${!isCloze ? ' btn--primary' : ''}" data-k="qa">问答卡</button>
          <button class="btn btn--sm${isCloze ? ' btn--primary' : ''}" data-k="cloze">挖空卡</button>
          <span class="sdy-field__hint">挖空卡用 {{c1::答案::提示}} 标记，可一键自动建议</span>
        </div>`}
        <div id="ce-qa"${isCloze ? ' hidden' : ''}>
          <div class="sdy-field">
            <label class="sdy-field__label">正面（问题 / 提示）*</label>
            <textarea class="sdy-textarea" id="ce-front" placeholder="例如：干球温度与湿球温度的差值反映了什么？">${escapeHtml(card && card.kind === 'qa' ? card.front : '')}</textarea>
          </div>
          <div class="sdy-field">
            <label class="sdy-field__label">背面（答案 / 解释）*</label>
            <textarea class="sdy-textarea" id="ce-back" placeholder="支持 Markdown、表格与 $公式$">${escapeHtml(card && card.kind === 'qa' ? card.back : '')}</textarea>
          </div>
        </div>
        <div id="ce-cloze"${isCloze ? '' : ' hidden'}>
          <div class="sdy-field">
            <label class="sdy-field__label">挖空原文 *</label>
            <textarea class="sdy-textarea" id="ce-ctext" style="min-height:110px" placeholder="把要背的词句用 {{c1::这样}} 标出来">${escapeHtml(card ? card.clozeText : '')}</textarea>
            <div class="sdy-row" style="margin-top:6px">
              <button class="btn btn--sm" id="ce-suggest">✨ 自动建议挖空</button>
              <span class="sdy-field__hint" id="ce-ordinfo"></span>
            </div>
          </div>
        </div>
        <div class="sdy-field">
          <label class="sdy-field__label">关联知识点（可选）</label>
          <select class="sdy-select" id="ce-nid">
            <option value="">不关联</option>
            ${nodes.map((n) => `<option value="${n.id}"${(card ? card.nid : nid) === n.id ? ' selected' : ''}>${escapeHtml(n.title)}</option>`).join('')}
          </select>
        </div>
        <div class="sdy-field">
          <label class="sdy-field__label">预览</label>
          <div class="sdy-modal__preview sdy-md" id="ce-preview"></div>
        </div>
        <div class="sdy-modal__acts">
          <button class="btn" data-a="cancel">取消</button>
          <button class="btn btn--primary" data-a="ok">${card ? '保存' : '创建'}</button>
        </div>`,
    });

    let curKind = isCloze ? 'cloze' : 'qa';
    const frontEl = box.querySelector('#ce-front');
    const backEl = box.querySelector('#ce-back');
    const ctextEl = box.querySelector('#ce-ctext');
    const previewEl = box.querySelector('#ce-preview');
    const ordInfo = box.querySelector('#ce-ordinfo');

    const updOrdInfo = () => {
      const ords = clozeOrds(ctextEl.value);
      ordInfo.textContent = ords.length
        ? `包含 ${ords.length} 个挖空序号（c${ords.join('、c')}）→ 将生成 ${ords.length} 张兄弟卡${card ? '，并同步到现有兄弟卡' : ''}`
        : '尚未标记挖空';
    };
    const updPreview = () => {
      previewEl.innerHTML = curKind === 'cloze'
        ? (ctextEl.value ? renderCloze(ctextEl.value, clozeOrds(ctextEl.value)[0] || 1) : '<p style="color:var(--text-3)">（挖空原文预览）</p>')
        : `<div>${renderMarkdown(frontEl.value) || '<p style="color:var(--text-3)">（正面预览）</p>'}</div><hr style="border:none;border-top:1px solid var(--border);margin:10px 0">${renderMarkdown(backEl.value)}`;
      bindReveal(previewEl);
    };
    const bindReveal = (rootEl) => {
      for (const blank of rootEl.querySelectorAll('.sdy-cz--active .sdy-cz__blank')) {
        blank.addEventListener('click', (e) => {
          e.stopPropagation();
          const holder = blank.closest('.sdy-cz--active');
          holder.classList.add('revealed');
          holder.querySelector('.sdy-cz__ans').hidden = false;
        });
      }
    };
    [frontEl, backEl, ctextEl].forEach((el) => el.addEventListener('input', () => { updPreview(); if (el === ctextEl) updOrdInfo(); }));
    updOrdInfo();
    updPreview();

    box.querySelector('#ce-suggest')?.addEventListener('click', () => {
      let t = ctextEl.value;
      t = t.replace(/\{\{c\d+::/g, '').replace(/(?:::[^{}]*)?\}\}/g, ''); // 先清掉旧标记
      ctextEl.value = suggestClozes(t);
      updOrdInfo(); updPreview();
    });

    // 类型切换（仅新建时）
    for (const kb of box.querySelectorAll('#ce-kind [data-k]')) {
      kb.addEventListener('click', () => {
        curKind = kb.dataset.k;
        box.querySelector('#ce-qa').hidden = curKind !== 'qa';
        box.querySelector('#ce-cloze').hidden = curKind !== 'cloze';
        for (const b of box.querySelectorAll('#ce-kind [data-k]')) b.classList.toggle('btn--primary', b.dataset.k === curKind);
        updPreview();
      });
    }

    box.querySelector('[data-a="cancel"]').onclick = close;
    box.querySelector('[data-a="ok"]').onclick = async () => {
      try {
        const nidVal = box.querySelector('#ce-nid').value || null;
        if (curKind === 'qa') {
          const front = frontEl.value.trim();
          const back = backEl.value.trim();
          if (!front || !back) { toast('正反面都要填写', true); return; }
          if (card) {
            card.front = front; card.back = back; card.nid = nidVal; card.updatedAt = Date.now();
            await db.put('cards', card);
          } else {
            const c = newCard(subject.id, { kind: 'qa', front, back, nid: nidVal });
            c.fsrs = await S.initSnapshot(subject.settings);
            await db.put('cards', c);
          }
        } else {
          const text = ctextEl.value.trim();
          const ords = clozeOrds(text);
          if (!text || !ords.length) { toast('请用 {{c1::…}} 标记至少一个挖空', true); return; }
          if (card) {
            // 编辑：同步整组兄弟卡
            const siblings = await db.byIndex('cards', 'noteId', card.noteId);
            const existingOrds = new Set(siblings.map((s) => s.ord));
            const noteId = card.noteId || card.id;
            let added = 0, removed = 0;
            for (const sib of siblings) {
              if (ords.includes(sib.ord)) {
                sib.clozeText = text; sib.nid = nidVal; sib.updatedAt = Date.now();
                await db.put('cards', sib);
              } else {
                await db.del('cards', sib.id);
                removed++;
              }
            }
            for (const o of ords) {
              if (existingOrds.has(o)) continue;
              const c = newCard(subject.id, { kind: 'cloze', clozeText: text, nid: nidVal, noteId, ord: o });
              c.fsrs = await S.initSnapshot(subject.settings);
              await db.put('cards', c);
              added++;
            }
            toast(`已保存（新增 ${added} 张，删除 ${removed} 张兄弟卡）`);
          } else {
            const noteId = uid();
            for (const o of ords) {
              const c = newCard(subject.id, { kind: 'cloze', clozeText: text, nid: nidVal, noteId, ord: o });
              c.fsrs = await S.initSnapshot(subject.settings);
              await db.put('cards', c);
            }
            toast(`已创建 ${ords.length} 张挖空卡`);
          }
        }
        subject.updatedAt = Date.now();
        await db.put('subjects', subject);
        close();
        if (onDone) onDone();
      } catch (e) {
        toast('保存失败：' + e.message, true);
      }
    };
  });
}

/* ============================================================
   设置
   ============================================================ */

async function renderSettings(panel, subject) {
  const st = subject.settings;
  const aiCfg = loadAiConfig();
  const usage = aiUsage();
  panel.innerHTML = `
    <div class="sdy-panel">
      <p class="sdy-panel__title">复习参数（FSRS-6）</p>
      <div class="sdy-field">
        <label class="sdy-field__label">目标保持率：<b id="set-dr-label">${st.desiredRetention.toFixed(2)}</b></label>
        <input type="range" class="sdy-range" id="set-dr" min="0.80" max="0.95" step="0.01" value="${st.desiredRetention}">
        <span class="sdy-field__hint">越高记得越牢但复习越频繁；Anki 默认 0.90。改完对之后的调度生效。</span>
      </div>
      <div class="sdy-row">
        <div class="sdy-field sdy-grow" style="max-width:160px">
          <label class="sdy-field__label">每日新卡上限</label>
          <input type="number" class="sdy-input" id="set-new" min="0" max="9999" value="${st.newPerDay}">
        </div>
        <div class="sdy-field sdy-grow" style="max-width:160px">
          <label class="sdy-field__label">每日复习上限</label>
          <input type="number" class="sdy-input" id="set-rev" min="0" max="9999" value="${st.revPerDay}">
        </div>
        <div class="sdy-field sdy-grow" style="max-width:160px">
          <label class="sdy-field__label">陷阱阈值（遗忘次数）</label>
          <input type="number" class="sdy-input" id="set-leech" min="2" max="99" value="${st.leechThreshold}">
        </div>
      </div>
      <div class="sdy-row">
        <div class="sdy-field sdy-grow" style="max-width:200px">
          <label class="sdy-field__label">学习步骤（分钟）</label>
          <input class="sdy-input" id="set-learn" value="${escapeHtml(st.learnSteps)}" placeholder="1m, 10m">
        </div>
        <div class="sdy-field sdy-grow" style="max-width:200px">
          <label class="sdy-field__label">重学步骤（分钟）</label>
          <input class="sdy-input" id="set-relearn" value="${escapeHtml(st.relearnSteps)}" placeholder="10m">
        </div>
        <div class="sdy-field sdy-grow" style="max-width:160px">
          <label class="sdy-field__label">最大间隔（天）</label>
          <input type="number" class="sdy-input" id="set-max" min="30" max="36500" value="${st.maxInterval}">
        </div>
        <div class="sdy-field" style="justify-content:flex-end">
          <label class="sdy-checkrow"><input type="checkbox" id="set-fuzz" ${st.enableFuzz ? 'checked' : ''}> 间隔模糊化（推荐开）</label>
        </div>
      </div>
      <div class="sdy-modal__acts" style="justify-content:flex-start">
        <button class="btn btn--primary" id="set-save">保存参数</button>
        <span class="sdy-field__hint" id="set-saved" hidden>已保存 ✓</span>
      </div>
    </div>

    <div class="sdy-panel">
      <p class="sdy-panel__title">AI 配置 <span class="sdy-chip ${aiCfg.mock ? 'sdy-chip--muted' : 'sdy-chip--review'}" id="aic-mode">${aiCfg.mock ? 'Mock 演示模式' : '已接入真实 API'}</span></p>
      <p class="sdy-field__hint" style="margin-bottom:10px">
        填 OpenAI 兼容端点（中转站 / 自建均可）+ Key + 模型名；端点会自动补 /v1/chat/completions。
        密钥只存在本机 localStorage，不参与云备份与导出。未配置时可勾选 Mock 模式走通全流程（输出为演示数据）。
      </p>
      <div class="sdy-row">
        <div class="sdy-field sdy-grow" style="min-width:220px">
          <label class="sdy-field__label">API 端点</label>
          <input class="sdy-input" id="aic-endpoint" placeholder="https://xxx.example.com/v4" value="${escapeHtml(aiCfg.endpoint)}">
        </div>
        <div class="sdy-field sdy-grow" style="min-width:180px">
          <label class="sdy-field__label">API Key</label>
          <input class="sdy-input" id="aic-key" type="password" placeholder="sk-…" value="${escapeHtml(aiCfg.key)}" autocomplete="off">
        </div>
        <div class="sdy-field" style="min-width:160px">
          <label class="sdy-field__label">模型</label>
          <input class="sdy-input" id="aic-model" placeholder="例如 glm-4.6 / deepseek-chat" value="${escapeHtml(aiCfg.model)}">
        </div>
      </div>
      <div class="sdy-row" style="margin-top:4px">
        <label class="sdy-checkrow"><input type="checkbox" id="aic-mock" ${aiCfg.mock ? 'checked' : ''}> Mock 演示模式（不调用真实 API）</label>
        <span class="sdy-grow"></span>
        <button class="btn" id="aic-test">测试连接</button>
        <button class="btn btn--primary" id="aic-save">保存 AI 配置</button>
        <span class="sdy-field__hint" id="aic-saved" hidden>已保存 ✓</span>
      </div>
      <p class="sdy-field__hint" style="margin-top:8px">用量：${usage.calls} 次调用 · ${usage.totalTokens} tokens（累计本机）<button class="btn btn--sm btn--ghost" id="aic-resetusage" style="margin-left:8px">清零</button></p>
    </div>

    <div class="sdy-panel">
      <p class="sdy-panel__title">云备份 <span class="sdy-chip sdy-chip--muted" id="cb-status">检查中…</span></p>
      <p class="sdy-field__hint" style="margin-bottom:10px">
        把全部科目（卡片 + 复习进度 + 知识树）手动备份到你的 Supabase 账号，换设备 / 清缓存前先上传。
        每个账号保留最近一份，上传会覆盖；恢复前会先在本机留恢复点。AI 密钥不参与备份。
      </p>
      <div class="sdy-row">
        <button class="btn btn--primary" id="cb-upload">☁ 立即上传备份</button>
        <button class="btn" id="cb-restore">⬇ 从云端恢复…</button>
        <span class="sdy-field__hint" id="cb-meta"></span>
      </div>
    </div>

    <div class="sdy-panel">
      <p class="sdy-panel__title">本地数据（分科目文件）</p>
      <div class="sdy-row">
        <button class="btn" id="ld-exp1">导出本科目 JSON</button>
        <button class="btn" id="ld-expall">导出全部科目</button>
        <button class="btn" id="ld-imp">导入科目 JSON…</button>
        <input type="file" id="ld-file" accept=".json,application/json" hidden>
      </div>
      <p class="sdy-field__hint" style="margin-top:8px">导入按科目文件进行，全部 id 会重新生成、不会覆盖现有数据；卡片复习进度随文件带走。AI 配置不参与导出。</p>
    </div>

    <div class="sdy-panel" style="border-color:var(--danger-border)">
      <p class="sdy-panel__title" style="color:var(--danger-fg)">危险区</p>
      <div class="sdy-row">
        <button class="btn" id="dz-clearlog">清空本科目复习记录</button>
        <button class="btn" id="dz-del" style="color:var(--danger-fg)">删除本科目…</button>
      </div>
    </div>`;

  // —— 复习参数
  panel.querySelector('#set-dr').addEventListener('input', (e) => {
    panel.querySelector('#set-dr-label').textContent = Number(e.target.value).toFixed(2);
  });
  panel.querySelector('#set-save').addEventListener('click', async () => {
    const s = subject.settings;
    s.desiredRetention = Number(panel.querySelector('#set-dr').value);
    s.newPerDay = Math.max(0, Number(panel.querySelector('#set-new').value) || 20);
    s.revPerDay = Math.max(0, Number(panel.querySelector('#set-rev').value) || 200);
    s.leechThreshold = Math.max(2, Number(panel.querySelector('#set-leech').value) || 8);
    s.learnSteps = panel.querySelector('#set-learn').value.trim() || '1m, 10m';
    s.relearnSteps = panel.querySelector('#set-relearn').value.trim() || '10m';
    s.maxInterval = Math.max(30, Number(panel.querySelector('#set-max').value) || 36500);
    s.enableFuzz = panel.querySelector('#set-fuzz').checked;
    subject.updatedAt = Date.now();
    await db.put('subjects', subject);
    const flag = panel.querySelector('#set-saved');
    flag.hidden = false;
    setTimeout(() => { flag.hidden = true; }, 1600);
    toast('复习参数已保存');
  });

  // —— AI 配置
  panel.querySelector('#aic-save').addEventListener('click', () => {
    saveAiConfig({
      endpoint: panel.querySelector('#aic-endpoint').value.trim(),
      key: panel.querySelector('#aic-key').value.trim(),
      model: panel.querySelector('#aic-model').value.trim(),
      mock: panel.querySelector('#aic-mock').checked,
    });
    const flag = panel.querySelector('#aic-saved');
    flag.hidden = false;
    setTimeout(() => { flag.hidden = true; }, 1600);
    renderSettings(panel, subject);
    toast('AI 配置已保存');
  });
  panel.querySelector('#aic-test').addEventListener('click', async () => {
    // 先用表单当前值临时保存再测，避免"改了没存就测"的困惑
    saveAiConfig({
      endpoint: panel.querySelector('#aic-endpoint').value.trim(),
      key: panel.querySelector('#aic-key').value.trim(),
      model: panel.querySelector('#aic-model').value.trim(),
      mock: panel.querySelector('#aic-mock').checked,
    });
    const btn = panel.querySelector('#aic-test');
    btn.disabled = true;
    btn.textContent = '测试中…';
    const t0 = Date.now();
    try {
      const { content } = await chat([{ role: 'user', content: '请只回复两个字：正常' }], { task: 'chat', maxTokens: 20 });
      toast(`连接正常（${Date.now() - t0}ms）：${content.slice(0, 30)}`);
    } catch (e) {
      toast('连接失败：' + e.message, true, 5200);
    }
    btn.disabled = false;
    btn.textContent = '测试连接';
  });
  panel.querySelector('#aic-resetusage').addEventListener('click', () => {
    try { localStorage.removeItem('stardy-ai-usage-v1'); } catch {}
    renderSettings(panel, subject);
  });

  // —— 云备份
  const statusEl = panel.querySelector('#cb-status');
  const metaEl = panel.querySelector('#cb-meta');
  (async () => {
    try {
      if (!cloudReady()) {
        statusEl.textContent = '云端未连接';
        statusEl.className = 'sdy-chip sdy-chip--leech';
        metaEl.textContent = 'Supabase 未配置或不可达，云备份不可用（本地数据不受影响）。';
        return;
      }
      const user = await cloudUser();
      if (!user) {
        statusEl.textContent = '未登录';
        statusEl.className = 'sdy-chip sdy-chip--leech';
        metaEl.innerHTML = '请先<a href="/">去主站登录</a>，再回到这里上传备份。';
        return;
      }
      statusEl.textContent = '已登录';
      statusEl.className = 'sdy-chip sdy-chip--review';
      const meta = await cloudMeta();
      metaEl.textContent = meta
        ? `上次备份：${new Date(meta.updated_at).toLocaleString('zh-CN')} · ${meta.subject_count} 个科目 · ${(meta.size_bytes / 1024).toFixed(0)} KB`
        : '云端还没有备份。';
    } catch {
      statusEl.textContent = '云端异常';
      statusEl.className = 'sdy-chip sdy-chip--leech';
    }
  })();

  panel.querySelector('#cb-upload').addEventListener('click', async () => {
    try {
      const r = await cloudUpload();
      toast(`已上传备份（${r.subjects} 个科目 · ${(r.size / 1024).toFixed(0)} KB）`);
      renderSettings(panel, subject);
    } catch (e) { toast(e.message, true); }
  });
  panel.querySelector('#cb-restore').addEventListener('click', async () => {
    const ok = await confirmBox({
      title: '从云端恢复？',
      body: '将用云端备份<b>整体替换</b>本机当前的全部科目数据。恢复前会自动在本机留一份恢复点。确认继续？',
      confirmText: '恢复', danger: true,
    });
    if (!ok) return;
    try {
      await makeRestorePoint();
      await cloudRestore();
      toast('已从云端恢复');
      renderSettings(panel, subject);
    } catch (e) { toast(e.message, true); }
  });

  // —— 本地数据
  panel.querySelector('#ld-exp1').addEventListener('click', async () => {
    const data = await exportSubjectFile(subject.id);
    toast(`已导出「${data.subjects[0].name}」`);
  });
  panel.querySelector('#ld-expall').addEventListener('click', async () => {
    await exportAllFile();
    toast('已导出全部科目');
  });
  const fileEl = panel.querySelector('#ld-file');
  panel.querySelector('#ld-imp').addEventListener('click', () => fileEl.click());
  fileEl.addEventListener('change', async () => {
    const f = fileEl.files[0];
    fileEl.value = '';
    if (!f) return;
    try {
      const payload = await readJsonFile(f);
      const ok = await confirmBox({
        title: `导入「${payload.subjects?.[0]?.name || f.name}」？`,
        body: '将以新 id 合并进当前数据（不会覆盖现有科目），卡片复习进度随文件带走。',
        confirmText: '导入',
      });
      if (!ok) return;
      const r = await importPayload(payload);
      toast(`已导入 ${r.subjects} 个科目、${r.cards} 张卡片`);
    } catch (e) { toast(e.message, true); }
  });

  // —— 危险区
  panel.querySelector('#dz-clearlog').addEventListener('click', async () => {
    const ok = await confirmBox({
      title: '清空本科目复习记录？',
      body: '答题历史与热图将被清空；卡片保留，但调度状态（间隔/难度）不动。通常只在想重新统计时使用。',
      confirmText: '清空', danger: true,
    });
    if (!ok) return;
    await db.delByIndex('revlog', 'subjectId', subject.id);
    toast('已清空复习记录');
  });
  panel.querySelector('#dz-del').addEventListener('click', async () => {
    const name = await promptBox({
      title: `删除科目「${subject.name}」`,
      body: `将删除全部卡片、知识树、资料与复习记录。<br>为防误删，请输入科目名称确认：<b>${escapeHtml(subject.name)}</b>`,
      placeholder: '输入科目名称',
      confirmText: '永久删除',
    });
    if (name !== subject.name) { if (name !== null) toast('名称不匹配，未删除', true); return; }
    await cascadeDeleteSubject(subject.id);
    toast('已删除科目');
    location.hash = '#/';
  });
}
