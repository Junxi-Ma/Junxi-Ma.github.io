// 设置页代理开关 + 部署指引弹窗 patch
import fs from 'node:fs';
const file = 'E:/My Website/public/tools/stardy/js/views/workspace.js';
let t = fs.readFileSync(file, 'utf8');

// 1) AI hint 下方加代理开关 + 指引按钮（插在 Mock 行前）
const mockRow = `      <div class="sdy-row" style="margin-top:4px">
        <label class="sdy-checkrow"><input type="checkbox" id="aic-mock" `;
const proxyBlock = `      <div class="sdy-field" style="margin-top:2px">
        <label class="sdy-checkrow"><input type="checkbox" id="aic-proxy" ` +
  '${aiCfg.proxy ? \'checked\' : \'\'}' + `> 经 Supabase 代理转发（用于不支持浏览器跨域的端点，如 opencode Zen 网关）</label>
        <button class="btn btn--sm" id="aic-proxyhelp" style="align-self:flex-start">📋 代理函数部署指引</button>
      </div>
      <div class="sdy-row" style="margin-top:4px">
        <label class="sdy-checkrow"><input type="checkbox" id="aic-mock" `;
if (!t.includes('aic-proxy')) {
  t = t.replace(mockRow, proxyBlock);
}

// 2) 两处 saveAiConfig 补 proxy 字段
t = t.split(`      model: panel.querySelector('#aic-model').value.trim(),
      mock: panel.querySelector('#aic-mock').checked,
    });`).join(`      model: panel.querySelector('#aic-model').value.trim(),
      mock: panel.querySelector('#aic-mock').checked,
      proxy: panel.querySelector('#aic-proxy').checked,
    });`);

// 3) 代理指引弹窗绑定（挂在 resetusage 绑定后面）
const anchor = `  panel.querySelector('#aic-resetusage').addEventListener('click', () => {`;
const bindAdd = `  panel.querySelector('#aic-proxyhelp').addEventListener('click', () => {
    const fnCode = FS_CODE;
    openModal({
      title: '代理函数部署指引（约 1 分钟）',
      wide: true,
      bodyHtml: ` + '`' + `
        <p class="sdy-field__hint" style="margin-bottom:8px">
          端点不支持浏览器跨域（CORS）时（如 <b>opencode Zen</b> 网关、部分中转服务），需要经你自己的 Supabase 部署一个转发函数。步骤：
        </p>
        <ol style="font-size:var(--fs-note);color:var(--text-2);line-height:1.9;padding-left:1.4em;margin:0 0 10px">
          <li>打开 <b>Supabase 控制台</b> → 左侧 <b>Edge Functions</b> → <b>Create a new function</b>（选 Create without editor 的任意模板均可）</li>
          <li>函数名填 <b>ai-proxy</b> → 进入编辑器，把下方代码<b>整体粘贴</b>替换原有内容 → <b>Deploy</b></li>
          <li>回到这里勾选「经 Supabase 代理转发」并保存，再点「测试连接」。转发时需要你<b>已在本站登录</b>（函数校验登录态，防止被外人滥用你的套餐）</li>
        </ol>
        <textarea class="sdy-textarea" id="pc-code" style="min-height:220px;font-family:var(--font-mono);font-size:11px" readonly>` + '${escapeHtml(fnCode)}' + `</textarea>
        <div class="sdy-modal__acts">
          <button class="btn" data-a="copy">复制代码</button>
          <a class="btn btn--primary" href="https://supabase.com/dashboard/project/_/functions" target="_blank" rel="noopener" style="text-decoration:none">打开 Supabase 控制台 ↗</a>
        </div>` + '`' + `,
      onMount(box, close) {
        box.querySelector('[data-a="copy"]').addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(fnCode);
            toast('已复制，去 Supabase 粘贴部署');
          } catch {
            box.querySelector('#pc-code').select();
            document.execCommand('copy');
            toast('已复制');
          }
        });
      },
    });
  });
  ` + anchor;
if (!t.includes("aic-proxyhelp")) {
  t = t.replace(anchor, bindAdd);
}

// 4) FS_CODE 常量（与 supabase/functions/ai-proxy/index.ts 保持一致）
const fnSource = fs.readFileSync('E:/My Website/supabase/functions/ai-proxy/index.ts', 'utf8');
const constBlock = `// ai-proxy Edge Function 源码（与 supabase/functions/ai-proxy/index.ts 同步，部署指引弹窗展示用）
const FS_CODE = ` + '`' + fnSource.replace(/\\/g, '\\\\').replace(/\`/g, '\\\`').replace(/\$\{/g, '\\${') + '`' + `;

`;
if (!t.includes('const FS_CODE')) {
  t = t.replace('const TABS = [', constBlock + 'const TABS = [');
}

fs.writeFileSync(file, t);
console.log('workspace proxy UI patched:', t.includes('aic-proxy'), t.includes('FS_CODE'));
