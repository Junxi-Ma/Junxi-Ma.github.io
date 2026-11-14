/**
 * Stardy — 测验与错题本
 *
 * 流程：配置（题型/数量/顺序）→ 逐题作答（选择即时判分、填空比对+自判、
 * 简答 AI 批改）→ 结果页。答错的题 wrongCount++ 并自动生成/更新一张
 * 「错题卡」进 FSRS 队列（按"重来"推进，当天到期重练）——错题回流闭环。
 */

import db from '../db.js?v=3';
import * as S from '../scheduler.js?v=3';
import { escapeHtml, renderMarkdown, newCard, newQuiz, normalizeAnswer, STATE_INFO } from '../models.js?v=3';
import { toast, openModal, confirmBox } from '../ui.js?v=3';
import { aiGradeEssay, aiQuizForNode, loadAiConfig } from '../ai.js?v=3';
import { openAiGenQuiz } from './ai.js?v=3';
import { gotoTab } from './workspace.js?v=3';

// 进行中的测验会话（跨 rerender 保留）
let quizSession = null;

const TYPE_NAME = { choice: '选择', fill: '填空', essay: '简答' };

export async function renderQuiz(panel, subject, root) {
  if (quizSession && quizSession.subjectId === subject.id) {
    renderRunning(panel, subject, root);
    return;
  }
  renderConfig(panel, subject, root);
}

/* ============================================================
   配置页
   ============================================================ */

async function renderConfig(panel, subject, root) {
  const [quizzes, nodes] = await Promise.all([
    db.byIndex('quiz', 'subjectId', subject.id),
    db.byIndex('nodes', 'subjectId', subject.id),
  ]);
  const wrong = quizzes.filter((q) => q.wrongCount > 0 && !q.resolved);
  const cfg = loadAiConfig();

  panel.innerHTML = `
    <div class="sdy-panel">
      <p class="sdy-panel__title">开始测验</p>
      <p class="sdy-field__hint" style="margin-bottom:12px">
        题库 ${quizzes.length} 道（选择 ${quizzes.filter((q) => q.type === 'choice').length} / 填空 ${quizzes.filter((q) => q.type === 'fill').length} / 简答 ${quizzes.filter((q) => q.type === 'essay').length}）。
        ${cfg.mock ? '⚠ 当前为 Mock 演示模式，AI 批改返回固定分数。' : ''}
      </p>
      <div class="sdy-field">
        <label class="sdy-field__label">题型</label>
        <div class="sdy-row">
          ${['choice', 'fill', 'essay'].map((t) => `
            <label class="sdy-checkrow"><input type="checkbox" value="${t}" checked> ${TYPE_NAME[t]}题</label>`).join('')}
        </div>
      </div>
      <div class="sdy-field">
        <label class="sdy-field__label">题量</label>
        <div class="sdy-row" id="qz-count">
          ${[10, 20, 30].map((n) => `<button class="btn btn--sm${n === 10 ? ' btn--primary' : ''}" data-n="${n}">${n} 题</button>`).join('')}
          <button class="btn btn--sm" data-n="9999">全部</button>
        </div>
      </div>
      <div class="sdy-row">
        <label class="sdy-checkrow"><input type="checkbox" id="qz-shuffle" checked> 随机顺序</label>
        <span class="sdy-grow"></span>
        <button class="btn btn--primary" id="qz-start">▶ 开始测验</button>
      </div>
      <p class="sdy-field__hint" id="qz-pool" style="margin-top:10px"></p>
    </div>

    <div class="sdy-panel">
      <p class="sdy-panel__title">
        <span>错题本（${wrong.length} 道未解决）</span>
        ${wrong.length ? '<button class="btn btn--sm btn--primary" id="qz-wrong-run">▶ 只练错题</button>' : ''}
      </p>
      ${wrong.length ? `
        <div class="sdy-cardlist">
          ${wrong.map((q) => wrongRow(q, subject)).join('')}
        </div>` : `
        <div class="sdy-soon" style="padding:26px">
          <div class="ic">✨</div>
          <p>没有待解决的错题。答错的题会出现在这里，并自动生成「错题卡」进入复习队列。</p>
        </div>`}
      ${quizzes.some((q) => q.wrongCount > 0) ? `<div class="sdy-row" style="margin-top:12px"><button class="btn btn--sm btn--ghost" id="qz-wrong-all" style="color:var(--danger-fg)">清空错题记录</button></div>` : ''}
    </div>

    <div class="sdy-panel">
      <p class="sdy-panel__title">
        <span>出题（知识点 ${nodes.length} 个）</span>
        <button class="btn btn--sm" id="qz-aigen" ${nodes.length ? '' : 'disabled'}>🤖 AI 出题</button>
      </p>
      <p class="sdy-field__hint">按知识点生成选择 / 填空 / 简答题，产出先进「审核」标签页，确认后才进题库。</p>
    </div>`;

  const counts = { choice: 0, fill: 0, essay: 0 };
  panel.querySelectorAll('.sdy-field .sdy-checkrow input').forEach((c) => {
    c.addEventListener('change', () => {
      for (const k of ['choice', 'fill', 'essay']) counts[k] = c.value === k && c.checked ? 1 : 0;
      updatePool();
    });
  });
  let qCount = 10;
  for (const b of panel.querySelectorAll('#qz-count [data-n]')) {
    b.addEventListener('click', () => {
      qCount = Number(b.dataset.n);
      panel.querySelectorAll('#qz-count [data-n]').forEach((x) => x.classList.toggle('btn--primary', x === b));
    });
  }
  const typesSel = () => [...panel.querySelectorAll('.sdy-field .sdy-checkrow input:checked')].map((c) => c.value);

  function updatePool() {
    const pool = quizzes.filter((q) => typesSel().includes(q.type));
    panel.querySelector('#qz-pool').textContent = pool.length
      ? `当前筛选下题库有 ${pool.length} 道题，本次将取 ${Math.min(qCount, pool.length)} 道。`
      : '题库中还没有符合题型的题目——先用 🤖 AI 出题，或检查题型筛选。';
  }
  updatePool();

  panel.querySelector('#qz-start').addEventListener('click', async () => {
    const types = typesSel();
    if (!types.length) { toast('至少选一种题型', true); return; }
    let list = quizzes.filter((q) => types.includes(q.type));
    if (!list.length) { toast('题库里还没有题，先点 🤖 AI 出题', true); return; }
    if (panel.querySelector('#qz-shuffle').checked) list = shuffle(list);
    list = list.slice(0, qCount);
    startSession(subject, root, list, false);
  });

  panel.querySelector('#qz-wrong-run')?.addEventListener('click', () => {
    const list = shuffle([...wrong]);
    startSession(subject, root, list, true);
  });

  panel.querySelector('#qz-aigen').addEventListener('click', () => {
    const nodesForAi = nodes.map((n) => ({ ...n, _hasQuiz: quizzes.some((q) => q.nid === n.id) }));
    openAiGenQuiz(subject, nodesForAi, () => gotoTab(root, subject.id, 'quiz'));
  });

  panel.querySelector('#qz-wrong-all')?.addEventListener('click', async () => {
    const all = quizzes.filter((q) => q.wrongCount > 0);
    const ok = await confirmBox({ title: '清空错题记录？', body: `${all.length} 道题的错题计数与状态将清零（题目保留）。`, confirmText: '清空', danger: true });
    if (!ok) return;
    for (const q of all) { q.wrongCount = 0; q.resolved = false; await db.put('quiz', q); }
    renderConfig(panel, subject, root);
  });

  for (const b of panel.querySelectorAll('[data-resolve]')) {
    b.addEventListener('click', async () => {
      const q = quizzes.find((x) => x.id === b.dataset.resolve);
      q.resolved = !q.resolved;
      await db.put('quiz', q);
      renderConfig(panel, subject, root);
    });
  }
  for (const b of panel.querySelectorAll('[data-delquiz]')) {
    b.addEventListener('click', async () => {
      if (!(await confirmBox({ title: '删除这道题？', body: '关联的错题卡不受影响。', confirmText: '删除', danger: true }))) return;
      await db.del('quiz', b.dataset.delquiz);
      renderConfig(panel, subject, root);
    });
  }
}

function wrongRow(q, subject) {
  return `
    <div class="sdy-cardrow">
      <div class="sdy-cardrow__main">
        <div class="sdy-cardrow__front">${escapeHtml(String(q.q).slice(0, 90))}</div>
        <div class="sdy-cardrow__meta">
          <span class="sdy-chip sdy-chip--learn">${TYPE_NAME[q.type]}</span>
          <span>错 ${q.wrongCount} 次</span>
          ${q.resolved ? '<span class="sdy-chip sdy-chip--review">已解决</span>' : '<span class="sdy-chip sdy-chip--leech">未解决</span>'}
        </div>
      </div>
      <div class="sdy-cardrow__acts">
        <button class="btn btn--sm" data-resolve="${q.id}">${q.resolved ? '重新标记' : '标记已解决'}</button>
        <button class="btn btn--sm btn--ghost" data-delquiz="${q.id}" style="color:var(--danger-fg)">删除</button>
      </div>
    </div>`;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startSession(subject, root, list, fromWrong) {
  quizSession = { subjectId: subject.id, list, idx: 0, results: [], fromWrong };
  renderRunning(root.querySelector('#ws-panel'), subject, root);
}

/* ============================================================
   答题
   ============================================================ */

function renderRunning(panel, subject, root) {
  const s = quizSession;
  const q = s.list[s.idx];

  // 完成
  if (!q) { renderResult(panel, subject, root); return; }

  panel.innerHTML = `
    <div class="sdy-panel">
      <p class="sdy-panel__title">
        <span>第 ${s.idx + 1} / ${s.list.length} 题 · ${TYPE_NAME[q.type]}题 ${s.fromWrong ? '（错题重练）' : ''}</span>
        <button class="btn btn--sm btn--ghost" id="qz-exit">退出测验</button>
      </p>
      <div class="sdy-review__prog" style="max-width:100%;margin-bottom:14px"><i style="width:${(s.idx / s.list.length) * 100}%"></i></div>
      <div class="sdy-md" style="font-size:17px;line-height:1.8;margin-bottom:14px">${renderMarkdown(q.q)}</div>
      <div id="qz-answer-area"></div>
      <div id="qz-feedback"></div>
      <div class="sdy-modal__acts" style="justify-content:flex-start" id="qz-acts"></div>
    </div>
    ${q.nid && q.sourceRef?.docName ? `<p class="sdy-field__hint">📎 ${escapeHtml(q.sourceRef.docName)}</p>` : ''}`;

  panel.querySelector('#qz-exit').addEventListener('click', () => {
    quizSession = null;
    renderConfig(panel, subject, root);
  });

  const area = panel.querySelector('#qz-answer-area');
  const acts = panel.querySelector('#qz-acts');

  if (q.type === 'choice') {
    area.innerHTML = `<div class="sdy-cardlist">${(q.opts || []).map((o, i) => `
      <button class="sdy-quiz-opt" data-i="${i}">
        <span class="sdy-quiz-opt__letter">${String.fromCharCode(65 + i)}</span>
        <span>${escapeHtml(o)}</span>
      </button>`).join('')}</div>`;
    for (const b of area.querySelectorAll('.sdy-quiz-opt')) {
      b.addEventListener('click', () => judgeChoice(b, q, subject, root));
    }
  } else if (q.type === 'fill') {
    area.innerHTML = `
      <input class="sdy-input" id="qz-fill" placeholder="输入答案" style="font-size:16px" autocomplete="off">
      <p class="sdy-field__hint" style="margin-top:6px">提交后自动比对；不一致时可自判（忽略大小写与全半角）。</p>`;
    const input = area.querySelector('#qz-fill');
    input.focus();
    const submit = () => judgeFill(input.value, q, subject, root);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    acts.innerHTML = '<button class="btn btn--primary" id="qz-submit">提交</button>';
    panel.querySelector('#qz-submit').onclick = submit;
  } else {
    area.innerHTML = `
      <textarea class="sdy-textarea" id="qz-essay" style="min-height:140px;font-size:15px" placeholder="写下你的答案要点（每点一行）…"></textarea>
      <p class="sdy-field__hint" style="margin-top:6px">提交后由 AI 按参考要点批改打分（满分 100，≥60 记为答对）。</p>`;
    acts.innerHTML = '<button class="btn btn--primary" id="qz-submit">提交批改</button>';
    panel.querySelector('#qz-submit').onclick = () => judgeEssay(area.querySelector('#qz-essay').value, q, subject, root);
  }
}

async function judgeChoice(btnEl, q, subject, root) {
  if (quizSession?.locked) return;
  quizSession.locked = true;
  const panel = root.querySelector('#ws-panel');
  const picked = Number(btnEl.dataset.i);
  const correct = picked === Number(q.answer);
  for (const b of panel.querySelectorAll('.sdy-quiz-opt')) {
    b.classList.add('locked');
    if (Number(b.dataset.i) === Number(q.answer)) b.classList.add('correct');
    else if (b === btnEl && !correct) b.classList.add('wrong');
  }
  await finishQuestion(correct, q, subject, root, correct ? null : `正确答案：${String.fromCharCode(Number(q.answer))}. ${q.opts[q.answer]}`);
}

function judgeFill(input, q, subject, root) {
  const ok = normalizeAnswer(input) === normalizeAnswer(q.answer) && normalizeAnswer(input) !== '';
  finishQuestion(ok, q, subject, root, ok ? null : `参考答案：${q.answer}`).then(() => {
    if (!ok) {
      // 填空错题给自判机会：确认「我答对了」则改判
      const acts = root.querySelector('#qz-acts');
      if (!acts || !quizSession) return;
      const last = quizSession.results[quizSession.results.length - 1];
      const btn = document.createElement('button');
      btn.className = 'btn btn--sm';
      btn.textContent = '其实我答对了（按显示的参考答案确认）';
      btn.onclick = async () => {
        last.correct = true;
        q.wrongCount = Math.max(0, q.wrongCount - 1);
        q.resolved = true;
        await db.put('quiz', q);
        btn.remove();
        toast('已改判为答对，并标记错题已解决');
      };
      acts.appendChild(btn);
    }
  });
}

async function judgeEssay(answerText, q, subject, root) {
  const panel = root.querySelector('#ws-panel');
  const acts = panel.querySelector('#qz-acts');
  acts.innerHTML = '<span class="sdy-field__hint">🤖 AI 批改中…</span>';
  let res;
  try {
    res = await aiGradeEssay(q.q, q.answer, answerText);
  } catch (e) {
    toast('AI 批改失败：' + e.message + '（按 0 分处理，可退出重试）', true, 5000);
    res = { score: 0, comment: e.message };
  }
  quizSession.essayScores = quizSession.essayScores || [];
  quizSession.essayScores.push(res.score);
  const ok = res.score >= 60;
  panel.querySelector('#qz-feedback').innerHTML = `
    <div class="sdy-panel" style="margin:0 0 12px">
      <p class="sdy-panel__title"><span>AI 批改结果</span><b style="font-family:var(--font-mono);font-size:22px;color:${ok ? 'var(--ok)' : 'var(--danger-fg)'}">${res.score} 分</b></p>
      <p class="sdy-field__hint" style="margin:0 0 8px">${escapeHtml(res.comment)}</p>
      <p class="sdy-field__label" style="margin:0 0 4px">参考要点</p>
      <div class="sdy-md" style="font-size:var(--fs-note)">${renderMarkdown(q.answer)}</div>
    </div>`;
  await finishQuestion(ok, q, subject, root, ok ? null : '按参考要点对照补漏');
}

/** 记录结果 + 错题回流（错题卡进 FSRS 队列） */
async function finishQuestion(correct, q, subject, root, failNote) {
  const panel = root.querySelector('#ws-panel');
  const fb = panel.querySelector('#qz-feedback');
  const acts = panel.querySelector('#qz-acts');
  quizSession.locked = false;
  quizSession.results.push({ quizId: q.id, correct, type: q.type });

  if (correct) {
    q.resolved = true;
    q.lastAt = Date.now();
    await db.put('quiz', q);
    if (fb) fb.innerHTML = `<div class="sdy-panel" style="margin:0 0 12px;border-color:color-mix(in oklch, var(--ok) 40%, transparent)"><p style="margin:0;color:var(--ok);font-weight:600">✓ 回答正确</p>${q.explain ? `<div class="sdy-md" style="margin-top:8px;font-size:var(--fs-note)">${renderMarkdown(q.explain)}</div>` : ''}</div>`;
  } else {
    q.wrongCount++;
    q.resolved = false;
    q.lastAt = Date.now();
    await db.put('quiz', q);
    if (fb) fb.innerHTML = `<div class="sdy-panel" style="margin:0 0 12px;border-color:var(--danger-border)"><p style="margin:0 0 6px;color:var(--danger-fg);font-weight:600">✗ 回答错误${failNote ? '' : ''}</p>${failNote ? `<p class="sdy-field__hint" style="margin:0 0 6px">${escapeHtml(failNote)}</p>` : ''}${q.explain ? `<div class="sdy-md" style="font-size:var(--fs-note)">${renderMarkdown(q.explain)}</div>` : ''}</div>`;
    await backflowQuizCard(subject, q);
  }

  acts.innerHTML = '';
  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn btn--primary';
  nextBtn.textContent = quizSession.idx + 1 >= quizSession.list.length ? '查看结果 →' : '下一题 →';
  nextBtn.onclick = () => {
    quizSession.idx++;
    quizSession.locked = false;
    renderRunning(panel, subject, root);
  };
  acts.appendChild(nextBtn);
}

/** 错题回流：生成/更新关联「错题卡」，按"重来"推进调度 → 今天到期重练 */
async function backflowQuizCard(subject, quiz) {
  try {
    const noteId = 'quiz-' + quiz.id;
    const existing = await db.byIndex('cards', 'noteId', noteId);
    const answerText = typeof quiz.answer === 'number' && quiz.opts?.length
      ? `${String.fromCharCode(quiz.answer)}. ${quiz.opts[quiz.answer]}`
      : String(quiz.answer);
    const back = `**${answerText}**${quiz.explain ? '\n\n' + quiz.explain : ''}`;
    let card;
    if (existing.length) {
      card = existing[0];
      card.front = '【错题】' + quiz.q;
      card.back = back;
      card.updatedAt = Date.now();
      await db.put('cards', card);
    } else {
      card = newCard(subject.id, { kind: 'qa', front: '【错题】' + quiz.q, back, nid: quiz.nid, noteId, ord: 0 });
      card.fsrs = await S.initSnapshot(subject.settings);
      await db.put('cards', card);
    }
    const { snapshot } = await S.answer(subject.settings, card.fsrs, 1, new Date());
    card.fsrs = snapshot;
    await db.put('cards', card);
  } catch (e) {
    console.warn('[stardy] 错题回流失败：', e);
  }
}

/* ============================================================
   结果页
   ============================================================ */

function renderResult(panel, subject, root) {
  const s = quizSession;
  const total = s.results.length;
  const good = s.results.filter((r) => r.correct).length;
  const pct = total ? Math.round((good / total) * 100) : 0;
  const wrongList = s.results.filter((r) => !r.correct);
  const essayAvg = s.essayScores?.length
    ? Math.round(s.essayScores.reduce((a, b) => a + b, 0) / s.essayScores.length)
    : null;

  panel.innerHTML = `
    <div class="sdy-panel" style="text-align:center;padding:36px 20px">
      <div style="font-size:46px">${pct >= 80 ? '🏆' : pct >= 60 ? '👍' : '💪'}</div>
      <h2 style="margin:10px 0 4px;font-family:var(--font-serif)">${good} / ${total} · ${pct}%</h2>
      ${essayAvg != null ? `<p class="sdy-field__hint">简答题平均分 ${essayAvg}</p>` : ''}
      <div class="sdy-row" style="justify-content:center;margin-top:14px">
        <button class="btn" id="qz-again">再来一次</button>
        <button class="btn btn--primary" id="qz-home">返回配置</button>
      </div>
    </div>
    ${wrongList.length ? `
      <div class="sdy-panel">
        <p class="sdy-panel__title">本次错题（已回流进复习队列）</p>
        <div class="sdy-cardlist">
          ${wrongList.map((r) => {
            const q = s.list.find((x) => x.id === r.quizId) || s.list[s.results.indexOf(r)];
            return `<div class="sdy-cardrow">
              <div class="sdy-cardrow__main">
                <div class="sdy-cardrow__front">${escapeHtml(String(q.q).slice(0, 90))}</div>
                <div class="sdy-cardrow__meta"><span class="sdy-chip sdy-chip--learn">${TYPE_NAME[q.type]}</span><span class="sdy-chip sdy-chip--muted">已生成错题卡</span></div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>` : '<div class="sdy-panel"><p class="sdy-field__hint" style="text-align:center;margin:0">本次全部答对 🎉</p></div>'}`;

  panel.querySelector('#qz-again').addEventListener('click', () => {
    const list = shuffle([...s.list]);
    startSession(subject, root, list, s.fromWrong);
  });
  panel.querySelector('#qz-home').addEventListener('click', () => {
    quizSession = null;
    renderConfig(panel, subject, root);
  });
}
