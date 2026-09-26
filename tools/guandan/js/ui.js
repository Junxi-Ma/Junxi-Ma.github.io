/* ============================================================
 * ui.js — 界面：设置页 / 牌桌渲染 / 自由拖拽理牌 / 聊天 / 弹窗
 * ============================================================ */
'use strict';

const UI = {
  handCols: [],          // 玩家手牌列 [[card,...],...]（card 与 Game 手牌同对象）
  selected: new Set(),   // 选中的牌 id
  playerResolve: null,
  pickMode: null,        // {eligible, resolve}
  drag: null,
  bubbleTimers: {},
  bannerTimer: null,
  toastTimer: null,

  $: id => document.getElementById(id),

  settings: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    chatFreq: 1,
    hintEnabled: true,
    speed: 1,
    mode: 'shengji',
    aiSkill: 2,
    picked: ['laozhang', 'lajiao', 'lele'],
    seatMap: ['laozhang', 'lajiao', 'lele'] // 座位1,2,3 上的 persona id
  },

  /* ==================== 初始化 ==================== */
  init() {
    this.loadSettings();
    this.buildPersonaGrid();
    this.fillSetupForm();
    this.wireSetup();
    this.wireGame();
    PersonaChat.init(this.settings, {
      append: (seat, text) => this.chatAppend(seat, text),
      system: text => this.chatSystem(text)
    });
  },

  loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('gd-settings-v1') || 'null');
      if (s) Object.assign(this.settings, s);
    } catch (e) { /* ignore */ }
  },
  saveSettings() {
    try { localStorage.setItem('gd-settings-v1', JSON.stringify(this.settings)); } catch (e) {}
  },

  /* ---------------- 设置页 ---------------- */
  buildPersonaGrid() {
    const grid = this.$('gd-persona-grid');
    grid.innerHTML = '';
    GD_PERSONAS.forEach(p => {
      const el = document.createElement('div');
      el.className = 'gd-persona';
      el.style.setProperty('--pc', p.color);
      el.dataset.pid = p.id;
      el.innerHTML = `<div class="gd-avatar"><img src="${p.avatar}" alt=""></div>
        <div><b>${p.name}</b><span>${p.desc}</span></div>`;
      el.addEventListener('click', () => this.togglePersona(p.id, el));
      grid.appendChild(el);
    });
    this.refreshPersonaPicks();
  },

  togglePersona(pid, el) {
    const arr = this.settings.picked;
    const i = arr.indexOf(pid);
    if (i >= 0) arr.splice(i, 1);
    else {
      if (arr.length >= 3) { this.toast('最多选 3 位牌友'); return; }
      arr.push(pid);
    }
    this.refreshPersonaPicks();
    this.saveSettings();
  },

  refreshPersonaPicks() {
    document.querySelectorAll('.gd-persona').forEach(el => {
      el.classList.toggle('picked', this.settings.picked.includes(el.dataset.pid));
    });
    const assign = this.$('gd-seat-assign');
    if (this.settings.picked.length === 3) {
      assign.hidden = false;
      // seatMap 修正为合法排列
      const p = this.settings.picked;
      let map = this.settings.seatMap.filter(id => p.includes(id));
      for (const id of p) if (!map.includes(id)) map.push(id);
      this.settings.seatMap = map.slice(0, 3);
      [1, 2, 3].forEach(seat => {
        const sel = this.$('gd-seat-' + seat);
        sel.innerHTML = p.map(id => {
          const pe = GD_PERSONAS.find(x => x.id === id);
          return `<option value="${id}">${pe.name}</option>`;
        }).join('');
        sel.value = this.settings.seatMap[seat - 1];
      });
    } else {
      assign.hidden = true;
    }
  },

  fillSetupForm() {
    this.$('gd-api-base').value = this.settings.baseUrl || '';
    this.$('gd-api-key').value = this.settings.apiKey || '';
    this.$('gd-api-model').value = this.settings.model || '';
    this.$('gd-hint-toggle').checked = !!this.settings.hintEnabled;
    this.$('gd-speed').value = String(this.settings.speed || 1);
    document.querySelector(`input[name=gd-mode][value=${this.settings.mode}]`).checked = true;
    document.querySelector(`input[name=gd-ai][value="${this.settings.aiSkill}"]`).checked = true;
  },

  wireSetup() {
    [1, 2, 3].forEach(seat => {
      this.$('gd-seat-' + seat).addEventListener('change', e => {
        this.settings.seatMap[seat - 1] = e.target.value;
        // 防重复：若与其它座位冲突则交换
        const seen = {};
        let dup = false;
        this.settings.seatMap.forEach(id => { if (seen[id]) dup = true; seen[id] = 1; });
        if (dup) {
          const rest = this.settings.picked.filter(id => !this.settings.seatMap.includes(id) ||
            this.settings.seatMap.indexOf(id) !== this.settings.seatMap.lastIndexOf(id));
          // 简单修复：重置为 picked 顺序
          this.settings.seatMap = this.settings.picked.slice();
          [1, 2, 3].forEach(s => { this.$('gd-seat-' + s).value = this.settings.seatMap[s - 1]; });
          this.toast('座位不能重复，已自动重排');
        }
        this.saveSettings();
      });
    });
    this.$('gd-start-btn').addEventListener('click', () => this.startGame());
  },

  startGame() {
    const s = this.settings;
    s.mode = document.querySelector('input[name=gd-mode]:checked').value;
    s.aiSkill = +document.querySelector('input[name=gd-ai]:checked').value;
    s.baseUrl = this.$('gd-api-base').value.trim() || 'https://api.openai.com/v1';
    s.apiKey = this.$('gd-api-key').value.trim();
    s.model = this.$('gd-api-model').value.trim() || 'gpt-4o-mini';
    s.hintEnabled = this.$('gd-hint-toggle').checked;
    s.speed = parseFloat(this.$('gd-speed').value) || 1;
    if (s.picked.length !== 3) { this.toast('请先选择 3 位牌友'); return; }
    if (new Set(s.seatMap).size !== 3) { this.toast('座位安排有重复'); return; }
    this.saveSettings();

    PersonaChat.settings = this.settings;
    this.$('gd-setup').hidden = true;
    this.$('gd-game').hidden = false;
    this.$('gd-chat-list').innerHTML = '';
    this.$('gd-chat-note').textContent = s.apiKey
      ? '已连接 LLM，角色会用大模型自由对话。'
      : '未配置 API Key，角色使用内置台词；在「设置」中配置后可自由对话。';
    this.$('gd-mode-label').textContent = s.mode === 'shengji' ? '升级模式' : '带资模式';
    this.$('gd-btn-hint').style.display = s.hintEnabled ? '' : 'none';

    Game.start({
      mode: s.mode,
      aiSkill: s.aiSkill,
      seats: s.seatMap.map(id => GD_PERSONAS.findIndex(p => p.id === id)),
      hintEnabled: s.hintEnabled,
      speed: s.speed
    });
  },

  /* ==================== 牌桌渲染 ==================== */
  onRoundStart() {
    this.selected.clear();
    this.syncHand(true);
    this.banner(`第 ${Game.S.roundNo} 局 · 打 ${Game.levelText()}`);
  },

  renderAll() {
    const S = Game.S;
    if (!S) return;
    // 顶栏
    if (S.mode === 'shengji') {
      const lv = t => GD_RANK_LABEL[GD_LEVEL_ORDER[S.teamLevel[t]]];
      this.$('gd-level-info').textContent =
        `我方打 ${lv(0)} · 对方打 ${lv(1)} · 本局级牌 ${Game.levelText()}`;
      this.$('gd-funds-info').textContent = '';
    } else {
      this.$('gd-level-info').textContent = `固定打 2`;
      this.$('gd-funds-info').textContent = `资金 ${S.funds[0] >= 0 ? '+' : ''}${S.funds[0]}`;
    }
    // 中央
    this.$('gd-center').innerHTML =
      `<div class="gd-level-badge">${Game.levelText()}</div>
       <div class="gd-center-sub">第 ${S.roundNo} 局 · ${S.lastPlay ? '跟牌中' : '自由出牌'}</div>`;
    // 座位
    for (let i = 0; i < 4; i++) this.renderSeat(i);
    // 手牌
    if (!this.drag) { this.syncHand(false); this.renderHand(); }
    // 按钮可用性
    const myTurn = S.current === 0 && !S.roundOver && !this.pickMode;
    this.$('gd-btn-play').disabled = !myTurn;
    this.$('gd-btn-pass').disabled = !myTurn || !S.lastPlay;
  },

  renderSeat(i) {
    const S = Game.S, p = S.players[i];
    const el = this.$('gd-seat-' + i);
    const persona = p.persona;
    const avatarSrc = i === 0 ? 'img/player.jpg' : (persona ? persona.avatar : 'img/player.jpg');
    const color = i === 0 ? '#ffc03c' : (persona ? persona.color : '#ffc03c');
    const RANK_TXT = ['', '头游', '二游', '三游', '末游'];
    let trickHtml = '';
    const t = S.seatTrick[i];
    if (t === 'pass') trickHtml = '<span class="gd-pass-tag">不出</span>';
    else if (t) trickHtml = t.cards.map(c => this.cardHtml(c, true, S.level)).join('');
    const oldBubble = this.$('gd-bubble-' + i);
    const bubbleText = oldBubble ? oldBubble.textContent : '';
    const bubbleShown = oldBubble ? oldBubble.classList.contains('show') : false;

    el.classList.toggle('active', S.current === i && !S.roundOver);
    el.innerHTML = `
      <div class="gd-bubble${bubbleShown ? ' show' : ''}" id="gd-bubble-${i}"></div>
      <div class="gd-seat-trick">${trickHtml}</div>
      <div class="gd-seat-avatar-wrap" style="--pc:${color}">
        <div class="gd-seat-avatar"><img src="${avatarSrc}" alt=""></div>
        ${p.finishRank ? '' : `<div class="gd-seat-count-badge">${p.hand.length}</div>`}
      </div>
      <div class="gd-seat-namebar">
        <span class="gd-seat-name">${p.name}</span>
        <span class="gd-seat-team ${p.team === 0 ? 'ally' : 'foe'}">${p.team === 0 ? '友' : '敌'}</span>
        ${p.finishRank ? `<span class="gd-seat-rank">${RANK_TXT[p.finishRank]}</span>` : ''}
      </div>`;
    if (bubbleText) this.$('gd-bubble-' + i).textContent = bubbleText;
  },

  setTurn(idx) {
    for (let i = 0; i < 4; i++) this.$('gd-seat-' + i).classList.toggle('active', i === idx);
    if (idx === 0) this.turnTip(Game.S.lastPlay ? '轮到你：管住上家或不出' : '轮到你首出');
    else this.turnTip(`${Game.S.players[idx].name} 思考中…`);
  },

  /* ---------------- 手牌 ---------------- */
  syncHand(rebuild) {
    const S = Game.S;
    if (!S) return;
    const hand = S.players[0].hand;
    const inHand = new Set(hand.map(c => c.id));
    if (rebuild || !this.handCols.length) {
      // 按实力降序分组，每组一列
      const sorted = hand.slice().sort((a, b) => gdCardPower(b, S.level) - gdCardPower(a, S.level) || a.suit.localeCompare(b.suit));
      this.handCols = [];
      for (const c of sorted) {
        const last = this.handCols[this.handCols.length - 1];
        if (last && gdCardPower(last[0], S.level) === gdCardPower(c, S.level)) last.push(c);
        else this.handCols.push([c]);
      }
      return;
    }
    // 增量同步：移除已打出的，新进的附加到同点列或新列
    const seen = new Set();
    for (const col of this.handCols) {
      for (let i = col.length - 1; i >= 0; i--) {
        if (!inHand.has(col[i].id)) col.splice(i, 1); else seen.add(col[i].id);
      }
    }
    this.handCols = this.handCols.filter(c => c.length);
    for (const c of hand) {
      if (seen.has(c.id)) continue;
      const col = this.handCols.find(cl => gdCardPower(cl[0], S.level) === gdCardPower(c, S.level));
      if (col) col.push(c); else this.handCols.push([c]);
    }
  },

  renderHand() {
    const S = Game.S;
    const hand = this.$('gd-hand');
    hand.innerHTML = '';
    const pick = this.pickMode;
    // 自适应重叠量：列越高（张数越多）重叠越大，确保整列都显示在手牌区内
    const root = document.querySelector('.gd-page');
    const cardH = parseFloat(getComputedStyle(root).getPropertyValue('--gd-card-h')) || 108;
    const colH = this.$('gd-hand-scroll').clientHeight - 26;
    this.handCols.forEach((col, ci) => {
      const band = col.length > 1 ? Math.max(13, Math.min(34, (colH - cardH) / (col.length - 1))) : 30;
      const colEl = document.createElement('div');
      colEl.className = 'gd-col';
      colEl.dataset.col = ci;
      colEl.style.setProperty('--gd-band', band + 'px');
      col.forEach(card => {
        const el = this.buildCardEl(card, false, S.level);
        if (this.selected.has(card.id)) el.classList.add('selected');
        if (pick) {
          if (pick.eligible(card)) el.classList.add('pickable');
          else el.classList.add('dim');
        }
        el.addEventListener('pointerdown', e => this.onCardPointerDown(e, card.id));
        el.addEventListener('pointermove', e => this.onCardPointerMove(e));
        el.addEventListener('pointerup', e => this.onCardPointerUp(e, card.id));
        el.addEventListener('pointercancel', () => { this.drag = null; this.renderHand(); });
        colEl.appendChild(el);
      });
      hand.appendChild(colEl);
    });
  },

  cardHtml(c, mini, level) {
    const red = (c.suit === 'H' || c.suit === 'D') ? ' red' : '';
    const joker = c.suit === 'J';
    const cls = joker ? ` joker${c.rank === 17 ? ' big-joker' : ''}` : red;
    const wild = gdIsWild(c, level) ? '<span class="gd-c-wild">配</span>' : '';
    const suit = joker ? '' : GD_SUIT_SYMBOL[c.suit];
    const label = GD_RANK_LABEL[c.rank];
    return `<div class="gd-card${mini ? ' mini' : ''}${cls}" data-id="${c.id}">
      <span class="gd-c-rank">${label}</span>
      <span class="gd-c-suit">${suit}</span>
      <span class="gd-c-big">${joker ? (c.rank === 17 ? '🃏' : '🃟') : suit}</span>
      ${wild}</div>`;
  },
  buildCardEl(c, mini, level) {
    const t = document.createElement('template');
    t.innerHTML = this.cardHtml(c, mini, level).trim();
    return t.content.firstChild;
  },

  /* ---------------- 拖拽理牌 ---------------- */
  onCardPointerDown(e, id) {
    if (e.button !== undefined && e.button !== 0) return;
    if (this.pickMode) { this.drag = null; return; } // 进贡模式：不做拖拽，交给 pointerup 点选
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    this.drag = { id, startX: e.clientX, startY: e.clientY, active: false, ghost: null, line: null };
  },

  onCardPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 8) return;
      d.active = true;
      const src = document.querySelector(`.gd-hand .gd-card[data-id="${d.id}"]`);
      if (src) {
        src.classList.add('dragging-src');
        d.ghost = src.cloneNode(true);
        d.ghost.classList.add('gd-ghost');
        d.ghost.classList.remove('selected');
        document.body.appendChild(d.ghost);
        d.line = document.createElement('div');
        d.line.className = 'gd-insert-line';
        document.body.appendChild(d.line);
      }
    }
    if (d.ghost) {
      d.ghost.style.left = (e.clientX - 38) + 'px';
      d.ghost.style.top = (e.clientY - 54) + 'px';
    }
    this.updateDropHint(e.clientX, e.clientY);
  },

  onCardPointerUp(e, id) {
    if (this.pickMode) { this.clickCard(id); return; } // 进贡/还贡：点选
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.clearDropHint();
    if (d.ghost) d.ghost.remove();
    if (d.line) d.line.remove();
    if (!d.active) { this.clickCard(id); return; }
    // 落点计算
    const target = this.computeDropTarget(e.clientX, e.clientY);
    if (target) this.moveCardTo(d.id, target.col, target.index, target.newCol);
    this.renderHand();
  },

  locateCard(id) {
    for (let ci = 0; ci < this.handCols.length; ci++) {
      const ii = this.handCols[ci].findIndex(c => c.id === id);
      if (ii >= 0) return { ci, ii };
    }
    return null;
  },

  computeDropTarget(x, y) {
    const cols = [...document.querySelectorAll('.gd-hand .gd-col')];
    if (!cols.length) return null;
    let insertColIdx = cols.length; // 新列位置（默认最后）
    let inside = null;
    cols.forEach((colEl, i) => {
      const r = colEl.getBoundingClientRect();
      if (x >= r.left - 6 && x <= r.right + 6 && !inside) inside = { i, r };
      if (r.right < x && insertColIdx === cols.length) insertColIdx = i + 1;
    });
    if (!inside) {
      // 落在缝隙/空白：建新列
      let k = 0;
      cols.forEach((colEl, i) => { if (colEl.getBoundingClientRect().left < x) k = i + 1; });
      return { col: k, index: 0, newCol: true };
    }
    const { i, r } = inside;
    const band = parseFloat(cols[i].style.getPropertyValue('--gd-band')) || 30;
    const n = this.handCols[i].length;
    let index = Math.round((y - r.top) / band);
    index = Math.max(0, Math.min(n, index));
    return { col: i, index, newCol: false };
  },

  updateDropHint(x, y) {
    const t = this.computeDropTarget(x, y);
    document.querySelectorAll('.gd-hand .gd-col').forEach(el => el.classList.remove('drop-hint'));
    const d = this.drag;
    if (!t || !d || !d.line) { if (d && d.line) d.line.style.display = 'none'; return; }
    const cols = [...document.querySelectorAll('.gd-hand .gd-col')];
    if (t.newCol) {
      // 在列间画竖线
      const left = t.col < cols.length ? cols[t.col].getBoundingClientRect().left - 6
        : cols[cols.length - 1].getBoundingClientRect().right + 4;
      const r0 = cols[0].getBoundingClientRect();
      const bb = parseFloat(cols[0].style.getPropertyValue('--gd-band')) || 30;
      const h = r0.height + bb;
      d.line.style.display = '';
      d.line.style.width = '3px';
      d.line.style.height = h + 'px';
      d.line.style.left = left + 'px';
      d.line.style.top = r0.top + 'px';
    } else {
      const colEl = cols[t.col];
      if (!colEl) return;
      colEl.classList.add('drop-hint');
      const r = colEl.getBoundingClientRect();
      const bb = parseFloat(colEl.style.getPropertyValue('--gd-band')) || 30;
      d.line.style.display = '';
      d.line.style.width = r.width + 'px';
      d.line.style.height = '3px';
      d.line.style.left = r.left + 'px';
      d.line.style.top = (r.top + t.index * bb) + 'px';
    }
  },

  clearDropHint() {
    document.querySelectorAll('.gd-hand .gd-col').forEach(el => el.classList.remove('drop-hint'));
  },

  moveCardTo(id, colIdx, index, newCol) {
    const loc = this.locateCard(id);
    if (!loc) return;
    const [card] = this.handCols[loc.ci].splice(loc.ii, 1);
    if (!this.handCols[loc.ci].length) {
      this.handCols.splice(loc.ci, 1);
      if (colIdx > loc.ci) colIdx--;
    }
    if (newCol) {
      this.handCols.splice(colIdx, 0, [card]);
    } else {
      const col = this.handCols[colIdx];
      if (!col) { this.handCols.push([card]); return; }
      // 同列内移动时，若原位置在目标位置之前，index 需修正
      col.splice(Math.min(index, col.length), 0, card);
    }
  },

  /* ---------------- 点选 / 出牌 ---------------- */
  clickCard(id) {
    if (this.pickMode) {
      const card = Game.S.players[0].hand.find(c => c.id === id);
      if (!card || !this.pickMode.eligible(card)) { this.toast('这张牌不符合要求'); return; }
      const pm = this.pickMode;
      this.pickMode = null;
      this.banner('');
      this.renderHand();
      pm.resolve(card);
      return;
    }
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.renderHand();
  },

  getPlayerAction() {
    return new Promise(resolve => {
      this.playerResolve = resolve;
      this.selected.clear();
      this.renderHand();
      this.renderAll();
    });
  },

  resolvePlayer(combo) {
    if (!this.playerResolve) return;
    const r = this.playerResolve;
    this.playerResolve = null;
    if (combo) {
      const ids = new Set(combo.cards.map(c => c.id));
      for (const col of this.handCols)
        for (let i = col.length - 1; i >= 0; i--)
          if (ids.has(col[i].id)) col.splice(i, 1);
      this.handCols = this.handCols.filter(c => c.length);
    }
    this.selected.clear();
    this.turnTip('');
    r(combo);
  },

  abortPromises() {
    if (this.playerResolve) { const r = this.playerResolve; this.playerResolve = null; r(null); }
    if (this.pickMode) { const pm = this.pickMode; this.pickMode = null; pm.resolve(null); }
  },

  wireGame() {
    this.$('gd-btn-play').addEventListener('click', () => {
      if (!this.playerResolve) return;
      const S = Game.S;
      const cards = S.players[0].hand.filter(c => this.selected.has(c.id));
      if (!cards.length) { this.toast('先点选要出的牌'); return; }
      const combos = gdAnalyzeSelection(cards, S.level);
      if (!combos.length) { this.toast('这不是合法牌型'); return; }
      let chosen;
      if (!S.lastPlay) {
        chosen = combos[0];
      } else {
        const ok = combos.filter(c => gdCanBeat(c, S.lastPlay));
        if (!ok.length) { this.toast(`管不上：需要更大的${gdComboLabel(S.lastPlay, S.level)}或炸弹`); return; }
        ok.sort((a, b) => (gdIsBomb(a) - gdIsBomb(b)) || (a.main - b.main));
        chosen = ok[0];
      }
      this.resolvePlayer(chosen);
    });
    this.$('gd-btn-pass').addEventListener('click', () => {
      if (!this.playerResolve) return;
      if (!Game.S.lastPlay) { this.toast('你是首出，不能不出'); return; }
      this.resolvePlayer(null);
    });
    this.$('gd-btn-sort').addEventListener('click', () => {
      this.syncHand(true);
      this.selected.clear();
      this.renderHand();
    });
    this.$('gd-btn-hint').addEventListener('click', () => this.showHint());
    this.$('gd-btn-quit').addEventListener('click', () => {
      this.confirm('离桌', '确定结束当前对局并返回设置页吗？', () => {
        this.abortPromises();
        Game.quit();
        this.backToSetup();
      });
    });
    const toggleChat = () => {
      const open = this.$('gd-chat').classList.toggle('open');
      if (open) this.$('gd-btn-chat').textContent = '💬 聊天'; // 打开即清除未读标记
    };
    this.$('gd-btn-chat').addEventListener('click', toggleChat);
    this.$('gd-chat-close').addEventListener('click', () => {
      this.$('gd-chat').classList.remove('open');
      this.$('gd-btn-chat').textContent = '💬 聊天';
    });
    this.$('gd-chat-send').addEventListener('click', () => this.sendChat());
    this.$('gd-chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') this.sendChat(); });
    this.$('gd-btn-settings').addEventListener('click', () => this.openSettings());
    this.$('gd-btn-rules').addEventListener('click', () => this.openRules());
  },

  showHint() {
    if (!this.settings.hintEnabled) { this.toast('提示功能已在设置中关闭'); return; }
    if (!Game.S || Game.S.current !== 0 || Game.S.roundOver) { this.toast('还没轮到你'); return; }
    const combo = Game.requestHint();
    if (!combo) { this.toast('没有能管上的牌，建议不出'); return; }
    this.selected = new Set(combo.cards.map(c => c.id));
    this.renderHand();
    combo.cards.forEach(c => {
      const el = document.querySelector(`.gd-hand .gd-card[data-id="${c.id}"]`);
      if (el) {
        el.classList.add('hinted');
        setTimeout(() => el.classList.remove('hinted'), 2600);
      }
    });
    this.toast(`建议出：${gdComboLabel(combo, Game.S.level)}`);
  },

  /* ---------------- 进贡选牌 ---------------- */
  pickCard(title, eligible) {
    return new Promise(resolve => {
      this.pickMode = { eligible, resolve };
      this.banner(title, 60000);
      this.turnTip(title);
      this.renderHand();
    });
  },

  /* ---------------- 聊天 ---------------- */
  chatAppend(seat, text) {
    const p = Game.S ? Game.S.players[seat] : null;
    const persona = p && p.persona;
    const av = persona ? persona.avatar : 'img/player.jpg';
    const list = this.$('gd-chat-list');
    const el = document.createElement('div');
    el.className = 'gd-msg';
    el.style.setProperty('--pc', persona ? persona.color : '#ffc03c');
    el.innerHTML = `<div class="gd-m-avatar"><img src="${av}" alt=""></div>
      <div class="gd-m-body"><div class="gd-m-name">${p ? p.name : ''}</div>
      <div class="gd-m-text"></div></div>`;
    el.querySelector('.gd-m-text').textContent = text;
    list.appendChild(el);
    list.scrollTop = list.scrollHeight;
    // 座位气泡
    const bubble = this.$('gd-bubble-' + seat);
    if (bubble) {
      bubble.textContent = text;
      bubble.classList.add('show');
      clearTimeout(this.bubbleTimers[seat]);
      this.bubbleTimers[seat] = setTimeout(() => bubble.classList.remove('show'), 4200);
    }
    // 未打开聊天时红点提示
    if (!this.$('gd-chat').classList.contains('open')) {
      this.$('gd-btn-chat').textContent = '💬 聊天 •';
    }
  },

  chatSystem(text) {
    const list = this.$('gd-chat-list');
    const el = document.createElement('div');
    el.className = 'gd-msg sys';
    el.innerHTML = `<div class="gd-m-body"><div class="gd-m-text"></div></div>`;
    el.querySelector('.gd-m-text').textContent = text;
    list.appendChild(el);
    list.scrollTop = list.scrollHeight;
  },

  sendChat() {
    const input = this.$('gd-chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const list = this.$('gd-chat-list');
    const el = document.createElement('div');
    el.className = 'gd-msg self';
    el.innerHTML = `<div class="gd-m-body"><div class="gd-m-name">你</div><div class="gd-m-text"></div></div>`;
    el.querySelector('.gd-m-text').textContent = text;
    list.appendChild(el);
    list.scrollTop = list.scrollHeight;
    const aiSeats = Game.S ? [1, 2, 3].filter(i => Game.S.players[i].isAI) : [];
    PersonaChat.playerSpoke(text, aiSeats);
  },

  /* ---------------- 提示条 ---------------- */
  banner(text, ms = 2600) {
    const b = this.$('gd-banner');
    clearTimeout(this.bannerTimer);
    if (!text) { b.hidden = true; return; }
    b.textContent = text;
    b.hidden = false;
    if (ms < 30000) this.bannerTimer = setTimeout(() => { b.hidden = true; }, ms);
  },
  toast(text) {
    const t = this.$('gd-toast');
    clearTimeout(this.toastTimer);
    t.textContent = text;
    t.hidden = false;
    this.toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
  },
  turnTip(text) { this.$('gd-turn-tip').textContent = text || ''; },

  /* ---------------- 弹窗 ---------------- */
  modal(title, bodyHtml, actions) {
    // actions: [{label, primary, onClick}]，返回关闭函数
    this.$('gd-modal-title').textContent = title;
    this.$('gd-modal-body').innerHTML = bodyHtml;
    const box = this.$('gd-modal-actions');
    box.innerHTML = '';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.className = 'gd-btn' + (a.primary ? ' gd-btn-primary' : '');
      btn.textContent = a.label;
      btn.addEventListener('click', () => { this.closeModal(); a.onClick && a.onClick(); });
      box.appendChild(btn);
    }
    this.$('gd-modal-mask').hidden = false;
  },
  closeModal() { this.$('gd-modal-mask').hidden = true; },

  confirm(title, text, onOk) {
    this.modal(title, `<p>${text}</p>`, [
      { label: '取消' },
      { label: '确定', primary: true, onClick: onOk }
    ]);
  },

  onRoundEnd(summary) {
    return new Promise(resolve => {
      const S = Game.S;
      const RANK_TXT = ['头游', '二游', '三游', '末游'];
      const rows = S.finishOrder.map((s, i) => {
        const p = S.players[s];
        return `<div class="gd-rank-line"><span>${RANK_TXT[i]}</span><span>${p.name}${p.team === 0 ? '（我方）' : ''}</span></div>`;
      }).join('');
      const extra = summary.lines.slice(1).map(l => `<p>${l}</p>`).join('');
      const title = summary.matchWinner !== undefined
        ? (summary.matchWinner === 0 ? '🎉 过A成功，我方获胜！' : '😞 对方过A，憾负')
        : (summary.headTeam === 0 ? '✅ 本局我方拿下' : '❌ 本局对方拿下');
      this.modal(`第 ${S.roundNo} 局结束`, `<p class="gd-big-result">${title}</p>${rows}${extra}`, [
        { label: summary.matchWinner !== undefined ? '查看结果' : '下一局', primary: true, onClick: () => resolve(true) }
      ]);
    });
  },

  onMatchEnd(win) {
    return new Promise(resolve => {
      this.modal('整场结束', `<p class="gd-big-result">${win ? '🏆 恭喜，赢下整场！' : '下次再接再厉！'}</p>`, [
        { label: '返回', primary: true, onClick: () => resolve(true) }
      ]);
    });
  },

  openSettings() {
    const s = this.settings;
    this.modal('设置', `
      <div class="gd-form">
        <label class="gd-form-row"><span>API 地址</span><input id="gd2-base" type="text" value="${s.baseUrl || ''}"></label>
        <label class="gd-form-row"><span>API Key</span><input id="gd2-key" type="password" value="${s.apiKey || ''}"></label>
        <label class="gd-form-row"><span>模型</span><input id="gd2-model" type="text" value="${s.model || ''}"></label>
        <div class="gd-form-row gd-inline">
          <label><input id="gd2-hint" type="checkbox" ${s.hintEnabled ? 'checked' : ''}> 开启提示</label>
          <label>出牌速度
            <select id="gd2-speed">
              <option value="0.6" ${s.speed === 0.6 ? 'selected' : ''}>慢</option>
              <option value="1" ${s.speed === 1 ? 'selected' : ''}>标准</option>
              <option value="1.8" ${s.speed === 1.8 ? 'selected' : ''}>快</option>
            </select></label>
        </div>
        <p style="font-size:12px;color:#888">API 走 OpenAI 兼容接口，仅保存在本机浏览器 localStorage。</p>
      </div>`, [
      {
        label: '保存', primary: true, onClick: () => {
          s.baseUrl = this.$('gd2-base').value.trim();
          s.apiKey = this.$('gd2-key').value.trim();
          s.model = this.$('gd2-model').value.trim() || 'gpt-4o-mini';
          s.hintEnabled = this.$('gd2-hint').checked;
          s.speed = parseFloat(this.$('gd2-speed').value) || 1;
          Game.settings.hintEnabled = s.hintEnabled;
          Game.settings.speed = s.speed;
          this.$('gd-btn-hint').style.display = s.hintEnabled ? '' : 'none';
          this.$('gd-chat-note').textContent = s.apiKey ? '已连接 LLM，角色会用大模型自由对话。' : '未配置 API Key，角色使用内置台词。';
          this.saveSettings();
          this.toast('设置已保存');
        }
      }
    ]);
  },

  openRules() {
    this.modal('规则速览', `
      <p><b>牌型</b>：单张 / 对子 / 三张 / 三带二 / 顺子(5张) / 三连对 / 钢板(二连三) / 炸弹(≥4张) / 同花顺 / 天王炸(双小王+双大王)。</p>
      <p><b>大小</b>：大王&gt;小王&gt;级牌&gt;2&gt;A&gt;K…；炸弹大小区间：4炸&lt;5炸&lt;同花顺&lt;6炸&lt;7炸&lt;8炸&lt;天王炸。</p>
      <p><b>逢人配</b>：红桃级牌是百搭，可代替除王牌外任意牌（牌面带「配」角标）。</p>
      <p><b>升级模式</b>：双下升3级、一三升2级、一四升1级；末游向头游进贡最大牌（百搭除外），头游还一张≤10的牌；双下两人都进贡；进贡方合计持双大王可抗贡。打A时须头游且队友非末游才能过A获胜。</p>
      <p><b>带资模式</b>：每局按 双下300 / 一三200 / 一四100 结算，不进贡，每局随机换队友，固定打2。</p>
      <p><b>操作</b>：手牌按列摆放，可随意拖拽到任意列任意位置；点选出牌，「提示」由最高牌技 AI 基于公开信息分析。</p>`, [
      { label: '知道了', primary: true }
    ]);
  },

  backToSetup() {
    this.$('gd-game').hidden = true;
    this.$('gd-setup').hidden = false;
    this.$('gd-chat').classList.remove('open');
  }
};

document.addEventListener('DOMContentLoaded', () => UI.init());
