/* ============================================================
 * personas.js — 角色人格 + 牌桌闲聊
 * 每个角色：人设提示词（供 LLM）+ 各场景本地台词（无 API key 时的兜底）
 * LLM 走 OpenAI 兼容接口（/chat/completions），配置存 localStorage
 * ============================================================ */
'use strict';

const GD_PERSONAS = [
  {
    id: 'laozhang', name: '老张', avatar: 'img/laozhang.jpg', color: '#c98f3d',
    desc: '沉稳老炮，打了三十年牌，话不多但句句有料。',
    chattiness: 0.35,
    prompt: '你是老张，五十多岁的掼蛋老炮，打牌沉稳老练。说话简短、有江湖气，偶尔指点两句，从不大惊小怪。正在和牌友打掼蛋。',
    lines: {
      play: ['先探探路。', '这手有点意思。', '慢慢来，不急。', '牌要一张一张打。'],
      pass: ['管不上，过。', '这张有点大，让了。', '先不出。'],
      bomb: ['炸得漂亮。', '这时候用炸，有想法。', '炸弹不是这么省的。'],
      win: ['承让了。', '基本功而已。', '下把继续。'],
      lose: ['这把打得臭。', '让你一回。', '记下了，下把找回来。'],
      wait: ['想好了再出，不急。', '喝茶喝茶。'],
      finish: ['我先走一步。', '清牌了，各位自便。'],
      reply: ['嗯。', '有道理。', '打牌打牌。', '哈哈，是吧。']
    }
  },
  {
    id: 'lajiao', name: '小辣椒', avatar: 'img/lajiao.jpg', color: '#d94f4f',
    desc: '毒舌直爽，输了要吐槽，赢了要嘚瑟。',
    chattiness: 0.7,
    prompt: '你是小辣椒，性格火辣直爽的掼蛋玩家。说话带刺但无恶意，喜欢吐槽别人出牌，赢了会得意，输了会嘴硬。正在和牌友打掼蛋。',
    lines: {
      play: ['就这？', '看我怎么收拾你。', '让让你先。', '出牌能不能痛快点！'],
      pass: ['先让你一招。', '过过过。', '哼，不出就不出。'],
      bomb: ['哇，炸我？你完了！', '有炸了不起啊！', '好家伙，藏得够深。'],
      win: ['哈哈哈哈哈不好意思啦～', '赢你们跟玩似的。', '还有谁！'],
      lose: ['不算不算，这把手感不好。', '你们运气好而已！', '下把我认真了。'],
      wait: ['快点快点，黄花菜都凉了！', '你在数牌吗？'],
      finish: ['拜拜了您嘞～', '我溜啦，你们慢慢斗。'],
      reply: ['切～', '说得好像你会打一样。', '哈哈哈这个好笑。', '少来这套。']
    }
  },
  {
    id: 'acai', name: '阿财', avatar: 'img/acai.jpg', color: '#3f9e63',
    desc: '话痨土豪，牌桌上嘴不停，输赢都乐呵呵。',
    chattiness: 0.85,
    prompt: '你是阿财，做点小生意的土豪，超级话痨，热情外向，牌品好输赢都开心，喜欢请客吃饭的话题。正在和牌友打掼蛋。',
    lines: {
      play: ['来来来，跟一张！', '这牌打得我舒服。', '兄弟姐妹们看好了！', '小钱小钱，都是小钱。'],
      pass: ['这把先垫垫底！', '不要不要。', '哈哈咱不跟。'],
      bomb: ['哎哟喂，大手笔！', '炸了炸了，刺激！', '这一炸值一顿饭！'],
      win: ['赢了赢了！晚上我请！', '今天手气挡不住啊！', '老板们承让承让！'],
      lose: ['输了输了，哈哈没事！', '破财免灾，下把再来！', '哎呀差一点点！'],
      wait: ['慢慢想，我有的是时间。', '要不要先来杯茶？'],
      finish: ['我先撤了兄弟们！', '完事儿！轻松！'],
      reply: ['哈哈对对对！', '说得在理！', '晚上我做东！', '必须的！']
    }
  },
  {
    id: 'lengmian', name: '冷面', avatar: 'img/lengmian.jpg', color: '#5b7fbe',
    desc: '高冷寡言，惜字如金，出牌干脆利落。',
    chattiness: 0.15,
    prompt: '你是冷面，极其高冷的掼蛋高手，惜字如金，说话一般不超过五个字，气场强大。正在和牌友打掼蛋。',
    lines: {
      play: ['过。', '嗯。', '跟。', '走。'],
      pass: ['……过。', '嗯。'],
      bomb: ['哦。', '有点东西。', '炸。'],
      win: ['正常。', '嗯。', '下一把。'],
      lose: ['……', '再来。', '记住你了。'],
      wait: ['快点。', '等。'],
      finish: ['完。', '先走。'],
      reply: ['嗯。', '哦。', '随你。', '……']
    }
  },
  {
    id: 'lele', name: '乐乐', avatar: 'img/lele.jpg', color: '#b06fc9',
    desc: '元气萌新，牌技一般但热情满分，表情包担当。',
    chattiness: 0.75,
    prompt: '你是乐乐，刚学会掼蛋不久的元气萌新，活泼可爱，经常看不懂局势但很兴奋，喜欢向别人请教，输了也不气馁。正在和牌友打掼蛋。',
    lines: {
      play: ['我这样出对吗？', '嘿嘿，跟一张～', '哇你们都好厉害！', '让我想想想……好了！'],
      pass: ['我……我不出啦！', '这个我管不上耶。'],
      bomb: ['哇！！炸弹！好帅！', '呜哇被炸了！', '这就是炸弹的威力吗！'],
      win: ['我们赢啦？？我们赢啦！', '耶！！！', '我居然赢了！'],
      lose: ['呜呜输了……但很好玩！', '下次我一定行！', '求带求带！'],
      wait: ['不急不急，你慢慢想～', '我等着呢！'],
      finish: ['我打完啦！', '咦？我没牌了！'],
      reply: ['哇真的吗！', '哈哈哈你好有意思！', '嗯嗯嗯！', '教我教我！']
    }
  },
  {
    id: 'zhiduo', name: '智多星', avatar: 'img/zhiduo.jpg', color: '#3da8a0',
    desc: '数据流玩家，出牌先算概率，嘴上全是分析。',
    chattiness: 0.55,
    prompt: '你是智多星，掼蛋数据流玩家，张口闭口概率、记牌、牌效，分析头头是道但偶尔翻车。正在和牌友打掼蛋。',
    lines: {
      play: ['按概率这手最划算。', '外面还剩两张王，我算过的。', '这手牌效最高。', '从期望上看应该这么出。'],
      pass: ['压不过，放弃本轮。', '期望为负，过。'],
      bomb: ['这个炸在计划之外……', '炸点选择合理。', '概率上来说你该炸了。'],
      win: ['一切尽在计算之中。', '胜率高达87%的一局。', '数据不会骗人。'],
      lose: ['小概率事件……', '方差，都是方差。', '这局是统计噪音。'],
      wait: ['你在计算吗？我也算算。', '建议从牌效角度考虑。'],
      finish: ['计算完成，收工。', '符合预期。'],
      reply: ['有道理，记下了。', '从数据上看确实。', '这个观点很有意思。', '嗯，期望值不错。']
    }
  }
];

const PersonaChat = {
  settings: null,   // {baseUrl, apiKey, model, chatFreq}
  hooks: null,      // {append(seatIdx, text), system(text)}
  seatPersonas: [], // seatIdx -> persona
  lastSpeakAt: 0,
  pending: {},      // seatIdx -> bool
  history: [],      // 最近对话（供 LLM 上下文）

  init(settings, hooks) {
    this.settings = settings;
    this.hooks = hooks;
    this.lastSpeakAt = 0;
    this.pending = {};
    this.history = [];
  },

  setSeatPersonas(list) { this.seatPersonas = list; },

  hasLLM() { return !!(this.settings && this.settings.apiKey); },

  /* 事件驱动发言。evt: play/pass/bomb/finish/win/lose/wait/tribute */
  onEvent(evt, seatIdx, detail) {
    const persona = this.seatPersonas[seatIdx];
    if (!persona) return;
    const now = Date.now();
    const gap = { play: 9000, pass: 20000, bomb: 3000, finish: 2000, win: 1000, lose: 1000, wait: 15000, tribute: 4000 }[evt] || 8000;
    if (now - this.lastSpeakAt < gap) return;
    // 说话欲望 = 角色话痨度 × 事件权重
    const evtWeight = { play: 0.5, pass: 0.25, bomb: 0.9, finish: 0.9, win: 1, lose: 1, wait: 0.5, tribute: 0.8 }[evt] || 0.4;
    if (Math.random() > persona.chattiness * evtWeight * (this.settings.chatFreq ?? 1)) return;
    this.lastSpeakAt = now;
    this.speak(seatIdx, evt, detail);
  },

  /* 生成并发出一句话 */
  async speak(seatIdx, evt, detail) {
    const persona = this.seatPersonas[seatIdx];
    if (!persona || this.pending[seatIdx]) return;
    this.pending[seatIdx] = true;
    try {
      let text = null;
      if (this.hasLLM()) {
        text = await this.askLLM(persona, this.describeEvent(evt, detail, persona));
      }
      if (!text) {
        const pool = persona.lines[evt] || persona.lines.play;
        text = pool[Math.floor(Math.random() * pool.length)];
      }
      this.pushHistory(persona.name, text);
      this.hooks.append(seatIdx, text);
    } catch (e) {
      console.warn('发言失败', e);
    } finally {
      this.pending[seatIdx] = false;
    }
  },

  describeEvent(evt, d, persona) {
    const base = `（你正在打掼蛋，当前打${d && d.levelText ? d.levelText : ''}）`;
    switch (evt) {
      case 'play': return `${base}你刚出了一手${d && d.what ? d.what : '牌'}。用一句话点评或自言自语，不超过20字，直接给台词。`;
      case 'pass': return `${base}你选择了不出。用一句话表达，不超过15字，直接给台词。`;
      case 'bomb': return `${base}刚才有人甩出了${d && d.what ? d.what : '炸弹'}。用一句话反应，不超过20字，直接给台词。`;
      case 'finish': return `${base}你的牌打完了。说一句话，不超过15字，直接给台词。`;
      case 'win': return `${base}这一局你们队赢了${d && d.extra ? '（' + d.extra + '）' : ''}。说一句话，不超过20字，直接给台词。`;
      case 'lose': return `${base}这一局你们队输了${d && d.extra ? '（' + d.extra + '）' : ''}。说一句话，不超过20字，直接给台词。`;
      case 'wait': return `${base}你在等下家出牌，等得有点久。说一句话，不超过15字，直接给台词。`;
      case 'tribute': return `${base}现在进行进贡${d && d.extra ? '：' + d.extra : ''}。说一句话，不超过20字，直接给台词。`;
      default: return `${base}随便说一句牌桌上的话，不超过15字，直接给台词。`;
    }
  },

  /* 玩家发言后，AI 们逐个考虑接话 */
  async playerSpoke(text, seatIndexes) {
    this.pushHistory('你', text);
    for (const idx of seatIndexes) {
      const persona = this.seatPersonas[idx];
      if (!persona) continue;
      const p = this.hasLLM() ? 0.9 : 0.45; // 没配 LLM 时用本地台词，接话概率低一些
      if (Math.random() > p * Math.max(0.4, persona.chattiness)) continue;
      setTimeout(async () => {
        if (this.pending[idx]) return;
        this.pending[idx] = true;
        try {
          let reply = null;
          if (this.hasLLM()) {
            reply = await this.askLLM(persona,
              `（你正在打掼蛋）牌桌上的玩家对你说：「${text}」。用角色的口吻回一句，不超过25字，直接给台词。`);
          }
          if (!reply) {
            const pool = persona.lines.reply;
            reply = pool[Math.floor(Math.random() * pool.length)];
          }
          this.pushHistory(persona.name, reply);
          this.hooks.append(idx, reply);
        } finally {
          this.pending[idx] = false;
        }
      }, 800 + Math.random() * 2500);
    }
  },

  pushHistory(who, text) {
    this.history.push({ who, text });
    if (this.history.length > 12) this.history.shift();
  },

  async askLLM(persona, userMsg) {
    const s = this.settings;
    try {
      const ctx = this.history.slice(-6).map(h => `${h.who}：${h.text}`).join('\n');
      const res = await fetch(s.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.apiKey },
        body: JSON.stringify({
          model: s.model,
          messages: [
            { role: 'system', content: persona.prompt + '只输出台词本身，不要任何解释、引号或动作描写。' + (ctx ? '\n最近牌桌对话：\n' + ctx : '') },
            { role: 'user', content: userMsg }
          ],
          max_tokens: 80,
          temperature: 0.9
        }),
        signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const txt = (data.choices && data.choices[0] && data.choices[0].message.content || '').trim();
      return txt.replace(/^["「『]|["」』]$/g, '').slice(0, 60) || null;
    } catch (e) {
      console.warn('LLM 调用失败，使用本地台词：', e);
      return null;
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GD_PERSONAS, PersonaChat };
}
