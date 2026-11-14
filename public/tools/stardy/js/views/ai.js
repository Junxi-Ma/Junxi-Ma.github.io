/**
 * Stardy — AI 流程：建知识树 / 批量出卡 / 批量出题 / 审核台
 *
 * AI 产出先入 pending（待审核），经人工审核通过才写入正式表。
 * 节点/关系按批次重映射 id；卡片与题目直接挂真实节点。
 */

import db from '../db.js?v=6';
import { uid, escapeHtml, newCard, newNode, newLink, newQuiz, clozeOrds } from '../models.js?v=6';
import { openModal, toast, confirmBox } from '../ui.js?v=6';
import { aiStructFromChunk, aiCardsForNode, aiQuizForNode, loadAiConfig } from '../ai.js?v=6';
import { roughSections } from '../parse.js?v=6';
import * as S from '../scheduler.js?v=6';

/* ============================================================
   AI 建树
   ============================================================ */

/** 选资料弹窗 → 分块 → 逐块 AI 提取 → 入 pending（逐块增量保存，可中断） */
export function openAiBuildTree(subject, docs, onDone) {
  if (!docs.length) { toast('先在「资料」页上传课件或资料', true); return; }

  const { box, close } = openModal({
    title: 'AI 构建知识树',
    wide: true,
    bodyHtml: `
      <p class="sdy-field__hint" style="margin-bottom:10px">
        ${loadAiConfig().mock
          ? '⚠ 当前为 <b>Mock 演示模式</b>（设置页可填真实 API）。输出为演示数据，用于走通流程。'
          : `模型：<b>${escapeHtml(loadAiConfig().model || '默认')}</b>，按片段逐次调用，可随时中断（已生成的片段保留）。`}
      </p>
      <div class="sdy-field">
        <label class="sdy-field__label">选择参与建树的资料</label>
        <div id="bt-docs" style="max-height:180px;overflow-y:auto">
          ${docs.map((d) => `
            <label class="sdy-checkrow" style="margin-bottom:6px">
              <input type="checkbox" checked value="${d.id}" data-chars="${d.chars}">
              <span>${escapeHtml(d.name)} <span style="color:var(--text-3)">（${d.chars} 字）</span></span>
            </label>`).join('')}
        </div>
      </div>
      <div class="sdy-field">
        <label class="sdy-field__label">每个片段上限（字符）</label>
        <input type="number" class="sdy-input" id="bt-chunk" value="2000" min="800" max="6000" style="max-width:180px">
        <span class="sdy-field__hint" id="bt-estimate"></span>
      </div>
      <div id="bt-progress" hidden>
        <div class="sdy-review__prog" style="max-width:100%;margin-bottom:8px"><i id="bt-bar" style="width:0%"></i></div>
        <p class="sdy-field__hint" id="bt-line">准备中…</p>
      </div>
      <div class="sdy-modal__acts">
        <button class="btn" data-a="cancel">取消</button>
        <button class="btn btn--primary" data-a="start">开始构建</button>
        <button class="btn" data-a="stop" hidden>停止（保留已完成部分）</button>
      </div>`,
  });

  const updEstimate = () => {
    const chars = [...box.querySelectorAll('#bt-docs input:checked')].reduce((s, c) => s + Number(c.dataset.chars || 0), 0);
    const size = Number(box.querySelector('#bt-chunk').value) || 2000;
    const est = Math.max(1, Math.ceil(chars / size));
    box.querySelector('#bt-estimate').textContent = `约 ${chars} 字 → 预计 ${est} 次调用`;
  };
  updEstimate();
  box.querySelector('#bt-chunk').addEventListener('input', updEstimate);
  for (const c of box.querySelectorAll('#bt-docs input')) c.addEventListener('change', updEstimate);

  box.querySelector('[data-a="cancel"]').onclick = () => { stopFlag = true; close(); };
  let stopFlag = false;
  box.querySelector('[data-a="stop"]').onclick = () => { stopFlag = true; };

  box.querySelector('[data-a="start"]').onclick = async () => {
    const chosen = [...box.querySelectorAll('#bt-docs input:checked')].map((c) => docs.find((d) => d.id === c.value));
    if (!chosen.length) { toast('至少选一份资料', true); return; }
    const chunkSize = Number(box.querySelector('#bt-chunk').value) || 2000;
    const batchId = uid();

    const chunks = [];
    for (const d of chosen) {
      for (const c of roughSections(d.text, chunkSize)) {
        chunks.push({ doc: d, chunk: c });
      }
    }
    if (!chunks.length) { toast('资料里没有可提取的文字', true); return; }

    box.querySelector('[data-a="start"]').hidden = true;
    box.querySelector('#bt-progress').hidden = false;
    box.querySelector('[data-a="stop"]').hidden = false;
    box.querySelector('[data-a="cancel"]').textContent = '关闭';

    const bar = box.querySelector('#bt-bar');
    const line = box.querySelector('#bt-line');
    let nodeN = 0, linkN = 0, mergedN = 0;
    // 跨片段同章合并：标题相同的根节点不重复建，其子树挂到已有章下
    const normTitle = (s) => String(s || '').replace(/[\s第章章节：:、·．.\-—~～()（）]/g, '').slice(0, 10);
    const seenRoots = new Map(); // normTitle -> tempId（已入库的根）

    for (let i = 0; i < chunks.length; i++) {
      if (stopFlag) break;
      const { doc, chunk } = chunks[i];
      bar.style.width = `${(i / chunks.length) * 100}%`;
      line.textContent = `片段 ${i + 1}/${chunks.length}：${chunk.heading || doc.name}…`;
      try {
        const { nodes: rawNodes, links } = await aiStructFromChunk(chunk.text, { docName: doc.name, idx: i, total: chunks.length });
        // —— 同章合并：重复根丢弃，引用它的子节点改挂已有根 ——
        const dropMap = new Map(); // 被丢弃的根 tempId -> 已有根 tempId
        const nodes = [];
        for (const n of rawNodes.slice(0, 14)) {
          const tempId = String(n.id || uid()).slice(0, 12);
          const pidTemp = n.pid ? String(n.pid).slice(0, 12) : null;
          const key = normTitle(n.title);
          if (!pidTemp && key && seenRoots.has(key)) {
            dropMap.set(tempId, seenRoots.get(key));
            mergedN++;
            continue;
          }
          nodes.push({ ...n, id: tempId, pid: pidTemp });
          if (!pidTemp && key) seenRoots.set(key, tempId);
        }
        // 重映射：pid 指向被丢弃根的节点 → 改挂已有根
        const remap = (pid) => (pid && dropMap.has(pid) ? dropMap.get(pid) : pid);
        const srcRef = { docId: doc.id, docName: doc.name, chunkIdx: chunk.idx, quote: chunk.heading || '' };
        for (const n of nodes) {
          const pidTemp = remap(String(n.pid || '')) || null;
          await db.put('pending', {
            id: uid(), subjectId: subject.id, batchId, kind: 'node', createdAt: Date.now(),
            data: {
              tempId: n.id,
              pidTemp: pidTemp ? String(pidTemp).slice(0, 12) : null,
              title: String(n.title).slice(0, 40),
              detail: String(n.detail || '').slice(0, 400),
              formula: String(n.formula || '').slice(0, 300),
              quote: String(n.quote || '').slice(0, 80),
              sourceRef: srcRef,
            },
          });
          nodeN++;
        }
        for (const l of links.slice(0, 12)) {
          await db.put('pending', {
            id: uid(), subjectId: subject.id, batchId, kind: 'link', createdAt: Date.now(),
            data: { fromTemp: remap(String(l.from)), toTemp: remap(String(l.to)), label: l.label, sourceRef: srcRef },
          });
          linkN++;
        }
      } catch (e) {
        line.textContent = `片段 ${i + 1} 失败：${e.message}（继续下一个）`;
        await new Promise((r) => setTimeout(r, 900));
      }
    }
    bar.style.width = '100%';
    box.querySelector('[data-a="stop"]').hidden = true;
    line.textContent = stopFlag
      ? `已停止：本批收集 ${nodeN} 个节点、${linkN} 条关系（合并重复章 ${mergedN} 处），去审核台确认入库`
      : `完成：收集 ${nodeN} 个节点、${linkN} 条关系（合并重复章 ${mergedN} 处），去审核台确认入库`;
    if (nodeN + linkN === 0) { toast('没有产出可审核的内容', true); return; }
    close();
    toast(`AI 完成：${nodeN} 节点 / ${linkN} 关系待审核（合并重复章 ${mergedN} 处）`);
    if (onDone) onDone();
  };
}

/* ============================================================
   AI 批量出卡
   ============================================================ */

export function openAiGenCards(subject, nodes, onDone) {
  if (!nodes.length) { toast('先建一些知识点（树或手动节点）', true); return; }
  const cfg = loadAiConfig();
  const { box, close } = openModal({
    title: 'AI 批量出卡',
    wide: true,
    bodyHtml: `
      <p class="sdy-field__hint" style="margin-bottom:10px">
        ${cfg.mock ? '⚠ 当前为 <b>Mock 演示模式</b>（设置页可填真实 API）。' : `模型：<b>${escapeHtml(cfg.model || '默认')}</b>，每个知识点一次调用，可中断。`}
      </p>
      <div class="sdy-field">
        <label class="sdy-field__label">选择知识点（默认全选未出过卡的）</label>
        <div style="max-height:240px;overflow-y:auto" id="gc-nodes">
          ${nodes.map((n) => `
            <label class="sdy-checkrow" style="margin-bottom:5px">
              <input type="checkbox" value="${n.id}" ${n._hasCards ? '' : 'checked'}>
              <span>${escapeHtml(n.title)}</span>
            </label>`).join('')}
        </div>
      </div>
      <div id="gc-progress" hidden>
        <div class="sdy-review__prog" style="max-width:100%;margin-bottom:8px"><i id="gc-bar" style="width:0%"></i></div>
        <p class="sdy-field__hint" id="gc-line"></p>
      </div>
      <div class="sdy-modal__acts">
        <button class="btn" data-a="cancel">取消</button>
        <button class="btn btn--primary" data-a="start">开始出卡</button>
      </div>`,
  });

  let stopFlag = false;
  box.querySelector('[data-a="cancel"]').onclick = () => { stopFlag = true; close(); };
  box.querySelector('[data-a="start"]').onclick = async () => {
    const chosen = [...box.querySelectorAll('#gc-nodes input:checked')].map((c) => nodes.find((n) => n.id === c.value));
    if (!chosen.length) { toast('至少选一个知识点', true); return; }
    const batchId = uid();
    box.querySelector('[data-a="start"]').hidden = true;
    box.querySelector('#gc-progress').hidden = false;
    box.querySelector('[data-a="cancel"]').textContent = '关闭';

    const bar = box.querySelector('#gc-bar');
    const line = box.querySelector('#gc-line');
    let cardN = 0;

    for (let i = 0; i < chosen.length; i++) {
      if (stopFlag) break;
      const n = chosen[i];
      bar.style.width = `${(i / chosen.length) * 100}%`;
      line.textContent = `出卡 ${i + 1}/${chosen.length}：${n.title}…`;
      try {
        const cards = await aiCardsForNode(n);
        for (const c of cards.slice(0, 6)) {
          await db.put('pending', {
            id: uid(), subjectId: subject.id, batchId, kind: 'card', createdAt: Date.now(),
            data: {
              kind: c.kind,
              front: String(c.front || '').slice(0, 800),
              back: String(c.back || '').slice(0, 1200),
              clozeText: String(c.clozeText || '').slice(0, 800),
              nid: n.id,
              sourceRef: { docId: null, docName: '知识点：' + n.title, chunkIdx: null, quote: (n.detail || '').slice(0, 60) },
            },
          });
          cardN++;
        }
      } catch (e) {
        line.textContent = `「${n.title}」失败：${e.message}（继续）`;
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    bar.style.width = '100%';
    line.textContent = `完成：收集 ${cardN} 张卡片待审核`;
    if (!cardN) { toast('没有产出卡片', true); return; }
    close();
    toast(`AI 出卡 ${cardN} 张，待审核`);
    if (onDone) onDone();
  };
}

/* ============================================================
   AI 批量出题（测验）
   ============================================================ */

/** 选知识点 + 题型 → 每个知识点每种题型出一题 → 入 pending 等审核 */
export function openAiGenQuiz(subject, nodes, onDone) {
  if (!nodes.length) { toast('先建一些知识点再出题', true); return; }
  const cfg = loadAiConfig();
  const { box, close } = openModal({
    title: 'AI 批量出题',
    wide: true,
    bodyHtml: `
      <p class="sdy-field__hint" style="margin-bottom:10px">
        ${cfg.mock
          ? '⚠ 当前为 <b>Mock 演示模式</b>（设置页可填真实 API）。'
          : `模型：<b>${escapeHtml(cfg.model || '默认')}</b>，每个知识点每种题型一次调用，可中断。`}
      </p>
      <div class="sdy-field">
        <label class="sdy-field__label">题型（可多选）</label>
        <div class="sdy-row">
          <label class="sdy-checkrow qz-type"><input type="checkbox" value="choice" checked> 选择题</label>
          <label class="sdy-checkrow qz-type"><input type="checkbox" value="fill" checked> 填空题</label>
          <label class="sdy-checkrow qz-type"><input type="checkbox" value="essay" checked> 简答题（AI 批改）</label>
        </div>
      </div>
      <div class="sdy-field">
        <label class="sdy-field__label">范围（默认全选未出过题的知识点）</label>
        <div style="max-height:220px;overflow-y:auto" id="qz-nodes">
          ${nodes.map((n) => `
            <label class="sdy-checkrow" style="margin-bottom:5px">
              <input type="checkbox" value="${n.id}" ${n._hasQuiz ? '' : 'checked'}>
              <span>${escapeHtml(n.title)}</span>
            </label>`).join('')}
        </div>
      </div>
      <div id="qz-progress" hidden>
        <div class="sdy-review__prog" style="max-width:100%;margin-bottom:8px"><i id="qz-bar" style="width:0%"></i></div>
        <p class="sdy-field__hint" id="qz-line"></p>
      </div>
      <div class="sdy-modal__acts">
        <button class="btn" data-a="cancel">取消</button>
        <button class="btn btn--primary" data-a="start">开始出题</button>
      </div>`,
  });

  let stopFlag = false;
  box.querySelector('[data-a="cancel"]').onclick = () => { stopFlag = true; close(); };
  box.querySelector('[data-a="start"]').onclick = async () => {
    const types = [...box.querySelectorAll('.qz-type input:checked')].map((c) => c.value);
    const chosen = [...box.querySelectorAll('#qz-nodes input:checked')].map((c) => nodes.find((n) => n.id === c.value));
    if (!types.length || !chosen.length) { toast('至少选一种题型和一个知识点', true); return; }
    const batchId = uid();
    box.querySelector('[data-a="start"]').hidden = true;
    box.querySelector('#qz-progress').hidden = false;
    box.querySelector('[data-a="cancel"]').textContent = '关闭';

    const bar = box.querySelector('#qz-bar');
    const line = box.querySelector('#qz-line');
    const total = chosen.length * types.length;
    let done = 0, quizN = 0;
    const typeName = { choice: '选择', fill: '填空', essay: '简答' };

    for (const n of chosen) {
      if (stopFlag) break;
      for (const type of types) {
        if (stopFlag) break;
        bar.style.width = `${(done / total) * 100}%`;
        line.textContent = `出题 ${done + 1}/${total}：${n.title}（${typeName[type]}）…`;
        try {
          const z = await aiQuizForNode(n, type);
          await db.put('pending', {
            id: uid(), subjectId: subject.id, batchId, kind: 'quiz', createdAt: Date.now(),
            data: { ...z, nid: n.id, sourceRef: { docId: null, docName: '知识点：' + n.title, chunkIdx: null, quote: (n.detail || '').slice(0, 60) } },
          });
          quizN++;
        } catch (e) {
          line.textContent = `「${n.title}」${typeName[type]}题失败：${e.message}（继续）`;
          await new Promise((r) => setTimeout(r, 700));
        }
        done++;
      }
    }
    bar.style.width = '100%';
    line.textContent = `完成：收集 ${quizN} 道题待审核`;
    if (!quizN) { toast('没有产出题目', true); return; }
    close();
    toast(`AI 出题 ${quizN} 道，待审核`);
    if (onDone) onDone();
  };
}

/* ============================================================
   审核台
   ============================================================ */

/**
 * 审核台：按批次列出 pending 条目，逐条编辑/勾选，通过后重映射入库。
 * @param container 面板元素
 * @param onDone 入库后回调（刷新视图）
 */
export async function renderReviewConsole(container, subject, onDone) {
  const items = await db.byIndex('pending', 'subjectId', subject.id);
  if (!items.length) {
    container.innerHTML = `
      <div class="sdy-panel"><div class="sdy-soon">
        <div class="ic">✅</div>
        <p>没有待审核的 AI 产出。<br>去「知识树」用 🤖 AI 建树，或在「卡片」页用 🤖 AI 出卡。</p>
      </div></div>
      <div class="sdy-row"><button class="btn" id="rc-back">↩ 返回知识树</button></div>`;
    container.querySelector('#rc-back').addEventListener('click', () => onDone('tree'));
    return;
  }

  // 按批次分组（新批次在前）
  const batches = new Map();
  for (const it of items) {
    if (!batches.has(it.batchId)) batches.set(it.batchId, []);
    batches.get(it.batchId).push(it);
  }
  const batchList = [...batches.entries()].sort((a, b) => (b[1][0].createdAt || 0) - (a[1][0].createdAt || 0));

  container.innerHTML = `
    <div class="sdy-row" style="margin-bottom:12px">
      <button class="btn btn--sm" id="rc-back">↩ 返回知识树</button>
      <span class="sdy-grow"></span>
      <span class="sdy-chip sdy-chip--muted">${items.length} 条待审核 · ${batchList.length} 个批次</span>
      <button class="btn btn--sm" style="color:var(--danger-fg)" id="rc-clearall">清空全部</button>
    </div>
    ${batchList.map(([bid, list]) => batchHtml(bid, list)).join('')}`;

  function batchHtml(bid, list) {
    const counts = { node: 0, link: 0, card: 0, quiz: 0 };
    for (const it of list) counts[it.kind]++;
    const docNames = [...new Set(list.map((it) => it.data.sourceRef?.docName).filter(Boolean))].slice(0, 3);
    return `
      <div class="sdy-panel" data-batch="${bid}">
        <p class="sdy-panel__title">
          <span>批次 ${escapeHtml(bid.slice(0, 6))} · ${new Date(list[0].createdAt).toLocaleString('zh-CN')}
            <span class="sdy-chip sdy-chip--muted" style="margin-left:6px">节点 ${counts.node} · 关系 ${counts.link} · 卡片 ${counts.card} · 题目 ${counts.quiz}</span>
          </span>
          <span class="sdy-row">
            <button class="btn btn--sm btn--primary" data-ok="${bid}">✓ 通过所选</button>
            <button class="btn btn--sm" data-drop="${bid}">✕ 丢弃所选</button>
            <button class="btn btn--sm btn--ghost" style="color:var(--danger-fg)" data-dropbatch="${bid}">丢弃整批</button>
          </span>
        </p>
        ${docNames.length ? `<p class="sdy-field__hint" style="margin-bottom:8px">来源：${escapeHtml(docNames.join(' / '))}</p>` : ''}
        <div class="sdy-cardlist" style="max-height:480px;overflow-y:auto">
          ${list.map((it) => itemHtml(it, list)).join('')}
        </div>
      </div>`;
  }

  function itemHtml(it, list) {
    const nodeTitle = (tempId) => {
      const src = list.find((x) => x.kind === 'node' && x.data.tempId === tempId);
      return src ? src.data.title : '(未知节点)';
    };
    if (it.kind === 'node') {
      return `
        <div class="sdy-cardrow" data-item="${it.id}">
          <input type="checkbox" checked data-ck style="flex:none">
          <div class="sdy-cardrow__main" style="display:flex;flex-direction:column;gap:6px">
            <div class="sdy-row">
              <span class="sdy-chip sdy-chip--new">节点</span>
              <input class="sdy-input" data-f="title" value="${escapeHtml(it.data.title)}" style="max-width:280px" maxlength="40">
              <input class="sdy-input" data-f="formula" value="${escapeHtml(it.data.formula)}" placeholder="公式（可选）" style="max-width:220px;font-family:var(--font-mono);font-size:12px">
            </div>
            <textarea class="sdy-textarea" data-f="detail" style="min-height:52px" placeholder="正文">${escapeHtml(it.data.detail)}</textarea>
            ${it.data.quote ? `<p class="sdy-field__hint">📎 「${escapeHtml(it.data.quote)}」${it.data.sourceRef?.docName ? ' —— ' + escapeHtml(it.data.sourceRef.docName) : ''}</p>` : ''}
          </div>
        </div>`;
    }
    if (it.kind === 'link') {
      return `
        <div class="sdy-cardrow" data-item="${it.id}">
          <input type="checkbox" checked data-ck style="flex:none">
          <div class="sdy-cardrow__main sdy-row">
            <span class="sdy-chip sdy-chip--muted">关系</span>
            <select class="sdy-select" data-f="label" style="width:auto">
              ${['前置', '拓展', '易混'].map((l) => `<option ${l === it.data.label ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
            <span style="font-size:var(--fs-sm);color:var(--text-2)">
              ${escapeHtml(nodeTitle(it.data.fromTemp))} → ${escapeHtml(nodeTitle(it.data.toTemp))}
            </span>
          </div>
        </div>`;
    }
    if (it.kind === 'quiz') {
      const typeLabel = { choice: '选择', fill: '填空', essay: '简答' }[it.data.type] || it.data.type;
      const optsHtml = it.data.type === 'choice'
        ? `<div class="sdy-row" style="margin-top:4px">${(it.data.opts || []).map((o, i) =>
            `<label class="sdy-checkrow" style="gap:4px"><input type="radio" name="qz-${it.id}" data-f="answer" value="${i}" ${Number(it.data.answer) === i ? 'checked' : ''}><span>${String.fromCharCode(65 + i)}. ${escapeHtml(o)}</span></label>`).join('')}</div>`
        : it.data.type === 'fill'
          ? `<input class="sdy-input" data-f="answer" value="${escapeHtml(it.data.answer)}" placeholder="参考答案" style="margin-top:4px">`
          : `<textarea class="sdy-textarea" data-f="answer" style="min-height:64px" placeholder="参考答案要点（每点一行）">${escapeHtml(it.data.answer)}</textarea>`;
      return `
        <div class="sdy-cardrow" data-item="${it.id}">
          <input type="checkbox" checked data-ck style="flex:none">
          <div class="sdy-cardrow__main" style="display:flex;flex-direction:column;gap:6px">
            <div class="sdy-row">
              <span class="sdy-chip sdy-chip--learn">${typeLabel}题</span>
              <span class="sdy-field__hint">${escapeHtml(it.data.sourceRef?.docName || '')}</span>
            </div>
            <textarea class="sdy-textarea" data-f="q" style="min-height:48px">${escapeHtml(it.data.q)}</textarea>
            ${optsHtml}
            <textarea class="sdy-textarea" data-f="explain" style="min-height:36px" placeholder="解析">${escapeHtml(it.data.explain)}</textarea>
          </div>
        </div>`;
    }
    // card
    const ordN = it.data.kind === 'cloze' ? clozeOrds(it.data.clozeText).length : 0;
    return `
      <div class="sdy-cardrow" data-item="${it.id}">
        <input type="checkbox" checked data-ck style="flex:none">
        <div class="sdy-cardrow__main" style="display:flex;flex-direction:column;gap:6px">
          <div class="sdy-row">
            <span class="sdy-chip ${it.data.kind === 'cloze' ? 'sdy-chip--learn' : 'sdy-chip--new'}">${it.data.kind === 'cloze' ? `挖空${ordN ? '×' + ordN : ''}` : '问答'}</span>
            <span class="sdy-field__hint">${escapeHtml(it.data.sourceRef?.docName || '')}</span>
          </div>
          ${it.data.kind === 'qa' ? `
            <input class="sdy-input" data-f="front" value="${escapeHtml(it.data.front)}" placeholder="正面">
            <textarea class="sdy-textarea" data-f="back" style="min-height:52px">${escapeHtml(it.data.back)}</textarea>
          ` : `
            <textarea class="sdy-textarea" data-f="clozeText" style="min-height:52px">${escapeHtml(it.data.clozeText)}</textarea>
          `}
        </div>
      </div>`;
  }

  const rerender = () => renderReviewConsole(container, subject, onDone);
  container.querySelector('#rc-back').addEventListener('click', () => onDone('tree'));
  container.querySelector('#rc-clearall').addEventListener('click', async () => {
    const ok = await confirmBox({ title: '清空全部待审核条目？', body: `${items.length} 条 AI 产出将被丢弃。`, confirmText: '清空', danger: true });
    if (!ok) return;
    for (const it of items) await db.del('pending', it.id);
    rerender();
  });

  for (const btn of container.querySelectorAll('[data-dropbatch]')) {
    btn.addEventListener('click', async () => {
      const bid = btn.dataset.dropbatch;
      const list = batches.get(bid);
      const ok = await confirmBox({ title: '丢弃整批？', body: `该批次 ${list.length} 条产出将被丢弃。`, confirmText: '丢弃', danger: true });
      if (!ok) return;
      for (const it of list) await db.del('pending', it.id);
      rerender();
    });
  }

  for (const btn of container.querySelectorAll('[data-drop]')) {
    btn.addEventListener('click', async () => {
      const bid = btn.dataset.drop;
      const list = batches.get(bid).filter((it) => checked(it));
      if (!list.length) { toast('先勾选要丢弃的条目', true); return; }
      for (const it of list) await db.del('pending', it.id);
      toast(`已丢弃 ${list.length} 条`);
      rerender();
    });
  }

  for (const btn of container.querySelectorAll('[data-ok]')) {
    btn.addEventListener('click', async () => {
      const bid = btn.dataset.ok;
      await approveBatch(bid);
    });
  }

  const checked = (it) => {
    const row = container.querySelector(`[data-item="${it.id}"]`);
    return row?.querySelector('[data-ck]')?.checked ?? true;
  };
  const fieldOf = (it, name) => container.querySelector(`[data-item="${it.id}"] [data-f="${name}"]`)?.value ?? null;

  async function approveBatch(bid) {
    const list = batches.get(bid);
    const picked = list.filter((it) => checked(it));
    if (!picked.length) { toast('先勾选要通过的条目', true); return; }

    // 1) 节点：分配真实 id（保持勾选顺序，父先于子尽力而为）
    const idMap = new Map();
    const nodeItems = picked.filter((it) => it.kind === 'node');
    for (const it of nodeItems) idMap.set(it.data.tempId, uid());

    let nNode = 0, nLink = 0, nCard = 0, nQuiz = 0, skipped = 0;
    for (const it of nodeItems) {
      const title = (fieldOf(it, 'title') || it.data.title).trim() || '未命名知识点';
      const n = newNode(subject.id, idMap.get(it.data.pidTemp) || null, title,
        fieldOf(it, 'detail') ?? it.data.detail,
        fieldOf(it, 'formula') ?? it.data.formula,
        it.data.sourceRef);
      await db.put('nodes', n);
      nNode++;
    }
    // 2) 关系：两端都被通过才入
    for (const it of picked.filter((x) => x.kind === 'link')) {
      const from = idMap.get(it.data.fromTemp);
      const to = idMap.get(it.data.toTemp);
      if (!from || !to) { skipped++; continue; }
      await db.put('links', newLink(subject.id, from, to, fieldOf(it, 'label') || it.data.label));
      nLink++;
    }
    // 3) 卡片：挂真实节点；节点未通过则跳过
    for (const it of picked.filter((x) => x.kind === 'card')) {
      if (it.data.nid && !nodeExists(it.data.nid)) { skipped++; continue; }
      const kind = it.data.kind;
      const front = kind === 'qa' ? (fieldOf(it, 'front') ?? it.data.front) : '';
      const back = kind === 'qa' ? (fieldOf(it, 'back') ?? it.data.back) : '';
      const clozeText = kind === 'cloze' ? (fieldOf(it, 'clozeText') ?? it.data.clozeText) : '';
      const c = newCard(subject.id, {
        kind, front: String(front).trim(), back: String(back).trim(), clozeText: String(clozeText).trim(),
        nid: it.data.nid || null,
        noteId: kind === 'cloze' ? uid() : null,
        ord: kind === 'cloze' ? (clozeOrds(clozeText)[0] || 1) : 0,
      });
      c.fsrs = await S.initSnapshot(subject.settings);
      await db.put('cards', c);
      nCard++;
    }
    // 4) 测验题入库
    for (const it of picked.filter((x) => x.kind === 'quiz')) {
      if (it.data.nid && !(await nodeExists(it.data.nid))) { skipped++; continue; }
      const type = it.data.type;
      let answer = it.data.answer;
      if (type === 'choice') {
        const sel = container.querySelector(`[data-item="${it.id}"] [data-f="answer"]:checked`);
        answer = sel ? Number(sel.value) : (Number(it.data.answer) || 0);
      } else {
        answer = (fieldOf(it, 'answer') ?? it.data.answer) || '';
      }
      const z = newQuiz(subject.id, {
        nid: it.data.nid || null,
        type,
        q: (fieldOf(it, 'q') ?? it.data.q) || '',
        opts: it.data.opts || [],
        answer,
        explain: (fieldOf(it, 'explain') ?? it.data.explain) || '',
        sourceRef: it.data.sourceRef,
      });
      await db.put('quiz', z);
      nQuiz++;
    }
    // 清掉整批已处理的条目（未勾选的也一并清掉——同批一次审完）
    for (const it of list) await db.del('pending', it.id);
    subject.updatedAt = Date.now();
    await db.put('subjects', subject);
    toast(`入库：${nNode} 节点 / ${nLink} 关系 / ${nCard} 卡片 / ${nQuiz} 题目${skipped ? `；跳过 ${skipped} 条（引用了未通过的节点）` : ''}`);
    rerender();
    if (onDone) onDone('refresh');
  }

  async function nodeExists(nid) {
    return !!(await db.get('nodes', nid));
  }
}
