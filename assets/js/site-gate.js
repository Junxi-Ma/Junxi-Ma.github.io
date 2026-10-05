/* ============================================================
   site-gate.js — 全站登录门禁
   · 开关来自 Supabase 表 site_settings（key = 'guest_access'）：
       value = 'open'（默认；无记录或读取失败也按 open）→ 游客可直接浏览
       value = 'login' → 未登录访客只能看到全屏登录门禁
   · 门禁自带登录/注册表单，不依赖各页面的登录组件（分支页没有导航栏）
   · 登录成功（SIGNED_IN）自动放行；退出登录后重新裁决
   · 每次页面加载都会重新拉取开关（后台切换后刷新即生效）；
     localStorage 缓存仅用于「已放行」时先显示内容、避免闪烁
   · 调试：localStorage.setItem('site-gate-force', 'login' | 'open')
     可强制门禁状态（不受后台开关影响），删除该键恢复
   ============================================================ */
import { getSupabase, isConfigured } from './supabase.js';

const SETTING_KEY = 'guest_access';
const CACHE_KEY = 'site-gate-cache-v1';
const FORCE_KEY = 'site-gate-force';
const GATE_ID = 'site-gate';

const root = document.documentElement;

/* ---------- 放行 / 缓存 ---------- */
function setGateOpen() {
  root.dataset.gateOpen = '1';
  document.getElementById(GATE_ID)?.remove();
  cacheState('open');
}

function cacheState(state) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ state, ts: Date.now() })); } catch {}
}

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (raw && (raw.state === 'open' || raw.state === 'login') && Date.now() - raw.ts < 5 * 60 * 1000) {
      return raw.state;
    }
  } catch {}
  return null;
}

/* ---------- 后端规则 ---------- */
async function fetchSetting(sb) {
  // 返回 'open' | 'login'；无记录 / 读取失败 → 默认放行（fail-open，宁可开门不锁站）
  try {
    const { data, error } = await sb
      .from('site_settings')
      .select('value')
      .eq('key', SETTING_KEY)
      .maybeSingle();
    if (error) return 'open';
    return data?.value === 'login' ? 'login' : 'open';
  } catch {
    return 'open';
  }
}

/* ---------- 裁决 ---------- */
let deciding = false;
async function decide(sb) {
  if (deciding) return;
  deciding = true;
  try {
    let force = null;
    try { force = localStorage.getItem(FORCE_KEY); } catch {}

    const [user, setting] = await Promise.all([
      sb.auth.getSession().then((r) => r.data?.session?.user ?? null).catch(() => null),
      fetchSetting(sb),
    ]);

    let allow;
    if (force === 'login') allow = Boolean(user);
    else if (force === 'open') allow = true;
    else allow = Boolean(user) || setting === 'open';

    if (allow) setGateOpen();
    else showGate(sb);
  } catch {
    setGateOpen(); // 任何意外错误宁可放行，不把站锁死
  } finally {
    deciding = false;
  }
}

/* ---------- 门禁遮罩（自带登录 / 注册表单） ---------- */
function showGate(sb) {
  cacheState('login');
  delete root.dataset.gateOpen;
  if (document.getElementById(GATE_ID)) return;

  const el = document.createElement('div');
  el.id = GATE_ID;
  el.innerHTML = `
    <div class="sg-card">
      <div class="sg-brand"><b>Michael.</b> 个人站</div>
      <h2>本站内容需注册登录后使用</h2>
      <p class="sg-sub">注册一个账号（邮箱 + 密码）即可浏览全部页面；已有账号直接登录。</p>
      <div class="sg-tabs">
        <button type="button" class="sg-tab is-active" data-mode="login">登录</button>
        <button type="button" class="sg-tab" data-mode="register">注册</button>
      </div>
      <form class="sg-form" novalidate>
        <label class="sg-field sg-only-register" hidden><span>昵称</span>
          <input name="display_name" maxlength="24" placeholder="怎么称呼你（可留空）" autocomplete="nickname"></label>
        <label class="sg-field"><span>邮箱</span>
          <input name="email" type="email" required placeholder="you@example.com" autocomplete="email"></label>
        <label class="sg-field"><span>密码</span>
          <input name="password" type="password" required minlength="6" placeholder="至少 6 位" autocomplete="current-password"></label>
        <p class="sg-msg" hidden></p>
        <button type="submit" class="sg-submit">登录</button>
      </form>
      <p class="sg-foot">数据保存在 Supabase，仅用于登录与本站功能；密码经服务端加密存储。</p>
    </div>`;
  document.body.appendChild(el);

  let mode = 'login';
  const q = (s) => el.querySelector(s);
  const form = q('.sg-form');
  const msg = q('.sg-msg');
  const submit = q('.sg-submit');
  const nameInput = q('input[name=display_name]');
  const emailInput = q('input[name=email]');
  const passInput = q('input[name=password]');

  const setMode = (m) => {
    mode = m;
    el.querySelectorAll('.sg-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.mode === m));
    q('.sg-only-register').hidden = m !== 'register';
    submit.textContent = m === 'register' ? '注册' : '登录';
    passInput.setAttribute('autocomplete', m === 'register' ? 'new-password' : 'current-password');
    msg.hidden = true;
  };
  el.querySelectorAll('.sg-tab').forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));

  const say = (text, isErr = false) => {
    msg.hidden = !text;
    msg.textContent = text || '';
    msg.classList.toggle('is-err', isErr);
  };

  const translate = (e) => {
    const s = String(e?.message || e);
    if (/Invalid login credentials/i.test(s)) return '邮箱或密码不对（未验证的邮箱也会这样提示，先去邮箱点确认链接）';
    if (/already registered/i.test(s)) return '该邮箱已注册，直接登录即可';
    if (/rate limit|too many/i.test(s)) return '操作太频繁，等几分钟再试';
    if (/not confirmed/i.test(s)) return '邮箱还没验证：去邮箱（含垃圾箱）点确认链接';
    if (/valid email/i.test(s)) return '邮箱格式看起来不对';
    if (/at least 6|password/i.test(s)) return '密码至少 6 位';
    if (/Failed to fetch|NetworkError/i.test(s)) return '连不上后端，请检查网络后重试';
    return s;
  };

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = emailInput.value.trim();
    const password = passInput.value;
    if (!email || !password) return say('请填写邮箱和密码', true);
    if (password.length < 6) return say('密码至少 6 位', true);
    say('');
    submit.disabled = true;
    try {
      if (mode === 'register') {
        const nickname = nameInput.value.trim() || null;
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: { data: { display_name: nickname } },
        });
        if (error) throw error;
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          say('这个邮箱注册过但还没完成验证：去邮箱（含垃圾箱）点确认邮件里的链接。', true);
        } else if (!data.session) {
          say('注册成功！确认邮件已发送（注意垃圾箱），验证后即可登录。');
        }
        // 已直接建立会话（关闭邮箱确认时）→ SIGNED_IN 事件自动放行
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setGateOpen(); // SIGNED_IN 事件也会触发，这里立即放行少等一拍
      }
    } catch (e) {
      say(translate(e), true);
    } finally {
      submit.disabled = false;
    }
  });
}

/* ---------- 启动 ---------- */
async function init() {
  // 快速通道：上次判定为 open 时先放行内容，本次加载内还会重新裁决
  //（后台切换开关后，访客下次刷新/跳页立即按新规则执行）
  if (readCache() === 'open') setGateOpen();

  if (!isConfigured()) return setGateOpen(); // 未配置后端：没有登录能力，保持放行
  const sb = await getSupabase();
  if (!sb) return setGateOpen();             // 客户端加载失败：放行，不把站锁死

  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN') setGateOpen();
    else if (event === 'SIGNED_OUT') decide(sb);
  });
  await decide(sb);
}

init().catch(() => setGateOpen()); // 任何意外错误一律放行，不把站锁死
