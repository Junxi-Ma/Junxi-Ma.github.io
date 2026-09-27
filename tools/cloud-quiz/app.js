/* ============================================================
 * app.js — 云的分类速记与测验
 * 两个页签：速记表（可遮罩自测）/ 测验（可配置范围题型题数，
 * 答错自动重排，错题本存 localStorage）
 * ============================================================ */
'use strict';

/* ================= 数据工具 ================= */
const genusById = id => CLOUD_GENERA.find(g => g.id === id);
const speciesById = id => CLOUD_SPECIES.find(s => s.id === id);
const familyName = id => (CLOUD_FAMILIES.find(f => f.id === id) || {}).name || id;
const morphFull = m => ({ 积: '积状', 层: '层状', 波: '波状' }[m] || m);
const suffixOf = abbr => (abbr.includes(' ') ? abbr.split(' ')[1] : '');

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ================= 错题本 / 统计（localStorage） ================= */
const CQ_STORE_KEY = 'cloud-quiz-v1';
const CQStore = {
  data: { wrong: {}, done: 0, right: 0 },
  load() {
    try {
      const raw = localStorage.getItem(CQ_STORE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && typeof d === 'object') this.data = Object.assign(this.data, d);
      }
    } catch (e) { /* 私密模式等场景忽略 */ }
  },
  save() {
    try { localStorage.setItem(CQ_STORE_KEY, JSON.stringify(this.data)); } catch (e) {}
  },
  record(type, targetId, ok) {
    this.data.done++;
    if (ok) this.data.right++;
    const qid = type + ':' + targetId;
    if (!ok) {
      const w = this.data.wrong[qid] || { n: 0, last: 0 };
      w.n++; w.last = Date.now();
      this.data.wrong[qid] = w;
    } else if (this.data.wrong[qid]) {
      delete this.data.wrong[qid];   // 答对一次即出错题本
    }
    this.save();
  },
  wrongCount() { return Object.keys(this.data.wrong).length; },
  clearWrong() { this.data.wrong = {}; this.save(); },
};
CQStore.load();

/* ================= 出题 ================= */
const CQ_TYPES = {
  abbr2cn: '简写 → 中文名',
  cn2abbr: '中文名 → 简写',
  latin2cn: '拉丁学名 → 中文名',
  sp2genus: '云类属于哪个云属',
  genus2abbr: '云属中文名 → 简写',
  abbr2genus: '云属简写 → 中文名',
  genus2family: '云属属于哪一云族',
  genus2morph: '云属的形态',
};
const SPECIES_TYPES = ['abbr2cn', 'cn2abbr', 'latin2cn', 'sp2genus'];
const GENUS_TYPES = ['genus2abbr', 'abbr2genus', 'genus2family', 'genus2morph'];

/** 从候选数组里挑 n 个与 answer(字符串)不同的干扰项，按优先级逐组取 */
function pickDistractors(groups, answer, n, allPool) {
  const seen = new Set([answer]);
  const out = [];
  for (const group of groups) {
    for (const item of shuffle(group.slice())) {
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
      if (out.length === n) return out;
    }
  }
  for (const item of shuffle(allPool.slice())) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length === n) return out;
  }
  return out;
}

const sameGenusSp = (s, genus) => CLOUD_SPECIES.filter(x => x.genus === genus && x.id !== s.id);
const sameFamilySp = (s, genus) => {
  const fam = genusById(genus).family;
  return CLOUD_SPECIES.filter(x => x.genus !== s.genus && genusById(x.genus).family === fam);
};
const sameSuffixSp = (s) => {
  const suf = suffixOf(s.abbr);
  return suf ? CLOUD_SPECIES.filter(x => x.id !== s.id && suffixOf(x.abbr) === suf) : [];
};
const genusAbbrsOf = fam => CLOUD_GENERA.filter(g => !fam || g.family === fam).map(g => g.abbr);

/** 构造一道题；pool 为当前范围允许的属 id 集合；
 *  targetSpecies/targetGenus 用于错题重练时定向复现同一题 */
function makeQuestion(type, genusIds, targetSpecies, targetGenus) {
  const genera = CLOUD_GENERA.filter(g => genusIds.includes(g.id));
  const species = CLOUD_SPECIES.filter(s => genusIds.includes(s.genus));
  const q = { type, answered: false };
  let opts, answerVal, prompt, sub = '', explain;

  if (type === 'abbr2cn' || type === 'latin2cn') {
    const s = targetSpecies || species[Math.floor(Math.random() * species.length)];
    answerVal = s.cn;
    opts = pickDistractors(
      [sameGenusSp(s, s.genus).map(x => x.cn), sameSuffixSp(s).map(x => x.cn), sameFamilySp(s, s.genus).map(x => x.cn)],
      s.cn, 3, CLOUD_SPECIES.map(x => x.cn));
    q.targetId = s.id;
    prompt = type === 'abbr2cn' ? s.abbr : s.latin;
    sub = type === 'abbr2cn' ? '这个简写对应哪类云？' : '这个拉丁学名对应哪类云？';
    explain = `${s.cn} · ${s.abbr} · ${s.latin}（${genusById(s.genus).cn}，${familyName(genusById(s.genus).family)}）`;
  } else if (type === 'cn2abbr') {
    const s = targetSpecies || species[Math.floor(Math.random() * species.length)];
    answerVal = s.abbr;
    opts = pickDistractors(
      [sameSuffixSp(s).map(x => x.abbr), sameGenusSp(s, s.genus).map(x => x.abbr), sameFamilySp(s, s.genus).map(x => x.abbr)],
      s.abbr, 3, CLOUD_SPECIES.map(x => x.abbr));
    q.targetId = s.id;
    prompt = s.cn;
    sub = '它的英文简写是？';
    explain = `${s.cn} · ${s.abbr} · ${s.latin}`;
  } else if (type === 'sp2genus') {
    const s = targetSpecies || species[Math.floor(Math.random() * species.length)];
    answerVal = genusById(s.genus).cn;
    const otherGenera = CLOUD_GENERA.filter(g => g.id !== s.genus);
    opts = pickDistractors(
      [otherGenera.filter(g => g.family === genusById(s.genus).family).map(g => g.cn),
       otherGenera.filter(g => g.morph === genusById(s.genus).morph).map(g => g.cn),
       otherGenera.map(g => g.cn)],
      answerVal, 3, CLOUD_GENERA.map(g => g.cn));
    q.targetId = s.id;
    prompt = s.cn;
    sub = '它属于哪个云属？';
    explain = `${s.cn} 属于 ${answerVal}（${s.abbr} · ${s.latin}）`;
  } else if (type === 'genus2abbr') {
    const g = targetGenus || genera[Math.floor(Math.random() * genera.length)];
    answerVal = g.abbr;
    const others = CLOUD_GENERA.filter(x => x.id !== g.id);
    opts = pickDistractors(
      [others.filter(x => x.family === g.family).map(x => x.abbr),
       others.filter(x => x.abbr[0] === g.abbr[0]).map(x => x.abbr),
       others.map(x => x.abbr)],
      g.abbr, 3, CLOUD_GENERA.map(x => x.abbr));
    q.targetId = g.id;
    prompt = g.cn;
    sub = '这个云属的英文简写是？';
    explain = `${g.cn} ${g.abbr}，${familyName(g.family)}，${morphFull(g.morph)}云`;
  } else if (type === 'abbr2genus') {
    const g = targetGenus || genera[Math.floor(Math.random() * genera.length)];
    answerVal = g.cn;
    const others = CLOUD_GENERA.filter(x => x.id !== g.id);
    opts = pickDistractors(
      [others.filter(x => x.abbr[0] === g.abbr[0]).map(x => x.cn),
       others.filter(x => x.family === g.family).map(x => x.cn),
       others.map(x => x.cn)],
      g.cn, 3, CLOUD_GENERA.map(x => x.cn));
    q.targetId = g.id;
    prompt = g.abbr;
    sub = '这个简写是哪个云属？';
    explain = `${g.cn} ${g.abbr}，${familyName(g.family)}，${morphFull(g.morph)}云`;
  } else if (type === 'genus2family') {
    const g = targetGenus || genera[Math.floor(Math.random() * genera.length)];
    answerVal = familyName(g.family);
    opts = pickDistractors([CLOUD_FAMILIES.map(f => f.name)], answerVal, 2, CLOUD_FAMILIES.map(f => f.name));
    q.targetId = g.id;
    prompt = g.cn;
    sub = '它属于哪一云族？';
    explain = `${g.cn} ${g.abbr} 属${answerVal}，${morphFull(g.morph)}云`;
  } else { // genus2morph
    const g = targetGenus || genera[Math.floor(Math.random() * genera.length)];
    answerVal = morphFull(g.morph) + '云';
    opts = pickDistractors([['积状云', '层状云', '波状云']], answerVal, 2, ['积状云', '层状云', '波状云']);
    q.targetId = g.id;
    prompt = g.cn;
    sub = '它属于哪类形态？';
    explain = `${g.cn} ${g.abbr} 属${familyName(g.family)}，${morphFull(g.morph)}云`;
  }

  opts.push(answerVal);
  shuffle(opts);
  q.prompt = prompt; q.sub = sub; q.explain = explain;
  q.options = opts;
  q.answerIdx = opts.indexOf(answerVal);
  return q;
}

function buildQueue(mode, familyId, count) {
  let genusIds = CLOUD_GENERA.map(g => g.id);
  if (familyId !== 'all') genusIds = genusIds.filter(id => genusById(id).family === familyId);
  let types;
  if (mode === 'species') types = SPECIES_TYPES;
  else if (mode === 'genus') types = GENUS_TYPES;
  else if (mode === 'wrong') {
    // 错题重练：只出错题本里的题，按记录的 type+targetId 精确复现
    const entries = Object.keys(CQStore.data.wrong)
      .map(qid => ({ type: qid.split(':')[0], targetId: qid.split(':')[1] }))
      .filter(e => CQ_TYPES[e.type]);
    shuffle(entries);
    return entries.slice(0, count).map(e => {
      const s = speciesById(e.targetId);
      const g = genusById(e.targetId);
      if (s && SPECIES_TYPES.includes(e.type)) return makeQuestion(e.type, CLOUD_GENERA.map(x => x.id), s, null);
      if (g && GENUS_TYPES.includes(e.type)) return makeQuestion(e.type, CLOUD_GENERA.map(x => x.id), null, g);
      const t = Object.keys(CQ_TYPES)[Math.floor(Math.random() * Object.keys(CQ_TYPES).length)];
      return makeQuestion(t, CLOUD_GENERA.map(x => x.id));
    });
  } else types = Object.keys(CQ_TYPES);

  const questions = [];
  const seenQids = new Set();
  let guard = 0;
  while (questions.length < count && guard < count * 30) {
    guard++;
    const type = types[Math.floor(Math.random() * types.length)];
    const q = makeQuestion(type, genusIds);
    const qid = q.type + ':' + q.targetId;
    if (seenQids.has(qid)) continue;
    seenQids.add(qid);
    questions.push(q);
  }
  return questions;
}

/* ================= 页面渲染 ================= */
const $ = id => document.getElementById(id);

const FAMILY_ACCENT = { high: 'high', mid: 'mid', low: 'low' };

/** 天空高度示意图：三族按海拔排布，点云朵跳到对应云属卡片 */
function renderSky() {
  const sky = $('cq-sky');
  sky.innerHTML = '';
  const bands = [
    { fam: 'high', height: '5000 m 以上' },
    { fam: 'mid', height: '2500 – 5000 m' },
    { fam: 'low', height: '2500 m 以下' },
  ];
  for (const band of bands) {
    const fam = CLOUD_FAMILIES.find(f => f.id === band.fam);
    const el = document.createElement('div');
    el.className = 'cq-sky-band';
    el.dataset.fam = band.fam;
    el.innerHTML = `
      <div class="cq-sky-band-head"><b>${fam.name}</b><i>${band.height}</i></div>
      <div class="cq-sky-chips">
        ${CLOUD_GENERA.filter(g => g.family === band.fam).map(g =>
          `<button type="button" class="cq-cloud" data-genus="${g.id}" title="查看 ${g.cn} 明细"><b>${g.abbr}</b>${g.cn}</button>`).join('')}
      </div>`;
    sky.appendChild(el);
  }
  const ground = document.createElement('div');
  ground.className = 'cq-sky-ground';
  ground.textContent = '地面';
  sky.appendChild(ground);

  sky.addEventListener('click', e => {
    const chip = e.target.closest('.cq-cloud');
    if (!chip) return;
    const box = document.getElementById('cq-genus-' + chip.dataset.genus);
    if (!box) return;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    box.classList.remove('is-flash');
    void box.offsetWidth;
    box.classList.add('is-flash');
  });
}

function renderLearn() {
  const wrap = $('cq-learn');
  wrap.innerHTML = '';
  for (const fam of CLOUD_FAMILIES) {
    const card = document.createElement('section');
    card.className = 'cq-fam';
    card.dataset.fam = fam.id;
    const genera = CLOUD_GENERA.filter(g => g.family === fam.id);
    const generaText = genera.map(g => g.cn + ' ' + g.abbr).join('　');
    const morphText = genera.map(g => g.morph).join('·');
    card.innerHTML = `
      <header class="cq-fam-head">
        <h3><span class="cq-fam-dot"></span>${fam.name}<small>${fam.hint}</small></h3>
        <p class="cq-fam-line">${generaText}</p>
        <p class="cq-fam-morph">形态：<b>${morphText}</b></p>
        <button class="btn btn--ghost btn--sm cq-fam-quiz" data-fam="${fam.id}" type="button">考这族 →</button>
      </header>`;
    const grid = document.createElement('div');
    grid.className = 'cq-genus-grid';
    card.appendChild(grid);
    for (const g of genera) {
      const box = document.createElement('div');
      box.className = 'cq-genus';
      box.id = 'cq-genus-' + g.id;
      const rows = CLOUD_SPECIES.filter(s => s.genus === g.id);
      box.innerHTML = `
        <div class="cq-genus-head">
          <b>${g.cn}</b><code>${g.abbr}</code>
          <span class="cq-morph cq-morph-${CLOUD_MORPH_COLOR[g.morph]}">${g.morph}</span>
        </div>
        <table class="cq-table"><tbody>
          ${rows.map(s => `
            <tr>
              <td>${s.cn}</td>
              <td class="cq-maskable" data-k="abbr"><code>${s.abbr}</code></td>
              <td class="cq-maskable" data-k="latin"><i>${s.latin}</i></td>
            </tr>`).join('')}
        </tbody></table>`;
      grid.appendChild(box);
    }
    wrap.appendChild(card);
  }
  applyMasks();
}

/* 遮罩自测：勾选后对应列打码，点击揭开 */
function applyMasks() {
  const maskAbbr = $('mask-abbr').checked;
  const maskLatin = $('mask-latin').checked;
  document.querySelectorAll('.cq-maskable').forEach(td => {
    const k = td.dataset.k;
    const on = (k === 'abbr' && maskAbbr) || (k === 'latin' && maskLatin);
    td.classList.toggle('masked', on && !td.classList.contains('revealed'));
  });
}

/* ================= 测验流程 ================= */
const Quiz = {
  queue: [], idx: 0, right: 0, wrongList: [], active: false, streak: 0, bestStreak: 0,

  start(mode, familyId, count) {
    this.queue = buildQueue(mode, familyId, count);
    if (!this.queue.length) { alert('这个范围下没有可出的题'); return; }
    this.idx = 0; this.right = 0; this.wrongList = []; this.active = false;
    this.streak = 0; this.bestStreak = 0;
    $('cq-config').hidden = true;
    $('cq-summary').hidden = true;
    $('cq-stage').hidden = false;
    this.active = true;
    this.show();
  },

  cur() { return this.queue[this.idx]; },

  show() {
    const q = this.cur();
    $('cq-progress').textContent = `第 ${this.idx + 1} / ${this.queue.length} 题`;
    $('cq-progressbar-fill').style.width = ((this.idx + 1) / this.queue.length * 100) + '%';
    this.renderScore();
    $('cq-type-tag').textContent = CQ_TYPES[q.type];
    $('cq-prompt').textContent = q.prompt;
    $('cq-prompt-sub').textContent = q.sub;
    const box = $('cq-options');
    box.innerHTML = '';
    const keys = ['A', 'B', 'C', 'D'];
    q.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cq-opt';
      btn.innerHTML = `<kbd>${keys[i]}</kbd>`;
      btn.appendChild(document.createTextNode(' ' + opt));
      btn.addEventListener('click', () => this.answer(i));
      box.appendChild(btn);
    });
    $('cq-feedback').hidden = true;
    $('cq-feedback').className = 'cq-feedback';
    $('cq-next').hidden = true;
  },

  renderScore() {
    let text = `本组答对 ${this.right}`;
    if (this.streak >= 2) text += ` · 🔥 连对 ${this.streak}`;
    $('cq-score').textContent = text;
  },

  answer(i) {
    const q = this.cur();
    if (q.answered) return;
    q.answered = true;
    const ok = i === q.answerIdx;
    const btns = [...$('cq-options').children];
    btns.forEach((b, bi) => {
      b.disabled = true;
      if (bi === q.answerIdx) b.classList.add('is-right');
      else if (bi === i) b.classList.add('is-wrong');
    });
    const fb = $('cq-feedback');
    fb.hidden = false;
    fb.className = 'cq-feedback ' + (ok ? 'is-ok' : 'is-err');
    fb.textContent = (ok ? '✓ 答对了　' : '✕ 答错了　') + q.explain;
    if (ok) {
      this.right++;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    } else {
      this.streak = 0;
      this.wrongList.push(q);
      q.missedOnce = true;
    }
    CQStore.record(q.type, q.targetId, ok);
    this.renderScore();
    $('cq-next').hidden = false;
    $('cq-next').focus();
    refreshStats();
  },

  next() {
    this.idx++;
    if (this.idx >= this.queue.length) {
      // 有答错的题 → 插队重练一遍，直到当轮全部答对
      if (this.wrongList.length) {
        for (const q of this.wrongList) q.answered = false;
        this.queue = this.queue.concat(this.wrongList);
        this.wrongList = [];
      }
    }
    if (this.idx >= this.queue.length) { this.finish(); return; }
    this.show();
  },

  finish() {
    this.active = false;
    $('cq-stage').hidden = true;
    const total = this.queue.length;
    const summary = $('cq-summary');
    summary.hidden = false;
    const rate = Math.round((this.right / total) * 100);
    const praise = rate >= 90 ? '优秀，保持这个手感！'
      : rate >= 70 ? '不错，把错题消灭掉就稳了。'
      : rate >= 40 ? '多来几轮，重点啃错题。'
      : '先去速记表遮罩背两遍，再回来战。';
    $('cq-summary-title').textContent = `本轮 ${this.right} / ${total}（${rate}%）${this.bestStreak >= 3 ? ` · 最高连对 ${this.bestStreak}` : ''}`;
    $('cq-summary-praise').textContent = praise;
    const seen = new Set();
    const lines = [];
    for (const q of this.queue) {
      const qid = q.type + ':' + q.targetId;
      if (q.missedOnce && !seen.has(qid)) {
        seen.add(qid);
        lines.push(`<li>${q.explain}</li>`);
      }
    }
    $('cq-summary-wrong').innerHTML = lines.length
      ? '<h4>本轮错过（已记入错题本）：</h4><ul>' + lines.join('') + '</ul>'
      : '<p class="cq-all-right">全对，漂亮！🎉</p>';
    refreshStats();
  },

  stop() {
    this.active = false;
    $('cq-stage').hidden = true;
    $('cq-summary').hidden = true;
    $('cq-config').hidden = false;
  },
};

/* ================= 页签 / 事件 / 键盘 ================= */
function switchTab(tab) {
  $('cq-learn-wrap').hidden = tab !== 'learn';
  $('cq-quiz-wrap').hidden = tab !== 'quiz';
  document.querySelectorAll('.cq-tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tab));
}

function refreshStats() {
  const d = CQStore.data;
  const rate = d.done ? Math.round((d.right / d.done) * 100) : null;
  $('cq-stats').textContent =
    `累计 ${d.done} 题 · 正确率 ${rate === null ? '—' : rate + '%'} · 待消灭错题 ${CQStore.wrongCount()}`;
}

document.addEventListener('DOMContentLoaded', () => {
  renderSky();
  renderLearn();
  refreshStats();

  document.querySelectorAll('.cq-tab').forEach(b =>
    b.addEventListener('click', () => switchTab(b.dataset.tab)));

  $('mask-abbr').addEventListener('change', applyMasks);
  $('mask-latin').addEventListener('change', applyMasks);
  $('mask-reveal').addEventListener('click', () => {
    document.querySelectorAll('.cq-maskable').forEach(td => {
      td.classList.remove('masked');
      td.classList.add('revealed');
    });
  });
  $('mask-reset').addEventListener('click', () => {
    document.querySelectorAll('.cq-maskable').forEach(td => td.classList.remove('revealed'));
    applyMasks();
  });
  $('cq-learn').addEventListener('click', e => {
    const td = e.target.closest('.cq-maskable');
    if (td && td.classList.contains('masked')) {
      td.classList.add('revealed');
      td.classList.remove('masked');
    }
  });
  // 族头部的「考这族」：限定范围直接开考
  $('cq-learn').addEventListener('click', e => {
    const btn = e.target.closest('.cq-fam-quiz');
    if (!btn) return;
    $('cq-family').value = btn.dataset.fam;
    switchTab('quiz');
    Quiz.start($('cq-mode').value, btn.dataset.fam, Number($('cq-count').value));
  });

  $('cq-start').addEventListener('click', () => {
    Quiz.start($('cq-mode').value, $('cq-family').value, Number($('cq-count').value));
  });
  $('cq-quit').addEventListener('click', () => Quiz.stop());
  $('cq-back').addEventListener('click', () => Quiz.stop());
  $('cq-next').addEventListener('click', () => Quiz.next());
  $('cq-again').addEventListener('click', () => {
    Quiz.start($('cq-mode').value, $('cq-family').value, Number($('cq-count').value));
  });
  $('cq-wrong-mode').addEventListener('click', () => {
    if (!CQStore.wrongCount()) { alert('错题本是空的，先去考几题吧'); return; }
    Quiz.start('wrong', 'all', Math.min(CQStore.wrongCount(), 40));
  });
  $('cq-clear-wrong').addEventListener('click', () => {
    if (confirm('确定清空错题本吗？')) { CQStore.clearWrong(); refreshStats(); }
  });

  document.addEventListener('keydown', e => {
    if ($('cq-quiz-wrap').hidden) return;
    if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) return;
    const q = Quiz.active ? Quiz.cur() : null;
    if (Quiz.active && q && !q.answered) {
      const k = e.key.toLowerCase();
      const idx = ['1', '2', '3', '4'].indexOf(k) >= 0 ? Number(k) - 1
        : ['a', 'b', 'c', 'd'].indexOf(k);
      if (idx >= 0 && idx < q.options.length) { e.preventDefault(); Quiz.answer(idx); return; }
    }
    if (e.key === 'Enter') {
      if (Quiz.active && q && q.answered) { e.preventDefault(); Quiz.next(); }
      else if (!$('cq-summary').hidden) { e.preventDefault(); $('cq-again').click(); }
    }
  });
});
