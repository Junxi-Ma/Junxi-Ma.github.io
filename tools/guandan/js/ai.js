/* ============================================================
 * ai.js — 人机牌技引擎（非 LLM）
 * 三档水平：
 *   1 新手：经常乱出/乱pass，基本不记牌
 *   2 熟手：贪心最小压制，会拆牌，快输时才用炸
 *   3 高手：整手拆解、记关键牌、配合队友、炸弹纪律、残局处理
 * 所有决策只使用：自己的手牌 + 已打出的公共牌（无全知视角）
 * ============================================================ */
'use strict';

/* 把手牌拆解成若干组合（贪心 + 局部优化），返回 combo 列表 */
function gdDecompose(hand, level) {
  const wilds = hand.filter(c => gdIsWild(c, level));
  const rest = hand.filter(c => !gdIsWild(c, level));
  const pool = gdGroupByRank(rest);
  const combos = [];
  const take = (r, k) => pool[r].splice(0, k);
  const cnt = r => (pool[r] ? pool[r].length : 0);
  const liveRanks = () => Object.keys(pool).map(Number).filter(r => pool[r].length).sort((a, b) => a - b);

  // 天王炸
  if (cnt(16) >= 2 && cnt(17) >= 2) {
    combos.push(gdMkCombo('jokerbomb', take(16, 2).concat(take(17, 2)), 999));
  }
  // 天然炸弹（≥4 同点，王除外）
  for (const r of liveRanks()) {
    if (r >= 16) continue;
    if (cnt(r) >= 4) combos.push(gdMkCombo('bomb', take(r, cnt(r)), gdRankPower(r, level)));
  }
  // 三张 → 钢板（相邻三连）→ 三带二
  let trips = liveRanks().filter(r => cnt(r) === 3 && r < 16);
  for (let i = 0; i < trips.length - 1; i++) {
    const a = trips[i], b = trips[i + 1];
    if (b === a + 1 && a !== level && b !== level && a >= 3 && b <= 14) {
      combos.push(gdMkCombo('plate', take(a, 3).concat(take(b, 3)), b));
      trips.splice(i, 2); i = -1;
    }
  }
  for (const t of trips) {
    const pairR = liveRanks()
      .filter(r => r !== t && cnt(r) === 2 && r < 16)
      .sort((a, b) => gdRankPower(a, level) - gdRankPower(b, level))[0];
    if (pairR !== undefined) {
      combos.push(gdMkCombo('fullhouse', take(t, 3).concat(take(pairR, 2)), gdRankPower(t, level)));
    } else {
      combos.push(gdMkCombo('triple', take(t, 3), gdRankPower(t, level)));
    }
  }
  // 三连对（木板，3 连对，3~A 非级牌）
  const pairRanks = liveRanks().filter(r => cnt(r) === 2 && r < 16);
  for (let i = 0; i < pairRanks.length;) {
    let j = i;
    while (j + 1 < pairRanks.length && pairRanks[j + 1] === pairRanks[j] + 1 &&
           pairRanks[j + 1] <= 14 && pairRanks[j + 1] !== level) j++;
    const seg = pairRanks.slice(i, j + 1);
    let k = 0;
    while (seg.length - k >= 3) {
      const trio = seg.slice(k, k + 3);
      if (trio.every(r => r >= 3 && r <= 14 && r !== level)) {
        combos.push(gdMkCombo('tube',
          take(trio[0], 2).concat(take(trio[1], 2), take(trio[2], 2)), trio[2]));
        k += 3;
      } else break;
    }
    i = j + 1;
  }
  // 顺子：只用单张散牌凑（不动对子，避免拆强牌）
  let changed = true;
  while (changed) {
    changed = false;
    for (let s = 3; s <= 10; s++) {
      let ok = true;
      for (let r = s; r < s + 5; r++) {
        if (r === level || cnt(r) !== 1) { ok = false; break; }
      }
      if (ok) {
        combos.push(gdMkCombo('straight', [s, s + 1, s + 2, s + 3, s + 4].flatMap(r => take(r, 1)), s + 4));
        changed = true; break;
      }
    }
  }
  // 剩余对子、单张
  for (const r of liveRanks()) {
    while (cnt(r) >= 2) combos.push(gdMkCombo('pair', take(r, 2), gdRankPower(r, level)));
    if (cnt(r) === 1) combos.push(gdMkCombo('single', take(r, 1), gdRankPower(r, level)));
  }
  // 百搭利用：优先三变炸，其次配最小单张成级牌对，最后单出
  for (const wc of wilds) {
    const ti = combos.findIndex(c => c.type === 'triple');
    if (ti >= 0) {
      combos[ti] = gdMkCombo('bomb', combos[ti].cards.concat(wc), combos[ti].main);
      continue;
    }
    let si = -1;
    combos.forEach((c, i) => {
      if (c.type === 'single' && (si < 0 || c.main < combos[si].main)) si = i;
    });
    if (si >= 0) {
      combos[si] = gdMkCombo('pair', combos[si].cards.concat(wc), gdRankPower(level, level));
    } else {
      combos.push(gdMkCombo('single', [wc], gdRankPower(level, level)));
    }
  }
  return combos;
}

/* 记牌：统计除自己手牌与已出牌之外，外面还剩哪些关键牌（王/级牌/可能的大炸） */
function gdCountUnseen(gs, idx) {
  const seen = {};
  const add = c => { seen[c.suit + c.rank] = (seen[c.suit + c.rank] || 0) + 1; };
  gs.players[idx].hand.forEach(add);
  gs.playedCards.forEach(add);
  const remain = { 16: 2, 17: 2, level: 0 };
  remain[16] -= gs.players[idx].hand.filter(c => c.rank === 16).length +
    gs.playedCards.filter(c => c.rank === 16).length;
  remain[17] -= gs.players[idx].hand.filter(c => c.rank === 17).length +
    gs.playedCards.filter(c => c.rank === 17).length;
  remain.level = 8 - gs.players[idx].hand.filter(c => c.rank === gs.level).length -
    gs.playedCards.filter(c => c.rank === gs.level).length;
  return remain;
}

const AIEngine = {
  /* 主入口：返回 combo 或 null（不出） */
  decide(gs, idx) {
    const me = gs.players[idx];
    const last = gs.lastPlay;
    const leading = !last || gs.lastPlayer === idx;
    if (leading) return this.lead(gs, idx);
    return this.follow(gs, idx);
  },

  lead(gs, idx) {
    const me = gs.players[idx], level = gs.level, skill = me.skill;
    const combos = gdDecompose(me.hand, level);
    if (combos.length === 1) return combos[0];
    const nonBomb = combos.filter(c => !gdIsBomb(c));
    const bombs = combos.filter(gdIsBomb).sort((a, b) => gdBombScore(a) - gdBombScore(b));

    if (skill === 1) {
      const pool = nonBomb.length ? nonBomb : combos;
      return pool[Math.floor(Math.random() * pool.length)];
    }
    if (!nonBomb.length) return bombs[0]; // 满手炸弹

    // 对手有人只剩 1~2 张：高手会直接炸停并接管出牌权
    const oppMin = Math.min(...gs.players
      .filter((p, i) => i !== idx && !p.finishRank && p.team !== me.team)
      .map(p => p.hand.length), 99);
    if (skill >= 3 && oppMin <= 2 && bombs.length) return bombs[0];

    // 收尾：只剩两手牌且第二手能控场 → 先出非炸那手
    const sorted = nonBomb.slice().sort((a, b) => a.main - b.main || a.len - b.len);
    if (combos.length === 2 && bombs.length === 1) {
      // 先小后炸，防止炸完被管
      return sorted[0];
    }
    // 队友已走完（我方头游）：放开打
    // 默认：出最小的组合，把大牌留作控制
    return sorted[0];
  },

  follow(gs, idx) {
    const me = gs.players[idx], level = gs.level, skill = me.skill;
    const last = gs.lastPlay;
    const hand = me.hand;
    const beats = gdEnumerateBeats(hand, level, last);
    const lastP = gs.players[gs.lastPlayer];
    const isPartner = lastP.team === me.team;

    if (skill === 1) {
      if (!beats.length) return null;
      if (Math.random() < 0.35) return null;
      const nb = beats.filter(b => !gdIsBomb(b));
      const pool = nb.length ? nb : beats;
      return pool[Math.floor(Math.random() * Math.min(pool.length, 3))];
    }

    // 一手走完：毫不犹豫
    const finisher = beats.find(b => b.len === hand.length);
    if (finisher) return finisher;

    const nonBomb = beats.filter(b => !gdIsBomb(b));
    const bombs = beats.filter(gdIsBomb);

    if (isPartner) {
      if (skill >= 3) {
        if (lastP.hand.length <= 2) return null;              // 让队友走完
        if (gdIsBomb(last) || last.main >= 14) return null;   // 队友牌已够大
        if (Math.random() < 0.55) return null;                // 一般不压队友
      } else if (Math.random() < 0.5) return null;
      return nonBomb.length ? nonBomb[0] : null;
    }

    // 对手出牌
    const oppLeft = lastP.hand.length;
    if (nonBomb.length) {
      const pick = nonBomb[0];
      if (skill >= 2) {
        // 舍不得用王/级牌去管一张小单，且对手牌还多
        if (last.type === 'single' && last.main < 11 && pick.main >= 99 && oppLeft > 8) {
          if (Math.random() < 0.65) return null;
        }
        // 高手：对手只剩很少牌时，尽量用最小代价死死管住
        if (oppLeft <= 3) return pick;
      }
      return pick;
    }
    // 只剩炸弹能管
    if (bombs.length) {
      const threat = oppLeft <= (skill >= 3 ? 4 : 5);
      const unseen = skill >= 3 ? gdCountUnseen(gs, idx) : null;
      // 高手：确认外面没有更大威胁（王已现完）时更敢炸
      const safeBomb = skill >= 3 && unseen && unseen[16] <= 0 && unseen[17] <= 0;
      if (threat || safeBomb || gs.playedCards.length > 70) return bombs[0];
    }
    return null;
  },

  /* 给玩家的提示：以玩家视角（手牌+公共牌）用最高牌技分析 */
  hint(gs, idx) {
    const saved = gs.players[idx].skill;
    gs.players[idx].skill = 3;
    const r = this.decide(gs, idx);
    gs.players[idx].skill = saved;
    return r;
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { gdDecompose, AIEngine, gdCountUnseen };
}
