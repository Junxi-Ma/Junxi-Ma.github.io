/* ============================================================
   online.js — 外出名额分配 · 在线房间（Supabase）
   · 班长创建房间得房间码；成员输码进入，所有人实时共同编辑
   · 分配在本地计算，结果发布后房间内所有人可见
   · 实时：Supabase Realtime（postgres_changes）+ 8 秒轮询兜底
   ============================================================ */
import { getSupabase, isConfigured } from '../../assets/js/supabase.js';

const REASONS = ['家长看望', '同学看望', '外出游玩', '看病就医', '办理事务', '采购物品', '朋友聚会', '其他'];
const CUSTOM = 8;                       // 自定义理由的下标（mReason 的特殊选项）
const DEFAULT_W = [5, 3, 2, 4, 2, 1, 2, 1];
const DOW = ['日', '一', '二', '三', '四', '五', '六'];
const K_ROOM = 'site:outing:oroom';
const K_CID = 'site:outing:cid';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_DAYS = 90;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ================= 日期工具 ================= */
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
function dateRange(s, e) {
  const out = [];
  const cur = parseISO(s);
  const end = parseISO(e);
  let guard = 0;
  while (cur <= end && guard++ <= MAX_DAYS) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}
const dowOf = (iso) => DOW[parseISO(iso).getUTCDay()];
const shortDate = (iso) => { const [, m, d] = iso.split('-'); return `${+m}/${+d}`; };
const isWeekend = (iso) => [0, 6].includes(parseISO(iso).getUTCDay());

/* ================= 状态 ================= */
let sb = null;
let capsOk = false;       // 数据库是否已支持逐日名额（caps 列）
let room = null;          // {code, start_date, end_date, daily_cap, weights, allow_fill, result, result_at, dates}
let entries = [];
let editingId = null;     // 正在编辑的条目 id
let pendingCaps = [];     // 创建表单里的逐日名额
let channel = null;
let pollTimer = null;
let resultOpen = false;

const load = (k, fb) => { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? fb : v; } catch { return fb; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 忽略 */ } };

function clientId() {
  let id = load(K_CID, null);
  if (!id) {
    id = globalThis.crypto?.randomUUID
      ? crypto.randomUUID()
      : 'c-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    save(K_CID, id);
  }
  return id;
}

function roomDates(r) { return dateRange(r.start_date, r.end_date); }
function roomWithDates(r) { return { ...r, dates: roomDates(r) }; }
/** 第 di 天的名额：逐日设置优先，否则用默认 daily_cap */
function capOf(di) {
  const c = room.caps?.[di];
  return (c === 0 || c) ? c : (room.daily_cap ?? 3);
}

/* ================= 页签联动 ================= */
function panelVisible(step) {
  $('panel-online').hidden = step !== 'online';
}

/* ================= 提示 ================= */
let toastTimer;
function toast(msg, isErr) {
  // 复用离线脚本的 toast 元素
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('toast--err', !!isErr);
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 2600);
}

/* ================= 创建 / 加入 ================= */
function weightInputs() {
  return [...document.querySelectorAll('#onWeights input')].map((i) => Math.max(0, Math.min(99, parseInt(i.value, 10) || 0)));
}

function randomCode(len = 5) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

async function createRoom() {
  const s = $('onStart').value;
  const e = $('onEnd').value;
  const q = Math.min(99, Math.max(1, parseInt($('onCap').value, 10) || 0));
  if (!isISO(s) || !isISO(e)) { toast('请填写完整的日期范围', true); return; }
  if (parseISO(e) < parseISO(s)) { toast('结束日期不能早于开始日期', true); return; }
  const dates = dateRange(s, e);
  if (!dates.length || dates.length > MAX_DAYS) { toast(`日期范围需在 1 ~ ${MAX_DAYS} 天`, true); return; }
  const caps = dates.map((_, i) => (pendingCaps[i] ?? q));
  const capsDiffer = caps.some((c) => c !== q);
  if (capsDiffer && !capsOk) {
    toast('数据库还没启用逐日名额（重跑 supabase/schema.sql 后生效），本次按统一名额创建', true);
  }
  const payload = {
    code: randomCode(),
    start_date: s,
    end_date: e,
    daily_cap: q,
    weights: weightInputs(),
    allow_fill: $('onFill').getAttribute('aria-checked') === 'true',
    ...(capsOk ? { caps: capsDiffer ? caps : null } : {}),
  };
  // 房间码冲突自动重试
  for (let i = 0; i < 5; i++) {
    const { error } = await sb.from('outing_rooms').insert(payload);
    if (!error) break;
    if (error.code === '23505') { payload.code = randomCode(); continue; }
    toast('创建失败：' + (error.message || error), true);
    return;
  }
  enterRoom({ ...payload });
  toast(`房间已创建，把房间码 ${payload.code} 发到群里`);
}

async function joinRoom() {
  const code = $('onJoinCode').value.trim().toUpperCase();
  if (!code) { toast('请输入房间码', true); return; }
  const { data, error } = await sb.from('outing_rooms').select('*').eq('code', code).maybeSingle();
  if (error) { toast('加入失败：' + (error.message || error), true); return; }
  if (!data) { toast('房间不存在，检查一下房间码', true); return; }
  enterRoom(data);
  toast(`已进入房间 ${data.code}`);
}

function enterRoom(r) {
  room = roomWithDates(r);
  save(K_ROOM, { code: r.code });
  entries = [];
  bindLive();
  renderRoom();
  loadEntries();
}

function leaveRoom() {
  if (!confirm('退出房间？退出后需重新输入房间码才能进入（房间与报名数据仍保留）。')) return;
  if (channel) { sb.removeChannel(channel); channel = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  room = null;
  editingId = null;
  localStorage.removeItem(K_ROOM);
  $('onJoinCode').value = '';
  renderEntry();
}

/* ================= 实时同步 ================= */
function bindLive() {
  if (channel) { sb.removeChannel(channel); channel = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  channel = sb
    .channel('outing-' + room.code)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'outing_entries', filter: `room_code=eq.${room.code}` },
      () => loadEntries())
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'outing_rooms', filter: `code=eq.${room.code}` },
      () => reloadRoom())
    .subscribe();
  pollTimer = setInterval(() => { loadEntries(); }, 8000);
}

async function reloadRoom() {
  const { data, error } = await sb.from('outing_rooms').select('*').eq('code', room.code).maybeSingle();
  if (error || !data) return;
  room = roomWithDates(data);
  renderRoom();          // 重建房间信息与名单（result 变化也在其中）
}

/* ================= 数据读写 ================= */
async function loadEntries() {
  const { data, error } = await sb
    .from('outing_entries')
    .select('*')
    .eq('room_code', room.code)
    .order('created_at', { ascending: true });
  if (error) { console.warn('[outing] 条目加载失败', error); return; }
  entries = data || [];
  renderEntries();
  renderResultBanner();
}

async function submitEntry() {
  const name = $('onName').value.trim();
  if (!name) { toast('请填写姓名', true); return; }
  const picks = pickedIdx();
  if (!picks.length) { toast('请至少选择一个可接受日期', true); return; }
  const g = parseInt($('onReason').value, 10);
  const x = g === CUSTOM ? $('onCustom').value.trim() : '';
  if (g === CUSTOM && !x) { toast('请填写自定义理由', true); return; }
  const row = {
    room_code: room.code,
    name,
    days: Math.min(room.dates.length, Math.max(1, parseInt($('onDays').value, 10) || 1)),
    past: Math.max(0, parseInt($('onPast').value, 10) || 0),
    reason_idx: g,
    reason_text: x,
    accepts: picks,
    client_id: clientId(),
    updated_at: new Date().toISOString(),
  };
  // 同名视为同一人：覆盖其报名；填新名字 = 新增一条（可帮没有手机的同学代填）
  const sameName = editingId ? null : entries.find((e) => e.name === name);
  let error;
  if (editingId) {
    ({ error } = await sb.from('outing_entries').update(row).eq('id', editingId));
  } else if (sameName) {
    ({ error } = await sb.from('outing_entries').update(row).eq('id', sameName.id));
  } else {
    ({ error } = await sb.from('outing_entries').insert(row));
  }
  if (error) { toast('提交失败：' + (error.message || error), true); return; }
  editingId = null;
  $('onCancelEdit').hidden = true;
  $('onFormTitle').textContent = '填报外出（可帮他人代填）';
  resetForm(true);
  toast(!sameName ? '已提交，房间内所有人可见' : `已更新「${name}」的报名`);
}

async function deleteEntry(id) {
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  if (!confirm(`删除「${e.name}」的报名？`)) return;
  const { error } = await sb.from('outing_entries').delete().eq('id', id);
  if (error) { toast('删除失败：' + (error.message || error), true); return; }
  if (editingId === id) cancelEdit();
}

function editEntry(id) {
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  editingId = id;
  $('onFormTitle').textContent = `正在编辑：${e.name}`;
  $('onCancelEdit').hidden = false;
  $('onName').value = e.name;
  $('onDays').value = e.days;
  $('onPast').value = e.past;
  $('onReason').value = String(e.reason_idx);
  $('onReason').dispatchEvent(new Event('change'));
  $('onCustom').value = e.reason_text || '';
  $('onDateGrid').querySelectorAll('input').forEach((c) => { c.checked = false; });
  (e.accepts || []).forEach((i) => {
    const cb = $('onDateGrid').querySelector(`input[value="${i}"]`);
    if (cb) cb.checked = true;
  });
  updatePickCount();
  $('onFormTitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEdit() {
  editingId = null;
  $('onCancelEdit').hidden = true;
  $('onFormTitle').textContent = '填报外出（可帮他人代填）';
  resetForm(true);
}

/* ================= 渲染 ================= */
function pickedIdx() {
  return [...$('onDateGrid').querySelectorAll('input:checked')]
    .map((c) => parseInt(c.value, 10))
    .sort((a, b) => a - b);
}
function updatePickCount() {
  $('onPickCount').textContent = `已选 ${pickedIdx().length} 天`;
}
function resetForm(clearName) {
  if (clearName) { $('onName').value = ''; }
  $('onDays').value = '1';
  $('onPast').value = '0';
  $('onReason').value = '0';
  $('onCustom').value = '';
  $('onCustomWrap').hidden = true;
  $('onDateGrid').querySelectorAll('input').forEach((c) => { c.checked = false; });
  updatePickCount();
}

function renderRoom() {
  $('onEntry').hidden = true;
  $('onRoom').hidden = false;
  $('onCode').textContent = room.code;
  $('onRange').textContent = `${room.start_date} 至 ${room.end_date}（${room.dates.length} 天）`;
  $('onCapText').textContent = `${room.daily_cap} 人/天` + (room.caps ? '（逐日可不同）' : '');
  renderDateGrid();
  renderResultBanner();
}

function renderDateGrid() {
  $('onDateGrid').innerHTML = room.dates.map((iso, i) => `
    <label class="date-cell${isWeekend(iso) ? ' is-weekend' : ''}">
      <input type="checkbox" value="${i}">
      <span class="date-cell__dow">${dowOf(iso)}</span>
      <span class="date-cell__day">${shortDate(iso)}</span>
      <span class="date-cell__slot">${capOf(i)}名额</span>
    </label>`).join('');
}

function renderEntries() {
  $('onEntriesCount').textContent = `${entries.length} 人`;
  $('onCount').textContent = `${entries.length} 人`;
  const cid = clientId();
  const rows = entries.map((e) => {
    const reason = e.reason_idx === CUSTOM ? (e.reason_text || '其他') : (REASONS[e.reason_idx] || '其他');
    const dates = (e.accepts || []).map((n) => (room.dates[n] ? shortDate(room.dates[n]) : `#${n}`)).join('、');
    const mine = e.client_id === cid;
    return `<div class="list__row">
      <div class="list__main">
        <div class="list__title">${esc(e.name)}
          ${mine ? '<span class="badge badge--accent">本机</span>' : ''}
          <span class="badge">${esc(reason)}</span>
          <span class="badge">已外出 ${e.past} 次</span>
          <span class="badge">要 ${e.days} 天</span>
        </div>
        <div class="list__sub">可接受：${esc(dates || '—')}</div>
      </div>
      <div class="adm-actions" style="display:flex;gap:6px">
        <button class="icon-btn" type="button" data-edit="${e.id}" aria-label="编辑 ${esc(e.name)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m18 2 4 4L8 16l-4 1 1-4Z"/></svg>
        </button>
        <button class="icon-btn icon-btn--danger" type="button" data-del="${e.id}" aria-label="删除 ${esc(e.name)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
  $('onEntries').innerHTML = rows || '<div class="day-empty">还没有人报名 —— 把房间码发到群里吧</div>';
}

/* ---------- 分配（与离线算法同源，适配在线条目） ---------- */
function tiebreak(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 97;
}

function allocateOnline() {
  if (!entries.length) throw new Error('还没有人报名');
  const people = entries.map((e) => {
    const idx = (e.accepts || []).filter((n) => n >= 0 && n < room.dates.length);
    const wi = e.reason_idx === CUSTOM ? REASONS.length - 1 : e.reason_idx;
    const weight = room.weights[wi] ?? 1;
    return {
      id: e.id,
      name: e.name,
      reason: e.reason_idx === CUSTOM ? (e.reason_text || '其他') : (REASONS[e.reason_idx] || '其他'),
      weight,
      past: e.past,
      need: Math.min(e.days, room.dates.length),
      accept: idx,
      got: [],
    };
  });
  // 优先分 = 理由权重 × 100 ÷ 2^有效外出次数
  // 有效外出次数 = 历史次数 + 本轮已排上的天数（连出两天的人，第二天按多外出一次计）
  const effPast = (p) => Math.min(30, p.past + p.got.length);
  const scoreOf = (p) => p.weight * 100 / Math.pow(2, effPast(p));
  const byScore = (a, b) =>
    scoreOf(b) - scoreOf(a)
    || tiebreak(a.name) - tiebreak(b.name)
    || a.name.localeCompare(b.name, 'zh');

  const demand = people.reduce((s, p) => s + p.need, 0);
  const slot = room.dates.map((_, di) => capOf(di));
  const days = room.dates.map(() => []);

  const take = (p, di, fill) => {
    const ep = effPast(p);                 // 排上这天前的有效次数（本天是该人第 got.length+1 天）
    const score = Math.round(scoreOf(p));
    p.got.push(di);
    p.need--;
    slot[di]--;
    days[di].push({ p, fill, ep, score });
  };

  room.dates.forEach((_, di) => {
    const cands = people.filter((p) => p.need > 0 && p.accept.includes(di)).sort(byScore);
    for (const p of cands) {
      if (slot[di] <= 0) break;
      take(p, di, false);
    }
  });

  let fillCount = 0;
  if (room.allow_fill) {
    room.dates.forEach((_, di) => {
      while (slot[di] > 0) {
        const cands = people.filter((p) => p.need > 0 && !p.got.includes(di)).sort(byScore);
        if (!cands.length) break;
        take(cands[0], di, true);
        fillCount++;
      }
    });
  }

  days.forEach((list) => list.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name, 'zh')));
  const unsatisfied = people.filter((p) => p.need > 0).map((p) => ({ name: p.name, need: p.need, past: p.past }));
  const filled = days.reduce((s, l) => s + l.length, 0);
  return {
    at: new Date().toISOString(),
    days: days.map((list, di) => ({
      iso: room.dates[di],
      names: list.map((x) => ({
        name: x.p.name,
        reason: x.p.reason,
        past: x.p.past,
        extra: x.ep - x.p.past,          // 本轮已排上的天数（第二天起有效次数会加）
        fill: x.fill,
        score: x.score,
      })),
    })),
    unsatisfied,
    stats: { people: people.length, cap: room.dates.length * room.daily_cap, filled, fillCount, demand },
  };
}

async function allocAndPublish() {
  try {
    const result = allocateOnline();
    const { error } = await sb
      .from('outing_rooms')
      .update({ result, result_at: result.at })
      .eq('code', room.code);
    if (error) throw error;
    toast('分配完成并已发布给全房间');
  } catch (err) {
    toast(err.message, true);
  }
}

function republishClear() {
  if (!confirm('清除已发布的结果？房间内所有人都不再看到。')) return;
  sb.from('outing_rooms').update({ result: null, result_at: null }).eq('code', room.code)
    .then(() => { renderResultBanner(); });
}

function renderResultBanner() {
  const has = Boolean(room.result);
  $('onResultBanner').hidden = !has;
  if (has) {
    $('onResultAt').textContent = room.result_at ? new Date(room.result_at).toLocaleString('zh-CN', { hour12: false }) : '';
  }
  const box = $('onResultBox');
  if (!has || !resultOpen) { box.hidden = true; return; }
  const r = room.result;
  box.hidden = false;
  box.innerHTML = `
    <div class="stat-grid">
      <div class="stat"><div class="stat__label">报名人数</div><div class="stat__value">${r.stats.people}</div></div>
      <div class="stat"><div class="stat__label">总名额</div><div class="stat__value">${r.stats.cap}</div></div>
      <div class="stat"><div class="stat__label">已分配</div><div class="stat__value">${r.stats.filled}</div></div>
      <div class="stat"><div class="stat__label">调剂补位</div><div class="stat__value">${r.stats.fillCount}</div></div>
    </div>
    <div style="margin-top:14px">
      ${r.days.map((d, di) => `
        <div class="day-card${d.names.length < capOf(di) ? ' is-short' : ''}">
          <div class="day-card__head">
            <span class="day-card__date">${d.iso}<span class="dow">周${dowOf(d.iso)}</span></span>
            <span class="day-card__cap">${d.names.length} / ${capOf(di)} 人</span>
          </div>
          ${d.names.length ? `<div class="day-card__list">${d.names.map((x, n) => `
            <div class="pick">
              <span class="pick__rank">${n + 1}</span>
              <div class="pick__main">
                <div class="pick__name">${esc(x.name)}${x.fill ? ' <span class="badge badge--err">调剂</span>' : ''}</div>
                <div class="pick__meta">${esc(x.reason)} · 历史外出 ${x.past} 次${x.extra ? ` · 本轮已排 ${x.extra} 天，按 ${x.past + x.extra} 次计` : ''} · 优先分 ${x.score ?? '—'}</div>
              </div>
            </div>`).join('')}</div>`
        : '<div class="day-empty">无人报名这天</div>'}
        </div>`).join('')}
      ${r.unsatisfied.length ? `
        <div class="panel" style="margin-top:12px">
          <div class="panel__head"><span class="panel__title">未能排满的成员</span></div>
          <div class="list">${r.unsatisfied.map((p) => `
            <div class="list__row"><div class="list__main">
              <div class="list__title">${esc(p.name)}</div>
              <div class="list__sub">还差 ${p.need} 天 · 历史外出 ${p.past} 次</div>
            </div><span class="badge">下次优先</span></div>`).join('')}</div>
        </div>` : ''}
    </div>`;
}

/* ================= 初始化 ================= */
async function boot() {
  if (!isConfigured()) {
    $('onEntry').innerHTML =
      '<div class="callout"><span>☁️</span><div>在线房间需要 Supabase 后端支持，当前未配置 —— 请使用下方「离线 · 建房间」流程（邀请码模式）。</div></div>';
    return;
  }
  sb = await getSupabase();
  if (!sb) {
    $('onEntry').innerHTML =
      '<div class="callout"><span>☁️</span><div>Supabase 加载失败，请检查网络后刷新。离线模式仍可使用。</div></div>';
    return;
  }
  // 探测 caps 列是否存在（旧表结构降级为统一名额）
  try {
    const { error } = await sb.from('outing_rooms').select('caps').limit(1);
    capsOk = !error;
  } catch {
    capsOk = false;
  }

  // 理由下拉框（8 类 + 自定义）
  $('onReason').innerHTML = REASONS.map((r, i) => `<option value="${i}">${r}</option>`).join('')
    + `<option value="${CUSTOM}">自己填写…</option>`;

  // 理由权重输入行（创建房间用）
  $('onWeights').innerHTML = DEFAULT_W.map((w, i) => `
    <div class="field"><input class="input" type="number" id="onw${i}" min="0" max="99" value="${w}" aria-label="${REASONS[i]}权重"><span class="field__hint">${REASONS[i]}</span></div>`).join('');

  // 逐日名额编辑器：默认取「每天人数」，可单独调整
  const renderCapsEditor = () => {
    const s = $('onStart').value;
    const e = $('onEnd').value;
    if (!isISO(s) || !isISO(e) || parseISO(e) < parseISO(s)) {
      $('onCaps').innerHTML = '<span class="field__hint">填好日期范围后，这里可以逐天调整名额</span>';
      pendingCaps = [];
      return;
    }
    const dates = dateRange(s, e);
    if (dates.length > MAX_DAYS) {
      $('onCaps').innerHTML = `<span class="field__hint">日期范围最多 ${MAX_DAYS} 天</span>`;
      pendingCaps = [];
      return;
    }
    const def = Math.max(1, Math.min(99, parseInt($('onCap').value, 10) || 3));
    pendingCaps = dates.map((_, i) => (pendingCaps[i] ?? def));
    $('onCaps').innerHTML = dates.map((iso, i) => `
      <div class="on-cap-cell">
        <span class="on-cap-date">${shortDate(iso)} 周${dowOf(iso)}</span>
        <input type="number" min="0" max="99" data-di="${i}" value="${pendingCaps[i]}" inputmode="numeric" aria-label="${iso} 名额">
      </div>`).join('');
  };
  ['onStart', 'onEnd', 'onCap'].forEach((id) =>
    $(id).addEventListener('change', renderCapsEditor));
  $('onCaps').addEventListener('input', (e) => {
    const di = e.target.dataset?.di;
    if (di === undefined) return;
    pendingCaps[+di] = Math.max(0, Math.min(99, parseInt(e.target.value, 10) || 0));
  });
  renderCapsEditor();

  $('onCreate').addEventListener('click', createRoom);
  $('onJoin').addEventListener('click', joinRoom);
  $('onJoinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  $('onLeave').addEventListener('click', leaveRoom);
  $('onCopyLink').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?r=${room.code}`;
    try { await navigator.clipboard.writeText(url); toast('加入链接已复制'); }
    catch { toast('复制失败，房间码：' + room.code, true); }
  });
  $('onSubmit').addEventListener('click', submitEntry);
  $('onCancelEdit').addEventListener('click', cancelEdit);
  $('onAlloc').addEventListener('click', allocAndPublish);
  $('onReload').addEventListener('click', () => { loadEntries(); reloadRoom(); toast('已刷新'); });
  $('onReason').addEventListener('change', () => {
    $('onCustomWrap').hidden = $('onReason').value !== String(CUSTOM);
  });
  $('onDateGrid').addEventListener('change', updatePickCount);
  $('onResultToggle').addEventListener('click', (e) => {
    e.preventDefault();
    resultOpen = !resultOpen;
    renderResultBanner();
  });
  $('onFill').addEventListener('click', () => {
    const on = $('onFill').getAttribute('aria-checked') === 'true';
    $('onFill').setAttribute('aria-checked', String(!on));
  });

  // ?r= 直达加入；否则回到上次未退出的房间
  const r = new URLSearchParams(location.search).get('r');
  if (r && /^[A-Z0-9]{4,8}$/i.test(r)) {
    $('onJoinCode').value = r.toUpperCase();
    await joinRoom();
    history.replaceState(null, '', location.pathname + '#online');
    return;
  }
  const saved = load(K_ROOM, null);
  if (saved?.code) {
    const { data } = await sb.from('outing_rooms').select('*').eq('code', saved.code).maybeSingle();
    if (data) { enterRoom(data); return; }
    localStorage.removeItem(K_ROOM);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.seg__btn').forEach((b) =>
    b.addEventListener('click', () => panelVisible(b.dataset.step)));
  panelVisible((location.hash || '#online').slice(1) === 'online' ? 'online' : '');
  boot();
});
