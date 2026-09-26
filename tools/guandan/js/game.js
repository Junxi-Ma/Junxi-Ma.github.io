/* ============================================================
 * game.js — 对局流程引擎
 * 模式：shengji（升级：双下+3/一三+2/一四+1，进贡，打到A过A获胜）
 *      daizi（带资：每局按名次结算 100/200/300，不进贡，每局重抽队友，固定打2）
 * ============================================================ */
'use strict';

const Game = {
  S: null,
  running: false,
  waitTimer: null,
  gen: 0,        // 对局世代号：重新开桌后，上一场残留的异步循环会因世代不符而自行退出

  settings: {
    speed: 1,          // AI 出牌间隔倍率
    hintEnabled: true
  },

  sleep(ms) { return new Promise(r => setTimeout(r, ms / this.settings.speed)); },

  /* ---------------- 开局 ---------------- */
  async start(cfg) {
    // cfg: {mode, aiSkill, seats:[personaIdx x3 → 座位1,2,3], hintEnabled, speed}
    this.gen++;                 // 作废上一场所有挂起的异步循环
    this.disarmWaitTimer();
    const personas = [null, ...cfg.seats.map(i => GD_PERSONAS[i])];
    this.S = {
      mode: cfg.mode,
      roundNo: 0,
      attackingTeam: 0,             // 当前级牌由哪队“打”
      teamLevel: [0, 0],            // 两队级牌下标（GD_LEVEL_ORDER）
      funds: [0, 0, 0, 0],
      players: [0, 1, 2, 3].map(i => ({
        idx: i,
        isAI: i !== 0,
        persona: personas[i],
        name: i === 0 ? '你' : personas[i].name,
        skill: i === 0 ? 0 : cfg.aiSkill,
        team: (i % 2 === 0) ? 0 : 1,
        hand: [], finishRank: 0
      })),
      prevResult: null,
      playedCards: [],
      finishOrder: [],
      lastPlay: null, lastPlayer: -1, passes: 0, current: 0, leader: 0,
      seatTrick: [null, null, null, null],
      level: 15, roundOver: false, matchOver: false
    };
    this.settings.hintEnabled = cfg.hintEnabled;
    this.settings.speed = cfg.speed || 1;
    PersonaChat.setSeatPersonas(personas);
    this.running = true;
    this.newRound();
  },

  teamOf(seat) { return this.S.players[seat].team; },
  partnerOf(seat) { return this.S.players.find(p => p.idx !== seat && p.team === this.teamOf(seat)).idx; },
  opponentsOf(seat) { return this.S.players.filter(p => p.team !== this.teamOf(seat)).map(p => p.idx); },

  levelText() { return GD_RANK_LABEL[this.S.level]; },

  /* ---------------- 一局 ---------------- */
  async newRound() {
    const S = this.S, gen = this.gen;
    S.roundNo++;
    S.roundOver = false;
    S.playedCards = [];
    S.finishOrder = [];
    S.lastPlay = null; S.lastPlayer = -1; S.passes = 0;
    S.seatTrick = [null, null, null, null];
    S.players.forEach(p => { p.hand = []; p.finishRank = 0; });

    // 带资：每局重洗 AI 座位（队友随机）
    if (S.mode === 'daizi' && S.roundNo > 1) this.reshuffleSeats();

    S.level = S.mode === 'daizi' ? 15 : GD_LEVEL_ORDER[S.teamLevel[S.attackingTeam]];

    // 发牌
    const deck = gdShuffle(gdBuildDeck());
    for (let i = 0; i < 108; i++) S.players[i % 4].hand.push(deck[i]);
    S.players.forEach(p => p.hand.sort((a, b) => gdCardPower(b, S.level) - gdCardPower(a, S.level)));

    UI.onRoundStart();
    UI.renderAll();

    // 进贡
    if (S.mode === 'shengji' && S.prevResult) {
      await this.doTribute();
      if (!this.running || this.gen !== gen) return;
    }

    // 决定先手
    if (S.roundNo === 1 && !S.prevResult) {
      const h3 = S.players.find(p => p.hand.some(c => c.suit === 'H' && c.rank === 3));
      S.leader = h3 ? h3.idx : Math.floor(Math.random() * 4);
      UI.banner(`随机开局，${S.players[S.leader].name} 持有红桃3先出`);
    } else if (S.prevResult) {
      // 带资：头游先出；升级：双下头游先出，否则末游（进贡方）先出
      S.leader = (S.mode === 'daizi' || S.prevResult.double) ? S.prevResult.head : S.prevResult.last;
      UI.banner(`${S.players[S.leader].name} 先出`);
    }
    S.current = S.leader;
    UI.renderAll();
    await this.sleep(600);
    if (!this.running || this.gen !== gen) return;
    this.runLoop();
  },

  /* 带资模式：每局重排三名 AI 的座位 → 队友随机变化（玩家固定坐 0 号位）
   * 资金跟着角色走，而不是跟着座位走，这样“谁赢麻了”才有意义 */
  reshuffleSeats() {
    const S = this.S;
    const slots = [1, 2, 3].map(i => ({ persona: S.players[i].persona, funds: S.funds[i] }));
    gdShuffle(slots);
    for (let k = 0; k < 3; k++) {
      const seat = k + 1;
      S.players[seat].persona = slots[k].persona;
      S.players[seat].name = slots[k].persona.name;
      S.funds[seat] = slots[k].funds;
    }
    PersonaChat.setSeatPersonas([null, ...slots.map(s => s.persona)]);
    UI.toast(`新一局队友：${S.players[2].name}`);
  },

  /* ---------------- 进贡 ---------------- */
  async doTribute() {
    const S = this.S, gen = this.gen, r = S.prevResult, level = S.level;
    const losers = r.double
      ? this.opponentsOf(r.head)
      : [r.last];
    // 抗贡：进贡方合计持有两张大王
    const bigJokers = losers.flatMap(i => S.players[i].hand).filter(c => c.rank === 17).length;
    await this.sleep(500);
    if (bigJokers >= 2) {
      UI.banner(`双大王在手，抗贡！本局不进贡`);
      losers.forEach(i => { if (S.players[i].isAI) PersonaChat.onEvent('tribute', i, { extra: '你们抗贡了，不用进贡' }); });
      await this.sleep(1200);
      return;
    }
    if (r.double) {
      // 双下：两名输家各进贡最大牌，大的给头游、小的给二游；各还一张≤10
      const gives = [];
      for (const g of losers) {
        const c = await this.chooseTributeCard(g);
        if (!this.running || this.gen !== gen || !c) return;
        gives.push({ g, c });
      }
      gives.sort((a, b) => gdCardPower(b.c, level) - gdCardPower(a.c, level));
      const receivers = [r.head, r.second];
      for (let i = 0; i < 2; i++) {
        this.moveCard(gives[i].g, receivers[i], gives[i].c);
        UI.banner(`${S.players[gives[i].g].name} 向 ${S.players[receivers[i]].name} 进贡 ${this.cardText(gives[i].c)}`);
        await this.sleep(900);
        if (!this.running || this.gen !== gen) return;
        const back = await this.chooseReturnCard(receivers[i]);
        if (!this.running || this.gen !== gen || !back) return;
        this.moveCard(receivers[i], gives[i].g, back);
        UI.banner(`${S.players[receivers[i]].name} 还贡 ${this.cardText(back)}`);
        await this.sleep(900);
      }
    } else {
      const c = await this.chooseTributeCard(r.last);
      if (!this.running || this.gen !== gen || !c) return;
      this.moveCard(r.last, r.head, c);
      UI.banner(`${S.players[r.last].name} 向 ${S.players[r.head].name} 进贡 ${this.cardText(c)}`);
      await this.sleep(900);
      if (!this.running || this.gen !== gen) return;
      const back = await this.chooseReturnCard(r.head);
      if (!this.running || this.gen !== gen || !back) return;
      this.moveCard(r.head, r.last, back);
      UI.banner(`${S.players[r.head].name} 还贡 ${this.cardText(back)}`);
      await this.sleep(900);
    }
    UI.renderAll();
  },

  cardText(c) { return (c.suit === 'J' ? '' : GD_SUIT_SYMBOL[c.suit]) + GD_RANK_LABEL[c.rank]; },

  moveCard(from, to, card) {
    const S = this.S;
    const i = S.players[from].hand.findIndex(c => c.id === card.id);
    if (i >= 0) S.players[from].hand.splice(i, 1);
    S.players[to].hand.push(card);
    S.players[to].hand.sort((a, b) => gdCardPower(b, S.level) - gdCardPower(a, S.level));
  },

  async chooseTributeCard(seat) {
    const S = this.S, p = S.players[seat];
    const eligible = c => !gdIsWild(c, S.level);
    if (p.isAI) {
      const pool = p.hand.filter(eligible);
      pool.sort((a, b) => gdCardPower(b, S.level) - gdCardPower(a, S.level));
      PersonaChat.onEvent('tribute', seat, { extra: '你要进贡一张最大的牌' });
      return pool[0];
    }
    // 玩家：从最大牌中选一张
    const pool = p.hand.filter(eligible);
    const maxPow = Math.max(...pool.map(c => gdCardPower(c, S.level)));
    const top = pool.filter(c => gdCardPower(c, S.level) === maxPow);
    return UI.pickCard('选择一张牌进贡（须为最大牌）', c => top.some(t => t.id === c.id));
  },

  async chooseReturnCard(seat) {
    const S = this.S, p = S.players[seat];
    const eligible = c => c.suit !== 'J' && c.rank <= 10 && c.rank !== S.level && !gdIsWild(c, S.level);
    const pool = p.hand.filter(eligible).sort((a, b) => gdCardPower(a, S.level) - gdCardPower(b, S.level));
    if (p.isAI) {
      if (pool.length) return pool[0];
      return p.hand.slice().sort((a, b) => gdCardPower(a, S.level) - gdCardPower(b, S.level))[0];
    }
    if (!pool.length) { // 极端情况：手里全是大牌，直接还最小的一张
      return p.hand.slice().sort((a, b) => gdCardPower(a, S.level) - gdCardPower(b, S.level))[0];
    }
    return UI.pickCard('选择一张牌还贡（须为10及以下）', eligible);
  },

  /* ---------------- 出牌主循环 ---------------- */
  async runLoop() {
    const S = this.S, gen = this.gen;
    while (this.running && this.gen === gen && !S.roundOver) {
      const idx = S.current;
      const p = S.players[idx];
      UI.setTurn(idx);
      let action = null;
      if (p.isAI) {
        await this.sleep(700 + Math.random() * 700);
        if (!this.running || this.gen !== gen || S.roundOver) return;
        action = this.validateAI(p, AIEngine.decide(S, idx));
      } else {
        this.armWaitTimer();
        action = await UI.getPlayerAction();
        this.disarmWaitTimer();
        if (!this.running || this.gen !== gen || S.roundOver) return;
      }
      this.applyPlay(idx, action);
      UI.renderAll();
      if (S.roundOver) break;
      // 轮转
      const activeOthers = S.players.filter(q => !q.finishRank && q.idx !== S.lastPlayer).length;
      if (S.lastPlay && S.passes >= activeOthers) {
        // 一轮结束，最后出牌者获得出牌权（已走完则顺延）
        S.seatTrick = [null, null, null, null];
        const winner = S.lastPlayer;
        S.lastPlay = null; S.passes = 0;
        S.current = S.players[winner].finishRank ? this.nextActive(winner) : winner;
        UI.banner(`${S.players[winner].name} 拿下一轮`);
        UI.renderAll();
        await this.sleep(500);
      } else {
        S.current = this.nextActive(idx);
      }
    }
    if (this.running && S.roundOver) this.finishRound();
  },

  armWaitTimer() {
    this.disarmWaitTimer();
    this.waitTimer = setTimeout(() => {
      const ais = [1, 2, 3].filter(i => !this.S.players[i].finishRank);
      if (ais.length) PersonaChat.onEvent('wait', ais[Math.floor(Math.random() * ais.length)], {});
    }, 22000);
  },
  disarmTimerPublic() { this.disarmWaitTimer(); },
  disarmWaitTimer() { if (this.waitTimer) { clearTimeout(this.waitTimer); this.waitTimer = null; } },

  nextActive(from) {
    const S = this.S;
    let i = from;
    do { i = (i + 1) % 4; } while (S.players[i].finishRank);
    return i;
  },

  validateAI(p, action) {
    const S = this.S;
    const leading = !S.lastPlay;
    if (!action) {
      if (leading) { // 首出不能 pass，兜底出最小单张
        const c = p.hand.slice().sort((a, b) => gdCardPower(a, S.level) - gdCardPower(b, S.level))[0];
        return gdMkCombo('single', [c], gdRankPower(c.rank, S.level));
      }
      return null;
    }
    const ids = new Set(p.hand.map(c => c.id));
    if (!action.cards.every(c => ids.has(c.id))) return leading ? this.validateAI(p, null) : null;
    if (!leading && !gdCanBeat(action, S.lastPlay)) return null;
    return action;
  },

  applyPlay(idx, combo) {
    const S = this.S, p = S.players[idx];
    if (combo) {
      const ids = new Set(combo.cards.map(c => c.id));
      p.hand = p.hand.filter(c => !ids.has(c.id));
      S.playedCards.push(...combo.cards);
      S.lastPlay = combo; S.lastPlayer = idx; S.passes = 0;
      S.seatTrick[idx] = combo;
      // 闲聊
      if (p.isAI) {
        PersonaChat.onEvent('play', idx, { what: gdComboLabel(combo, S.level), levelText: this.levelText() });
      }
      if (gdIsBomb(combo)) {
        const others = [0, 1, 2, 3].filter(i => i !== idx && S.players[i].isAI && !S.players[i].finishRank);
        if (others.length) PersonaChat.onEvent('bomb', others[Math.floor(Math.random() * others.length)],
          { what: gdComboLabel(combo, S.level) });
      }
    } else {
      S.passes++;
      S.seatTrick[idx] = 'pass';
      if (p.isAI) PersonaChat.onEvent('pass', idx, {});
    }
    // 走完
    if (!p.hand.length && !p.finishRank) {
      p.finishRank = S.finishOrder.length + 1;
      S.finishOrder.push(idx);
      S.seatTrick[idx] = combo || 'pass';
      if (p.isAI) PersonaChat.onEvent('finish', idx, {});
      this.checkRoundOver();
    }
  },

  checkRoundOver() {
    const S = this.S;
    // 某队两人都走完 → 直接结束
    for (const t of [0, 1]) {
      const members = S.players.filter(p => p.team === t);
      if (members.every(p => p.finishRank)) { S.roundOver = true; break; }
    }
    if (!S.roundOver && S.finishOrder.length >= 3) {
      const rest = S.players.find(p => !p.finishRank);
      rest.finishRank = 4;
      S.finishOrder.push(rest.idx);
      S.roundOver = true;
    }
    if (S.roundOver) {
      // 给未排名的补名次（双下时对手按剩余牌数排）
      const unranked = S.players.filter(p => !p.finishRank)
        .sort((a, b) => a.hand.length - b.hand.length);
      for (const p of unranked) {
        p.finishRank = S.finishOrder.length + 1;
        S.finishOrder.push(p.idx);
      }
    }
  },

  /* ---------------- 结算 ---------------- */
  async finishRound() {
    const S = this.S, gen = this.gen;
    const head = S.finishOrder[0];
    const headTeam = this.teamOf(head);
    const partner = this.partnerOf(head);
    const partnerRank = S.players[partner].finishRank;
    const double = partnerRank === 2;
    const last = S.finishOrder[3];
    const second = S.finishOrder[1];

    S.prevResult = { head, second, last, double, headTeam };

    let summary = { head, partnerRank, double, headTeam, lines: [] };
    const RANK_TXT = ['头游', '二游', '三游', '末游'];
    summary.lines.push(`头游：${S.players[head].name}（${headTeam === 0 ? '我方' : '对方'}）`);
    summary.lines.push(`名次：${S.finishOrder.map((s, i) => `${RANK_TXT[i]} ${S.players[s].name}`).join(' / ')}`);

    if (S.mode === 'shengji') {
      const gain = double ? 3 : partnerRank === 3 ? 2 : 1;
      const lvIdx = S.teamLevel[headTeam];
      S.attackingTeam = headTeam;
      if (lvIdx === GD_LEVEL_ORDER.length - 1) {
        // 打A：需头游且队友非末游才过A
        if (partnerRank <= 3) {
          summary.lines.push(`打A成功！${headTeam === 0 ? '我方' : '对方'}拿下整场！`);
          summary.matchWinner = headTeam;
        } else {
          summary.lines.push(`打A失败（队友末游），继续打A`);
        }
      } else {
        S.teamLevel[headTeam] = Math.min(GD_LEVEL_ORDER.length - 1, lvIdx + gain);
        const lvl = GD_RANK_LABEL[GD_LEVEL_ORDER[S.teamLevel[headTeam]]];
        summary.lines.push(`${headTeam === 0 ? '我方' : '对方'}升 ${gain} 级，下局打 ${lvl}`);
      }
      summary.lines.push(`当前级牌：我方 ${GD_RANK_LABEL[GD_LEVEL_ORDER[S.teamLevel[0]]]} / 对方 ${GD_RANK_LABEL[GD_LEVEL_ORDER[S.teamLevel[1]]]}`);
    } else {
      const stake = double ? 300 : partnerRank === 3 ? 200 : 100;
      for (const p of S.players) {
        S.funds[p.idx] += (p.team === headTeam ? stake : -stake);
      }
      summary.stake = stake;
      summary.lines.push(`${headTeam === 0 ? '我方' : '对方'}赢 ${stake}（双下300 / 一三200 / 一四100）`);
      summary.lines.push(`你的资金：${S.funds[0] >= 0 ? '+' : ''}${S.funds[0]}`);
    }

    // 闲聊：胜负感叹
    S.players.forEach(p => {
      if (!p.isAI) return;
      PersonaChat.onEvent(p.team === headTeam ? 'win' : 'lose', p.idx,
        { extra: S.mode === 'daizi' ? `输赢 ${summary.stake}` : '', levelText: this.levelText() });
    });

    UI.renderAll();
    await UI.onRoundEnd(summary);
    if (!this.running || this.gen !== gen) return;
    if (summary.matchWinner !== undefined) {
      await UI.onMatchEnd(summary.matchWinner === 0);
      this.running = false;
      UI.backToSetup();
      return;
    }
    this.newRound();
  },

  requestHint() {
    const S = this.S;
    if (!S || S.current !== 0 || S.roundOver) return null;
    return AIEngine.hint(S, 0);
  },

  quit() {
    this.running = false;
    this.gen++;
    this.disarmWaitTimer();
    if (typeof UI !== 'undefined' && UI.abortPromises) UI.abortPromises();
  }
};
