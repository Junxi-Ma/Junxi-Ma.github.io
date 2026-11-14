/**
 * Stardy — 云备份与按科目导出/导入
 *
 * 云端：Supabase 单表 stardy_backups，每用户一行（unique user_id），
 *       payload 为全量工作区 JSON。手动上传 / 下载，不自动同步。
 * 本地：按科目导出 JSON 文件（分科目不混装），导入时重映射全部 id。
 * AI 配置（端点 / 密钥）只存本机 localStorage，永不进入云备份。
 */

import db from './db.js?v=6';
import { uid } from './models.js?v=6';
import { getSupabase, isConfigured } from '../../../assets/js/supabase.js';

const BACKUP_VERSION = 2;

/* ============ 全量收集 / 写回 ============ */

export async function collectAll() {
  const [subjects, docs, nodes, links, cards, quiz, revlog] = await Promise.all([
    db.all('subjects'), db.all('docs'), db.all('nodes'),
    db.all('links'), db.all('cards'), db.all('quiz'), db.all('revlog'),
  ]);
  return { app: 'stardy', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), subjects, docs, nodes, links, cards, quiz, revlog };
}

async function writeAll(payload, { clearFirst = true } = {}) {
  const stores = ['subjects', 'docs', 'nodes', 'links', 'cards', 'quiz', 'revlog'];
  if (clearFirst) for (const s of stores) await db.clear(s);
  await db.bulkPut('subjects', payload.subjects || []);
  await db.bulkPut('docs', payload.docs || []);
  await db.bulkPut('nodes', payload.nodes || []);
  await db.bulkPut('links', payload.links || []);
  await db.bulkPut('cards', payload.cards || []);
  await db.bulkPut('quiz', payload.quiz || []);
  await db.bulkPut('revlog', payload.revlog || []);
}

/* ============ 云备份（Supabase） ============ */

export function cloudReady() {
  return isConfigured();
}

export async function cloudUser() {
  if (!cloudReady()) return null;
  try {
    const sb = await getSupabase();
    const { data } = await sb.auth.getSession();
    return data?.session?.user || null;
  } catch {
    return null;
  }
}

/** 上传全量备份（覆盖式：每用户一行） */
export async function cloudUpload() {
  const sb = await getSupabase();
  const { data, error: sessErr } = await sb.auth.getSession();
  if (sessErr || !data?.session?.user) throw new Error('未登录：请先在主站登录，再回来上传备份');
  const user = data.session.user;
  const payload = await collectAll();
  const json = JSON.stringify(payload);
  const row = {
    user_id: user.id,
    payload,
    version: BACKUP_VERSION,
    size_bytes: json.length,
    subject_count: (payload.subjects || []).length,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('stardy_backups').upsert(row, { onConflict: 'user_id' });
  if (error) throw new Error('备份上传失败：' + (error.message || '未知错误'));
  return { size: json.length, subjects: row.subject_count };
}

/** 拉取云备份元信息（不拉 payload） */
export async function cloudMeta() {
  if (!cloudReady()) return null;
  const sb = await getSupabase();
  const { data, error } = await sb.auth.getSession();
  if (error || !data?.session?.user) return null;
  const { data: row, error: qErr } = await sb
    .from('stardy_backups')
    .select('size_bytes, subject_count, updated_at, version')
    .maybeSingle();
  if (qErr) return null;
  return row || null;
}

/** 下载云备份并本地恢复（调用方负责确认与恢复点快照） */
export async function cloudRestore() {
  const sb = await getSupabase();
  const { data, error: sessErr } = await sb.auth.getSession();
  if (sessErr || !data?.session?.user) throw new Error('未登录，无法恢复云端备份');
  const { data: row, error } = await sb.from('stardy_backups').select('payload').maybeSingle();
  if (error) throw new Error('读取云备份失败：' + (error.message || '未知错误'));
  if (!row || !row.payload) throw new Error('云端还没有备份');
  await writeAll(row.payload);
  return row.payload;
}

/* ============ 按科目导出 / 导入 ============ */

export async function collectSubject(subjectId) {
  const subject = await db.get('subjects', subjectId);
  if (!subject) throw new Error('科目不存在');
  const [docs, nodes, links, cards, quiz, revlog] = await Promise.all([
    db.byIndex('docs', 'subjectId', subjectId),
    db.byIndex('nodes', 'subjectId', subjectId),
    db.byIndex('links', 'subjectId', subjectId),
    db.byIndex('cards', 'subjectId', subjectId),
    db.byIndex('quiz', 'subjectId', subjectId),
    db.byIndex('revlog', 'subjectId', subjectId),
  ]);
  return { app: 'stardy', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), subjects: [subject], docs, nodes, links, cards, quiz, revlog };
}

/** 下载文件到用户浏览器 */
export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export async function exportSubjectFile(subjectId) {
  const data = await collectSubject(subjectId);
  const name = (data.subjects[0].name || 'stardy').replace(/[\\/:*?"<>|]/g, '_');
  downloadJson(`stardy-${name}-${new Date().toISOString().slice(0, 10)}.json`, data);
  return data;
}

export async function exportAllFile() {
  const data = await collectAll();
  downloadJson(`stardy-全部科目-${new Date().toISOString().slice(0, 10)}.json`, data);
  return data;
}

/** 从文件读取 JSON（返回解析后的对象） */
export function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      try { resolve(JSON.parse(fr.result)); }
      catch (e) { reject(new Error('文件不是合法的 JSON：' + e.message)); }
    };
    fr.onerror = () => reject(new Error('文件读取失败'));
    fr.readAsText(file);
  });
}

/** 校验并导入（科目级或全量包）。全部 id 重映射，fsrs 进度随卡带走 */
export async function importPayload(payload) {
  if (!payload || payload.app !== 'stardy') throw new Error('不是 Stardy 导出的文件（缺 app 标识）');
  if (!Array.isArray(payload.subjects) || !payload.subjects.length) throw new Error('文件里没有科目数据');

  const idMap = new Map();
  const remap = (id) => {
    if (!id) return id;
    if (!idMap.has(id)) idMap.set(id, uid());
    return idMap.get(id);
  };

  const defaultSettings = () => ({
    desiredRetention: 0.9, newPerDay: 20, revPerDay: 200,
    learnSteps: '1m, 10m', relearnSteps: '10m', maxInterval: 36500,
    enableFuzz: true, leechThreshold: 8,
  });
  const defaultFsrs = () => ({
    stability: 0, difficulty: 0, dueAt: new Date().toISOString(), lastReviewAt: null,
    state: 0, scheduleStatus: 'new', cardId: uid(), reps: 0, lapses: 0, scheduledDays: 0, learningStep: 0,
  });
  const subjects = payload.subjects.map((s) => ({
    ...s,
    id: remap(s.id),
    settings: { ...defaultSettings(), ...(s.settings || {}) },
    createdAt: s.createdAt || Date.now(),
    updatedAt: s.updatedAt || Date.now(),
  }));
  const mk = (rows) => (rows || []).map((r) => {
    const n = { ...r, id: remap(r.id), subjectId: remap(r.subjectId) };
    if (r.pid !== undefined) n.pid = r.pid ? remap(r.pid) : null;
    if (r.noteId) n.noteId = remap(r.noteId);
    if (r.nid) n.nid = remap(r.nid);
    if (r.cardId) n.cardId = remap(r.cardId);
    if (r.from) n.from = remap(r.from);
    if (r.to) n.to = remap(r.to);
    return n;
  });

  const docs = mk(payload.docs);
  const nodes = mk(payload.nodes);
  const links = mk(payload.links);
  const cards = mk(payload.cards).map((c) => ({
    flags: 0, suspended: false, ord: 0, noteId: null, nid: null,
    createdAt: Date.now(), updatedAt: Date.now(),
    ...c,
    fsrs: c.fsrs && c.fsrs.state != null ? c.fsrs : defaultFsrs(),
  }));
  const quiz = mk(payload.quiz).map((z) => ({
    wrongCount: 0, resolved: false, lastAt: null, opts: [],
    ...z,
  }));
  const revlog = mk(payload.revlog);

  await db.bulkPut('subjects', subjects);
  await db.bulkPut('docs', docs);
  await db.bulkPut('nodes', nodes);
  await db.bulkPut('links', links);
  await db.bulkPut('cards', cards);
  await db.bulkPut('quiz', quiz);
  await db.bulkPut('revlog', revlog);
  return { subjects: subjects.length, cards: cards.length };
}

/** 最小可用科目模板（格式说明弹窗展示用；导入时缺的字段自动补默认值） */
export function subjectTemplate() {
  const now = Date.now();
  const sid = 'SUB-' + uid().slice(0, 8);
  return {
    app: 'stardy',
    version: 2,
    exportedAt: new Date().toISOString(),
    subjects: [{
      id: sid, name: '在这里填科目名', intro: '一句话简介（可选）',
      createdAt: now, updatedAt: now,
      settings: { desiredRetention: 0.9, newPerDay: 20, revPerDay: 200, learnSteps: '1m, 10m', relearnSteps: '10m', maxInterval: 36500, enableFuzz: true, leechThreshold: 8 },
    }],
    docs: [],
    nodes: [
      { id: 'n1', subjectId: sid, pid: null, title: '第一章 示例章', detail: '章/节节点：作为分组容器', formula: '', order: 1 },
      { id: 'n2', subjectId: sid, pid: 'n1', title: '示例知识点', detail: '记忆要点：把会考的定义、数值、条件写在这里。', formula: '$$E = mc^2$$', order: 2 },
    ],
    links: [{ id: 'l1', subjectId: sid, from: 'n2', to: 'n1', label: '前置' }],
    cards: [
      { id: 'c1', subjectId: sid, nid: 'n2', noteId: null, ord: 0, kind: 'qa',
        front: '这是正面问题（具体、可 30 秒作答）', back: '这是背面答案，支持 **Markdown** 与 $公式$', clozeText: '' },
      { id: 'c2', subjectId: sid, nid: 'n2', noteId: 'note-c2', ord: 1, kind: 'cloze',
        front: '', back: '', clozeText: '把关键句里的 {{c1::要背的词}} 挖空' },
    ],
    quiz: [
      { id: 'q1', subjectId: sid, nid: 'n2', type: 'choice', q: '题干', opts: ['A 选项', 'B', 'C', 'D'], answer: 0, explain: '解析', wrongCount: 0, resolved: false },
    ],
    revlog: [],
  };
}

/** 恢复前自动快照到设置表（key = restore-point），失败可找回 */
export async function makeRestorePoint() {
  const payload = await collectAll();
  await db.put('settings', { key: 'restore-point', at: Date.now(), payload });
  return payload;
}
