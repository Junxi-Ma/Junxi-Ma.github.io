/* ============================================================
   analytics.js — 全站匿名访客统计
   · 每次页面加载向 visits 表上报一条（访客 id + 路径）
   · 页脚展示 聚合统计（总访问 / 独立访客 / 今日），走安全聚合函数
   · 访客 id 存 localStorage，仅用于去重，不含任何个人信息
   ============================================================ */
import { getSupabase, isConfigured } from './supabase.js';

const VISITOR_KEY = 'site-visitor-id';

function visitorId() {
  let id = null;
  try {
    id = localStorage.getItem(VISITOR_KEY);
  } catch {
    /* 隐私模式下忽略 */
  }
  if (!id) {
    id = globalThis.crypto?.randomUUID
      ? crypto.randomUUID()
      : 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    try {
      localStorage.setItem(VISITOR_KEY, id);
    } catch {
      /* 忽略 */
    }
  }
  return id;
}

async function trackVisit(sb) {
  try {
    const { error } = await sb
      .from('visits')
      .insert({ visitor_id: visitorId(), path: location.pathname });
    if (error) throw error;
  } catch (e) {
    console.warn('[analytics] 访问上报失败：', e);
  }
}

async function renderFooterStats(sb) {
  try {
    const { data, error } = await sb.rpc('get_site_stats');
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return;
    const footer = document.querySelector('.footer .footer__inner');
    if (!footer) return;
    const el = document.createElement('span');
    el.className = 'footer__stats';
    el.title = '由 Supabase 实时统计';
    el.textContent = `访问 ${row.total_views} 次 · ${row.unique_visitors} 位访客 · 今日 ${row.today_views}`;
    footer.insertBefore(el, footer.querySelector('.footer__links'));
  } catch (e) {
    console.warn('[analytics] 统计加载失败：', e);
  }
}

if (isConfigured()) {
  getSupabase().then((sb) => {
    if (!sb) return;
    trackVisit(sb);
    renderFooterStats(sb);
  });
}
