/**
 * Stardy — 全屏复习层
 *
 * 布局：桌面三栏（左·本次学习数据 / 中·3D 拟真卡 / 右·卡片信息），
 * 窄屏自动收拢。卡身宋体系字体，字号按内容自适应占满卡片。
 * 队列来自 scheduler.buildQueue（学习到期优先，新卡/复习按比例穿插，
 * 同笔记 sibling 埋没）。键盘：Space 翻面，1-4 打分，Esc 退出。
 */

import db from '../db.js?v=5';
import * as S from '../scheduler.js?v=5';
import { renderMarkdown, renderCloze, escapeHtml, fmtInterval, STATE_INFO, GRADES, uid } from '../models.js?v=5';
import { toast } from '../ui.js?v=5';

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
    todayLog: [...revlogToday],
    idx: 0,
    answered: 0,
    againCount: 0,
    startedAt: Date.now(),
    shownAt: 0,
    flipped: false,
    pathOf,
    timer: null,
  };

  const el = overlay();
  el.hidden = false;
  document.body.style.overflow = 'hidden';
  renderChrome(el);
  renderLeftStats();
  await showCurrent();
  session.timer = setInterval(() => {
    const t = document.getElementById('rv-n-time');
    if (t) t.textContent = elapsedMin() + ' 分';
  }, 20000);
  document.addEventListener('keydown', onKey);
}

export function close() {
  if (!session) return;
  clearInterval(session.timer);
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
function elapsedMin() {
  return Math.max(1, Math.round((Date.now() - session.startedAt) / 60000));
}
function relTime(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 3600e3) return Math.max(1, Math.round(diff / 60e3)) + ' 分钟前';
  if (diff < 86400e3) return Math.round(diff / 3600e3) + ' 小时前';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
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
    <div class="sdy-review__main">
      <aside class="sdy-side" id="rv-left"></aside>
      <div class="sdy-center" id="rv-body"></div>
      <aside class="sdy-side" id="rv-right"></aside>
    </div>
    <div class="sdy-review__flipzone" id="rv-flipwrap">
      <button class="btn btn--primary" id="rv-flip">显示答案（Space）</button>
    </div>
    <div class="sdy-review__grades" id="rv-grades" hidden></div>`;
  el.querySelector('#rv-exit').addEventListener('click', exit);
}

/** 左栏：本次学习 + 今日配额（每答一题刷新） */
function renderLeftStats() {
  const el = overlay();
  const left = el.querySelector('#rv-left');
  if (!left) return;
  const s = session;
  const cap = s.subject.settings;
  const newUsed = s.todayLog.filter((r) => r.preState === 0).length;
  const revUsed = s.todayLog.filter((r) => r.preState === 2).length;
  left.innerHTML = `
    <p class="sdy-side__title">本次学习</p>
    <div class="sdy-side__big"><b>${s.answered}</b><span>已答</span></div>
    <div class="sdy-side__row"><span>剩余</span><b>${Math.max(0, s.queue.length - s.idx)}</b></div>
    <div class="sdy-side__row"><span>记住</span><b>${s.answered - s.againCount}</b></div>
    <div class="sdy-side__row"><span>需重练</span><b>${s.againCount}</b></div>
    <div class="sdy-side__row"><span>用时</span><b id="rv-n-time">${elapsedMin()} 分</b></div>
    <div class="sdy-side__divider"></div>
    <p class="sdy-side__title">今日配额</p>
    <div class="sdy-side__row"><span>新卡</span><b>${newUsed} / ${cap.newPerDay}</b></div>
    <div class="sdy-side__bar"><i style="width:${Math.min(100, (newUsed / Math.max(1, cap.newPerDay)) * 100)}%"></i></div>
    <div class="sdy-side__row" style="margin-top:8px"><span>复习</span><b>${revUsed} / ${cap.revPerDay}</b></div>
    <div class="sdy-side__bar"><i style="width:${Math.min(100, (revUsed / Math.max(1, cap.revPerDay)) * 100)}%"></i></div>`;
}

/** 右栏：当前卡片的信息 */
function renderCardInfo(card, r, flipped) {
  const right = overlay().querySelector('#rv-right');
  if (!right) return;
  const st = STATE_INFO[card.fsrs?.state ?? 0];
  const rows = [
    ['类型', card.kind === 'cloze' ? `挖空 c${card.ord}` : '问答'],
    ['状态', st.name],
    ['上次复习', card.fsrs?.lastReviewAt ? relTime(new Date(card.fsrs.lastReviewAt).getTime()) : '首次学习'],
    ['当前间隔', card.fsrs?.scheduledDays ? card.fsrs.scheduledDays + ' 天' : '—'],
    ['已遗忘', (card.fsrs?.lapses || 0) + ' 次'],
  ];
  if (flipped && card.fsrs && card.fsrs.state !== 0) {
    rows.push(['稳定性 S', Number(card.fsrs.stability || 0).toFixed(1) + ' 天']);
    rows.push(['难度 D', Number(card.fsrs.difficulty || 0).toFixed(1)]);
  }
  if (r != null && !flipped) rows.push(['当前保持率', (r * 100).toFixed(0) + '%']);
  right.innerHTML = `
    <p class="sdy-side__title">卡片信息</p>
    ${rows.map(([k, v]) => `<div class="sdy-side__row"><span>${k}</span><b>${v}</b></div>`).join('')}
    ${card.flags & 1 ? '<div style="margin-top:6px"><span class="sdy-chip sdy-chip--leech">陷阱卡 · 建议重写</span></div>' : ''}`;
}

/**
 * 字号自适应：二分找到能占满卡片又不溢出的最大字号（14-34px）。
 * 短文本自动放大，长文本自动缩小，放不下时兜底滚动。
 */
function fitText(el, max = 34, min = 14) {
  const probe = el.querySelector('.sdy-md') || el;
  probe.style.fontSize = '';
  let lo = min, hi = max, best = min;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    probe.style.fontSize = mid + 'px';
    if (el.scrollHeight <= el.clientHeight + 1) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  probe.style.fontSize = best + 'px';
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
  const isCloze = card.kind === 'cloze';

  body.innerHTML = `
    <div class="sdy-stage">
      <div class="sdy-flip" id="rv-flip">
        <div class="sdy-face sdy-face--front">
          <div class="sdy-face__head">
            <span class="sdy-face__crumb">${escapeHtml(crumb)}</span>
            <span class="sdy-face__grow"></span>
            <span class="sdy-chip sdy-chip--${st.cls}">${st.name}${isCloze ? ` · c${card.ord}` : ''}</span>
          </div>
          <div class="sdy-face__body"><div class="sdy-md">${isCloze ? renderCloze(card.clozeText, card.ord) : renderMarkdown(card.front)}</div></div>
        </div>
        <div class="sdy-face sdy-face--back">
          <div class="sdy-face__head">
            <span class="sdy-face__crumb">${escapeHtml(crumb)}</span>
            <span class="sdy-face__grow"></span>
            <span class="sdy-chip sdy-chip--muted">答案</span>
          </div>
          <div class="sdy-face__body"><div class="sdy-md">${isCloze ? renderCloze(card.clozeText, card.ord, ' revealed') : renderMarkdown(card.back)}</div></div>
        </div>
      </div>
    </div>
    <div class="sdy-review__meta" id="rv-meta">
      ${r != null ? `<span class="sdy-chip sdy-chip--muted">当前保持率 ${(r * 100).toFixed(0)}%</span>` : ''}
      ${card.fsrs?.lapses ? `<span class="sdy-chip sdy-chip--muted">已遗忘 ${card.fsrs.lapses} 次</span>` : ''}
    </div>
    <div class="sdy-review__hint">空格 / 点击卡片 显示答案 · 1-4 打分 · Esc 退出</div>`;

  // 挖空正面：空格可点击提示式揭示；点卡身任意处翻面
  const frontBody = body.querySelector('.sdy-face--front .sdy-face__body');
  bindClozeReveal(frontBody);
  frontBody.addEventListener('click', (e) => {
    if (e.target.closest('.sdy-cz__blank')) return;
    if (!session.flipped) flip();
  });
  fitText(frontBody);
  fitText(body.querySelector('.sdy-face--back .sdy-face__body'));
  renderCardInfo(card, r, false);
  flipwrap.hidden = false;
  flipwrap.querySelector('#rv-flip').onclick = flip;
  grades.hidden = true;
  grades.innerHTML = '';
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
  el.querySelector('#rv-flip').classList.add('flipped');
  el.querySelector('#rv-flipwrap').hidden = true;

  // 答案面挖空卡：直接揭示并高亮，再重新自适应字号
  const backBody = el.querySelector('.sdy-face--back .sdy-face__body');
  if (backBody) {
    backBody.querySelectorAll('.sdy-cz--active').forEach((h) => {
      h.classList.add('revealed');
      const ans = h.querySelector('.sdy-cz__ans');
      if (ans) ans.hidden = false;
    });
    fitText(backBody);
  }

  // 记忆状态补充进 meta 行
  const card = session.queue[session.idx];
  const meta = el.querySelector('#rv-meta');
  if (meta && card.fsrs) {
    meta.insertAdjacentHTML('afterbegin',
      `<span class="sdy-chip sdy-chip--muted">S ${Number(card.fsrs.stability || 0).toFixed(1)} 天 · D ${Number(card.fsrs.difficulty || 0).toFixed(1)}</span>`);
  }
  renderCardInfo(card, null, true);

  // 四键预览间隔
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
  session.todayLog.push(revlogEntry);

  session.answered++;
  if (grade === 1) session.againCount++;
  if (leech) toast('⚠ 这张卡已多次遗忘，已标记为「陷阱卡」——建议重写或拆分它', true, 4200);

  session.idx++;
  renderLeftStats();
  await showCurrent();
}

function renderDone(body) {
  const el = overlay();
  el.querySelector('#rv-count').textContent = '完成';
  el.querySelector('#rv-prog').style.width = '100%';
  el.querySelector('#rv-flipwrap').hidden = true;
  el.querySelector('#rv-grades').hidden = true;
  const mins = elapsedMin();
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
    renderLeftStats();
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
