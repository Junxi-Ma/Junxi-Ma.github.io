/**
 * Stardy — 全局设置页（系统级：AI 配置 / 云备份 / 本地数据）
 *
 * 这些是跨科系的系统级功能，放在首页的全局设置里；
 * 科目专属的复习参数与科目操作在科目工作台的设置 tab。
 */

import db from '../db.js?v=10';
import { escapeHtml } from '../models.js?v=10';
import { toast, openModal, confirmBox } from '../ui.js?v=10';
import {
  exportAllFile, readJsonFile, importPayload, subjectTemplate,
  cloudReady, cloudUser, cloudMeta, cloudUpload, cloudRestore, makeRestorePoint,
} from '../backup.js?v=10';
import { loadAiConfig, saveAiConfig, chat, aiUsage } from '../ai.js?v=10';
import { gotoTab } from './workspace.js?v=10';

export async function renderGlobalSettings(root) {
  document.title = '全局设置 · Stardy 学习系统';
  const aiCfg = loadAiConfig();
  const usage = aiUsage();

  root.innerHTML = `
    <div class="container tool sdy-view">
      <div class="sdy-ws-head">
        <div>
          <a class="sdy-backhome" href="#/">← 返回学习系统</a>
          <h2 class="sdy-ws-title">⚙ 全局设置</h2>
          <p class="sdy-ws-intro">AI 配置 / 云备份 / 数据导入导出——系统级功能，对所有科目生效。复习参数在各自科目的「设置」标签里。</p>
        </div>
      </div>

      <div class="sdy-panel">
        <p class="sdy-panel__title">AI 配置 <span class="sdy-chip ${aiCfg.mock ? 'sdy-chip--muted' : 'sdy-chip--review'}" id="aic-mode">${aiCfg.mock ? 'Mock 演示模式' : '已接入真实 API'}</span></p>
        <p class="sdy-field__hint" style="margin-bottom:10px">
          填 OpenAI 兼容端点（中转站 / 自建均可）+ Key + 模型名；端点会自动补 /v1/chat/completions。
          注意端点必须是 OpenAI 兼容的 chat/completions 接口（编码工具如 opencode 自带的 API 不是这种协议，无法直接填）；本地服务还需开启 CORS 才能被网页直连——可开启下方代理转发。
          推理型模型（深度思考）会消耗较多 token，建树/出卡建议选非推理模型更快更省。
          密钥只存本机 localStorage，不参与云备份与导出。未配置时可勾选 Mock 模式走通全流程（输出为演示数据）。
        </p>
        <div class="sdy-row">
          <div class="sdy-field sdy-grow" style="min-width:220px">
            <label class="sdy-field__label">API 端点</label>
            <input class="sdy-input" id="aic-endpoint" placeholder="https://xxx.example.com/v4" value="${escapeHtml(aiCfg.endpoint)}">
          </div>
          <div class="sdy-field sdy-grow" style="min-width:180px">
            <label class="sdy-field__label">API Key</label>
            <input class="sdy-input" id="aic-key" type="password" placeholder="sk-…" value="${escapeHtml(aiCfg.key)}" autocomplete="off">
          </div>
          <div class="sdy-field" style="min-width:160px">
            <label class="sdy-field__label">模型</label>
            <input class="sdy-input" id="aic-model" placeholder="例如 glm-4.6 / deepseek-chat" value="${escapeHtml(aiCfg.model)}">
          </div>
          <div class="sdy-field" style="min-width:150px">
            <label class="sdy-field__label">最大输出 tokens</label>
            <input class="sdy-input" id="aic-maxout" placeholder="留空=由服务端决定" value="${escapeHtml(String(aiCfg.maxOut ?? 384000))}">
          </div>
        </div>
        <div class="sdy-field" style="margin-top:2px">
          <label class="sdy-checkrow"><input type="checkbox" id="aic-proxy" ${aiCfg.proxy ? 'checked' : ''}> 经 Supabase 代理转发（用于不支持浏览器跨域的端点，如 opencode Zen 网关）</label>
          <button class="btn btn--sm" id="aic-proxyhelp" style="align-self:flex-start">📋 代理函数部署指引</button>
        </div>
        <div class="sdy-row" style="margin-top:4px">
          <label class="sdy-checkrow"><input type="checkbox" id="aic-mock" ${aiCfg.mock ? 'checked' : ''}> Mock 演示模式（不调用真实 API）</label>
          <span class="sdy-grow"></span>
          <button class="btn" id="aic-test">测试连接</button>
          <button class="btn btn--primary" id="aic-save">保存 AI 配置</button>
          <span class="sdy-field__hint" id="aic-saved" hidden>已保存 ✓</span>
        </div>
        <p class="sdy-field__hint" style="margin-top:8px">用量：${usage.calls} 次调用 · ${usage.totalTokens} tokens（累计本机）<button class="btn btn--sm btn--ghost" id="aic-resetusage" style="margin-left:8px">清零</button></p>
      </div>

      <div class="sdy-panel">
        <p class="sdy-panel__title">云备份 <span class="sdy-chip sdy-chip--muted" id="cb-status">检查中…</span></p>
        <p class="sdy-field__hint" style="margin-bottom:10px">
          把全部科目（卡片 + 复习进度 + 知识树）手动备份到你的 Supabase 账号，换设备 / 清缓存前先上传。
          每个账号保留最近一份，上传会覆盖；恢复前会先在本机留恢复点。AI 密钥不参与备份。
        </p>
        <div class="sdy-row">
          <button class="btn btn--primary" id="cb-upload">☁ 立即上传备份</button>
          <button class="btn" id="cb-restore">⬇ 从云端恢复…</button>
          <span class="sdy-field__hint" id="cb-meta"></span>
        </div>
      </div>

      <div class="sdy-panel">
        <p class="sdy-panel__title">数据导入 / 导出</p>
        <div class="sdy-row">
          <button class="btn" id="ld-expall">⬆ 导出全部科目</button>
          <button class="btn" id="ld-imp">⬇ 导入科目 JSON…</button>
          <button class="btn" id="ld-tpl">📋 科目文件格式说明</button>
          <input type="file" id="ld-file" accept=".json,application/json" hidden>
        </div>
        <p class="sdy-field__hint" style="margin-top:8px">导入按科目文件进行，全部 id 会重新生成、不会覆盖现有数据；卡片复习进度随文件带走。AI 配置不参与导出。单科目导出在各科目的「设置」标签里。</p>
      </div>
    </div>`;

  // —— AI 配置
  const collectAiCfg = () => ({
    endpoint: root.querySelector('#aic-endpoint').value.trim(),
    key: root.querySelector('#aic-key').value.trim(),
    model: root.querySelector('#aic-model').value.trim(),
    mock: root.querySelector('#aic-mock').checked,
    proxy: root.querySelector('#aic-proxy').checked,
    maxOut: root.querySelector('#aic-maxout').value.trim() || '',
  });
  root.querySelector('#aic-save').addEventListener('click', () => {
    saveAiConfig(collectAiCfg());
    const flag = root.querySelector('#aic-saved');
    flag.hidden = false;
    setTimeout(() => { flag.hidden = true; }, 1600);
    renderGlobalSettings(root);
    toast('AI 配置已保存');
  });
  root.querySelector('#aic-test').addEventListener('click', async () => {
    saveAiConfig(collectAiCfg());
    const btn = root.querySelector('#aic-test');
    btn.disabled = true;
    btn.textContent = '测试中…';
    const t0 = Date.now();
    try {
      const { content } = await chat([{ role: 'user', content: '请只回复两个字：正常' }], { task: 'chat', maxTokens: 8192 });
      toast(`连接正常（${Date.now() - t0}ms）：${content.slice(0, 30)}`);
    } catch (e) {
      toast('连接失败：' + e.message, true, 5200);
    }
    btn.disabled = false;
    btn.textContent = '测试连接';
  });
  root.querySelector('#aic-resetusage').addEventListener('click', () => {
    try { localStorage.removeItem('stardy-ai-usage-v1'); } catch {}
    renderGlobalSettings(root);
  });

  // —— 代理部署指引
  root.querySelector('#aic-proxyhelp').addEventListener('click', () => {
    const fnCode = PROXY_CODE;
    openModal({
      title: '代理函数部署指引（约 1 分钟）',
      wide: true,
      bodyHtml: `
        <p class="sdy-field__hint" style="margin-bottom:8px">
          端点不支持浏览器跨域（CORS）时（如 <b>opencode Zen</b> 网关、部分中转服务），需要经你自己的 Supabase 部署一个转发函数。步骤：
        </p>
        <ol style="font-size:var(--fs-note);color:var(--text-2);line-height:1.9;padding-left:1.4em;margin:0 0 10px">
          <li>打开 <b>Supabase 控制台</b> → 左侧 <b>Edge Functions</b> → <b>Create a new function</b></li>
          <li>函数名填 <b>ai-proxy</b> → 进入编辑器，把下方代码<b>整体粘贴</b>替换原有内容 → <b>Deploy</b></li>
          <li>回到这里勾选「经 Supabase 代理转发」并保存，再点「测试连接」。转发时需要你<b>已在本站登录</b>（函数校验登录态，防止被外人滥用你的套餐）</li>
        </ol>
        <textarea class="sdy-textarea" id="pc-code" style="min-height:220px;font-family:var(--font-mono);font-size:11px" readonly>${escapeHtml(fnCode)}</textarea>
        <div class="sdy-modal__acts">
          <button class="btn" data-a="copy">复制代码</button>
          <a class="btn btn--primary" href="https://supabase.com/dashboard" target="_blank" rel="noopener" style="text-decoration:none">打开 Supabase 控制台 ↗</a>
        </div>`,
      onMount(box) {
        box.querySelector('[data-a="copy"]').addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(fnCode); toast('已复制，去 Supabase 粘贴部署'); }
          catch { box.querySelector('#pc-code').select(); document.execCommand('copy'); toast('已复制'); }
        });
      },
    });
  });

  // —— 云备份
  const statusEl = root.querySelector('#cb-status');
  const metaEl = root.querySelector('#cb-meta');
  (async () => {
    try {
      if (!cloudReady()) {
        statusEl.textContent = '云端未连接';
        statusEl.className = 'sdy-chip sdy-chip--leech';
        metaEl.textContent = 'Supabase 未配置或不可达，云备份不可用（本地数据不受影响）。';
        return;
      }
      const user = await cloudUser();
      if (!user) {
        statusEl.textContent = '未登录';
        statusEl.className = 'sdy-chip sdy-chip--leech';
        metaEl.innerHTML = '请先<a href="/">去主站登录</a>，再回到这里上传备份。';
        return;
      }
      statusEl.textContent = '已登录';
      statusEl.className = 'sdy-chip sdy-chip--review';
      const meta = await cloudMeta();
      metaEl.textContent = meta
        ? `上次备份：${new Date(meta.updated_at).toLocaleString('zh-CN')} · ${meta.subject_count} 个科目 · ${(meta.size_bytes / 1024).toFixed(0)} KB`
        : '云端还没有备份。';
    } catch {
      statusEl.textContent = '云端异常';
      statusEl.className = 'sdy-chip sdy-chip--leech';
    }
  })();

  root.querySelector('#cb-upload').addEventListener('click', async () => {
    try {
      const r = await cloudUpload();
      toast(`已上传备份（${r.subjects} 个科目 · ${(r.size / 1024).toFixed(0)} KB）`);
      renderGlobalSettings(root);
    } catch (e) { toast(e.message, true); }
  });
  root.querySelector('#cb-restore').addEventListener('click', async () => {
    const ok = await confirmBox({
      title: '从云端恢复？',
      body: '将用云端备份<b>整体替换</b>本机当前的全部科目数据。恢复前会自动在本机留恢复点。确认继续？',
      confirmText: '恢复', danger: true,
    });
    if (!ok) return;
    try {
      await makeRestorePoint();
      await cloudRestore();
      toast('已从云端恢复');
      renderGlobalSettings(root);
    } catch (e) { toast(e.message, true); }
  });

  // —— 数据导入 / 导出
  root.querySelector('#ld-expall').addEventListener('click', async () => {
    await exportAllFile();
    toast('已导出全部科目');
  });
  const fileEl = root.querySelector('#ld-file');
  root.querySelector('#ld-imp').addEventListener('click', () => fileEl.click());
  fileEl.addEventListener('change', async () => {
    const f = fileEl.files[0];
    fileEl.value = '';
    if (!f) return;
    try {
      const payload = await readJsonFile(f);
      const ok = await confirmBox({
        title: `导入「${payload.subjects?.[0]?.name || f.name}」？`,
        body: '将以新 id 合并进当前数据（不会覆盖现有科目），卡片复习进度随文件带走。',
        confirmText: '导入',
      });
      if (!ok) return;
      const r = await importPayload(payload);
      toast(`已导入 ${r.subjects} 个科目、${r.cards} 张卡片`);
    } catch (e) { toast(e.message, true); }
  });

  // —— 格式说明 + 代理代码（复用常量）
  root.querySelector('#ld-tpl').addEventListener('click', () => {
    const tpl = JSON.stringify(subjectTemplate(), null, 2);
    openModal({
      title: '科目文件格式说明', wide: true,
      bodyHtml: `
        <p class="sdy-field__hint" style="margin-bottom:8px">
          用任意工具（其他 AI、脚本）按下面模板生成 JSON，保存为 .json 文件后点「导入科目 JSON…」即可。
          导入时全部 id 自动重新生成、不会覆盖现有数据；<b>缺的字段会自动补默认值</b>（settings / 卡片的 fsrs 调度状态都不用自己填）。
        </p>
        <table style="font-size:var(--fs-sm);color:var(--text-2);border-collapse:collapse;margin-bottom:10px">
          <tr><td style="padding:2px 10px 2px 0"><b>subjects</b></td><td>科目元信息：name 科目名 / intro 简介 / settings 复习参数（可整段省略）</td></tr>
          <tr><td style="padding:2px 10px 2px 0"><b>nodes</b></td><td>知识树：pid 指向父节点 id（null = 章）；title / detail 正文（支持 $公式$）/ formula 公式 / order 排序</td></tr>
          <tr><td style="padding:2px 10px 2px 0"><b>cards</b></td><td>卡片：kind=qa 用 front+back；kind=cloze 用 clozeText（{{c1::挖空}}）+ noteId 同组一致；nid 关联知识点（可选）；fsrs 不用填（自动初始化）</td></tr>
          <tr><td style="padding:2px 10px 2px 0"><b>quiz</b></td><td>题目：type=choice/fill/essay；choice 的 answer 是下标 0-3，fill/essay 是参考答案文本</td></tr>
          <tr><td style="padding:2px 10px 2px 0"><b>links</b></td><td>知识点关系：from/to 指向节点 id，label ∈ 前置/拓展/易混（可选）</td></tr>
          <tr><td style="padding:2px 10px 2px 0"><b>docs / revlog</b></td><td>资料原文 / 复习记录（通常留空数组）</td></tr>
        </table>
        <textarea class="sdy-textarea" id="tpl-code" style="min-height:260px;font-family:var(--font-mono);font-size:11px" readonly>${escapeHtml(tpl)}</textarea>
        <div class="sdy-modal__acts">
          <button class="btn" data-a="copy">复制模板</button>
        </div>`,
      onMount(box) {
        box.querySelector('[data-a="copy"]').addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(tpl); toast('模板已复制'); }
          catch { box.querySelector('#tpl-code').select(); document.execCommand('copy'); toast('已复制'); }
        });
      },
    });
  });
}

// ai-proxy Edge Function 源码（与 supabase/functions/ai-proxy/index.ts 同步，部署指引弹窗展示用）
const PROXY_CODE = `// ============================================================
// ai-proxy — Stardy AI 的 CORS 转发代理（Supabase Edge Function）
// 部署：Dashboard → Edge Functions → Create a new function → 命名
// ai-proxy → 粘贴本文件全部内容 → Deploy
// 安全：仅允许本站登录用户调用；仅转发到 https:// 目标。
// ============================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: { message: '仅支持 POST' } }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  try {
    const auth = req.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: { message: '代理转发需要先登录本站账号' } }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: userData, error: userErr } = await admin.auth.getUser(auth.slice(7));
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: { message: '登录态无效，请重新登录' } }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    const { url, body, headers } = await req.json();
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      return new Response(JSON.stringify({ error: { message: '仅支持转发到 https:// 目标' } }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    const fwd = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(headers && typeof headers === 'object' ? headers : {}) },
      body: JSON.stringify(body ?? {}),
    });
    const text = await fwd.text();
    return new Response(text, {
      status: fwd.status,
      headers: { ...CORS, 'Content-Type': fwd.headers.get('content-type') || 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: '代理转发失败：' + String(e?.message || e) } }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
`;
