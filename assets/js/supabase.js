/* ============================================================
   supabase.js — 全站 Supabase 后端接入（访客统计 / 登录注册）
   · 上线前只需把 SUPABASE_URL 填上（形如 https://xxxx.supabase.co）
   · publishable key 是公开密钥，可以安全地放在前端
   · URL 留空时整站优雅降级为纯静态模式（不注入任何动态元素）
   · 建表 SQL 见仓库 supabase/schema.sql（在 Supabase SQL Editor 运行一次）
   ============================================================ */

const SUPABASE_URL = 'https://pimyumfvricwpigqlacv.supabase.co'; // ← 在这里填你的 Project URL
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Lz1UOc8oPtTOxv6shuYPYA__5bBUcE9';

const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const isConfigured = () =>
  Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

let clientPromise = null;

/** 返回 Supabase 客户端的 Promise；未配置或加载失败时 resolve(null) */
export function getSupabase() {
  if (!isConfigured()) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import(/* @vite-ignore */ CDN)
      .then(({ createClient }) =>
        createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          auth: { persistSession: true, autoRefreshToken: true },
        })
      )
      .catch((e) => {
        console.warn('[supabase] 初始化失败，退回本地模式：', e);
        clientPromise = null;
        return null;
      });
  }
  return clientPromise;
}
