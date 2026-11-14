/**
 * Stardy — AI 客户端（OpenAI 兼容，浏览器直连，密钥只存本机 localStorage）
 *
 * 健壮性承自前身 Vue 版：JSON 围栏剥离 → 最外层括号截取 → 截断修复（括号栈
 * 补齐）、reasoning 模型空内容回退、finish_reason=length 识别、CORS/网络
 * 错误的中文提示。所有任务可用 mock 模式跑通全流程（无 Key 自测）。
 */

const CFG_KEY = 'stardy-ai-v1';
const USAGE_KEY = 'stardy-ai-usage-v1';

export function loadAiConfig() {
  try {
    return { endpoint: '', key: '', model: '', mock: true, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') };
  } catch {
    return { endpoint: '', key: '', model: '', mock: true };
  }
}

export function saveAiConfig(cfg) {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch {}
}

export function aiUsage() {
  try { return JSON.parse(localStorage.getItem(USAGE_KEY) || 'null') || { calls: 0, totalTokens: 0 }; }
  catch { return { calls: 0, totalTokens: 0 }; }
}

function addUsage(tokens) {
  const u = aiUsage();
  u.calls++;
  u.totalTokens += tokens || 0;
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch {}
}

/** 端点规范化：自动补 /v1/chat/completions */
function endpointUrl(base) {
  let e = (base || '').trim().replace(/\/+$/, '');
  if (!e) throw new Error('请先在设置里填写 API 端点');
  if (!/\/chat\/completions$/.test(e)) {
    e += /\/v\d+$/.test(e) ? '/chat/completions' : '/v1/chat/completions';
  }
  return e;
}

/* ============ JSON 提取与修复（截断容错） ============ */

export function pickJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const first = Math.min(...['{', '['].map((c) => { const i = t.indexOf(c); return i < 0 ? Infinity : i; }));
  if (first === Infinity) return null;
  const open = t[first];
  const close = open === '{' ? '}' : ']';
  const last = t.lastIndexOf(close);
  if (last > first) return t.slice(first, last + 1);
  return t.slice(first); // 可能截断，交给 repairJson
}

/** 括号栈扫描补齐截断的 JSON（字符串内的括号与转义不计） */
export function repairJson(t) {
  if (!t) return null;
  const stack = [];
  let inStr = false;
  let esc = false;
  for (const ch of t) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let s = t;
  if (inStr) s += '"';
  for (let i = stack.length - 1; i >= 0; i--) s += stack[i] === '{' ? '}' : ']';
  return s;
}

function parseLoose(text) {
  const raw = pickJson(text);
  if (!raw) throw new Error('AI 没有返回 JSON');
  try { return JSON.parse(raw); } catch {}
  try { return JSON.parse(repairJson(raw)); } catch {}
  throw new Error('AI 返回的 JSON 无法解析（已尝试截断修复）');
}

/* ============ 基础对话 ============ */

/**
 * 调一次 chat/completions。
 * @returns {Promise<{content: string, tokens: number}>}
 */
export async function chat(messages, { task = 'chat', temperature = 0.3, maxTokens = 4096, jsonMode = false } = {}) {
  const cfg = loadAiConfig();

  if (cfg.mock) {
    const content = mockChat(task, messages);
    return { content, tokens: 0 };
  }

  const body = {
    model: cfg.model || 'gpt-4o-mini',
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  let res;
  try {
    res = await fetch(endpointUrl(cfg.endpoint), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error('网络请求失败（可能是端点跨域限制或地址写错）：' + e.message);
  }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { try { detail = await res.text(); } catch {} }
    if (res.status === 401 || res.status === 403) throw new Error('API Key 无效或无权限（' + res.status + '）' + (detail ? '：' + detail : ''));
    if (res.status === 429) throw new Error('触发限流（429），稍后再试' + (detail ? '：' + detail : ''));
    // 某些中转不支持 response_format，降级重试一次
    if (jsonMode && res.status === 400 && /response_format|json_object/i.test(detail)) {
      return chat(messages, { task, temperature, maxTokens, jsonMode: false });
    }
    throw new Error('AI 请求失败（' + res.status + '）' + (detail ? '：' + detail.slice(0, 200) : ''));
  }

  const data = await res.json();
  const msg = data.choices?.[0]?.message || {};
  const content = msg.content || msg.reasoning_content || '';
  if (data.choices?.[0]?.finish_reason === 'length') {
    throw new Error('AI 输出被 max_tokens 截断，请减小每次的处理量');
  }
  if (!content) throw new Error('AI 返回了空内容');
  const tokens = data.usage?.total_tokens || 0;
  addUsage(tokens);
  return { content, tokens };
}

/* ============ 高层任务 ============ */

export const SYS_STRUCT = `你是严谨的教材知识整理助手。把给定的教材片段整理成"链式知识结构"，规则：
1. 层级不超过四层：章 → 节 → 知识点 → 细节。每个节点有自拟短 id，pid 指向父节点 id，顶层节点 pid 给 null。
2. title 不超过 20 字；detail 用一两句话讲清该点（不超过 120 字）；formula 仅在确有公式时给 LaTeX（用 $...$ 或 $$...$$ 包裹），没有则给空字符串。
3. 每个节点必须附 quote：从原文逐字摘出一句支撑该节点的话（不超过 50 字）。原文没有的内容一律不要编造。
4. links 给出节点间关系，label 只能是"前置""拓展""易混"之一，没有关系就给空数组。
5. 只输出 JSON，不要任何解释：{"nodes":[{"id","pid","title","detail","formula","quote"}],"links":[{"from","to","label"}]}`;

export const SYS_CARDS = `你是闪卡出题助手。根据给定的知识点，出 2-4 张卡片，规则：
- kind 为 "qa"：front 是一个具体、可短答的问题（禁止"简述XX""谈谈XX"这类空泛问法），back 是简洁完整的答案，可用 Markdown 与 $公式$。
- kind 为 "cloze"：clozeText 取知识点里的关键句，用 {{c1::要背的词}} 标记挖空（可多个序号 c1、c2）。
- 每张卡应能在 30 秒内作答；内容只来自给定知识点，不要编造。
- 只输出 JSON：{"cards":[{"kind","front","back","clozeText"}]}（qa 的 clozeText 为空串；cloze 的 front/back 为空串）`;

/** 片段 → 结构化节点（含溯源 quote）。返回 {nodes, links}，id 为 AI 自拟临时 id */
export async function aiStructFromChunk(chunkText, meta, onToken = null) {
  const user = `【资料：${meta.docName} · 片段 ${meta.idx + 1}/${meta.total}】\n\n${chunkText.slice(0, 6000)}`;
  const { content, tokens } = await chat(
    [{ role: 'system', content: SYS_STRUCT }, { role: 'user', content: user }],
    { task: 'struct', temperature: 0.2, jsonMode: true },
  );
  if (onToken) onToken(tokens);
  const parsed = parseLoose(content);
  const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const links = Array.isArray(parsed.links) ? parsed.links : [];
  // 清洗：title 必须有；quote 截断；label 收敛
  const ok = nodes.filter((n) => n && n.title);
  const LABELS = ['前置', '拓展', '易混'];
  const okLinks = links
    .filter((l) => l && l.from && l.to && LABELS.includes(l.label))
    .map((l) => ({ from: String(l.from), to: String(l.to), label: l.label }));
  return { nodes: ok, links: okLinks };
}

/** 知识点 → 卡片 */
export async function aiCardsForNode(node, onToken = null) {
  const user = `【知识点】${node.title}\n【正文】${(node.detail || '').slice(0, 1500)}${node.formula ? '\n【公式】' + node.formula : ''}`;
  const { content, tokens } = await chat(
    [{ role: 'system', content: SYS_CARDS }, { role: 'user', content: user }],
    { task: 'cards', temperature: 0.4, jsonMode: true },
  );
  if (onToken) onToken(tokens);
  const parsed = parseLoose(content);
  const cards = (Array.isArray(parsed.cards) ? parsed.cards : [])
    .filter((c) => c && (c.kind === 'qa' || c.kind === 'cloze'))
    .filter((c) => (c.kind === 'qa' ? c.front && c.back : c.clozeText));
  return cards;
}

/* ============ Mock 模式（无 Key 自测全流程） ============ */

/** 确定性伪随机，让 mock 输出稳定可复现 */
function seeded(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 4294967296;
  };
}

function mockChat(task, messages) {
  const userMsg = messages.map((m) => m.content).join('\n');
  const body = userMsg.split('】').pop() || userMsg;
  const rnd = seeded(body);

  if (task === 'struct') {
    const lines = body.split('\n').map((l) => l.trim()).filter((l) => l.length >= 6 && !l.startsWith('【'));
    const chunks = [];
    let cur = null;
    for (const l of lines) {
      if (/^(第[一二三四五六七八九十\d]+[章节]|[（(]?[一二三四五六七八九十\d]+[）)、.]|\d+(\.\d+)*)/.test(l) && (!cur || cur.length >= 3)) {
        cur = [l]; chunks.push(cur);
      } else {
        (cur || (cur = ['要点'], chunks.push(cur))).push(l);
      }
    }
    const groups = (chunks.length ? chunks : [['要点', ...lines.slice(0, 4)]]).slice(0, 3);
    const nodes = [];
    const links = [];
    let n = 0;
    groups.forEach((g, gi) => {
      const rootId = 'r' + gi;
      nodes.push({ id: rootId, pid: null, title: g[0].replace(/^#+\s*/, '').slice(0, 18) || ('章节 ' + (gi + 1)), detail: '（mock）本节要点概述。', formula: '', quote: (g[1] || g[0]).slice(0, 40) });
      g.slice(1, 3).forEach((line, si) => {
        nodes.push({
          id: rootId + 's' + si, pid: rootId,
          title: line.replace(/^#+\s*/, '').slice(0, 16) || '知识点',
          detail: '（mock）' + line.slice(0, 60),
          formula: si === 0 && rnd() > 0.6 ? '$$T = t_0 + k\\,\\Delta x$$' : '',
          quote: line.slice(0, 40),
        });
        if (si > 0 && rnd() > 0.5) links.push({ from: rootId + 's0', to: rootId + 's' + si, label: ['前置', '拓展', '易混'][Math.floor(rnd() * 3)] });
      });
      n++;
      void n;
    });
    return JSON.stringify({ nodes, links });
  }

  if (task === 'cards') {
    const title = (userMsg.match(/【知识点】(.+)/) || [, '该知识点'])[1].split('\n')[0].slice(0, 20);
    const detail = (userMsg.match(/【正文】([\s\S]*?)(\n【公式】|$)/) || [, '相关内容'])[1].slice(0, 120);
    return JSON.stringify({
      cards: [
        { kind: 'qa', front: `（mock）什么是${title}？`, back: detail || `${title}的核心要点。`, clozeText: '' },
        { kind: 'qa', front: `（mock）${title}有什么意义或用途？`, back: '（mock）用于理解与实际应用。', clozeText: '' },
        { kind: 'cloze', front: '', back: '', clozeText: `${detail.slice(0, 24)}是{{c1::${title}}}的关键。` },
      ],
    });
  }

  return '（mock）收到。';
}
