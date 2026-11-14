/**
 * Stardy — 首页：科目列表 + 全局统计
 */

import db from '../db.js?v=3';
import { dueCounts, streak } from '../scheduler.js?v=3';
import { escapeHtml as _e, dayStr, newSubject } from '../models.js?v=3';
import { toast, confirmBox, openModal } from '../ui.js?v=3';
import { exportSubjectFile } from '../backup.js?v=3';
import { startReview } from './review.js?v=3';

export async function renderHome(root) {
  document.title = 'Stardy · 学习系统 — Michael';
  const [subjects, allCards, revlog] = await Promise.all([
    db.all('subjects'),
    db.all('cards'),
    db.all('revlog'),
  ]);

  // 全局统计
  let totalDue = 0, totalCards = 0;
  const dueBySubject = new Map();
  for (const s of subjects) {
    const cards = allCards.filter((c) => c.subjectId === s.id);
    const due = dueCounts(cards);
    dueBySubject.set(s.id, { due, n: cards.length });
    totalDue += due.total;
    totalCards += cards.length;
  }
  const todayN = revlog.filter((r) => r.day === dayStr()).length;

  root.innerHTML = `
    <div class="container tool sdy-view">
      <div class="tool__head">
        <p class="mono-label">Tool <span>/</span> 11</p>
        <h1>Stardy · 学习系统</h1>
        <p>资料 → 知识树 → 卡片 → 复习 → 测验的学习闭环。间隔重复由 FSRS-6 调度（Anki 同款算法），数据存本机，可一键云备份。</p>
      </div>

      <div class="sdy-stats-strip">
        <div class="sdy-stat"><span class="sdy-stat__n">${totalDue}</span><span class="sdy-stat__label">今日待复习</span></div>
        <div class="sdy-stat"><span class="sdy-stat__n">${todayN}</span><span class="sdy-stat__label">今日已答</span></div>
        <div class="sdy-stat"><span class="sdy-stat__n">${streak(revlog)}</span><span class="sdy-stat__label">连续天数</span></div>
        <div class="sdy-stat"><span class="sdy-stat__n">${totalCards}</span><span class="sdy-stat__label">卡片总数</span></div>
        <div class="sdy-stat"><span class="sdy-stat__n">${subjects.length}</span><span class="sdy-stat__label">科目</span></div>
        <div class="sdy-stat sdy-grow" style="justify-content:flex-end">
          <button class="btn btn--primary" id="sdy-new-subject">✚ 新建科目</button>
        </div>
      </div>

      <div id="sdy-subject-area"></div>
    </div>`;

  const area = root.querySelector('#sdy-subject-area');
  renderSubjectGrid(area, subjects, dueBySubject);

  root.querySelector('#sdy-new-subject').addEventListener('click', () => showNewSubjectModal(area, subjects, dueBySubject));
}

function renderSubjectGrid(area, subjects, dueBySubject) {
  if (!subjects.length) {
    area.innerHTML = `
      <div class="sdy-empty">
        还没有科目。<br>
        点右上角「✚ 新建科目」开始；建好后可以在「卡片」页手动建卡，<br>
        也可以把课件 PDF / PPT / Word 上传进来，让 AI 帮你整理（阶段二开放）。
      </div>`;
    return;
  }
  // 最近更新在前
  const sorted = [...subjects].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  area.innerHTML = `<div class="sdy-subjects">${
    sorted.map((s) => {
      const { due, n } = dueBySubject.get(s.id) || { due: { total: 0 }, n: 0 };
      return `
      <div class="sdy-subject" data-id="${s.id}" role="button" tabindex="0" aria-label="进入科目 ${_e(s.name)}">
        <div class="sdy-subject__top">
          <div class="sdy-subject__icon">🎓</div>
          <h3 class="sdy-subject__name">${_e(s.name)}</h3>
        </div>
        <p class="sdy-subject__intro">${_e(s.intro || '暂无简介')}</p>
        <div class="sdy-subject__nums">
          <span>卡片 <b>${n}</b></span>
          <span>新卡 <b>${due.new}</b></span>
          <span>复习 <b>${due.review + due.learn}</b></span>
        </div>
        <span class="sdy-subject__due">${due.total > 0 ? `今日待学 ${due.total}` : '今日已清'}</span>
        <div class="sdy-subject__menu">
          <button class="btn btn--sm" data-act="review" data-id="${s.id}" title="开始复习">▶ 复习</button>
          <button class="btn btn--sm" data-act="export" data-id="${s.id}" title="导出本科目 JSON">导出</button>
          <button class="btn btn--sm" data-act="delete" data-id="${s.id}" title="删除科目">删除</button>
        </div>
      </div>`;
    }).join('')
  }</div>`;

  for (const el of area.querySelectorAll('.sdy-subject')) {
    const id = el.dataset.id;
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-act]')) return;
      location.hash = `#/s/${id}/overview`;
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.target.closest('[data-act]')) location.hash = `#/s/${id}/overview`;
    });
  }
  for (const btn of area.querySelectorAll('[data-act="review"]')) {
    btn.addEventListener('click', () => startReview(btn.dataset.id));
  }
  for (const btn of area.querySelectorAll('[data-act="export"]')) {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const data = await exportSubjectFile(btn.dataset.id);
        toast(`已导出「${data.subjects[0].name}」（${data.cards.length} 张卡）`);
      } catch (err) { toast(err.message, true); }
    });
  }
  for (const btn of area.querySelectorAll('[data-act="delete"]')) {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const s = subjects.find((x) => x.id === btn.dataset.id);
      const ok = await confirmBox({
        title: `删除科目「${s.name}」？`,
        body: `将删除该科目的全部卡片、知识树、资料与复习记录，且不可撤销。建议先在设置页导出备份。`,
        confirmText: '删除', danger: true,
      });
      if (!ok) return;
      await cascadeDeleteSubject(s.id);
      toast('已删除');
      renderHome(area.closest('#main'));
    });
  }
}

/** 级联删除一个科目的全部数据 */
export async function cascadeDeleteSubject(subjectId) {
  for (const store of ['docs', 'nodes', 'links', 'cards', 'quiz']) {
    await db.delByIndex(store, 'subjectId', subjectId);
  }
  await db.delByIndex('revlog', 'subjectId', subjectId);
  await db.del('subjects', subjectId);
}

function showNewSubjectModal(area, subjects, dueBySubject) {
  const { box, close } = openModal({
      title: '新建科目',
      bodyHtml: `
        <div class="sdy-field">
          <label class="sdy-field__label">科目名称 *</label>
          <input class="sdy-input" id="ns-name" placeholder="例如：大气探测学" maxlength="40">
        </div>
        <div class="sdy-field">
          <label class="sdy-field__label">简介（可选）</label>
          <textarea class="sdy-textarea" id="ns-intro" style="min-height:64px" placeholder="这门课是什么、打算怎么复习"></textarea>
        </div>
        <div class="sdy-modal__acts">
          <button class="btn" data-a="cancel">取消</button>
          <button class="btn btn--primary" data-a="ok">创建</button>
        </div>`,
    });
    const nameEl = box.querySelector('#ns-name');
    nameEl.focus();
    const submit = async () => {
      const name = nameEl.value.trim();
      if (!name) { toast('请填写科目名称', true); return; }
      const s = newSubject(name, box.querySelector('#ns-intro').value);
      await db.put('subjects', s);
      close();
      toast('已创建，进入科目页面');
      location.hash = `#/s/${s.id}/overview`;
    };
    box.querySelector('[data-a="cancel"]').onclick = close;
    box.querySelector('[data-a="ok"]').onclick = submit;
    nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}
