/* ============================================================
   api.js — 共享数据与文本工具
   index.json 获取（缓存破坏 + 重试）/ frontmatter 解析 /
   HTML 转义 / 日期与阅读时长格式化
   ============================================================ */

/** HTML 转义：任何进入 innerHTML 的外部文本必须先经过它 */
export function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * 获取内容索引 data/index.json。
 * ?v= 破坏 GitHub Pages CDN 缓存（约 10 分钟）；失败自动重试一次。
 * @returns {Promise<{notes: Array, tools: Array}>}
 */
export async function fetchIndex() {
  const url = `data/index.json?v=${Date.now()}`;
  try {
    return await load(url);
  } catch (err) {
    // 重试一次
    await new Promise((r) => setTimeout(r, 600));
    return load(url);
  }
}

async function load(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`index.json ${res.status}`);
  const data = await res.json();
  return {
    notes: Array.isArray(data.notes) ? data.notes : [],
    tools: Array.isArray(data.tools) ? data.tools : [],
  };
}

/** 拆掉 frontmatter，返回 { frontmatter: {…}, body: '…' } */
export function splitFrontmatter(raw) {
  const text = String(raw ?? '').replace(/^﻿/, ''); // BOM
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { frontmatter: {}, body: text };
  return {
    frontmatter: parseFrontmatter(m[1]),
    body: text.slice(m[0].length),
  };
}

/**
 * 解析简单 YAML 子集（与 scripts/build_index.py 保持一致）：
 * key: value / 引号字符串 / tags: [a, b] / "key:\n  - item" 块列表
 */
export function parseFrontmatter(src) {
  const out = {};
  const lines = String(src ?? '').split(/\r?\n/);
  let listKey = null;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // 块列表项：  - item
    const li = line.match(/^\s+-\s+(.*)$/);
    if (li && listKey) {
      out[listKey].push(unquote(li[1].trim()));
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();

    if (val === '') {
      // 可能是块列表的开头
      out[key] = [];
      listKey = key;
      continue;
    }
    listKey = null;

    // 行内数组：[a, b, c]
    if (val.startsWith('[') && val.endsWith(']')) {
      out[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
      continue;
    }
    out[key] = unquote(val);
  }
  return out;
}

function unquote(s) {
  if (/^".*"$/.test(s) || /^'.*'$/.test(s)) return s.slice(1, -1);
  return s;
}

/** 去掉 Markdown 语法，得到纯文本（用于摘要与阅读时长） */
export function stripMarkdown(md) {
  return String(md ?? '')
    .replace(/```[\s\S]*?```/g, ' ')       // 代码块
    .replace(/`([^`]*)`/g, '$1')            // 行内代码
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')  // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')// 链接保留文字
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')     // 标题
    .replace(/^\s{0,3}>\s?/gm, '')          // 引用
    .replace(/^\s{0,3}[-*+]\s+/gm, '')      // 无序列表
    .replace(/^\s{0,3}\d+\.\s+/gm, '')      // 有序列表
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1') // 加粗/斜体/删除线
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 阅读时长（分钟）：中文按字、英文按词，约 450 单位/分钟 */
export function readingMinutes(text) {
  const s = stripMarkdown(text);
  const cjk = (s.match(/[一-鿿㐀-䶿]/g) || []).length;
  const words = (s.match(/[A-Za-z0-9]+/g) || []).length;
  return Math.max(1, Math.round((cjk + words) / 450));
}

/** 'YYYY-MM-DD' → 'YYYY-MM-DD'（展示用，非法值返回 ''） */
export function formatDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : '';
}

/** 生成页面状态 HTML（加载失败 / 空内容） */
export function stateHtml(code, text, isError = false) {
  return `<div class="state${isError ? ' state--error' : ''}">
    <p class="state__code">${code}</p>
    <p class="state__text">${escapeHtml(text)}</p>
  </div>`;
}
