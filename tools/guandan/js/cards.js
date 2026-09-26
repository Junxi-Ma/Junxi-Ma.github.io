/* ============================================================
 * cards.js — 掼蛋牌、牌型判定与比较
 * 牌面表示: { id, suit, rank }
 *   suit: 'S'♠ 'H'♥ 'D'♦ 'C'♣ 'J'(王牌)
 *   rank: 3..13, 14=A, 15=2, 16=小王, 17=大王
 * 级牌(level): 取值为 3..15 之一 (15 即打 2)
 * 逢人配(百搭): 红桃级牌，可代替除王牌外任意牌
 * ============================================================ */
'use strict';

const GD_SUITS = ['S', 'H', 'D', 'C'];
const GD_SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣', J: '' };
const GD_RANK_LABEL = {
  3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王'
};
// 升级次序：打 2 → 打 3 → ... → 打 A
const GD_LEVEL_ORDER = [15, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

function gdBuildDeck() {
  const cards = [];
  let id = 0;
  for (let d = 0; d < 2; d++) {
    for (const s of GD_SUITS) {
      for (let r = 3; r <= 15; r++) cards.push({ id: id++, suit: s, rank: r });
    }
    cards.push({ id: id++, suit: 'J', rank: 16 });
    cards.push({ id: id++, suit: 'J', rank: 17 });
  }
  return cards; // 108 张
}

function gdIsWild(card, level) { return card.suit === 'H' && card.rank === level; }
function gdIsJoker(card) { return card.suit === 'J'; }

// 比较用的“实力值”：大王 > 小王 > 级牌 > 2 > A > ... > 3
function gdRankPower(rank, level) {
  if (rank === 17) return 101;
  if (rank === 16) return 100;
  if (rank === level) return 99;
  return rank;
}
function gdCardPower(card, level) { return gdRankPower(card.rank, level); }

function gdShuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ---------------- 牌型 ----------------
 * combo: { type, cards, main, len }
 *   type: single/pair/triple/fullhouse/straight/tube/plate/bomb/flush/jokerbomb
 *   main: 比较用主值（普通牌型为实力值或序列顶牌的自然rank；炸弹为rank实力值）
 *   len:  牌数
 */
function gdMkCombo(type, cards, main) {
  return { type, cards: cards.slice(), main, len: cards.length };
}
function gdIsBomb(c) { return c.type === 'bomb' || c.type === 'flush' || c.type === 'jokerbomb'; }
// 炸弹分值：4炸<5炸<同花顺<6炸<7炸<8炸<天王炸
function gdBombScore(c) {
  if (c.type === 'jokerbomb') return 1000;
  if (c.type === 'flush') return 5.5;
  if (c.type === 'bomb') return c.len;
  return 0;
}

function gdCanBeat(a, b) {
  if (!b) return true;
  const ab = gdIsBomb(a), bb = gdIsBomb(b);
  if (ab && !bb) return true;
  if (!ab && bb) return false;
  if (ab && bb) {
    const sa = gdBombScore(a), sb = gdBombScore(b);
    if (sa !== sb) return sa > sb;
    return a.main > b.main; // 同分同类比主值（同花顺比顶牌；同张数炸弹比rank）
  }
  return a.type === b.type && a.len === b.len && a.main > b.main;
}

function gdGroupByRank(cards) {
  const g = {};
  for (const c of cards) (g[c.rank] = g[c.rank] || []).push(c);
  return g;
}

/* 分析一手选中的牌，返回所有合法解读（含百搭替换），按“强度类别”从高到低排列 */
function gdAnalyzeSelection(cards, level) {
  const n = cards.length;
  if (!n) return [];
  const wilds = cards.filter(c => gdIsWild(c, level));
  const rest = cards.filter(c => !gdIsWild(c, level));
  const w = wilds.length;
  const byRank = gdGroupByRank(rest);
  const ranks = Object.keys(byRank).map(Number).sort((a, b) => a - b);
  const out = [];
  const P = r => gdRankPower(r, level);

  // 天王炸：两小王两大王（百搭不能当王）
  if (n === 4 && w === 0) {
    const js = rest.filter(c => c.suit === 'J');
    if (js.length === 4 && js.filter(c => c.rank === 16).length === 2) {
      out.push(gdMkCombo('jokerbomb', cards, 999));
    }
  }

  // 同点数：单张/对子/三张/炸弹（百搭按同点计入）
  if (ranks.length <= 1) {
    const r = ranks.length ? ranks[0] : level; // 全百搭=级牌本身
    const main = P(r);
    if (n === 1) out.push(gdMkCombo('single', cards, main));
    else if (n === 2) out.push(gdMkCombo('pair', cards, main));
    else if (n === 3) out.push(gdMkCombo('triple', cards, main));
    else if (n >= 4) out.push(gdMkCombo('bomb', cards, main));
  }

  // 三带二
  if (n === 5 && ranks.length === 2) {
    const [a, b] = ranks;
    for (const [t, p] of [[a, b], [b, a]]) {
      const wt = 3 - byRank[t].length, wp = 2 - byRank[p].length;
      if (wt >= 0 && wp >= 0 && wt + wp === w) {
        out.push(gdMkCombo('fullhouse', cards, P(t)));
        break;
      }
    }
  }

  // 顺子 / 同花顺（5张，3~A 连续，2与级牌不可参与；百搭补位）
  if (n === 5 && w < 5) {
    const ok = ranks.length === new Set(ranks).size &&
      ranks.every(r => r >= 3 && r <= 14 && r !== level);
    if (ok && ranks.length) {
      const lo = ranks[0], hi = ranks[ranks.length - 1];
      if (hi - lo <= 4) {
        for (let s = Math.max(3, hi - 4); s <= Math.min(lo, 10); s++) {
          let missing = 0;
          for (let r = s; r < s + 5; r++) if (!byRank[r]) missing++;
          if (missing === w) {
            const flush = rest.length > 1 && rest.every(c => c.suit === rest[0].suit);
            out.push(gdMkCombo(flush ? 'flush' : 'straight', cards, s + 4));
            break;
          }
        }
      }
    }
  }

  if (n === 6 && w < 6) {
    // 三连对（木板）
    {
      const ok = ranks.every(r => r >= 3 && r <= 14 && r !== level && byRank[r].length <= 2);
      if (ok && ranks.length) {
        const lo = ranks[0], hi = ranks[ranks.length - 1];
        if (hi - lo <= 2) {
          for (let s = Math.max(3, hi - 2); s <= Math.min(lo, 12); s++) {
            let need = 0;
            for (let r = s; r < s + 3; r++) need += 2 - (byRank[r] ? byRank[r].length : 0);
            if (need === w) { out.push(gdMkCombo('tube', cards, s + 2)); break; }
          }
        }
      }
    }
    // 钢板（二连三）
    {
      const ok = ranks.every(r => r >= 3 && r <= 14 && r !== level && byRank[r].length <= 3);
      if (ok && ranks.length) {
        const lo = ranks[0], hi = ranks[ranks.length - 1];
        if (hi - lo <= 1) {
          for (let s = Math.max(3, hi - 1); s <= Math.min(lo, 13); s++) {
            let need = 0;
            for (let r = s; r < s + 2; r++) need += 3 - (byRank[r] ? byRank[r].length : 0);
            if (need === w) { out.push(gdMkCombo('plate', cards, s + 1)); break; }
          }
        }
      }
    }
  }

  // 排序：炸弹类 > 顺子类 > 三带二 > 三张 > 对子 > 单张（便于首选“最强解读”）
  const order = { jokerbomb: 9, flush: 8, bomb: 7, straight: 6, tube: 5, plate: 5, fullhouse: 4, triple: 3, pair: 2, single: 1 };
  out.sort((x, y) => (order[y.type] - order[x.type]) || (y.main - x.main));
  return out;
}

/* 从整手牌中找出所有能压住 last 的出牌方案，按代价从低到高排序。
 * 代价：普通牌型 < 炸弹；同类按 main 从小到大；尽量少用百搭。 */
function gdEnumerateBeats(hand, level, last) {
  const wilds = hand.filter(c => gdIsWild(c, level));
  const rest = hand.filter(c => !gdIsWild(c, level));
  const byRank = gdGroupByRank(rest);
  const w = wilds.length;
  const P = r => gdRankPower(r, level);
  const res = [];
  const take = (r, k) => byRank[r].slice(0, k).concat(wilds.slice(0, k - Math.min(k, byRank[r].length)));

  if (!last) return res;

  const type = last.type;
  if (type === 'single' || type === 'pair' || type === 'triple') {
    const need = last.len;
    for (const r of Object.keys(byRank).map(Number)) {
      const cnt = byRank[r].length;
      if (cnt + w < need) continue;
      if (P(r) <= last.main) continue;
      const useWild = Math.max(0, need - cnt);
      res.push(gdMkCombo(type, byRank[r].slice(0, Math.min(cnt, need)).concat(wilds.slice(0, useWild)), P(r)));
    }
    // 百搭本身可单出（级牌实力99）
    if (type === 'single' && w > 0 && P(level) > last.main) {
      res.push(gdMkCombo('single', wilds.slice(0, 1), P(level)));
    }
  } else if (type === 'fullhouse') {
    for (const t of Object.keys(byRank).map(Number)) {
      if (P(t) <= last.main) continue;
      const ct = byRank[t].length;
      for (let wt = Math.max(0, 3 - ct); wt <= Math.min(w, 3); wt++) {
        if (ct + wt !== 3) continue;
        for (const p of Object.keys(byRank).map(Number)) {
          if (p === t) continue;
          const cp = byRank[p].length;
          const wp = 2 - cp;
          if (wp < 0 || wt + wp > w) continue;
          res.push(gdMkCombo('fullhouse',
            byRank[t].slice(0, ct).concat(wilds.slice(0, wt), byRank[p].slice(0, cp), wilds.slice(wt, wt + Math.max(0, wp))), P(t)));
          break; // 每个三点只配最小的一对
        }
        break;
      }
    }
  } else if (type === 'straight' || type === 'flush') {
    const wantFlush = type === 'flush';
    for (let s = 3; s <= 10; s++) {
      const top = s + 4;
      if (top <= last.main) continue;
      let miss = 0, picks = [], ok = true;
      for (let r = s; r < s + 5; r++) {
        if (r === level || !byRank[r]) { miss++; continue; }
        let c = byRank[r][0];
        if (wantFlush) {
          const suited = byRank[r].filter(x => x.suit === (picks[0] ? picks[0].suit : x.suit));
          c = suited.find(x => !picks.length || x.suit === picks[0].suit) || null;
          if (!c) { ok = false; break; }
        }
        picks.push(c);
      }
      if (!ok || miss > w) continue;
      if (wantFlush && picks.length && !picks.every(c => c.suit === picks[0].suit)) continue;
      res.push(gdMkCombo(type, picks.concat(wilds.slice(0, miss)), top));
    }
  } else if (type === 'tube' || type === 'plate') {
    const per = type === 'tube' ? 2 : 3, span = type === 'tube' ? 3 : 2;
    const maxS = type === 'tube' ? 12 : 13;
    for (let s = 3; s <= maxS; s++) {
      const top = s + span - 1;
      if (top <= last.main) continue;
      let miss = 0, picks = [];
      for (let r = s; r < s + span; r++) {
        if (r === level || !byRank[r]) { miss += per; continue; }
        const c = Math.min(per, byRank[r].length);
        miss += per - c;
        picks.push(...byRank[r].slice(0, c));
      }
      if (miss > w) continue;
      res.push(gdMkCombo(type, picks.concat(wilds.slice(0, miss)), top));
    }
  }

  // 炸弹类（任何时刻都能压非炸弹/小炸弹）
  const bombs = gdFindBombs(hand, level);
  for (const b of bombs) if (gdCanBeat(b, last)) res.push(b);

  const cost = c => (gdIsBomb(c) ? 1000 + gdBombScore(c) * 10 + c.main / 100 : c.main + c.len / 100 +
    50 * c.cards.filter(x => gdIsWild(x, level)).length);
  res.sort((a, b) => cost(a) - cost(b));
  return res;
}

/* 找出手牌里所有炸弹（含百搭凑炸、同花顺、天王炸） */
function gdFindBombs(hand, level) {
  const wilds = hand.filter(c => gdIsWild(c, level));
  const rest = hand.filter(c => !gdIsWild(c, level));
  const byRank = gdGroupByRank(rest);
  const w = wilds.length;
  const out = [];
  // 天王炸
  const s16 = (byRank[16] || []).filter(c => c.rank === 16);
  const s17 = (byRank[17] || []).filter(c => c.rank === 17);
  if (s16.length >= 2 && s17.length >= 2) {
    out.push(gdMkCombo('jokerbomb', s16.slice(0, 2).concat(s17.slice(0, 2)), 999));
  }
  // 普通炸弹（>=4 同点，可用百搭补）
  for (const r of Object.keys(byRank).map(Number)) {
    if (r >= 16) continue;
    const cnt = byRank[r].length;
    for (let k = cnt + Math.min(w, 8 - cnt); k >= Math.max(4, cnt); k--) {
      if (k < 4) break;
      const useWild = k - cnt;
      if (useWild > w || k > 8) continue;
      out.push(gdMkCombo('bomb', byRank[r].concat(wilds.slice(0, useWild)), gdRankPower(r, level)));
    }
  }
  // 同花顺
  for (const suit of GD_SUITS) {
    for (let s = 3; s <= 10; s++) {
      let miss = 0, picks = [];
      for (let r = s; r < s + 5; r++) {
        if (r === level || !byRank[r]) { miss++; continue; }
        const c = byRank[r].find(x => x.suit === suit);
        if (c) picks.push(c); else miss++;
      }
      if (miss <= w) out.push(gdMkCombo('flush', picks.concat(wilds.slice(0, miss)), s + 4));
    }
  }
  return out;
}

/* 牌型中文名 */
function gdComboLabel(c, level) {
  const L = GD_RANK_LABEL;
  const lvl = r => GD_RANK_LABEL[r];
  switch (c.type) {
    case 'single': return '单张';
    case 'pair': return '对子';
    case 'triple': return '三张';
    case 'fullhouse': return '三带二';
    case 'straight': return '顺子';
    case 'tube': return '三连对';
    case 'plate': return '钢板';
    case 'bomb': return c.len + '张炸弹';
    case 'flush': return '同花顺';
    case 'jokerbomb': return '天王炸';
    default: return c.type;
  }
}

// Node 环境导出（用于单测）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    gdBuildDeck, gdIsWild, gdCardPower, gdRankPower, gdShuffle, gdAnalyzeSelection,
    gdCanBeat, gdIsBomb, gdBombScore, gdEnumerateBeats, gdFindBombs, gdComboLabel,
    GD_LEVEL_ORDER, GD_RANK_LABEL, GD_SUIT_SYMBOL
  };
}
