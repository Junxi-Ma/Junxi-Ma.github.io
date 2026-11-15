// 第二轮 patch：backup.js 导入容错+模板；ai.js 课程问答
import fs from 'node:fs';
const dir = 'E:/My Website/public/tools/stardy/js/';

// ===== backup.js =====
let b = fs.readFileSync(dir + 'backup.js', 'utf8');
if (!b.includes('subjectTemplate')) {
  b = b.replace(
    "  const subjects = payload.subjects.map((s) => ({ ...s, id: remap(s.id) }));",
    () => [
      "  const defaultSettings = () => ({",
      "    desiredRetention: 0.9, newPerDay: 20, revPerDay: 200,",
      "    learnSteps: '1m, 10m', relearnSteps: '10m', maxInterval: 36500,",
      "    enableFuzz: true, leechThreshold: 8,",
      "  });",
      "  const defaultFsrs = () => ({",
      "    stability: 0, difficulty: 0, dueAt: new Date().toISOString(), lastReviewAt: null,",
      "    state: 0, scheduleStatus: 'new', cardId: uid(), reps: 0, lapses: 0, scheduledDays: 0, learningStep: 0,",
      "  });",
      "  const subjects = payload.subjects.map((s) => ({",
      "    ...s,",
      "    id: remap(s.id),",
      "    settings: { ...defaultSettings(), ...(s.settings || {}) },",
      "    createdAt: s.createdAt || Date.now(),",
      "    updatedAt: s.updatedAt || Date.now(),",
      "  }));",
    ].join('\n'));
  b = b.replace(
    [
      "  const cards = mk(payload.cards);",
      "  const quiz = mk(payload.quiz);",
    ].join('\n'),
    [
      "  const cards = mk(payload.cards).map((c) => ({",
      "    flags: 0, suspended: false, ord: 0, noteId: null, nid: null,",
      "    createdAt: Date.now(), updatedAt: Date.now(),",
      "    ...c,",
      "    fsrs: c.fsrs && c.fsrs.state != null ? c.fsrs : defaultFsrs(),",
      "  }));",
      "  const quiz = mk(payload.quiz).map((z) => ({",
      "    wrongCount: 0, resolved: false, lastAt: null, opts: [],",
      "    ...z,",
      "  }));",
    ].join('\n'));
  b = b.replace(
    "/** 恢复前自动快照到设置表（key = restore-point），失败可找回 */",
    () => [
      "/** 最小可用科目模板（格式说明弹窗展示用；导入时缺的字段自动补默认值） */",
      "export function subjectTemplate() {",
      "  const now = Date.now();",
      "  const sid = 'SUB-' + uid().slice(0, 8);",
      "  return {",
      "    app: 'stardy',",
      "    version: 2,",
      "    exportedAt: new Date().toISOString(),",
      "    subjects: [{",
      "      id: sid, name: '在这里填科目名', intro: '一句话简介（可选）',",
      "      createdAt: now, updatedAt: now,",
      "      settings: { desiredRetention: 0.9, newPerDay: 20, revPerDay: 200, learnSteps: '1m, 10m', relearnSteps: '10m', maxInterval: 36500, enableFuzz: true, leechThreshold: 8 },",
      "    }],",
      "    docs: [],",
      "    nodes: [",
      "      { id: 'n1', subjectId: sid, pid: null, title: '第一章 示例章', detail: '章/节节点：作为分组容器', formula: '', order: 1 },",
      "      { id: 'n2', subjectId: sid, pid: 'n1', title: '示例知识点', detail: '记忆要点：把会考的定义、数值、条件写在这里。', formula: '$$E = mc^2$$', order: 2 },",
      "    ],",
      "    links: [{ id: 'l1', subjectId: sid, from: 'n2', to: 'n1', label: '前置' }],",
      "    cards: [",
      "      { id: 'c1', subjectId: sid, nid: 'n2', noteId: null, ord: 0, kind: 'qa',",
      "        front: '这是正面问题（具体、可 30 秒作答）', back: '这是背面答案，支持 **Markdown** 与 $公式$', clozeText: '' },",
      "      { id: 'c2', subjectId: sid, nid: 'n2', noteId: 'note-c2', ord: 1, kind: 'cloze',",
      "        front: '', back: '', clozeText: '把关键句里的 {{c1::要背的词}} 挖空' },",
      "    ],",
      "    quiz: [",
      "      { id: 'q1', subjectId: sid, nid: 'n2', type: 'choice', q: '题干', opts: ['A 选项', 'B', 'C', 'D'], answer: 0, explain: '解析', wrongCount: 0, resolved: false },",
      "    ],",
      "    revlog: [],",
      "  };",
      "}",
      "",
      "/** 恢复前自动快照到设置表（key = restore-point），失败可找回 */",
    ].join('\n'));
  fs.writeFileSync(dir + 'backup.js', b, 'utf8');
  console.log('backup.js OK:', b.includes('subjectTemplate'));
} else console.log('backup.js already patched');

// ===== ai.js：课程问答 =====
let a = fs.readFileSync(dir + 'ai.js', 'utf8');
if (!a.includes('aiCourseChat')) {
  a += [
    '',
    '/* ============ 课程问答（基于知识树的简单对话） ============ */',
    '',
    'export const SYS_ASK = `你是课程助教。根据给定的【课程知识点】回答学生问题：',
    '- 优先依据知识点内容作答，条理清晰，重点加粗；可用 Markdown 与 $公式$。',
    '- 知识点里没有的内容可以补充通识，但要注明「（课程资料外）」。',
    '- 回答控制在 300 字以内，学生追问时再展开。`;',
    '',
    '/** 组装知识树要点上下文 */',
    'export function courseContext(nodes) {',
    "  const lines = nodes.map((n) => '· ' + (n._path || n.title) + (n.detail ? '：' + String(n.detail).replace(/\\s+/g, ' ').slice(0, 160) : ''));",
    "  const text = lines.join('\\n');",
    "  return text.length > 24000 ? text.slice(0, 24000) + '\\n…（知识点过多已截断）' : text;",
    '}',
    '',
    '/** 课程问答（messages 为本会话历史，调用方裁剪） */',
    'export async function aiCourseChat(context, messages, onToken = null) {',
    '  const { content, tokens } = await chat(messages, {',
    "    task: 'ask',",
    '    temperature: 0.5,',
    "    system: SYS_ASK + '\\n\\n【课程知识点】\\n' + context,",
    '  });',
    '  if (onToken) onToken(tokens);',
    '  return content;',
    '}',
    '',
  ].join('\n');
  fs.writeFileSync(dir + 'ai.js', a, 'utf8');
  console.log('ai.js OK:', a.includes('aiCourseChat'));
} else console.log('ai.js already patched');
