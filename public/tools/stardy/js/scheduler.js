/**
 * Stardy — 调度器：ts-fsrs v6 (FSRS-6) 的包装层
 *
 * 语义对照 Anki 26.11（rslib/src/scheduler/）：
 *   - 学习步骤 [1m, 10m] / 重学步骤 [10m]（rslib DeckConfig 默认）
 *   - 目标保持率 0.9、最大间隔 36500 天
 *   - 新卡/复习卡按比例穿插（queue/builder/intersperser.rs 的做法）
 *   - 同一笔记的多张挖空卡同日 sibling 埋没（burying.rs 的做法）
 *   - 遗忘次数 ≥ 阈值打"陷阱卡"标记（review.rs leech_threshold）
 */

import { DefaultScheduler, Rating } from '../libs/ts-fsrs/index.mjs?v=1';
import { parseSteps, startOfToday, endOfToday } from './models.js?v=1';

export const GRADE = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };
const RATING_BY_GRADE = { 1: Rating.Again, 2: Rating.Hard, 3: Rating.Good, 4: Rating.Easy };

// 相同配置复用同一个调度器实例（async 初始化有成本）
const _cache = new Map();

function stepsToConfig(minutes) {
  return minutes.map((m) => (m < 1 ? `${Math.max(1, Math.round(m * 60))}s` : `${m % 1 ? m.toFixed(1) : m}m`));
}

function settingsKey(st) {
  return JSON.stringify([
    st.desiredRetention, st.newPerDay, st.revPerDay,
    parseSteps(st.learnSteps), parseSteps(st.relearnSteps),
    st.maxInterval, st.enableFuzz,
  ]);
}

/** 按科目设置取得（或创建）调度器 */
export async function getScheduler(settings) {
  const key = settingsKey(settings);
  if (_cache.has(key)) return _cache.get(key);
  const learn = parseSteps(settings.learnSteps);
  const relearn = parseSteps(settings.relearnSteps);
  const p = DefaultScheduler({
    version: 'FSRS-6',
    desiredRetention: settings.desiredRetention,
    enableShortTerm: true,
    learningSteps: learn.length ? stepsToConfig(learn) : ['1m', '10m'],
    relearningSteps: relearn.length ? stepsToConfig(relearn) : ['10m'],
    enableFuzz: !!settings.enableFuzz,
    maximumInterval: settings.maxInterval || 36500,
  });
  _cache.set(key, p);
  return p;
}

/* ============ 快照序列化（IndexedDB 只存纯数据） ============ */

/** 新卡的 fsrs 快照 */
export async function initSnapshot(settings, now = new Date()) {
  const s = await getScheduler(settings);
  const c = s.newCard({ now });
  return snapshotOf(c);
}

function snapshotOf(c) {
  return {
    stability: c.stability,
    difficulty: c.difficulty,
    dueAt: c.dueAt instanceof Date ? c.dueAt.toISOString() : String(c.dueAt),
    lastReviewAt: c.lastReviewAt ? (c.lastReviewAt instanceof Date ? c.lastReviewAt.toISOString() : String(c.lastReviewAt)) : null,
    state: c.state,
    scheduleStatus: c.scheduleStatus,
    cardId: c.cardId,
    reps: c.reps,
    lapses: c.lapses,
    scheduledDays: c.scheduledDays,
    learningStep: c.learningStep,
  };
}

function toFsrsCard(snap) {
  return {
    stability: snap.stability ?? 0,
    difficulty: snap.difficulty ?? 0,
    dueAt: snap.dueAt ? new Date(snap.dueAt) : new Date(),
    lastReviewAt: snap.lastReviewAt ? new Date(snap.lastReviewAt) : null,
    state: snap.state ?? 0,
    scheduleStatus: snap.scheduleStatus ?? 'new',
    cardId: snap.cardId,
    reps: snap.reps ?? 0,
    lapses: snap.lapses ?? 0,
    scheduledDays: snap.scheduledDays ?? 0,
    learningStep: snap.learningStep ?? 0,
  };
}

/**
 * 答题：返回 { snapshot, leech }。调用方负责把 snapshot 写回 card.fsrs
 * 并追加一行 revlog（含 preState）。
 */
export async function answer(settings, snap, grade, now = new Date()) {
  const s = await getScheduler(settings);
  const before = toFsrsCard(snap);
  const result = s.review({ card: before, grade: RATING_BY_GRADE[grade], now });
  const next = snapshotOf(result.card);
  const leech = before.state === 2 && grade === GRADE.AGAIN && next.lapses >= (settings.leechThreshold || 8);
  return { snapshot: next, leech };
}

/** 四键预览：[{ grade, minutes, days }]；minutes 用于学习态按钮，days 用于复习态 */
export async function preview(settings, snap, now = new Date()) {
  const s = await getScheduler(settings);
  const card = toFsrsCard(snap);
  const out = [];
  for (const p of s.preview({ card, now })) {
    const due = p.card.dueAt ? new Date(p.card.dueAt).getTime() : now.getTime();
    const mins = Math.max(0, (due - now.getTime()) / 60000);
    out.push({
      grade: Number(p.grade),
      minutes: p.card.scheduledDays > 0 ? p.card.scheduledDays * 1440 : mins,
      days: p.card.scheduledDays,
      state: p.card.state,
    });
  }
  return out;
}

/** 当前可提取性（遗忘曲线）。新卡 / 无复习记录返回 null */
export async function retrievability(settings, snap, now = new Date()) {
  if (!snap || snap.state === 0 || !snap.lastReviewAt) return null;
  const s = await getScheduler(settings);
  const last = new Date(snap.lastReviewAt);
  const elapsed = s.chrono.difference(last, now);
  try {
    return s.model.forgettingCurve(toFsrsCard(snap), elapsed);
  } catch {
    return null;
  }
}

/* ============ 队列构建 ============ */

/**
 * 把两个列表按比例穿插（Anki Intersperser）：
 * ratio = (len1+1)/(len2+1)，只要 (j+1)*ratio < i+1 就持续取 list2。
 */
function intersperse(list1, list2) {
  const out = [];
  const len1 = list1.length, len2 = list2.length;
  if (!len1) return list2.slice();
  if (!len2) return list1.slice();
  const ratio = (len1 + 1) / (len2 + 1);
  let i = 0, j = 0;
  while (i < len1 || j < len2) {
    while (j < len2 && (i >= len1 || (j + 1) * ratio < i + 1)) out.push(list2[j++]);
    if (i < len1) out.push(list1[i++]);
  }
  return out;
}

/**
 * 构建今日复习队列。
 * @param subject 科目（读 settings 配额）
 * @param cards   本科目全部卡片
 * @param todayLog 今日已答 revlog 行（用于配额扣减）
 * @returns 排好队的卡片数组
 */
export function buildQueue(subject, cards, todayLog = [], now = new Date()) {
  const st = subject.settings;
  const end = endOfToday();

  const usable = cards.filter((c) => !c.suspended && c.fsrs);

  // 到点的学习/重学卡（分钟级）排最前
  const learn = usable
    .filter((c) => (c.fsrs.state === 1 || c.fsrs.state === 3) && new Date(c.fsrs.dueAt) <= now)
    .sort((a, b) => new Date(a.fsrs.dueAt) - new Date(b.fsrs.dueAt));

  // 今日到期的复习卡
  const revPool = usable
    .filter((c) => c.fsrs.state === 2 && new Date(c.fsrs.dueAt) <= end)
    .sort((a, b) => new Date(a.fsrs.dueAt) - new Date(b.fsrs.dueAt) || (a.id < b.id ? -1 : 1));

  // 新卡（按创建顺序）
  const newPool = usable
    .filter((c) => c.fsrs.state === 0)
    .sort((a, b) => a.createdAt - b.createdAt);

  // 配额扣减：今日已答的新卡数 / 复习卡数
  const answeredNew = todayLog.filter((r) => r.preState === 0).length;
  const answeredRev = todayLog.filter((r) => r.preState === 2).length;
  const newQuota = Math.max(0, (st.newPerDay ?? 20) - answeredNew);
  const revQuota = Math.max(0, (st.revPerDay ?? 200) - answeredRev);

  const limited = intersperse(newPool.slice(0, newQuota), revPool.slice(0, revQuota));

  // sibling 埋没：同 noteId 的多张卡同一天只出现一张
  const seenNotes = new Set();
  const queue = [];
  const deferred = [];
  for (const c of learn) {
    if (c.noteId && seenNotes.has(c.noteId)) { deferred.push(c); continue; }
    if (c.noteId) seenNotes.add(c.noteId);
    queue.push(c);
  }
  for (const c of limited) {
    if (c.noteId && seenNotes.has(c.noteId)) { deferred.push(c); continue; }
    if (c.noteId) seenNotes.add(c.noteId);
    queue.push(c);
  }
  // 队列见底才补埋没的同组卡（宁可少见，不空转）
  return [...queue, ...deferred];
}

/** 首页 / 总览用的到期计数（不受配额限制，反映真实待办） */
export function dueCounts(cards, now = new Date()) {
  const end = endOfToday();
  const counts = { new: 0, learn: 0, review: 0, total: 0, suspended: 0 };
  for (const c of cards) {
    if (c.suspended) { counts.suspended++; continue; }
    if (!c.fsrs) continue;
    if (c.fsrs.state === 0) counts.new++;
    else if ((c.fsrs.state === 1 || c.fsrs.state === 3) && new Date(c.fsrs.dueAt) <= now) counts.learn++;
    else if (c.fsrs.state === 2 && new Date(c.fsrs.dueAt) <= end) counts.review++;
  }
  counts.total = counts.new + counts.learn + counts.review;
  return counts;
}

/** 未来 N 天复习预测（含今天） */
export function forecast(cards, days = 30, now = new Date()) {
  const start = startOfToday();
  const buckets = Array.from({ length: days }, (_, i) => ({
    day: new Date(start.getTime() + i * 86400000),
    n: 0,
  }));
  for (const c of cards) {
    if (c.suspended || !c.fsrs || c.fsrs.state !== 2) continue;
    const due = new Date(c.fsrs.dueAt);
    const idx = Math.floor((due - start) / 86400000);
    if (idx < 0) buckets[0].n++;          // 已过期都算今天
    else if (idx < days) buckets[idx].n++;
  }
  return buckets;
}

/* ============ 统计 ============ */

/** 连续学习天数（以本地日历日计，今天有则含今天） */
export function streak(revlog) {
  const days = new Set(revlog.map((r) => r.day));
  if (!days.size) return 0;
  let n = 0;
  const d = new Date();
  if (!days.has(dayLocal(d))) {
    d.setDate(d.getDate() - 1); // 今天还没学，从昨天起算
  }
  while (days.has(dayLocal(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function dayLocal(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** 近 N 天答题热图数据：[{ day: 'YYYY-MM-DD', n: 数, right: 记住的比例 }] */
export function heatmap(revlog, days = 182) {
  const map = new Map();
  const start = startOfToday();
  start.setDate(start.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const k = dayLocal(new Date(start.getTime() + i * 86400000));
    map.set(k, { day: k, n: 0, good: 0 });
  }
  for (const r of revlog) {
    const e = map.get(r.day);
    if (!e) continue;
    e.n++;
    if (r.rating >= 2) e.good++;
  }
  return [...map.values()];
}

/** 复习态记忆保持率的粗估（复习态答案里 rating≥2 的比例） */
export function retention(revlog) {
  const rows = revlog.filter((r) => r.preState === 2);
  if (!rows.length) return null;
  const good = rows.filter((r) => r.rating >= 2).length;
  return good / rows.length;
}
