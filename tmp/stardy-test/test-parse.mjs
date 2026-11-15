// 在 Node 里实测 PDF 解析管线（与浏览器同一份 vendored 代码）
import fs from 'node:fs';
const root = 'file:///E:/My Website/dist/tools/stardy/js/parse.js?v=2';
const P = await import(root);
const buf = fs.readFileSync('E:/My_Appdesign/Stardy/大气探测学笔记.pdf');
const fakeFile = { name: '大气探测学笔记.pdf', arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
const t0 = Date.now();
const r = await P.parsePdf(fakeFile, (p) => { if (p.page % 50 === 0) console.log('  page', p.page, '/', p.total); });
console.log('耗时', Date.now() - t0, 'ms');
console.log('总字符', r.text.length);
console.log('大纲条目', r.outline?.length ?? 0);
console.log('前 5 条大纲:', (r.outline || []).slice(0, 5).map((o) => `L${o.level} ${o.title.slice(0, 25)}`));
console.log('页面字符分布(前6):', r.pagesInfo.slice(0, 6).map((x) => `${x.page}页${x.chars}字`).join(' '));
console.log('疑似扫描页:', r.pagesInfo.filter((x) => x.chars < 20).length, '/', r.pagesInfo.length);
console.log('正文预览:', JSON.stringify(r.text.slice(0, 220)));
const chunks = P.roughSections(r.text, 2000);
console.log('分块数(2000字上限):', chunks.length);
console.log('块首标题示例:', chunks.slice(0, 5).map((c) => c.heading || '(无)').join(' | '));
