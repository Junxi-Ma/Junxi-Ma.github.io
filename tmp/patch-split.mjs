// 设置拆分 patch：从 workspace.js 移除 AI/云备份/本地数据（已迁至 views/settings.js），
// 科目设置保留复习参数+危险区，加全局设置入口；home/app 加路由入口。
import fs from 'node:fs';
const dir = 'E:/My Website/public/tools/stardy/js/';
const views = dir + 'views/';

// ===== 1) workspace.js 剪切 =====
let w = fs.readFileSync(views + 'workspace.js', 'utf8');

// 1a) HTML 段：AI 面板起点 → 危险区面板（保留危险区）
const htmlStart = w.indexOf('    <div class="sdy-panel">\n      <p class="sdy-panel__title">AI 配置');
const htmlEndMark = '    <div class="sdy-panel" style="border-color:var(--danger-border)">';
const htmlEnd = w.indexOf(htmlEndMark);
if (htmlStart < 0 || htmlEnd < 0 || htmlEnd <= htmlStart) throw new Error('HTML 段定位失败');
w = w.slice(0, htmlStart) + w.slice(htmlEnd);

// 1b) 绑定段：'// —— AI 配置' → '// —— 危险区'
const bindStart = w.indexOf('  // —— AI 配置');
const bindEnd = w.indexOf('  // —— 危险区');
if (bindStart < 0 || bindEnd < 0 || bindEnd <= bindStart) throw new Error('绑定段定位失败');
w = w.slice(0, bindStart) + w.slice(bindEnd);

// 1c) imports：删掉 settings.js 已承接的符号（保留 gotoTab；backup 的云备份符号删去、subjectTemplate 删去）
w = w.replace(
  `import {
  exportSubjectFile, exportAllFile, readJsonFile, importPayload,
  cloudReady, cloudUser, cloudMeta, cloudUpload, cloudRestore, makeRestorePoint,
} from '../backup.js?v=9';`,
  `import { exportSubjectFile } from '../backup.js?v=9';`);
w = w.replace(
  "import { loadAiConfig, saveAiConfig, chat, aiUsage, aiCourseChat, courseContext } from '../ai.js?v=9';",
  "import { aiCourseChat, courseContext } from '../ai.js?v=9';");

// 1d) 科目设置面板：顶部加全局设置入口；本地数据按钮改（导出本科目保留）
w = w.replace(
  `      <p class="sdy-panel__title">复习参数（FSRS-6）</p>`,
  `      <p class="sdy-field__hint" style="margin:0 0 14px">AI 配置 / 云备份 / 数据导入在<a href="#/settings" style="color:var(--accent-strong)">⚙ 全局设置</a>（首页右上角也可进入）。</p>
      <p class="sdy-panel__title">复习参数（FSRS-6）</p>`);
w = w.replace(
  `      <div class="sdy-row">
        <button class="btn" id="dz-clearlog">清空本科目复习记录</button>
        <button class="btn" id="dz-del" style="color:var(--danger-fg)">删除本科目…</button>
      </div>`,
  `      <div class="sdy-row" style="margin-bottom:10px">
        <button class="btn" id="dz-exp1">⬆ 导出本科目 JSON</button>
      </div>
      <div class="sdy-row">
        <button class="btn" id="dz-clearlog">清空本科目复习记录</button>
        <button class="btn" id="dz-del" style="color:var(--danger-fg)">删除本科目…</button>
      </div>`);

// 1e) 绑定：dz-exp1
w = w.replace(
  `  panel.querySelector('#dz-clearlog').addEventListener('click', async () => {`,
  `  panel.querySelector('#dz-exp1').addEventListener('click', async () => {
    const data = await exportSubjectFile(subject.id);
    toast(\`已导出「\${data.subjects[0].name}」\`);
  });
  panel.querySelector('#dz-clearlog').addEventListener('click', async () => {`);

fs.writeFileSync(views + 'workspace.js', w, 'utf8');
console.log('workspace split done');

// ===== 2) home.js：头部加 ⚙ 设置入口 =====
let h = fs.readFileSync(views + 'home.js', 'utf8');
if (!h.includes('hd-settings')) {
  h = h.replace(
    `        <div class="sdy-stat sdy-grow" style="justify-content:flex-end">
          <button class="btn btn--primary" id="sdy-new-subject">✚ 新建科目</button>
        </div>`,
    `        <div class="sdy-stat sdy-grow" style="justify-content:flex-end">
          <button class="btn" id="hd-settings" title="AI / 云备份 / 数据导入">⚙ 设置</button>
          <button class="btn btn--primary" id="sdy-new-subject">✚ 新建科目</button>
        </div>`);
  h = h.replace(
    `  root.querySelector('#sdy-new-subject').addEventListener('click', () => showNewSubjectModal(area, subjects, dueBySubject));`,
    `  root.querySelector('#sdy-new-subject').addEventListener('click', () => showNewSubjectModal(area, subjects, dueBySubject));
  root.querySelector('#hd-settings').addEventListener('click', () => { location.hash = '#/settings'; });`);
  fs.writeFileSync(views + 'home.js', h, 'utf8');
  console.log('home settings entry done');
}

// ===== 3) app.js：路由 #/settings =====
let ap = fs.readFileSync(dir + 'app.js', 'utf8');
if (!ap.includes("views/settings.js")) {
  ap = ap.replace(
    "import { renderHome } from './views/home.js?v=9';",
    "import { renderHome } from './views/home.js?v=9';\nimport { renderGlobalSettings } from './views/settings.js?v=9';");
  ap = ap.replace(
    "  const mWs = h.match(/^#\\/s\\/([A-Za-z0-9-]+)(?:\\/([a-z]+))?/);",
    `  if (h === '#/settings') {
    await renderGlobalSettings(main);
    return;
  }
  const mWs = h.match(/^#\\/s\\/([A-Za-z0-9-]+)(?:\\/([a-z]+))?/);`);
  fs.writeFileSync(dir + 'app.js', ap, 'utf8');
  console.log('app route done');
}
