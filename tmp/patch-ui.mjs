// UI 微调 patch：①工作台返回学习系统链接 ②科目卡按钮移底部右侧
import fs from 'node:fs';
const dir = 'E:/My Website/public/tools/stardy/js/views/';

// 1) workspace.js：ws-head 左上加返回链接
let w = fs.readFileSync(dir + 'workspace.js', 'utf8');
if (!w.includes('sdy-backhome')) {
  w = w.replace(
    `      <div class="sdy-ws-head">
        <div>
          <h2 class="sdy-ws-title">`,
    `      <div class="sdy-ws-head">
        <div>
          <a class="sdy-backhome" href="#/">← 返回学习系统</a>
          <h2 class="sdy-ws-title">`);
  fs.writeFileSync(dir + 'workspace.js', w);
  console.log('workspace: backhome added');
}

// 2) home.js：菜单移到卡片底部右侧（常显）
let h = fs.readFileSync(dir + 'home.js', 'utf8');
const oldMenu = `        <span class="sdy-subject__due">\${due.total > 0 ? \`今日待学 \${due.total}\` : '今日已清'}</span>
        <div class="sdy-subject__menu">`;
const newFoot = `        <div class="sdy-subject__foot">
          <span class="sdy-subject__due">\${due.total > 0 ? \`今日待学 \${due.total}\` : '今日已清'}</span>
          <span class="sdy-grow"></span>`;
if (h.includes(oldMenu)) {
  h = h.replace(oldMenu, newFoot);
  h = h.replace(
    `          <button class="btn btn--sm" data-act="delete" data-id="\${s.id}" title="删除科目">删除</button>
        </div>`,
    `          <button class="btn btn--sm" data-act="delete" data-id="\${s.id}" title="删除科目">删除</button>
        </div>`);
  fs.writeFileSync(dir + 'home.js', h);
  console.log('home: menu -> foot done');
} else {
  console.log('home: menu pattern not found, checking...');
}
