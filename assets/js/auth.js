/* ============================================================
   auth.js — 登录 / 注册（Supabase Auth，邮箱 + 密码）
   · 导航栏注入入口按钮（未配置后端时不注入）
   · 弹窗含 登录 / 注册 两个页签，错误与提示走 textContent
   · 会话由 supabase-js 持久化在本地，多页共用
   · 管理员：登录后检查 is_admin，管理员可在账号弹窗进入管理后台；
     被封禁的账号登录即被踢出（数据层还有 RLS 强制，见 supabase/schema.sql）
   ============================================================ */
import { getSupabase, isConfigured } from './supabase.js';

let sb = null;
let user = null;
let isAdmin = false;
let pendingOpen = false;
let els = null; // 弹窗元素引用

/* ---------- 同步读取 supabase-js 缓存的会话 ----------
   避免换页时按钮先显示「登录」、等客户端加载完才闪变成昵称。
   缓存键：sb-<项目ref>-auth-token，值为会话 JSON（含 user）。 */
function cachedUser() {
  if (!isConfigured()) return null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('sb-') || !k.endsWith('-auth-token')) continue;
      const raw = JSON.parse(localStorage.getItem(k) || 'null');
      const u = raw?.user || raw?.currentUser?.user || null;
      if (u?.id) return u;
    }
  } catch {
    /* 忽略 */
  }
  return null;
}

/* ---------- 展示名 ---------- */
function displayName(u) {
  const meta = u?.user_metadata || {};
  return meta.display_name || (u?.email ? u.email.split('@')[0] : '用户');
}

/* ---------- 导航入口按钮 ---------- */
function renderButton() {
  const btn = document.getElementById('nav-auth');
  if (!btn) return;
  btn.textContent = user ? displayName(user) : '登录';
  btn.title = user ? `当前账号：${user.email}` : '登录 / 注册';
  btn.classList.toggle('is-user', Boolean(user));
}

function injectButton() {
  const actions = document.querySelector('.nav .nav__actions');
  if (!actions || document.getElementById('nav-auth')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-auth-btn';
  btn.id = 'nav-auth';
  btn.textContent = '登录';
  btn.addEventListener('click', () => {
    if (!els) {
      // 客户端尚未加载完：记住意图，加载完自动打开
      pendingOpen = true;
      return;
    }
    openModal();
  });
  actions.insertBefore(btn, document.getElementById('theme-toggle'));
}

/* ---------- 弹窗 ---------- */
function buildModal() {
  const mask = document.createElement('div');
  mask.className = 'auth-mask';
  mask.id = 'auth-mask';
  mask.hidden = true;
  mask.innerHTML = `
    <div class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <header class="auth-head">
        <h3 id="auth-title">登录</h3>
        <button type="button" class="auth-close" aria-label="关闭">×</button>
      </header>
      <div class="auth-tabs" role="tablist">
        <button type="button" class="auth-tab is-active" data-mode="login">登录</button>
        <button type="button" class="auth-tab" data-mode="register">注册</button>
      </div>
      <form class="auth-form" id="auth-form" novalidate>
        <label class="auth-field is-register-only">
          <span>昵称</span>
          <input name="display_name" type="text" maxlength="24" placeholder="怎么称呼你（可留空）" autocomplete="nickname">
        </label>
        <label class="auth-field">
          <span>邮箱</span>
          <input name="email" type="email" required placeholder="you@example.com" autocomplete="email">
        </label>
        <label class="auth-field">
          <span>密码</span>
          <input name="password" type="password" required minlength="6" placeholder="至少 6 位" autocomplete="current-password">
        </label>
        <p class="auth-msg" hidden></p>
        <button type="submit" class="btn btn--primary auth-submit">登录</button>
      </form>
      <div class="auth-account" hidden>
        <p class="auth-account-name"></p>
        <p class="auth-account-mail"></p>
        <p class="auth-account-msg" hidden></p>
        <div class="auth-account-actions">
          <a class="btn btn--ghost auth-admin-link" href="admin.html" hidden>管理后台 →</a>
          <button type="button" class="btn btn--ghost auth-claim" hidden
            title="本站第一个认领的账号将成为管理员">认领管理员</button>
          <button type="button" class="btn btn--ghost auth-logout">退出登录</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(mask);
  els = {
    mask,
    title: mask.querySelector('#auth-title'),
    tabs: [...mask.querySelectorAll('.auth-tab')],
    form: mask.querySelector('#auth-form'),
    name: mask.querySelector('input[name=display_name]'),
    email: mask.querySelector('input[name=email]'),
    password: mask.querySelector('input[name=password]'),
    msg: mask.querySelector('.auth-msg'),
    submit: mask.querySelector('.auth-submit'),
    account: mask.querySelector('.auth-account'),
    accName: mask.querySelector('.auth-account-name'),
    accMail: mask.querySelector('.auth-account-mail'),
    accMsg: mask.querySelector('.auth-account-msg'),
    adminLink: mask.querySelector('.auth-admin-link'),
    claim: mask.querySelector('.auth-claim'),
    logout: mask.querySelector('.auth-logout'),
  };

  let mode = 'login';
  const setMode = (m) => {
    mode = m;
    els.tabs.forEach((t) => t.classList.toggle('is-active', t.dataset.mode === m));
    mask.querySelectorAll('.is-register-only').forEach((el) => {
      el.style.display = m === 'register' ? '' : 'none';
    });
    els.title.textContent = m === 'register' ? '注册' : '登录';
    els.submit.textContent = m === 'register' ? '注册' : '登录';
    els.password.setAttribute(
      'autocomplete',
      m === 'register' ? 'new-password' : 'current-password'
    );
    showMsg('');
  };
  els.tabs.forEach((t) =>
    t.addEventListener('click', () => setMode(t.dataset.mode))
  );
  els._mode = () => mode;
  els._setMode = setMode;

  const close = () => {
    mask.hidden = true;
  };
  mask.querySelector('.auth-close').addEventListener('click', close);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !mask.hidden) close();
  });
  els._close = close;

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSubmit();
  });
  els.logout.addEventListener('click', async () => {
    await sb.auth.signOut();
    close();
  });
  els.claim.addEventListener('click', async () => {
    els.claim.disabled = true;
    try {
      const { data, error } = await sb.rpc('claim_admin_if_first');
      if (error) throw error;
      if (data === true) {
        isAdmin = true;
        showAccountMsg('认领成功，你现在是本站管理员。');
        renderAccountExtras();
      } else {
        els.claim.hidden = true;
        showAccountMsg('管理员已被认领。');
      }
    } catch (e) {
      showAccountMsg(translateAuthError(e), true);
    } finally {
      els.claim.disabled = false;
    }
  });
}

function showMsg(text, kind = 'info') {
  els.msg.hidden = !text;
  els.msg.textContent = text || '';
  els.msg.className = 'auth-msg' + (kind === 'err' ? ' is-err' : '');
}

function showAccountMsg(text, isErr = false) {
  els.accMsg.hidden = !text;
  els.accMsg.textContent = text || '';
  els.accMsg.classList.toggle('is-err', isErr);
}

function renderAccountExtras() {
  els.adminLink.hidden = !isAdmin;
  // 已有管理员时不再展示认领按钮
  els.claim.hidden = isAdmin;
}

function setLoading(on) {
  els.submit.disabled = on;
  const mode = els._mode();
  els.submit.textContent = on ? '请稍候…' : mode === 'register' ? '注册' : '登录';
}

async function handleSubmit() {
  const email = els.email.value.trim();
  const password = els.password.value;
  const nickname = els.name.value.trim();
  if (!email || !password) {
    showMsg('请填写邮箱和密码', 'err');
    return;
  }
  if (password.length < 6) {
    showMsg('密码至少 6 位', 'err');
    return;
  }
  showMsg('');
  setLoading(true);
  try {
    if (els._mode() === 'register') {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { display_name: nickname || null } },
      });
      if (error) throw error;
      // Supabase 的坑：邮箱已存在但未验证时，signUp 不报错，
      // 而是 user.identities 为空数组——此处明确提示，别让用户干等邮件
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        showMsg('这个邮箱注册过但还没完成验证：去邮箱（含垃圾箱）找确认邮件，'
          + '或在 Supabase 控制台 Authentication → Users 里手动确认 / 删除该账号后重新注册。'
          + '也可以在 Authentication → Sign In / Up 关闭 Confirm email，一劳永逸。');
        els._setMode('login');
      } else if (!data.session) {
        showMsg('注册成功！确认邮件已发送（注意垃圾箱）。'
          + '若收不到，可在 Supabase 控制台 Authentication → Sign In / Up 关闭 Confirm email，注册即登录。');
        els._setMode('login');
      }
      // 已直接建立会话（关闭邮箱确认时）→ onAuthStateChange 会刷新按钮
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      els._close();
    }
  } catch (e) {
    showMsg(translateAuthError(e), 'err');
  } finally {
    setLoading(false);
  }
}

function translateAuthError(e) {
  const msg = String(e?.message || e);
  if (/Invalid login credentials/i.test(msg)) {
    return '邮箱或密码不正确。若邮箱还没做过邮箱验证，也会这样提示——'
      + '去邮箱点确认链接，或在 Supabase 控制台 Authentication → Users 里手动确认。';
  }
  if (/already registered|already exists/i.test(msg)) return '该邮箱已注册，直接登录即可';
  if (/rate limit|too many/i.test(msg)) {
    return '操作太频繁（Supabase 免费版对发信/尝试次数限制很低）。等几分钟再试；'
      + '建议在 Authentication → Sign In / Up 关闭 Confirm email，注册即登录、彻底避开发信限制。';
  }
  if (/not confirmed/i.test(msg)) {
    return '邮箱还没验证。去邮箱（含垃圾箱）点确认链接；或在 Supabase 控制台 Authentication → Users 手动确认该账号；'
      + '或关闭 Confirm email 后重新注册。';
  }
  if (/valid email/i.test(msg)) return '邮箱格式看起来不对';
  if (/is invalid/i.test(msg)) return '这个邮箱域名不可用，换一个常用邮箱试试';
  if (/Signup requires a valid password/i.test(msg)) return '密码至少 6 位';
  if (/Failed to fetch|NetworkError/i.test(msg)) return '连不上后端（检查 Supabase 地址是否已填写）';
  return msg;
}

/* ---------- 打开弹窗 ---------- */
function openModal() {
  if (!els) return;
  els.msg.hidden = true;
  showAccountMsg('');
  if (user) {
    els.title.textContent = '我的账号';
    els.form.hidden = true;
    els.tabs.forEach((t) => (t.hidden = true));
    els.account.hidden = false;
    els.accName.textContent = `昵称：${displayName(user)}`;
    els.accMail.textContent = `邮箱：${user.email}`;
    renderAccountExtras();
  } else {
    els.title.textContent = '登录';
    els.form.hidden = false;
    els.tabs.forEach((t) => (t.hidden = false));
    els.account.hidden = true;
    els._setMode('login');
  }
  els.mask.hidden = false;
  (user ? els.claim : els.email).focus?.();
  if (!user) els.email.focus();
}

/* ---------- 会话刷新 + 身份 / 封禁检查 ---------- */
let bannedWarned = false;

async function refreshIdentity() {
  if (!user) {
    isAdmin = false;
    return;
  }
  // 管理员检查
  try {
    const { data } = await sb.rpc('is_admin');
    isAdmin = data === true;
  } catch {
    isAdmin = false; // schema 未更新等情况
  }
  // 封禁检查：登录态存在但账号被封 → 立即踢出
  try {
    const { data: profile, error } = await sb
      .from('profiles')
      .select('banned')
      .eq('id', user.id)
      .maybeSingle();
    if (!error && profile?.banned) {
      await sb.auth.signOut();
      user = null;
      isAdmin = false;
      if (!bannedWarned) {
        bannedWarned = true;
        window.alert('该账号已被封禁，如有疑问请联系站长。');
      }
    }
  } catch {
    /* profiles 表尚未建立（旧 schema）时忽略 */
  }
}

/* ---------- 初始化 ---------- */
if (isConfigured()) {
  // 立即用缓存会话渲染按钮（同步、无闪烁）；客户端加载后再做权威校验
  user = cachedUser();
  injectButton();
  renderButton();
  getSupabase().then((client) => {
    if (!client) return;
    sb = client;
    buildModal();
    const refresh = async () => {
      try {
        const { data } = await sb.auth.getSession();
        user = data.session?.user ?? null;
        await refreshIdentity();
      } catch {
        /* 忽略 */
      }
      renderButton();
    };
    refresh();
    sb.auth.onAuthStateChange(() => refresh());
    if (pendingOpen) {
      pendingOpen = false;
      openModal();
    }
  });
}
