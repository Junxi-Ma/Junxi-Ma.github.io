<script lang="ts">
/**
 * SiteGate.svelte — 全站登录门禁（Firefly 版）
 *
 * 逻辑来自旧站 public/assets/js/site-gate.js，改成组件后行为保持一致：
 *   · 开关存在 Supabase 表 site_settings，key = 'guest_access'
 *       value = 'login' → 未登录只能看到全屏登录框
 *       其他 / 无记录 / 读取失败 → 'open'，游客可直接浏览
 *   · fail-open：未配置后端、库加载失败、任何异常，一律放行。
 *     宁可开门，不能把整站锁死。
 *   · 已放行的结果缓存 5 分钟（localStorage），命中缓存的页面首帧直接放行，
 *     不用每页都等一次网络。
 *   · 登录成 SIGNED_IN 自动放行；退出登录 SIGNED_OUT 重新裁决。
 *
 * 接入方式：<SiteGate client:only="svelte" />，放在 Layout 的 body 末尾。
 * 首帧防闪需要 Layout 侧配合，见文件末尾注释。
 */
import { onMount } from "svelte";
import { getSupabase, isConfigured } from "@/lib/supabase";

/** site_settings 里控制门禁的键 */
const SETTING_KEY = "guest_access";
/** 判定结果缓存（5 分钟） */
const CACHE_KEY = "site-gate-cache-v1";
/** 调试用：localStorage 写 'login' / 'open' 可强制状态 */
const FORCE_KEY = "site-gate-force";
const CACHE_TTL = 5 * 60 * 1000;

type Phase = "pending" | "open" | "login";
type Mode = "login" | "register";
type GateCache = "open" | "login";

function readCache(): GateCache | null {
	try {
		const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
		if (
			raw &&
			(raw.state === "open" || raw.state === "login") &&
			typeof raw.ts === "number" &&
			Date.now() - raw.ts < CACHE_TTL
		) {
			return raw.state;
		}
	} catch {
		/* 隐私模式或脏数据 */
	}
	return null;
}

function writeCache(state: GateCache) {
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify({ state, ts: Date.now() }));
	} catch {
		/* 忽略 */
	}
}

/**
 * 初始状态在组件构造时同步算好：
 *   · 没配后端 → 直接 open，连遮罩都不渲染（零闪烁）
 *   · 缓存说上次是 open → 直接放行（零闪烁），本次加载内仍会复查
 *   · 其余情况先挂遮罩（pending），避免正文露出一瞬
 */
function initialPhase(): Phase {
	if (!isConfigured()) return "open";
	return readCache() === "open" ? "open" : "pending";
}

let phase = $state<Phase>(initialPhase());
let mode = $state<Mode>("login");
let email = $state("");
let password = $state("");
let displayName = $state("");
let message = $state("");
let isError = $state(false);
let submitting = $state(false);

function openGate() {
	phase = "open";
	writeCache("open");
	// 解除 <head> 里首帧钩子设下的隐藏（见 Layout.astro 的 data-gate-check）。
	// 少了这一行，缓存过期时页面会一直保持 hidden —— 没有遮罩、也点不了。
	if (typeof document !== "undefined") {
		document.documentElement.dataset.gateCheck = "open";
	}
}

function showGate() {
	phase = "login";
	writeCache("login");
	if (typeof document !== "undefined") {
		document.documentElement.dataset.gateCheck = "check";
	}
}

/** 把 Supabase 的错误翻成人话（照抄旧站） */
function translate(e: unknown): string {
	const s = String((e as { message?: string })?.message ?? e);
	if (/Invalid login credentials/i.test(s))
		return "邮箱或密码不对（邮箱还没验证时也会这样提示，先去邮箱点确认链接）";
	if (/already registered/i.test(s)) return "该邮箱已注册，直接登录即可";
	if (/rate limit|too many/i.test(s)) return "操作太频繁，等几分钟再试";
	if (/not confirmed/i.test(s)) return "邮箱还没验证：去邮箱（含垃圾箱）点确认链接";
	if (/valid email/i.test(s)) return "邮箱格式看起来不对";
	if (/at least 6|password/i.test(s)) return "密码至少 6 位";
	if (/Failed to fetch|NetworkError/i.test(s)) return "连不上后端，请检查网络后重试";
	return s;
}

/** 读门禁开关；任何异常都当作 open */
// biome-ignore lint/suspicious/noExplicitAny: 客户端是运行时动态加载的，没有类型
async function fetchSetting(sb: any): Promise<GateCache> {
	try {
		const { data, error } = await sb
			.from("site_settings")
			.select("value")
			.eq("key", SETTING_KEY)
			.maybeSingle();
		if (error) return "open";
		return data?.value === "login" ? "login" : "open";
	} catch {
		return "open";
	}
}

let deciding = false;

// biome-ignore lint/suspicious/noExplicitAny: 同上
async function decide(sb: any) {
	if (deciding) return;
	deciding = true;
	try {
		let force: string | null = null;
		try {
			force = localStorage.getItem(FORCE_KEY);
		} catch {
			/* 忽略 */
		}

		const [user, setting] = await Promise.all([
			sb.auth
				.getSession()
				// biome-ignore lint/suspicious/noExplicitAny: 同上
				.then((r: any) => r?.data?.session?.user ?? null)
				.catch(() => null),
			fetchSetting(sb),
		]);

		let allow: boolean;
		if (force === "login") allow = Boolean(user);
		else if (force === "open") allow = true;
		else allow = Boolean(user) || setting === "open";

		if (allow) openGate();
		else showGate();
	} catch {
		openGate();
	} finally {
		deciding = false;
	}
}

onMount(() => {
	// 初始阶段就是 open（缓存命中）时，确保 <head> 钩子设下的隐藏已解除。
	// 缓存刚好过期、但 head 与组件判断不一致时，这一步能兜住。
	if (phase === "open") {
		document.documentElement.dataset.gateCheck = "open";
	}

	if (!isConfigured()) {
		openGate();
		return;
	}

	let cancelled = false;
	let unsubscribe: (() => void) | null = null;

	(async () => {
		const sb = await getSupabase();
		if (cancelled) return;

		if (!sb) {
			// 库加载失败：没有登录能力，保持放行
			openGate();
			return;
		}

		// biome-ignore lint/suspicious/noExplicitAny: 同上
		const { data } = sb.auth.onAuthStateChange((event: string) => {
			if (event === "SIGNED_IN") openGate();
			else if (event === "SIGNED_OUT") decide(sb);
		});
		// biome-ignore lint/suspicious/noExplicitAny: subscription 类型不参与构建
		unsubscribe = () => (data as any)?.subscription?.unsubscribe?.();

		await decide(sb);
	})().catch(() => openGate());

	return () => {
		cancelled = true;
		unsubscribe?.();
	};
});

async function submit() {
	if (submitting) return;

	const mail = email.trim();
	if (!mail || !password) {
		message = "请填写邮箱和密码";
		isError = true;
		return;
	}
	if (password.length < 6) {
		message = "密码至少 6 位";
		isError = true;
		return;
	}

	message = "";
	isError = false;
	submitting = true;

	try {
		const sb = await getSupabase();
		if (!sb) {
			message = "后端未配置，暂时无法登录";
			isError = true;
			return;
		}

		if (mode === "register") {
			const nickname = displayName.trim() || null;
			const { data, error } = await sb.auth.signUp({
				email: mail,
				password,
				options: { data: { display_name: nickname } },
			});
			if (error) throw error;

			// identities 为空数组 = 这个邮箱早就注册过
			if (
				data?.user &&
				Array.isArray(data.user.identities) &&
				data.user.identities.length === 0
			) {
				message = "这个邮箱注册过但还没完成验证：去邮箱（含垃圾箱）点确认邮件里的链接。";
				isError = true;
			} else if (!data?.session) {
				message = "注册成功！确认邮件已发送（注意垃圾箱），验证后即可登录。";
				isError = false;
			}
			// 已直接建立会话时，SIGNED_IN 事件会放行
		} else {
			const { error } = await sb.auth.signInWithPassword({ email: mail, password });
			if (error) throw error;
			// SIGNED_IN 事件也会触发，这里立即放行少等一拍
			openGate();
		}
	} catch (e) {
		message = translate(e);
		isError = true;
	} finally {
		submitting = false;
	}
}

function switchMode(next: Mode) {
	mode = next;
	message = "";
	isError = false;
}
</script>

{#if phase !== "open"}
	<div
		class="sg-veil"
		role="dialog"
		aria-modal="true"
		aria-label="本站需要登录后访问"
	>
		<div class="sg-card">
			{#if phase === "pending"}
				<div class="sg-checking">
					<span class="sg-spinner" aria-hidden="true"></span>
					<p>正在检查访问权限…</p>
				</div>
			{:else}
				<header class="sg-brand">
					<span class="sg-brand__name">Michael.</span>
					<span class="sg-brand__suffix">个人站</span>
				</header>

				<h2 class="sg-title">本站内容需注册登录后使用</h2>
				<p class="sg-sub">
					注册一个账号（邮箱 + 密码）即可浏览全部页面；已有账号直接登录。
				</p>

				<div class="sg-tabs" role="tablist">
					<button
						type="button"
						class="sg-tab"
						class:is-active={mode === "login"}
						role="tab"
						aria-selected={mode === "login"}
						onclick={() => switchMode("login")}
					>
						登录
					</button>
					<button
						type="button"
						class="sg-tab"
						class:is-active={mode === "register"}
						role="tab"
						aria-selected={mode === "register"}
						onclick={() => switchMode("register")}
					>
						注册
					</button>
				</div>

				<form
					class="sg-form"
					novalidate
					onsubmit={(e) => {
						e.preventDefault();
						submit();
					}}
				>
					{#if mode === "register"}
						<label class="sg-field">
							<span>昵称</span>
							<input
								bind:value={displayName}
								maxlength="24"
								placeholder="怎么称呼你（可留空）"
								autocomplete="nickname"
							/>
						</label>
					{/if}

					<label class="sg-field">
						<span>邮箱</span>
						<input
							bind:value={email}
							type="email"
							required
							placeholder="you@example.com"
							autocomplete="email"
						/>
					</label>

					<label class="sg-field">
						<span>密码</span>
						<input
							bind:value={password}
							type="password"
							required
							minlength="6"
							placeholder="至少 6 位"
							autocomplete={mode === "register" ? "new-password" : "current-password"}
						/>
					</label>

					{#if message}
						<p class="sg-msg" class:is-err={isError} role="status">{message}</p>
					{/if}

					<button class="sg-submit" type="submit" disabled={submitting}>
						{submitting ? "请稍候…" : mode === "register" ? "注册" : "登录"}
					</button>
				</form>

				<p class="sg-foot">
					数据保存在 Supabase，仅用于登录与本站功能；密码经服务端加密存储。
				</p>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* 遮罩铺满视口、背景不透明，盖住所有正文。
	   不用 display:none 隐藏 body，避免和 Swup 的容器切换打架。 */
	.sg-veil {
		/* Firefly 没有给「正文文字色」定义变量（--deep-text 在暗色下不覆盖），
		   所以这里就地定义一组中性文字色，浅深两套都够对比度。 */
		--sg-text: #1c1c1e;
		--sg-text-muted: #5f6368;

		position: fixed;
		inset: 0;
		z-index: 2147483000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		overflow-y: auto;
		background: var(--page-bg);
	}

	:global(.dark) .sg-veil {
		--sg-text: #ecedee;
		--sg-text-muted: #a0a4a8;
	}

	.sg-card {
		width: 100%;
		max-width: 420px;
		padding: 32px 28px;
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-large);
		background: var(--card-bg);
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.12);
	}

	.sg-checking {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		padding: 28px 0;
	}

	.sg-checking p {
		margin: 0;
		font-size: 0.9rem;
		color: var(--sg-text-muted);
	}

	.sg-spinner {
		width: 26px;
		height: 26px;
		border: 2px solid var(--btn-regular-bg);
		border-top-color: var(--primary);
		border-radius: 50%;
		animation: sg-spin 0.8s linear infinite;
	}

	@keyframes sg-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.sg-brand {
		margin-bottom: 18px;
		font-size: 0.85rem;
	}

	.sg-brand__name {
		font-weight: 700;
		color: var(--primary);
	}

	.sg-brand__suffix {
		margin-left: 6px;
		color: var(--sg-text-muted);
	}

	.sg-title {
		margin: 0 0 8px;
		font-size: 1.15rem;
		font-weight: 700;
		line-height: 1.4;
		color: var(--sg-text);
	}

	.sg-sub {
		margin: 0 0 18px;
		font-size: 0.85rem;
		line-height: 1.7;
		color: var(--sg-text-muted);
		opacity: 0.8;
	}

	.sg-tabs {
		display: flex;
		gap: 6px;
		padding: 4px;
		margin-bottom: 16px;
		border-radius: 999px;
		background: var(--btn-regular-bg);
	}

	.sg-tab {
		flex: 1;
		padding: 7px 0;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--sg-text-muted);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.18s ease, color 0.18s ease;
	}

	.sg-tab.is-active {
		background: var(--card-bg);
		color: var(--primary);
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
	}

	.sg-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.sg-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.sg-field > span {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--sg-text-muted);
		opacity: 0.75;
	}

	.sg-field input {
		width: 100%;
		padding: 9px 12px;
		border: 1px solid var(--line-divider);
		border-radius: var(--radius-large);
		background: var(--btn-regular-bg);
		color: var(--sg-text-muted);
		font-size: 0.9rem;
		transition: border-color 0.18s ease, box-shadow 0.18s ease;
	}

	.sg-field input::placeholder {
		color: var(--sg-text-muted);
		opacity: 0.45;
	}

	.sg-field input:focus {
		outline: none;
		border-color: var(--primary);
		box-shadow: 0 0 0 3px var(--btn-regular-bg);
	}

	.sg-msg {
		margin: 0;
		padding: 9px 12px;
		border-radius: var(--radius-large);
		font-size: 0.8rem;
		line-height: 1.6;
		background: var(--btn-regular-bg);
		color: var(--sg-text-muted);
	}

	.sg-msg.is-err {
		background: color-mix(in oklch, #dc2626 12%, transparent);
		color: #dc2626;
	}

	:global(.dark) .sg-msg.is-err {
		color: #f87171;
	}

	.sg-submit {
		margin-top: 4px;
		padding: 10px 0;
		border: 0;
		border-radius: var(--radius-large);
		background: var(--primary);
		color: #fff;
		font-size: 0.9rem;
		font-weight: 700;
		cursor: pointer;
		transition: filter 0.18s ease, opacity 0.18s ease;
	}

	.sg-submit:hover:not(:disabled) {
		filter: brightness(1.06);
	}

	.sg-submit:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.sg-foot {
		margin: 16px 0 0;
		font-size: 0.72rem;
		line-height: 1.6;
		text-align: center;
		color: var(--sg-text-muted);
		opacity: 0.6;
	}

	@media (max-width: 480px) {
		.sg-card {
			padding: 24px 20px;
		}
		.sg-title {
			font-size: 1.05rem;
		}
	}
</style>

<!--
  首帧防闪（需要 Layout 侧配合，组件自身做不到）：
  client:only 的组件要等 JS 执行才渲染，HTML 到达与 JS 执行之间正文会露出。
  彻底解决要在 Layout.astro 的 <head> 里加一段内联脚本 + 一条样式：

    <script is:inline>
      (function () {
        try {
          var c = JSON.parse(localStorage.getItem('site-gate-cache-v1') || 'null');
          var fresh = c && Date.now() - c.ts < 300000;
          document.documentElement.dataset.gateCheck =
            fresh && c.state === 'open' ? 'open' : 'check';
        } catch (e) {
          document.documentElement.dataset.gateCheck = 'check';
        }
      })();
    </script>

    <style is:global>
      html[data-gate-check='check'] body > :not(.sg-veil) { visibility: hidden; }
    </style>

  组件放行后把 dataset.gateCheck 改成 open 即可解除（一行 documentElement 赋值）。
-->
