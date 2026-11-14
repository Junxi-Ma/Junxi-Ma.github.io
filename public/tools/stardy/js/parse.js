/**
 * Stardy — 资料解析：PDF / PPTX / DOCX / MD / TXT 文本提取 + 大纲重建 + 分块
 *
 * 设计取舍（承自前身 Vue 版）：只做文本提取，不做版面还原。
 * PDF 用字号聚类重建章节大纲；docx/pptx 读 OOXML 标题样式；
 * Markdown 读 # 层级。分块用中文标题正则 + 字数上限。
 * 扫描件（PDF 页面无文字层）记录 pagesInfo，OCR 转写在阶段三接入视觉模型。
 */

import { unzipSync, strFromU8 } from '../libs/fflate.mjs?v=2';

/* ============ PDF（pdf.js vendored @5.7.284） ============ */

let _pdfjs = null;
async function getPdfjs() {
  if (_pdfjs) return _pdfjs;
  const lib = await import('../libs/pdf/pdf.min.mjs?v=2');
  lib.GlobalWorkerOptions.workerSrc = new URL('../libs/pdf/pdf.worker.min.mjs?v=2', import.meta.url).href;
  _pdfjs = lib;
  return lib;
}

/**
 * 解析 PDF：逐页取文字，按 y 坐标拼行并记录字号 → 大纲。
 * @returns {Promise<{kind:'pdf', text, outline, pagesInfo:{page,chars}[]}>}
 */
export async function parsePdf(file, onProgress = null) {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({
    data,
    cMapUrl: new URL('../libs/pdf/cmaps/', import.meta.url).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('../libs/pdf/standard_fonts/', import.meta.url).href,
  }).promise;

  const lines = [];      // { text, size, page }
  const pagesInfo = [];
  const maxPages = 800;
  const n = Math.min(doc.numPages, maxPages);

  for (let p = 1; p <= n; p++) {
    if (onProgress) onProgress({ page: p, total: n });
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let pageChars = 0;

    // 按 y 聚行（transform[5] 为基线 y，transform[3] 为字号）
    const rows = new Map(); // y -> { y, parts: [{x, str, size}] }
    for (const item of content.items) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5]);
      const key = [...rows.keys()].find((ky) => Math.abs(ky - y) <= 3) ?? y;
      const row = rows.get(key) || { y, parts: [] };
      row.parts.push({ x: item.transform[4], str: item.str, size: Math.abs(item.transform[3]) || 0 });
      rows.set(key, row);
      pageChars += item.str.trim().length;
    }
    pagesInfo.push({ page: p, chars: pageChars });

    const sorted = [...rows.values()].sort((a, b) => b.y - a.y);
    for (const row of sorted) {
      row.parts.sort((a, b) => a.x - b.x);
      // 行内去重：课件导出常有"描边层+填充层"双份文本（x 相同、内容相同）
      const dedup = [];
      for (const s of row.parts) {
        const dup = dedup.find((d) => Math.abs(d.x - s.x) <= 2 && d.str.trim() === s.str.trim());
        if (!dup) dedup.push(s);
      }
      const text = dedupeLine(dedup.map((s) => s.str).join('').replace(/\s+/g, ' ').trim());
      if (!text) continue;
      const size = Math.max(...dedup.map((s) => s.size));
      // 相邻行相似去重（双层文本 y 略错位时各成一行）——保留更长的一份
      const prev = lines[lines.length - 1];
      if (prev && prev.page === p && similarLines(prev.text, text)) {
        if (text.length > prev.text.length) {
          prev.text = text;
          prev.size = Math.max(prev.size, size);
        }
        continue;
      }
      lines.push({ text, size, page: p });
    }
    page.cleanup();
  }
  try { await doc.destroy(); } catch {}

  const text = lines.map((l) => l.text).join('\n');
  const outline = buildOutlineBySize(lines);
  return { kind: 'pdf', text, outline, pagesInfo };
}

/** 两行文本是否足够相似（课件双层文本：相同 / 包含 / 编辑距离 ≤30%） */
function editDist(a, b, cap = Infinity) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
    if (Math.min(...cur) > cap) return cap + 1;
  }
  return prev[b.length];
}

function similarLines(a, b) {
  const x = String(a).replace(/\s+/g, '');
  const y = String(b).replace(/\s+/g, '');
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) return Math.min(x.length, y.length) >= 6;
  const n = Math.max(x.length, y.length);
  if (Math.abs(x.length - y.length) <= n * 0.3 && n >= 5) {
    return editDist(x, y, Math.ceil(n * 0.3)) <= n * 0.3;
  }
  return false;
}

/** 行内拆分去重：双层文本常被顺序拼接成"层A+层B"，两半相似则保留后半（正确文本层） */
function dedupeLine(t) {
  const s = String(t);
  if (s.length < 6) return s;
  const from = Math.floor(s.length * 0.3);
  const to = Math.ceil(s.length * 0.7);
  for (let i = from; i <= to; i++) {
    const a = s.slice(0, i);
    const b = s.slice(i);
    const na = a.replace(/\s+/g, '').length;
    const nb = b.replace(/\s+/g, '').length;
    if (na >= 2 && nb >= 2 && similarLines(a, b)) return s.slice(i);
  }
  return s;
}

/** 数学字母/符号行（PPT 转出的公式层），不能当标题 */
const MATH_RE = /[\u{1D400}-\u{1D7FF}\u{2100}-\u{214F}\u{2200}-\u{22FF}]/u;
const isMathLine = (t) => {
  const s = String(t).replace(/\s+/g, '');
  if (!s) return true;
  if (MATH_RE.test(s)) return true;
  const letters = (s.match(/[A-Za-z\u4e00-\u9fa5]/g) || []).length;
  return letters / s.length < 0.45;
};

/** 字号聚类大纲：众数字号为正文，≥正文×1.12 视为标题，字号相近归并（≤4 级） */
export function buildOutlineBySize(lines) {
  if (!lines.length) return null;
  const content = lines.filter((l) => !isMathLine(l.text) && l.text.length >= 2);
  const pool = content.length >= 5 ? content : lines;
  const freq = new Map();
  for (const l of pool) {
    const s = Math.round(l.size * 10) / 10;
    if (s > 0) freq.set(s, (freq.get(s) || 0) + l.text.length);
  }
  if (!freq.size) return null;
  const bodySize = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const headingSizes = [...new Set(pool.filter((l) => l.size >= bodySize * 1.12).map((l) => Math.round(l.size)))]
    .sort((a, b) => b - a).slice(0, 4);

  const outline = [];
  let pos = 0;
  for (const l of lines) {
    const rs = Math.round(l.size);
    const idx = headingSizes.indexOf(rs);
    const isHeading = idx >= 0 && !isMathLine(l.text) && l.text.length <= 60 && !/^[=_.\s]+$/.test(l.text);
    if (isHeading) outline.push({ level: idx + 1, title: l.text, pos });
    pos += l.text.length + 1;
  }
  return outline.length ? outline : null;
}

/* ============ PPTX ============ */

const slideNum = (key) => Number(/(\d+)\.xml$/.exec(key)?.[1] || 0);

/** 解析 PPTX：解压 OOXML，按幻灯片顺序取文本（每页插入分隔标记） */
export async function parsePptx(file) {
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const slideKeys = Object.keys(zip)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => slideNum(a) - slideNum(b));
  if (!slideKeys.length) throw new Error('这不是有效的 PPTX（找不到幻灯片 XML）');

  const parser = new DOMParser();
  const outline = [];
  const bodyLines = [];
  let pos = 0;
  slideKeys.forEach((key, i) => {
    const xml = strFromU8(zip[key]);
    const dom = parser.parseFromString(xml, 'text/xml');
    const texts = [...dom.getElementsByTagNameNS('*', 't')]
      .map((t) => (t.textContent || '').trim())
      .filter(Boolean);
    const marker = `— 第 ${i + 1} 页 —`;
    const block = [marker, ...texts].join('\n');
    if (texts.length) outline.push({ level: 1, title: texts[0].slice(0, 40) || marker, pos: pos + marker.length + 1 });
    bodyLines.push(block);
    pos += block.length + 1;
  });
  const text = bodyLines.join('\n\n');
  return { kind: 'pptx', text, outline: outline.length ? outline : null };
}

/* ============ DOCX ============ */

/** 解析 DOCX：段落 + 标题样式（Heading1-6 / 标题1-6）→ 大纲 */
export async function parseDocx(file) {
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const docXml = zip['word/document.xml'];
  if (!docXml) throw new Error('这不是有效的 DOCX（找不到 document.xml）');
  const dom = new DOMParser().parseFromString(strFromU8(docXml), 'text/xml');

  const paras = [...dom.getElementsByTagNameNS('*', 'p')];
  const outline = [];
  const bodyLines = [];
  let pos = 0;
  for (const p of paras) {
    const texts = [...p.getElementsByTagNameNS('*', 't')].map((t) => t.textContent || '').join('');
    const styleEl = p.getElementsByTagNameNS('*', 'pStyle')[0];
    const style = styleEl?.getAttribute('w:val') || styleEl?.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'val') || '';
    const hm = /^(?:Heading|标题)[\s_]?([1-6])$/i.exec(style);
    const line = texts.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (hm) outline.push({ level: Number(hm[1]), title: line.slice(0, 60), pos });
    bodyLines.push(line);
    pos += line.length + 1;
  }
  const text = bodyLines.join('\n');
  if (!text) throw new Error('DOCX 里没有可提取的文字（可能是扫描图片）');
  return { kind: 'docx', text, outline: outline.length ? outline : null };
}

/* ============ MD / TXT ============ */

export function parseMarkdownText(name, text) {
  const outline = [];
  let inFence = false;
  let pos = 0;
  for (const line of String(text).split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence) {
      const m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
      if (m) outline.push({ level: m[1].length, title: m[2].slice(0, 60), pos });
    }
    pos += line.length + 1;
  }
  return { kind: name.endsWith('.markdown') ? 'md' : 'md', text, outline: outline.length ? outline : null };
}

/* ============ 入口 ============ */

const KIND_LABEL = { pdf: 'PDF', pptx: 'PPT', docx: 'Word', md: 'Markdown', txt: '文本' };
export const kindLabel = (k) => KIND_LABEL[k] || k;

/** 按扩展名分派解析。不支持的格式给出明确错误。 */
export async function parseFile(file, onProgress = null) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return parsePdf(file, onProgress);
  if (name.endsWith('.pptx') || name.endsWith('.ppsx')) return parsePptx(file);
  if (name.endsWith('.docx')) return parseDocx(file);
  if (name.endsWith('.md') || name.endsWith('.markdown')) return parseMarkdownText(file.name, await file.text());
  if (name.endsWith('.txt') || name.endsWith('.text')) return { kind: 'txt', text: await file.text(), outline: null };
  throw new Error('暂不支持的格式：' + file.name + '（当前支持 PDF / PPTX / DOCX / MD / TXT；旧版 .ppt/.doc 请先另存为新格式，扫描件 OCR 在阶段三开放）');
}

/* ============ 分块 ============ */

const HEADING_RE = /^(第[一二三四五六七八九十百\d]+[章节讲部分]|[（(]?[一二三四五六七八九十]+[）)、.]|\d+(?:\.\d+)*[、.\s]|#{1,4}\s|—\s*第\s*\d+\s*页)/;

/**
 * 按中文标题行 + 字数上限切块。
 * @returns [{ idx, text, heading|null }]
 */
export function roughSections(text, maxChars = 2400) {
  const lines = String(text).split('\n');
  const chunks = [];
  let buf = [];
  let bufLen = 0;
  let bufHeading = null;

  const flush = () => {
    const t = buf.join('\n').trim();
    if (t) chunks.push({ idx: chunks.length, text: t, heading: bufHeading });
    buf = [];
    bufLen = 0;
    bufHeading = null;
  };

  for (const line of lines) {
    const isHeading = HEADING_RE.test(line.trim());
    if (isHeading && bufLen > maxChars * 0.7) {
      // 标题到来且当前块已满七成 → 先收块，让标题开新块
      flush();
    }
    if (isHeading && !bufHeading) bufHeading = line.trim().replace(/^#+\s*/, '').slice(0, 40);
    buf.push(line);
    bufLen += line.length + 1;
    if (bufLen >= maxChars) flush();
  }
  flush();
  return chunks;
}
