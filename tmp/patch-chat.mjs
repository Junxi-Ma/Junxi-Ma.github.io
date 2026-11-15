// workspace.js patch：①知识树 tab 加「💬 课程问答」 ②设置页「科目文件格式说明」
import fs from 'node:fs';
const dir = 'E:/My Website/public/tools/stardy/js/views/';
let w = fs.readFileSync(dir + 'workspace.js', 'utf8');

// —— imports：subjectTemplate + courseContext/aiCourseChat
if (!w.includes('subjectTemplate')) {
  w = w.replace(
    "import {\n  exportSubjectFile, exportAllFile, readJsonFile, importPayload,",
    "import {\n  exportSubjectFile, exportAllFile, readJsonFile, importPayload, subjectTemplate,");
}
if (!w.includes('aiCourseChat')) {
  w = w.replace(
    "import { loadAiConfig, saveAiConfig, chat, aiUsage } from '../ai.js?v=9';",
    "import { loadAiConfig, saveAiConfig, chat, aiUsage, aiCourseChat, courseContext } from '../ai.js?v=9';");
}

// —— 顶部按钮加 💬 课程问答
if (!w.includes('tr-ask')) {
  w = w.replace(
    `      <button class="btn btn--sm" id="tr-graph">🔭 总览图</button>`,
    `      <button class="btn btn--sm" id="tr-graph">🔭 总览图</button>
      <button class="btn btn--sm" id="tr-ask">💬 课程问答</button>`);
}

// —— 子视图切换支持 chat；showChat 实现（挂在 showGraph 定义后）
if (!w.includes('showChat')) {
  w = w.replace(
    `  panel.querySelector('#tr-graph')?.addEventListener('click', () => {
    if (treeview.querySelector('.sdy-radial')) showTree(); else showGraph();
  });`,
    `  panel.querySelector('#tr-graph')?.addEventListener('click', () => {
    if (treeview.querySelector('.sdy-radial')) showTree(); else showGraph();
  });
  panel.querySelector('#tr-ask')?.addEventListener('click', () => {
    if (treeview.querySelector('#ask-box')) showTree(); else showChat();
  });

  const showChat = () => {
    treeview.innerHTML = \`
      <div class="sdy-panel" id="ask-box" style="display:flex;flex-direction:column;min-height:520px">
        <p class="sdy-panel__title">
          <span>💬 课程问答（基于本科目知识树；AI 配置见设置页）</span>
          <button class="btn btn--sm btn--ghost" id="ask-back">↩ 返回大纲</button>
        </p>
        <div id="ask-log" style="flex:1;overflow-y:auto;min-height:280px;max-height:56vh;padding:6px 2px"></div>
        <div class="sdy-row" style="margin-top:10px;align-items:flex-end">
          <textarea class="sdy-textarea" id="ask-input" style="min-height:56px;flex:1" placeholder="问一个课程问题，Enter 发送（Shift+Enter 换行）…"></textarea>
          <button class="btn btn--primary" id="ask-send" style="flex:none">发送</button>
        </div>
      </div>\`;
    treeview.querySelector('#ask-back').addEventListener('click', showTree);
    const log = treeview.querySelector('#ask-log');
    const input = treeview.querySelector('#ask-input');
    const sendBtn = treeview.querySelector('#ask-send');
    const history = [];
    const addMsg = (role, html) => {
      const div = document.createElement('div');
      div.className = 'ask-msg ask-msg--' + role;
      div.innerHTML = html;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
      return div;
    };
    addMsg('assistant', '<div class="sdy-md">我是本课程的助教，基于知识树要点回答问题。试试问：「干湿球温度表的原理」「气象雷达的波段划分」「热滞系数怎么理解」。</div>');
    const send = async () => {
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      addMsg('user', '<div class="sdy-md">' + escapeHtml(q).replace(/\\n/g, '<br>') + '</div>');
      const thinking = addMsg('assistant', '<div class="sdy-field__hint">🤖 思考中…</div>');
      sendBtn.disabled = true;
      input.disabled = true;
      try {
        const nodes = await db.byIndex('nodes', 'subjectId', subject.id);
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const withPath = nodes.map((n) => {
          const parts = [];
          let cur = n;
          while (cur) { parts.unshift(cur.title); cur = cur.pid ? byId.get(cur.pid) : null; }
          return { ...n, _path: parts.join(' › ') };
        });
        const context = courseContext(withPath);
        const messages = [...history, { role: 'user', content: q }];
        const answer = await aiCourseChat(context, messages);
        history.push({ role: 'user', content: q }, { role: 'assistant', content: answer });
        while (history.length > 12) history.splice(0, 2);
        thinking.innerHTML = '<div class="sdy-md">' + renderMarkdown(answer) + '</div>';
        log.scrollTop = log.scrollHeight;
      } catch (e) {
        thinking.innerHTML = '<div class="sdy-md" style="color:var(--danger-fg)">出错了：' + escapeHtml(e.message) + '</div>';
      }
      sendBtn.disabled = false;
      input.disabled = false;
      input.focus();
    };
    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
  };`,
    );
}

// —— 设置页「科目文件格式说明」按钮（本地数据面板）
if (!w.includes('ld-tpl')) {
  w = w.replace(
    `        <button class="btn" id="ld-imp">导入科目 JSON…</button>
        <input type="file" id="ld-file" accept=".json,application/json" hidden>`,
    `        <button class="btn" id="ld-imp">导入科目 JSON…</button>
        <button class="btn" id="ld-tpl">📋 科目文件格式说明</button>
        <input type="file" id="ld-file" accept=".json,application/json" hidden>`);
}

// —— 格式说明弹窗（模板 JSON 由 subjectTemplate() 生成）
if (!w.includes('tplModal')) {
  w = w.replace(
    `  // —— 危险区
  panel.querySelector('#dz-clearlog')`,
    `  panel.querySelector('#ld-tpl').addEventListener('click', () => {
    const tpl = JSON.stringify(subjectTemplate(), null, 2);
    const tplModal = () => {
      openModal({
        title: '科目文件格式说明', wide: true,
        bodyHtml: \`
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
          <textarea class="sdy-textarea" id="tpl-code" style="min-height:260px;font-family:var(--font-mono);font-size:11px" readonly>\${escapeHtml(tpl)}</textarea>
          <div class="sdy-modal__acts">
            <button class="btn" data-a="copy">复制模板</button>
          </div>\`,
        onMount(box) {
          box.querySelector('[data-a="copy"]').addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(tpl); toast('模板已复制'); }
            catch { box.querySelector('#tpl-code').select(); document.execCommand('copy'); toast('已复制'); }
          });
        },
      });
    };
    tplModal();
  });

  // —— 危险区
  panel.querySelector('#dz-clearlog')`);
}

fs.writeFileSync(dir + 'workspace.js', w);
console.log('workspace patched:', w.includes('showChat'), w.includes('ld-tpl'), w.includes('tplModal'));
