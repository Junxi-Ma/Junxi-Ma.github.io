/**
 * Stardy — 数据模型与通用工具
 *
 * 实体工厂、挖空 {{c1::答案::提示}} 解析与渲染、迷你 Markdown + KaTeX 渲染、
 * 自动挖空建议（公式/数字优先）、格式化工具。
 */

/* ============ 基础工具 ============ */

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10));

/** 本地日期字符串 YYYY-MM-DD（连击 / 配额 / 热图的"一天"以本地时区为准） */
export function dayStr(d = new Date()) {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 本地当天零点 */
export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfToday() {
  const d = startOfToday();
  d.setDate(d.getDate() + 1);
  return d;
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 格式化间隔，入参统一为「分钟」：<1 分钟显示"现在"，<1 小时显示 N 分，<1 天显示 N 时，往上天数 / 月 / 年 */
export function fmtInterval(v) {
  if (v == null || Number.isNaN(v)) return '—';
  if (v < 1) return '现在';
  if (v < 60) return `${Math.round(v)}分`;
  if (v < 60 * 24) return `${Math.round(v / 60)}时`;
  const days = v / 1440;
  if (days < 30) return `${Math.round(days)}天`;
  if (days < 365) return `${(days / 30).toFixed(1)}月`;
  return `${(days / 365).toFixed(1)}年`;
}

export function fmtMs(ms) {
  if (ms == null) return '—';
  return fmtInterval(ms / 60000);
}

/* ============ 实体工厂 ============ */

export function defaultSubjectSettings() {
  return {
    desiredRetention: 0.9,   // 目标保持率（Anki 默认 0.9）
    newPerDay: 20,           // 每日新卡上限
    revPerDay: 200,          // 每日复习上限
    learnSteps: '1m, 10m',   // 学习步骤（分钟）
    relearnSteps: '10m',     // 重学步骤（分钟）
    maxInterval: 36500,      // 最大间隔（天）
    enableFuzz: true,        // 间隔模糊化
    leechThreshold: 8,       // 遗忘次数达到阈值打"陷阱卡"标记
  };
}

export function newSubject(name, intro = '') {
  const t = Date.now();
  return {
    id: uid(),
    name: name.trim() || '未命名科目',
    intro: intro.trim(),
    createdAt: t,
    updatedAt: t,
    settings: defaultSubjectSettings(),
  };
}

export function newDoc(subjectId, name, kind, text, outline = null) {
  return {
    id: uid(),
    subjectId,
    name,
    kind, // pdf | pptx | docx | md | txt | ocr
    text,
    chars: text.length,
    outline, // [{ level, title, pos }] 或 null
    addedAt: Date.now(),
  };
}

export function newNode(subjectId, pid, title, detail = '', formula = '', sourceRef = null) {
  return {
    id: uid(),
    subjectId,
    pid: pid || null, // null = 章根
    title: title.trim(),
    detail,
    formula,
    sourceRef, // { docId, docName, chunkIdx, quote } 溯源
    order: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function newLink(subjectId, from, to, label) {
  return { id: uid(), subjectId, from, to, label };
}

/** 卡片。fsrs 快照由 scheduler.initCard 填充 */
export function newCard(subjectId, { kind, front = '', back = '', clozeText = '', nid = null, noteId = null, ord = 0 }) {
  return {
    id: uid(),
    subjectId,
    nid,           // 关联知识点（可空：独立卡）
    noteId,        // 同一笔记的多张挖空卡共享 noteId（sibling 埋没依据）
    ord,           // 挖空序号（qa 卡为 0）
    kind,          // 'qa' | 'cloze'
    front,
    back,
    clozeText,     // 挖空卡原文（含 {{cN::...}}）
    flags: 0,      // bit0: leech
    suspended: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    fsrs: null,    // scheduler 填充
  };
}

export function newRevlogEntry(card, grade, preState, next) {
  return {
    id: Date.now() + '-' + uid().slice(0, 8), // 排序友好且唯一
    cardId: card.id,
    subjectId: card.subjectId,
    ts: Date.now(),
    day: dayStr(),
    rating: grade,                 // 1重来 2困难 3良好 4简单
    preState: preState,            // 0新 1学 2复 3重学
    scheduledDays: next.scheduledDays ?? 0,
    stability: next.stability ?? null,
    difficulty: next.difficulty ?? null,
    takenMs: next.takenMs ?? null,
  };
}

/* ============ 挖空（Cloze）============ */

const CLOZE_RE = /\{\{c(\d+)::([^:{}]*(?:::[^{}]*)?)\}\}/g;

/** 解析全部挖空标记 → [{ ord, answer, hint }] */
export function parseCloze(text) {
  const items = [];
  for (const m of String(text).matchAll(CLOZE_RE)) {
    const raw = m[2] ?? '';
    const sep = raw.indexOf('::');
    items.push({
      ord: Number(m[1]),
      answer: sep >= 0 ? raw.slice(0, sep) : raw,
      hint: sep >= 0 ? raw.slice(sep + 2) : '',
    });
  }
  return items.sort((a, b) => a.ord - b.ord);
}

export function clozeOrds(text) {
  return [...new Set(parseCloze(text).map(i => i.ord))];
}

/**
 * 行内渲染（挖空答案 / 提示用）：只做转义 + 粗体 + 行内代码 + 公式，
 * 不产生块级 <p>，允许安全地嵌在 <span> 里。
 */
export function renderInline(text) {
  if (text == null || text === '') return '';
  const { t, segs } = extractMath(text);
  let html = escapeHtml(t).replace(/\n/g, '<br>');
  html = html.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  return restoreMath(html, segs);
}

/**
 * 渲染挖空文本为 HTML。
 * 做法：先把 {{cN::…}} 换成占位符再过 renderMarkdown（保证答案不被二次转义、
 * 不破坏段落结构），最后把占位符还原成挖空标记。
 * activeOrd：当前要考察的挖空序号；其位置显示为可点击揭示的空格，其余挖空正常显示（下划线标注）。
 */
export function renderCloze(text, activeOrd, mark = '') {
  const segs = [];
  const ph = (i) => `\u0000C${i}\u0000`;
  let t = String(text ?? '');
  t = t.replace(CLOZE_RE, (whole, ordStr, raw) => {
    const ord = Number(ordStr);
    const sep = (raw ?? '').indexOf('::');
    segs.push({ ord, answer: sep >= 0 ? raw.slice(0, sep) : (raw ?? ''), hint: sep >= 0 ? raw.slice(sep + 2) : '' });
    return ph(segs.length - 1);
  });

  const html = renderMarkdown(t);
  return html.replace(/\u0000C(\d+)\u0000/g, (_, i) => {
    const seg = segs[Number(i)];
    if (!seg) return '';
    if (seg.ord !== activeOrd) {
      return `<span class="sdy-cz sdy-cz--passive" title="c${seg.ord}">${renderInline(seg.answer)}</span>`;
    }
    return `<span class="sdy-cz sdy-cz--active${mark}" data-answer="${escapeHtml(seg.answer)}"${seg.hint ? ` data-hint="${escapeHtml(seg.hint)}"` : ''}><span class="sdy-cz__blank" tabindex="0">${seg.hint ? escapeHtml(seg.hint) : '&nbsp;&nbsp;&nbsp;&nbsp;'}</span><span class="sdy-cz__ans" hidden>${renderInline(seg.answer)}</span></span>`;
  });
}

/**
 * 自动挖空建议：公式（$...$ / $$...$$）与数字优先，
 * 没有公式时每句挖一个最长的词（中文 2 字以上 / 英文单词）。
 */
export function suggestClozes(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  if (/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/.test(t)) {
    // 公式优先：整段公式（含 $ 定界符，保证渲染）作为挖空答案，序号按出现顺序
    let n = 0;
    return t.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g, (m) => `{{c${++n}::${m}}}`);
  }
  const numRe = /\d+(?:\.\d+)?(?:\s*[~～−-]\s*\d+(?:\.\d+)?)?(?:\s*(?:%|℃|hPa|Pa|km|mm|cm|K|J|W|m\/s))?/g;
  if (numRe.test(t)) {
    let n = 0;
    return t.replace(numRe, (m) => (m.trim() ? `{{c${++n}::${m}}}` : m));
  }
  // 按句挖关键词：每句（。；！？分隔）挖最长词
  let n = 0;
  return t
    .split(/(?<=[。；！？!?;])/)
    .map((sentence) => {
      const tokens = sentence.match(/[\u4e00-\u9fa5]{2,}|[A-Za-z][A-Za-z\-']+/g) || [];
      if (!tokens.length) return sentence;
      const best = tokens.reduce((a, b) => (b.length > a.length ? b : a));
      const idx = sentence.indexOf(best);
      if (idx < 0) return sentence;
      return sentence.slice(0, idx) + `{{c${++n}::${best}}}` + sentence.slice(idx + best.length);
    })
    .join('');
}

/* ============ 迷你 Markdown + KaTeX ============ */

/** 先抽出公式占位再转义 HTML，避免公式里的 < > 被吃掉 */
function extractMath(text) {
  const segs = [];
  let t = String(text ?? '');
  t = t.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    segs.push({ tex: tex.trim(), display: true });
    return `\u0000M${segs.length - 1}\u0000`;
  });
  t = t.replace(/(^|[^\\])\$([^$\n]+?)\$/g, (_, pre, tex) => {
    segs.push({ tex: tex.trim(), display: false });
    return `${pre}\u0000M${segs.length - 1}\u0000`;
  });
  return { t, segs };
}

function restoreMath(html, segs) {
  return html.replace(/\u0000M(\d+)\u0000/g, (_, i) => {
    const seg = segs[Number(i)];
    if (!seg || typeof katex === 'undefined') return escapeHtml(seg ? seg.tex : '');
    try {
      return katex.renderToString(seg.tex, { displayMode: seg.display, throwOnError: false, output: 'html' });
    } catch {
      return `<code>${escapeHtml(seg.tex)}</code>`;
    }
  });
}

/**
 * 迷你 Markdown：表格 / 引用 / 围栏代码 / 行内代码 / 粗体 / 列表 / 段落 + KaTeX 公式。
 * 输入先经 HTML 转义，安全。
 */
export function renderMarkdown(text) {
  if (text == null || text === '') return '';
  const { t, segs } = extractMath(text);
  const src = escapeHtml(t);

  const lines = src.split('\n');
  const out = [];
  let i = 0;
  const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isSepRow = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(l);
  const isFence = (l) => /^```/.test(l.trim());

  while (i < lines.length) {
    const line = lines[i];

    if (isFence(line)) { // 围栏代码
      const lang = line.trim().slice(3).trim();
      i++;
      const buf = [];
      while (i < lines.length && !isFence(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre class="sdy-code"${lang ? ` data-lang="${lang}"` : ''}><code>${buf.join('\n')}</code></pre>`);
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isSepRow(lines[i + 1])) { // 表格
      const head = line.slice(line.indexOf('|') + 1, line.lastIndexOf('|')).split('|').map(c => c.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(lines[i].slice(lines[i].indexOf('|') + 1, lines[i].lastIndexOf('|')).split('|').map(c => c.trim()));
        i++;
      }
      out.push(`<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^&gt; /.test(line)) { // 引用
      const buf = [];
      while (i < lines.length && /^&gt; /.test(lines[i])) buf.push(lines[i++].replace(/^&gt; /, ''));
      out.push(`<blockquote><p>${buf.join('<br>')}</p></blockquote>`);
      continue;
    }
    const ul = /^[-*]\s+(.+)/.exec(line);
    if (ul) {
      const items = [];
      while (i < lines.length) {
        const m = /^[-*]\s+(.+)/.exec(lines[i]);
        if (!m) break;
        items.push(`<li>${m[1]}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    const ol = /^\d+[.、]\s+(.+)/.exec(line);
    if (ol) {
      const items = [];
      while (i < lines.length) {
        const m = /^\d+[.、]\s+(.+)/.exec(lines[i]);
        if (!m) break;
        items.push(`<li>${m[1]}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }
    if (/^\s*$/.test(line)) { i++; continue; }

    // 普通段落（合并连续行）
    const buf = [line];
    i++;
    while (
      i < lines.length && !/^\s*$/.test(lines[i]) && !isTableRow(lines[i]) &&
      !isFence(lines[i]) && !/^&gt; /.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) && !/^\d+[.、]\s+/.test(lines[i])
    ) buf.push(lines[i++]);
    out.push(`<p>${buf.join('<br>')}</p>`);
  }

  let html = out.join('');
  // 行内修饰（此时已转义，粗体/行内代码里的 ** 与 ` 原样保留）
  html = html.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  return restoreMath(html, segs);
}

/* ============ 展示辅助 ============ */

export const STATE_INFO = {
  0: { name: '新卡', cls: 'new' },
  1: { name: '学习中', cls: 'learn' },
  2: { name: '复习', cls: 'review' },
  3: { name: '重学', cls: 'relearn' },
};
export const STATE_NAME = (s) => STATE_INFO[s]?.name || '?';

export const GRADES = [
  { v: 1, label: '重来', key: '1', cls: 'again' },
  { v: 2, label: '困难', key: '2', cls: 'hard' },
  { v: 3, label: '良好', key: '3', cls: 'good' },
  { v: 4, label: '简单', key: '4', cls: 'easy' },
];

/** 解析学习步骤配置字符串："1m, 10m" → [1, 10]（分钟）；"20s" → 1/3 分钟 */
export function parseSteps(str) {
  if (!str || !str.trim()) return [];
  const out = [];
  for (const part of str.split(/[,，]/)) {
    const m = /^\s*(\d+(?:\.\d+)?)\s*(m|min|s|h)?\s*$/i.exec(part);
    if (!m) continue;
    const n = Number(m[1]);
    const unit = (m[2] || 'm').toLowerCase();
    out.push(unit === 's' ? Math.max(n / 60, 1 / 60) : unit === 'h' ? n * 60 : n);
  }
  return out.length ? out : [];
}
