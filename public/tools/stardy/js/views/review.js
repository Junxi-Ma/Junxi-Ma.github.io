/**
 * Stardy — 全屏复习层
 *
 * 队列来自 scheduler.buildQueue（学习到期优先，新卡/复习按比例穿插，同笔记埋没）。
 * 键盘：Space/Enter 翻面，1-4 打分，Esc 退出。
 * 路由：#/review/<subjectId>；hash 变走（含浏览器后退）自动关闭。
 */

import db from '../db.js?v=1';
import * as S from '../scheduler.js?v=1';
import { renderMarkdown, renderCloze, escapeHtml, fmtInterval, STATE_INFO, GRADES, uid } from '../models.js?v=1';
import { toast } from '../ui.js?v=1';

const overlay = () => document.getElementById('sdy-review');

let session = null; // 当前会话状态

export function isOpen() {
  return !!session && !overlay().hidden;
}

/** 供按钮调用：切到复习路由，由 app.js 触发 open */
export function startReview(subjectId) {
  if (!subjectId) return;
  location.hash = `#/review/${subjectId}`;
}

export async function open(subjectId) {
  if (isOpen() && session.subjectId === subjectId) return;

  const subject = await db.get('subjects', subjectId);
  if (!subject) { toast('科目不存在', true); history.back(); return; }

  const cards = await db.byIndex('cards', 'subjectId', subjectId);
  const revlogToday = todayOnly(await db.byIndex('revlog', 'subjectId', subjectId));
  const queue = S.buildQueue(subject, cards, revlogToday);
  if (!queue.length) {
    toast('今天没有到期卡片，休息一下 ☕');
    history.back();
    return;
  }

  const nodes = await db.byIndex('nodes', 'subjectId', subjectId);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pathOf = (nid) => {
    if (!nid) return '';
    const parts = [];
    let cur = byId.get(nid);
    while (cur) { parts.unshift(cur.title); cur = cur.pid ? byId.get(cur.pid) : null; }
    return parts.join(' › ');
  };

  session = {
    subjectId,
    subject,
    cards,
    queue,
    idx: 0,
    answered: 0,
    againCount: 0,
    startedAt: Date.now(),
    shownAt: 0,
    flipped: false,
    pathOf,
  };

  const el = overlay();
  el.hidden = false;
  document.body.style.overflow = 'hidden';
  renderChrome(el);
  await showCurrent();
  document.addEventListener('keydown', onKey);
}

export function close(navigateBack = true) {
  if (!session) return;
  session = null;
  const el = overlay();
  el.hidden = true;
  el.innerHTML = '';
  document.body.style.overflow = '';
  document.removeEventListener('keydown', onKey);
}

function todayOnly(rows) {
  const t = localDay(new Date());
  return rows.filter((r) => r.day === t);
}
function localDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---------- UI ---------- */

function renderChrome(el) {
  el.innerHTML = `
    <div class="sdy-review__top">
      <button class="btn btn--sm btn--ghost" id="rv-exit">← 退出</button>
      <div class="sdy-review__prog"><i id="rv-prog" style="width:0%"></i></div>
      <span class="sdy-review__count" id="rv-count"></span>
      <span class="sdy-grow"></span>
      <span class="sdy-chip sdy-chip--muted">${escapeHtml(session.subject.name)}</span>
    </div>
    <div class="sdy-review__body" id="rv-body"></div>
    <div class="sdy-review__flipzone" id="rv-flipwrap">
      <button class="btn btn--primary" id="rv-flip">显示答案（Space）</button>
    </div>
    <div class="sdy-review__grades" id="rv-grades" hidden></div>`;
  el.querySelector('#rv-exit').addEventListener('click', exit);
}

async function showCurrent() {
  const el = overlay();
  const body = el.querySelector('#rv-body');
  const grades = el.querySelector('#rv-grades');
  const flipwrap = el.querySelector('#rv-flipwrap');
  const card = session.queue[session.idx];

  // 全部答完
  if (!card) { renderDone(body); return; }

  session.flipped = false;
  session.shownAt = Date.now();

  el.querySelector('#rv-count').textContent = `${session.idx + 1} / ${session.queue.length}`;
  el.querySelector('#rv-prog').style.width = `${(session.idx / session.queue.length) * 100}%`;

  const crumb = card.nid ? session.pathOf(card.nid) : (card.kind === 'cloze' ? `挖空卡 c${card.ord}` : '问答卡');
  const r = await S.retrievability(session.subject.settings, card.fsrs);
  const st = STATE_INFO[card.fsrs?.state ?? 0];

  body.innerHTML = `
    <div class="sdy-review__crumb">${escapeHtml(crumb)}</div>
    <div class="sdy-review__card" id="rv-card">
      <div class="sdy-review__q sdy-md">${
        card.kind === 'cloze' ? renderCloze(card.clozeText, card.ord) : renderMarkdown(card.front)
      }</div>
      <div class="sdy-review__divider"></div>
      <div class="sdy-review__a sdy-md">${
        card.kind === 'cloze' ? renderCloze(card.clozeText, card.ord, ' revealed') : renderMarkdown(card.back)
      }</div>
    </div>
    <div class="sdy-review__meta">
      <span class="sdy-chip sdy-chip--${st.cls}">${st.name}${card.kind === 'cloze' ? ` · c${card.ord}` : ''}</span>
      ${r != null ? `<span class="sdy-chip sdy-chip--muted">当前可提取性 ${(r * 100).toFixed(0)}%</span>` : ''}
      ${card.fsrs?.lapses ? `<span class="sdy-chip sdy-chip--muted">已遗忘 ${card.fsrs.lapses} 次</span>` : ''}
      ${card.flags & 1 ? '<span class="sdy-chip sdy-chip--leech">陷阱卡</span>' : ''}
    </div>
    <div class="sdy-review__hint">空格 / 点击卡片 显示答案 · 1-4 打分 · Esc 退出</div>`;

  // 挖空卡：正面隐藏 active 空格可点击揭示提示；答案面已带 revealed 直接展示
  bindClozeReveal(body.querySelector('.sdy-review__q'));

  const cardEl = body.querySelector('#rv-card');
  cardEl.addEventListener('click', (e) => {
    if (e.target.closest('.sdy-cz__blank')) return;
    if (!session.flipped) flip();
  });
  flipwrap.hidden = false;
  flipwrap.querySelector('#rv-flip').onclick = flip;
  grades.hidden = true;
}

function bindClozeReveal(qEl) {
  if (!qEl) return;
  for (const blank of qEl.querySelectorAll('.sdy-cz__blank')) {
    blank.addEventListener('click', (e) => {
      e.stopPropagation();
      const holder = blank.closest('.sdy-cz--active');
      holder.classList.add('revealed');
      const ans = holder.querySelector('.sdy-cz__ans');
      if (ans) ans.hidden = false;
    });
  }
}

async function flip() {
  if (session.flipped) return;
  session.flipped = true;
  const el = overlay();
  el.querySelector('#rv-card').classList.add('flipped');
  el.querySelector('#rv-flipwrap').hidden = true;

  // 答案面挖空卡：把 active 空格直接揭示并高亮
  const aEl = el.querySelector('.sdy-review__a');
  if (session.queue[session.idx].kind === 'cloze') {
    aEl.querySelectorAll('.sdy-cz--active').forEach((h) => {
      h.classList.add('revealed');
      const ans = h.querySelector('.sdy-cz__ans');
      if (ans) ans.hidden = false;
    });
  }

  // 四键预览间隔
  const card = session.queue[session.idx];
  const previews = await S.preview(session.subject.settings, card.fsrs);
  const grades = el.querySelector('#rv-grades');
  grades.hidden = false;
  grades.innerHTML = GRADES.map((g) => {
    const p = previews.find((x) => x.grade === g.v);
    const label = p ? fmtInterval(p.minutes) : '—';
    return `<button class="sdy-grade sdy-grade--${g.cls}" data-g="${g.v}" title="快捷键 ${g.key}">
      <span>${g.label}</span><small>${label}</small>
    </button>`;
  }).join('');
  for (const b of grades.querySelectorAll('[data-g]')) {
    b.addEventListener('click', () => answerCard(Number(b.dataset.g)));
  }
}

async function answerCard(grade) {
  if (!session || !session.flipped) return;
  const card = session.queue[session.idx];
  const takenMs = Date.now() - session.shownAt;
  const preState = card.fsrs?.state ?? 0;

  const { snapshot, leech } = await S.answer(session.subject.settings, card.fsrs, grade, new Date());
  card.fsrs = snapshot;
  card.updatedAt = Date.now();
  if (leech) card.flags |= 1;
  await db.put('cards', card);

  const revlogEntry = {
    id: Date.now() + '-' + uid().slice(0, 8),
    cardId: card.id,
    subjectId: card.subjectId,
    ts: Date.now(),
    day: localDay(new Date()),
    rating: grade,
    preState,
    scheduledDays: snapshot.scheduledDays ?? 0,
    stability: snapshot.stability ?? null,
    difficulty: snapshot.difficulty ?? null,
    takenMs,
  };
  await db.put('revlog', revlogEntry);

  if (leech) toast('⚠ 这张卡已多次遗忘，已标记为「陷阱卡」——建议重写或拆分它', true, 4200);

  session.answered++;
  if (grade === 1) session.againCount++;
  session.idx++;
  await showCurrent();
}

function renderDone(body) {
  const el = overlay();
  el.querySelector('#rv-count').textContent = '完成';
  el.querySelector('#rv-prog').style.width = '100%';
  el.querySelector('#rv-flipwrap').hidden = true;
  el.querySelector('#rv-grades').hidden = true;
  const mins = Math.max(1, Math.round((Date.now() - session.startedAt) / 60000));
  const good = session.answered - session.againCount;
  body.innerHTML = `
    <div class="sdy-review__done">
      <div class="big">${session.againCount === 0 ? '🎉' : session.againCount <= session.answered / 3 ? '👍' : '💪'}</div>
      <h2>本轮完成</h2>
      <p>${session.answered} 张 · 记住 ${good} · 需重练 ${session.againCount} · 用时 ${mins} 分钟</p>
      <div class="sdy-row" style="justify-content:center;margin-top:18px">
        <button class="btn" id="rv-done-back">返回</button>
        <button class="btn btn--primary" id="rv-done-more">还有到期的？再来一轮</button>
      </div>
    </div>`;
  el.querySelector('#rv-done-back').onclick = exit;
  el.querySelector('#rv-done-more').onclick = async () => {
    const [cards, revlog] = await Promise.all([
      db.byIndex('cards', 'subjectId', session.subjectId),
      db.byIndex('revlog', 'subjectId', session.subjectId),
    ]);
    const queue = S.buildQueue(session.subject, cards, todayOnly(revlog));
    if (!queue.length) { toast('已经全部完成了！'); exit(); return; }
    session.queue = queue;
    session.idx = 0;
    session.answered = 0;
    session.againCount = 0;
    await showCurrent();
  };
}

function exit() {
  // 退出即回原页面（hash 已是 #/review/...，改回科目页）
  location.hash = `#/s/${session.subjectId}/overview`;
}

/* ---------- 键盘 ---------- */

function onKey(e) {
  if (!session) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'Escape') { exit(); return; }
  if (!session.flipped && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault();
    flip();
    return;
  }
  if (session.flipped && ['1', '2', '3', '4'].includes(e.key)) {
    e.preventDefault();
    answerCard(Number(e.key));
  }
}
