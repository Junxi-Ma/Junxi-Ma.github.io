/* ============================================================
   admin.js — 管理后台逻辑
   · 守卫：登录 + is_admin（RPC，数据库端强制）
   · 页签：账号管理 / 访客黑名单 / 访客行为 / 管理员名单
   · 所有写操作依赖 RLS 策略，非管理员的请求会被服务端拒绝
   ============================================================ */
import { getSupabase, isConfigured } from './supabase.js';

let sb = null;
let user = null;
let isAdmin = false;
let adminIds = new Set();

const $ = (id) => document.getElementById(id);
const fmt = (iso) =>
  iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—';
const shortId = (v) => (v && v.length > 10 ? v.slice(0, 10) + '…' : v);

function setGuard(title, text, hint = '') {
  $('adm-app').hidden = true;
  $('adm-guard').hidden = false;
  $('adm-guard-title').textContent = title;
  $('adm-guard-text').textContent = text;
  $('adm-guard-hint').textContent = hint;
}

function note(text) {
  $('adm-note').textContent = text || '';
}

/* ================= 守卫 ================= */
async function init() {
  if (!isConfigured()) {
    setGuard(
      '后端未配置',
      '本页依赖 Supabase 后端。请在 assets/js/supabase.js 中填写项目地址后刷新。'
    );
    return;
  }
  sb = await getSupabase();
  if (!sb) {
    setGuard('后端不可达', 'Supabase 客户端加载失败，请检查网络或项目地址。');
    return;
  }
  const { data } = await sb.auth.getSession();
  user = data.session?.user ?? null;
  if (!user) {
    setGuard(
      '需要登录',
      '请先在右上角登录，然后使用管理员账号回到本页。'
    );
    return;
  }
  let admin = false;
  let rpcError = null;
  try {
    const res = await sb.rpc('is_admin');
    if (res.error) rpcError = res.error;
    else admin = res.data === true;
  } catch (e) {
    rpcError = e;
  }
  if (rpcError) {
    setGuard(
      '需要更新数据库脚本',
      '服务端还没有管理后台相关函数（schema v2）。请先在 Supabase SQL Editor 重新运行 supabase/schema.sql，然后刷新本页。',
      String(rpcError.message || rpcError)
    );
    return;
  }
  if (!admin) {
    setGuard(
      '没有权限',
      `当前账号（${user.email}）不是管理员。如果你是本站第一个账号，可在任意页面的账号弹窗里「认领管理员」。`
    );
    return;
  }
  isAdmin = true;
  $('adm-guard').hidden = true;
  $('adm-app').hidden = false;
  await reloadAll();
}

/* ================= 数据加载 ================= */
async function reloadAll() {
  note('加载中…');
  try {
    await Promise.all([loadAccounts(), loadBannedVisitors(), loadOverview(), loadRecent(), loadAdmins()]);
    note(`已刷新 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
  } catch (e) {
    note('加载失败：' + (e.message || e));
  }
}

/* ---------- 账号管理 ---------- */
async function loadAccounts() {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const tbody = $('adm-accounts');
  tbody.innerHTML = '';
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="5">还没有注册账号</td></tr>';
    return;
  }
  for (const p of data) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(p.display_name || '—')}${adminIds.has(p.id) ? ' <span class="adm-ok">管</span>' : ''}</td>
      <td class="mono">${escapeHtml(p.email)}</td>
      <td>${fmt(p.created_at)}</td>
      <td>${p.banned ? '<span class="adm-banned">已封禁</span>' : '<span class="adm-ok">正常</span>'}</td>
      <td><div class="adm-actions"></div></td>`;
    const actions = tr.querySelector('.adm-actions');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--ghost btn--sm';
    if (p.id === user.id) {
      btn.textContent = '当前账号';
      btn.disabled = true;
    } else {
      btn.textContent = p.banned ? '解封' : '封禁';
      btn.addEventListener('click', () => toggleBan(p));
    }
    actions.appendChild(btn);
    tbody.appendChild(tr);
  }
}

async function toggleBan(p) {
  const action = p.banned ? '解封' : '封禁';
  if (!confirm(`确定${action}账号「${p.display_name || p.email}」吗？`)) return;
  const { error } = await sb
    .from('profiles')
    .update({ banned: !p.banned })
    .eq('id', p.id);
  if (error) {
    alert('操作失败：' + (error.message || error));
    return;
  }
  await loadAccounts();
}

/* ---------- 访客黑名单 ---------- */
async function loadBannedVisitors() {
  const { data, error } = await sb
    .from('banned_visitors')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const tbody = $('adm-bv-list');
  tbody.innerHTML = '';
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="4">黑名单为空</td></tr>';
    return;
  }
  for (const b of data) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono" title="${escapeHtml(b.visitor_id)}">${escapeHtml(shortId(b.visitor_id))}</td>
      <td>${escapeHtml(b.reason || '—')}</td>
      <td>${fmt(b.created_at)}</td>
      <td><div class="adm-actions"></div></td>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--ghost btn--sm';
    btn.textContent = '移出';
    btn.addEventListener('click', async () => {
      const { error } = await sb
        .from('banned_visitors')
        .delete()
        .eq('visitor_id', b.visitor_id);
      if (error) {
        alert('移除失败：' + (error.message || error));
        return;
      }
      await loadBannedVisitors();
    });
    tr.querySelector('.adm-actions').appendChild(btn);
    tbody.appendChild(tr);
  }
}

function bvMsg(text, isErr = false) {
  const el = $('adm-bv-msg');
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('is-err', isErr);
}

async function addBannedVisitor() {
  const id = $('adm-bv-id').value.trim();
  const reason = $('adm-bv-reason').value.trim();
  if (!id) {
    bvMsg('请填写访客 id（可在「访客行为」页签里复制）', true);
    return;
  }
  const { error } = await sb
    .from('banned_visitors')
    .insert({ visitor_id: id, reason });
  if (error) {
    bvMsg('加入失败：' + (error.message || error), true);
    return;
  }
  $('adm-bv-id').value = '';
  $('adm-bv-reason').value = '';
  bvMsg('已加入黑名单。');
  await loadBannedVisitors();
}

/* ---------- 访客行为 ---------- */
async function loadOverview() {
  const { data, error } = await sb.rpc('get_visitor_overview', { max_rows: 100 });
  if (error) throw error;
  const tbody = $('adm-overview');
  tbody.innerHTML = '';
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="4">还没有访问记录</td></tr>';
    return;
  }
  for (const v of data) {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.title = '点击查看该访客的访问轨迹';
    tr.innerHTML = `
      <td class="mono" title="${escapeHtml(v.visitor_id)}">${escapeHtml(shortId(v.visitor_id))}</td>
      <td>${v.visit_count}</td>
      <td>${fmt(v.first_seen)}</td>
      <td>${fmt(v.last_seen)}</td>`;
    tr.addEventListener('click', () => showJourney(v.visitor_id, v.visit_count));
    tbody.appendChild(tr);
  }
}

async function showJourney(visitorId, count) {
  const { data, error } = await sb
    .from('visits')
    .select('path, created_at')
    .eq('visitor_id', visitorId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    alert('加载失败：' + (error.message || error));
    return;
  }
  $('adm-journey').hidden = false;
  $('adm-journey-title').textContent =
    `访客 ${shortId(visitorId)} 的访问轨迹（最近 ${data.length} / 共 ${count} 次）`;
  const tbody = $('adm-journey-body');
  tbody.innerHTML = data
    .map((v) => `<tr><td>${fmt(v.created_at)}</td><td class="mono">${escapeHtml(v.path)}</td></tr>`)
    .join('');
  $('adm-journey').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function loadRecent() {
  const { data, error } = await sb
    .from('visits')
    .select('visitor_id, path, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  const tbody = $('adm-recent');
  tbody.innerHTML = data
    .map(
      (v) =>
        `<tr><td>${fmt(v.created_at)}</td><td class="mono" title="${escapeHtml(v.visitor_id)}">${escapeHtml(shortId(v.visitor_id))}</td><td class="mono">${escapeHtml(v.path)}</td></tr>`
    )
    .join('');
}

/* ---------- 管理员名单 ---------- */
async function loadAdmins() {
  const [{ data: admins, error: e1 }, { data: profiles, error: e2 }] =
    await Promise.all([
      sb.from('admins').select('user_id, created_at').order('created_at', { ascending: true }),
      sb.from('profiles').select('id, email, display_name'),
    ]);
  if (e1) throw e1;
  if (e2) throw e2;
  adminIds = new Set(admins.map((a) => a.user_id));
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const tbody = $('adm-admins');
  tbody.innerHTML = '';
  for (const a of admins) {
    const p = byId.get(a.user_id);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(p?.display_name || '—')}${a.user_id === user.id ? ' <span class="adm-ok">（你）</span>' : ''}</td>
      <td class="mono">${escapeHtml(p?.email || '—')}</td>
      <td>${fmt(a.created_at)}</td>
      <td><div class="adm-actions"></div></td>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--ghost btn--sm';
    btn.textContent = '移除';
    btn.addEventListener('click', async () => {
      if (a.user_id === user.id && !confirm('移除自己将立刻失去后台权限，确定吗？')) return;
      const { error } = await sb.from('admins').delete().eq('user_id', a.user_id);
      if (error) {
        alert('移除失败：' + (error.message || error));
        return;
      }
      await loadAdmins();
    });
    tr.querySelector('.adm-actions').appendChild(btn);
    tbody.appendChild(tr);
  }
  if (!admins.length) {
    tbody.innerHTML = '<tr><td colspan="4">暂无管理员（可点「认领管理员」或在下方按邮箱提拔）</td></tr>';
  }
}

function adminMsg(text, isErr = false) {
  const el = $('adm-admin-msg');
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('is-err', isErr);
}

async function promoteAdmin() {
  const email = $('adm-admin-email').value.trim().toLowerCase();
  if (!email) {
    adminMsg('请填写注册邮箱', true);
    return;
  }
  const { data: profile, error } = await sb
    .from('profiles')
    .select('id, email')
    .eq('email', email)
    .maybeSingle();
  if (error) {
    adminMsg('查询失败：' + (error.message || error), true);
    return;
  }
  if (!profile) {
    adminMsg('该邮箱尚未注册', true);
    return;
  }
  const { error: insErr } = await sb
    .from('admins')
    .insert({ user_id: profile.id });
  if (insErr) {
    adminMsg('提拔失败：' + (insErr.message || insErr), true);
    return;
  }
  $('adm-admin-email').value = '';
  adminMsg('已提拔为管理员。');
  await loadAdmins();
  await loadAccounts();
}

/* ---------- 工具 ---------- */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ---------- 页签与启动 ---------- */
function switchTab(tab) {
  document.querySelectorAll('.adm-tab').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.tab === tab)
  );
  for (const t of ['accounts', 'banned', 'behavior', 'admins']) {
    $('adm-tab-' + t).hidden = t !== tab;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.adm-tab').forEach((b) =>
    b.addEventListener('click', () => switchTab(b.dataset.tab))
  );
  $('adm-bv-add').addEventListener('click', addBannedVisitor);
  $('adm-admin-add').addEventListener('click', promoteAdmin);
  $('adm-refresh').addEventListener('click', () => isAdmin && reloadAll());
  init();
});
