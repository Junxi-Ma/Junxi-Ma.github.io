// ============================================================
// ai-proxy — Stardy AI 的 CORS 转发代理（Supabase Edge Function）
//
// 用途：浏览器直连不支持跨域（CORS）的 OpenAI 兼容端点（如
// opencode Zen 网关、部分本地/中转服务）时，经由本函数服务端转发。
// API Key 由前端随请求携带、仅在本函数内用于转发，不落库、不存储。
//
// 部署（Supabase Dashboard 即可，无需 CLI）：
//   Dashboard → Edge Functions → Create a new function → 命名 ai-proxy
//   → 把本文件全部内容粘贴进 index.ts → Deploy
// 安全：
//   1. 仅允许本站登录用户调用（校验请求携带的 Supabase 用户 JWT）
//   2. 仅允许转发到 https:// 目标
//   3. 只转发 POST /chat 类请求体，原样返回响应（含状态码）
// ============================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: { message: '仅支持 POST' } }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    // 1) 验证调用者是本站登录用户（防公开滥用）
    const auth = req.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: { message: '代理转发需要先登录本站账号' } }), {
        status: 401,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: userData, error: userErr } = await admin.auth.getUser(auth.slice(7));
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: { message: '登录态无效，请重新登录' } }), {
        status: 401,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // 2) 校验并转发
    const { url, body, headers } = await req.json();
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      return new Response(JSON.stringify({ error: { message: '仅支持转发到 https:// 目标' } }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    const fwd = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers && typeof headers === 'object' ? headers : {}),
      },
      body: JSON.stringify(body ?? {}),
    });
    const text = await fwd.text();
    return new Response(text, {
      status: fwd.status,
      headers: { ...CORS, 'Content-Type': fwd.headers.get('content-type') || 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: '代理转发失败：' + String(e?.message || e) } }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
