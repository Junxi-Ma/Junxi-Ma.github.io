// 检查 models.js 导出符号在各文件中使用但未 import 的情况
import fs from 'node:fs';
const dir = 'E:/My Website/public/tools/stardy/js';
const src = fs.readFileSync(dir + '/models.js', 'utf8');
const exports = [...src.matchAll(/export (?:function|const) (\w+)/g)].map((m) => m[1]);
let issues = 0;
const files = ['app.js', 'db.js', 'scheduler.js', 'ui.js', 'backup.js', 'ai.js', 'parse.js',
  'views/home.js', 'views/workspace.js', 'views/review.js', 'views/ai.js', 'views/quiz.js', 'views/graph.js'];
for (const f of files) {
  const t = fs.readFileSync(dir + '/' + f, 'utf8');
  const importBlock = (t.match(/import \{([^}]+)\} from '\.\.\/models\.js[^']*'/) || [])[1] || '';
  const imported = importBlock.split(',').map((s) => s.trim().split(' as ')[0]).filter(Boolean);
  const missing = exports.filter((name) =>
    new RegExp('[^\\w.]' + name + '\\s*\\(', 'm').test(t) && !imported.includes(name));
  if (missing.length) { console.log(f, '缺 import:', missing.join(',')); issues++; }
}
console.log(issues ? issues + ' files have missing imports' : 'all imports OK');
