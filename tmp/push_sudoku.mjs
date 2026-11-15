#!/usr/bin/env node
/**
 * 用 GitHub Git Data API 推两个文件（一次提交），绕开本机 schannel 的
 * CRYPT_E_NO_REVOCATION_CHECK —— git push 在这台机器上过不去。
 * PAT 从环境变量 GH_PAT 读，不落盘。
 */
import fs from 'node:fs';
import path from 'node:path';

const PAT = process.env.GH_PAT;
if (!PAT) { console.error('缺少 GH_PAT'); process.exit(1); }

const OWNER = 'Junxi-Ma';
const REPO = 'Junxi-Ma.github.io';
const BRANCH = 'main';
const ROOT = 'E:/My Website';

const FILES = [
  'public/tools/sudoku/app.js',
  'public/tools/sudoku/index.html',
];

const MESSAGE = `fix(sudoku): 难度切换改事件委托并容错绑定

旧 HTML + 新 JS 的组合下（浏览器缓存了没有暂停按钮的页面），
pauseBtn.addEventListener 抛 TypeError 让整个 app.js 中断，
排在文件末尾的难度绑定根本不执行——表现为点难度完全没反应、连高亮都不变。

- 新增元素（#sk-pause / #sk-pause-veil / #sk-resume 等）一律可选链，
  缺了也不影响其余功能
- 难度绑定从末尾的循环改成 document 上的事件委托，并提到其它绑定之前
- newGame 包 try/catch，失败时在难度标签上给出可见提示
- 未捕获错误在页面顶部亮红条，带上 build 号，便于下次排查
- app.js?v=6 / style.css?v=5 强制刷新`;

const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

async function api(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${PAT}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dsh-sudoku-fix',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    throw new Error(`${init.method || 'GET'} ${url} -> ${res.status} ${JSON.stringify(json).slice(0, 400)}`);
  }
  return json;
}

const ref = await api(`${API}/git/ref/heads/${BRANCH}`);
const baseSha = ref.object.sha;
const baseCommit = await api(`${API}/git/commits/${baseSha}`);
console.log(`base: ${baseSha} (${baseCommit.commit?.message?.split('\n')[0] || ''})`);

const tree = [];
for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  const buf = fs.readFileSync(abs);
  const blob = await api(`${API}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: buf.toString('base64'), encoding: 'base64' }),
  });
  console.log(`blob ${rel} -> ${blob.sha} (${buf.length} B)`);
  tree.push({ path: rel, mode: '100644', type: 'blob', sha: blob.sha });
}

const newTree = await api(`${API}/git/trees`, {
  method: 'POST',
  body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
});

const now = new Date().toISOString();
const newCommit = await api(`${API}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({
    message: MESSAGE,
    tree: newTree.sha,
    parents: [baseSha],
    author: { name: 'Junxi-Ma', email: '3500221502@qq.com', date: now },
    committer: { name: 'Junxi-Ma', email: '3500221502@qq.com', date: now },
  }),
});
console.log(`commit: ${newCommit.sha}`);

const updated = await api(`${API}/git/refs/heads/${BRANCH}`, {
  method: 'PATCH',
  body: JSON.stringify({ sha: newCommit.sha, force: false }),
});
console.log(`ref ${BRANCH} -> ${updated.object.sha}`);
console.log('OK');
