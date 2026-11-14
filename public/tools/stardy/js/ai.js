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
    return { endpoint: '', key: '', model: '', mock: true, proxy: false, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') };
  } catch {
    return { endpoint: '', key: '', model: '', mock: true, proxy: false };
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
 * 经本站 Supabase Edge Function（ai-proxy）转发请求，
 * 用于访问不支持浏览器 CORS 的 OpenAI 兼容端点（如 opencode Zen）。
 * 需要用户先登录主站（代理只服务登录用户）并在 Supabase 部署该函数。
 */
async function proxyFetch(payload) {
  const sbMod = await import('../../../assets/js/supabase.js');
  if (!sbMod.isConfigured()) throw new Error('Supabase 未配置，无法使用代理转发');
  const sb = await sbMod.getSupabase();
  const { data: sess } = await sb.auth.getSession();
  if (!sess?.session?.user) throw new Error('代理转发需要先登录本站账号（在设置页开启前请先登录）');
  const token = sess.session.access_token;
  const res = await fetch((sb.supabaseUrl || '') + '/functions/v1/ai-proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      apikey: sb.headers?.apikey || token,
    },
    body: JSON.stringify(payload),
  });
  if (res.status === 401) throw new Error('代理拒绝：登录态无效或函数未部署（见设置页部署指引）');
  return res;
}

/**
 * 调一次 chat/completions。
 * @returns {Promise<{content: string, tokens: number}>}
 */
export async function chat(messages, { task = 'chat', temperature = 0.3, maxTokens = null, jsonMode = false, system = null } = {}) {
  const cfg = loadAiConfig();

  if (cfg.mock) {
    const content = mockChat(task, messages);
    return { content, tokens: 0 };
  }

  const maxOut = maxTokens ?? (cfg.maxOut ? Number(cfg.maxOut) : null);
  const body = {
    model: cfg.model || 'gpt-4o-mini',
    messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
    temperature,
    stream: false,
  };
  if (maxOut) body.max_tokens = maxOut;
  if (jsonMode) body.response_format = { type: 'json_object' };

  let res;
  const payload = { url: endpointUrl(cfg.endpoint), body, headers: cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {} };
  try {
    res = cfg.proxy ? await proxyFetch(payload) : await fetch(endpointUrl(cfg.endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(payload.headers) },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error('网络请求失败（可能是端点跨域限制或地址写错；若端点不支持浏览器直连，可在设置里开启「经 Supabase 代理转发」）：' + e.message);
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
    // 截断：正文为空 → 多半是推理模型把 max_tokens 花在了思考上；有内容 → 交给上层解析（JSON 有截断修复）
    if (!content.trim()) {
      throw new Error('AI 输出为空：max_tokens 被模型的推理过程消耗完。请在设置里把每次处理量调大，或换用非推理（不深度思考）的模型');
    }
  }
  if (!content) throw new Error('AI 返回了空内容' + (msg.reasoning_content ? '（模型只输出了推理过程，请换用非推理模型）' : ''));
  const tokens = data.usage?.total_tokens || 0;
  addUsage(tokens);
  return { content, tokens };
}

/* ============ 高层任务 ============ */

export const SYS_STRUCT = `你是严谨的教材知识整理助手。章/节骨架已由系统按原文标题生成，你只负责把片段内容整理成【可背诵的知识点】挂到骨架下。

【输出规则】
1. 只输出"知识点"节点（不输出章/节），pid 填【章节映射】里对应章/节的 id。
2. title ≤18 字，沿用原文措辞（如"三族十属二十九类""堡状层积云""悬球状云底"），禁止自创概括标题。
3. detail 是记忆要点，用短句/分号列出：定义、数值阈值、条件、分类、对比、成因、影响——原文里会考的数字与限定词（如 "<2500m""2-3km""由内向外生长""33°""8级以上"）必须全部保留。
4. formula 仅在原文有公式时给 LaTeX（$...$ 或 $...$）；quote 从原文逐字摘录支撑句（≤50字）。原文没有的内容一律不要编造。
5. links 给知识点之间的关系，label 只能是"前置""拓展""易混"。
6. 只输出 JSON：{"nodes":[{"id","pid","title","detail","formula","quote"}],"links":[{"from","to","label"}]}`;

export const SYS_CARDS = `你是闪卡出题助手。目标：把知识点做成【可直接背诵的记忆卡】，覆盖全部会考的细节。

【必须覆盖】该知识点的：定义 / 数值与阈值 / 分类枚举 / 条件与成因 / 公式及其参数含义 / 易混对比——有什么考什么，出 3-5 张，宁多勿漏。

【好卡示例·照此风格】
✓ front:"雨层云和积雨云的降水性质有何不同？" back:"雨层云产生**连续性**降水；积雨云产生**阵性**降水（有时有冰雹和龙卷风）。"
✓ front:"低云、中云、高云按云底高度如何划分？" back:"低云 <2500m；中云 2500-6000m；高云 >6000m。"
✓ front:"热滞系数 λ 由哪些因素决定？" back:"λ=CM/(hs)：元件热容量 MC 越大、散热面积 s 越小则 λ 越大；热交换系数 h 取决于介质性质与通风量。"

【禁止】
✗ "这个单元/章节讲了什么"（章节概述题）
✗ "简述XX""谈谈XX""XX有什么意义"（空泛问法）
✗ 答案里出现原文没有的编造内容

【格式】
- kind "qa"：front 指向一个具体、唯一、可 30 秒作答的记忆点；back 完整给出（保留原文数字、限定词、并列项），可用 Markdown 与 $公式$。
- kind "cloze"：clozeText 取原文关键句用 {{c1::要背的词}} 挖空（适合背原文表述）。
- 只输出 JSON：{"cards":[{"kind","front","back","clozeText"}]}（qa 的 clozeText 为空串；cloze 的 front/back 为空串）`;

export const SYS_QUIZ = `你是测验出题助手。目标：出一道考【具体记忆点】的题，禁止章节概述题。规则：
- type "choice"：单选四项。q 题干针对一个具体考点（数值阈值/分类归属/条件成因/仪器原理要点）；干扰项应来自同类知识的常见混淆点；answer 是正确选项下标 0-3；explain 一句话解析。
- type "fill"：q 用 ____ 标出空位（挖掉的必须是关键词：数字、名称、参数）；answer 是简短参考答案。
- type "essay"：q 是针对具体知识点的简答题；answer 是参考要点（分点、每点一行，保留原文数字与限定词）；explain 给判分要点。
- 禁止："下列说法正确的是"这类空泛题干；"概述本章内容"；原文没有的编造内容。
- 只输出 JSON：{"quiz":{"type","q","opts","answer","explain"}}（fill/essay 的 opts 为空数组）`;

export const SYS_GRADE = `你是严格的阅卷老师。给定题目、参考答案要点和学生答案：
1. 按要点给分，满分 100。学生答案方向正确即可给分，关键要点缺失按比例扣分。
2. comment 用一两句话指出答对了什么、漏了哪些要点（引用参考要点中的关键词）。
只输出 JSON：{"score":85,"comment":"..."}`;

export const SYS_OCR = `你是课件转写助手。把图片中的全部文字转写为纯文本 Markdown：
- 公式用 LaTeX（行内 $...$，独立公式 $$...$$）；表格转 Markdown 表格；按原图阅读顺序转写。
- 图中是课件页时，先输出页面主标题一行。只输出转写内容，不要任何解释。`;;

/** 知识点 → 一道测验题（type 指定题型） */
export async function aiQuizForNode(node, type, onToken = null) {
  const user = `【题型】${type}\n【知识点】${node.title}\n【正文】${(node.detail || '').slice(0, 1500)}${node.formula ? '\n【公式】' + node.formula : ''}`;
  const { content, tokens } = await chat(
    [{ role: 'system', content: SYS_QUIZ }, { role: 'user', content: user }],
    { task: 'quiz', temperature: 0.5, jsonMode: true },
  );
  if (onToken) onToken(tokens);
  const parsed = parseLoose(content);
  const z = parsed.quiz || parsed;
  if (!z || !z.q || !['choice', 'fill', 'essay'].includes(z.type)) throw new Error('AI 返回的题目不完整');
  const out = {
    type: z.type,
    q: String(z.q).slice(0, 600),
    opts: Array.isArray(z.opts) ? z.opts.map((o) => String(o).slice(0, 120)) : [],
    explain: String(z.explain || '').slice(0, 400),
  };
  if (out.type === 'choice') {
    if (out.opts.length !== 4) throw new Error('选择题选项数量不对');
    const idx = Number(z.answer);
    if (!Number.isInteger(idx) || idx < 0 || idx > 3) throw new Error('选择题答案下标无效');
    out.answer = idx;
  } else {
    out.answer = String(z.answer || '').slice(0, 600);
  }
  return out;
}

/** 简答题 AI 批改 → {score, comment} */
export async function aiGradeEssay(q, reference, answer, onToken = null) {
  const { content, tokens } = await chat(
    [{
      role: 'user',
      content: `【题目】${q}\n【参考答案要点】${reference}\n【学生答案】${answer || '（空白）'}`,
    }],
    { task: 'grade', temperature: 0.2, jsonMode: true, system: SYS_GRADE },
  );
  if (onToken) onToken(tokens);
  const parsed = parseLoose(content);
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
  return { score, comment: String(parsed.comment || '').slice(0, 400) };
}

/** 单页图片 OCR（视觉模型）。imageDataUrl 为 data:image/jpeg;base64,… */
export async function aiOcrPage(imageDataUrl, { pageNo, total }, onToken = null) {
  const { content, tokens } = await chat(
    [{
      role: 'user',
      content: [
        { type: 'text', text: `转写这一页课件的文字（第 ${pageNo}/${total} 页）。` },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    }],
    { task: 'ocr', temperature: 0.1, system: SYS_OCR },
  );
  if (onToken) onToken(tokens);
  return String(content || '').trim();
}

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
    const skelId = (userMsg.match(/【(skd+)】/) || [])[1] || null;
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

  if (task === 'quiz') {
    const type = (userMsg.match(/【题型】(\w+)/) || [, 'choice'])[1];
    const title = (userMsg.match(/【知识点】(.+)/) || [, '该知识点'])[1].split('\n')[0].slice(0, 20);
    const detail = (userMsg.match(/【正文】([\s\S]*?)(\n【公式】|$)/) || [, '相关内容'])[1].slice(0, 120);
    if (type === 'choice') {
      return JSON.stringify({
        quiz: { type: 'choice', q: `（mock）关于${title}，下列说法正确的是哪一项？`, opts: [detail.slice(0, 40) || title, '说法甲', '说法乙', '说法丙'], answer: 0, explain: '（mock）正确说法即知识点原文表述。' },
      });
    }
    if (type === 'fill') {
      return JSON.stringify({
        quiz: { type: 'fill', q: `（mock）${detail.slice(0, 18)}是____的核心内容。`, answer: title, explain: '（mock）参考知识点原文。' },
      });
    }
    return JSON.stringify({
      quiz: { type: 'essay', q: `（mock）请简述${title}的要点。`, answer: '1. 要点一\n2. 要点二\n3. 要点三', explain: '（mock）按点给分，每点约 33 分。' },
    });
  }

  if (task === 'grade') {
    return JSON.stringify({ score: 66, comment: '（mock）方向正确，但漏掉了"要点二"，表述可以更完整。' });
  }

  if (task === 'ocr') {
    return '（mock OCR）本页课件文字转写示例。\n\n$$T = t_0 + k\\,\\Delta x$$\n\n- 要点一：温度测量\n- 要点二：热平衡';
  }

  return '（mock）收到。';
}
