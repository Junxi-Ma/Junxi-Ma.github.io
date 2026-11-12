<script lang="ts">
/**
 * LoginModal — Firefly 风格的登录 / 注册弹窗
 *
 * 由 AccountButton 控制开关；也可以单独挂到任意页面。
 * 后端能力全部来自 src/lib/supabase.ts：未配置时组件不渲染任何东西。
 *
 * 几个刻意的处理：
 *   · 注册成功但没拿到 session，说明开了邮箱确认 —— 明确告诉用户去收信，
 *     而不是干等（旧站踩过：Supabase 对「邮箱已注册但未验证」不报错，
 *     只返回空的 identities，不特判的话用户会以为注册失败）
 *   · 英文错误统一翻译成中文，带上下一步该怎么做
 *   · 打开时锁 body 滚动、聚焦邮箱框，Esc / 点遮罩 / 关闭按钮都能关
 */
import { getSupabase } from "@/lib/supabase";

interface Props {
	open?: boolean;
	onclose?: () => void;
}

let { open = $bindable(false), onclose = () => {} }: Props = $props();

type Mode = "login" | "register";

let mode = $state<Mode>("login");
let email = $state("");
let password = $state("");
let confirm = $state("");
let nickname = $state("");
let loading = $state(false);
let errorMsg = $state("");
let infoMsg = $state("");

let emailInput = $state<HTMLInputElement>();

const isRegister = $derived(mode === "register");
const canSubmit = $derived(
	email.trim().length > 0 && password.length > 0 && !loading,
);

/** 把 Supabase 的英文错误翻成中文，并给出下一步动作 */
function translateAuthError(e: unknown): string {
	const msg = String(
		(e as { message?: string } | null)?.message ?? e ?? "",
	).trim();

	if (/Invalid login credentials/i.test(msg)) {
		return "邮箱或密码不正确。若邮箱还没做过邮箱验证，也会这样提示——去邮箱点确认链接，或在 Supabase 控制台 Authentication → Users 里手动确认。";
	}
	if (/already registered|already exists|User already registered/i.test(msg)) {
		return "该邮箱已注册，直接登录即可";
	}
	if (/Email not confirmed|not confirmed/i.test(msg)) {
		return "邮箱还没验证。去邮箱（含垃圾箱）点确认链接；或在 Supabase 控制台 Authentication → Users 手动确认该账号。";
	}
	if (/Password should be at least|Signup requires a valid password/i.test(msg)) {
		return "密码至少 6 位";
	}
	if (/Email rate limit exceeded|rate limit|too many/i.test(msg)) {
		return "操作太频繁（Supabase 免费版对发信与尝试次数限制很低）。等几分钟再试；也可以在 Authentication → Sign In / Up 关闭 Confirm email，注册即登录、彻底避开发信限制。";
	}
	if (/For security purposes/i.test(msg)) {
		return "请求太快了，等几秒再试";
	}
	if (/valid email|is invalid|invalid format/i.test(msg)) {
		return "邮箱格式看起来不对，检查一下再提交";
	}
	if (/Anonymous sign-ins are disabled/i.test(msg)) {
		return "本站未开放匿名登录，请用邮箱注册";
	}
	if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
		return "连不上后端。检查网络，或确认 Supabase 项目是否处于暂停状态";
	}
	if (/JWT|token|session/i.test(msg)) {
		return "登录状态已失效，请重新登录";
	}
	return msg || "操作失败，请稍后再试";
}

function close() {
	if (loading) return;
	open = false;
	onclose();
}

function switchMode(next: Mode) {
	mode = next;
	errorMsg = "";
	infoMsg = "";
	confirm = "";
}

async function submit() {
	if (!canSubmit) return;
	errorMsg = "";
	infoMsg = "";

	const mail = email.trim();
	if (!mail) {
		errorMsg = "请填写邮箱";
		return;
	}
	if (password.length < 6) {
		errorMsg = "密码至少 6 位";
		return;
	}
	if (isRegister && confirm && confirm !== password) {
		errorMsg = "两次输入的密码不一致";
		return;
	}

	const sb = await getSupabase();
	if (!sb) {
		errorMsg = "后端未连接，暂时无法登录";
		return;
	}

	loading = true;
	try {
		if (isRegister) {
			const { data, error } = await sb.auth.signUp({
				email: mail,
				password,
				options: { data: { display_name: nickname.trim() || null } },
			});
			if (error) throw error;

			// 邮箱已注册但没验证时，signUp 不报错，只返回空 identities
			if (
				data?.user &&
				Array.isArray(data.user.identities) &&
				data.user.identities.length === 0
			) {
				errorMsg =
					"这个邮箱注册过但还没完成验证：去邮箱（含垃圾箱）找确认邮件，或在 Supabase 控制台 Authentication → Users 里手动确认 / 删除该账号后重新注册。";
				mode = "login";
				return;
			}
			if (!data?.session) {
				infoMsg = "注册成功！确认邮件已发送，去邮箱（含垃圾箱）点链接即可。";
				mode = "login";
				password = "";
				confirm = "";
				return;
			}
			// 关闭了邮箱确认 → 已直接登录，onAuthStateChange 会刷新按钮
			loading = false;
			close();
			return;
		}

		const { error } = await sb.auth.signInWithPassword({
			email: mail,
			password,
		});
		if (error) throw error;
		// 先解除 loading，否则 close() 会被「加载中禁止关闭」挡住
		loading = false;
		close();
	} catch (e) {
		errorMsg = translateAuthError(e);
	} finally {
		loading = false;
	}
}

function onOverlayClick(e: MouseEvent) {
	if (e.target === e.currentTarget) close();
}

function onKeydown(e: KeyboardEvent) {
	if (e.key === "Escape" && open) {
		e.preventDefault();
		close();
	}
}

// 每次打开时重置状态并聚焦；关闭时恢复 body 滚动
$effect(() => {
	if (!open) return;

	errorMsg = "";
	infoMsg = "";
	loading = false;

	const prevOverflow = document.body.style.overflow;
	document.body.style.overflow = "hidden";

	const t = setTimeout(() => emailInput?.focus(), 60);

	return () => {
		clearTimeout(t);
		document.body.style.overflow = prevOverflow;
	};
});
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<div
		class="fixed inset-0 z-[2000] flex items-center justify-center p-4"
		role="presentation"
	>
		<!-- 遮罩 -->
		<div
			class="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
			role="presentation"
			onclick={onOverlayClick}
		></div>

		<!-- 卡片 -->
		<div
			class="relative w-full max-w-sm rounded-(--radius-large) border border-(--line-divider) bg-(--card-bg) p-6 shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="login-modal-title"
		>
			<div class="mb-5 flex items-center justify-between">
				<h2
					id="login-modal-title"
					class="m-0 text-lg font-bold text-neutral-900 dark:text-neutral-100"
				>
					{isRegister ? "注册" : "登录"}
				</h2>
				<button
					type="button"
					class="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-(--btn-regular-bg) hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
					aria-label="关闭"
					onclick={close}
				>
					<svg
						viewBox="0 0 24 24"
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						aria-hidden="true"
					>
						<path d="M18 6 6 18M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- 页签 -->
			<div
				class="mb-5 flex gap-1 rounded-xl bg-(--btn-regular-bg) p-1"
				role="tablist"
			>
				<button
					type="button"
					role="tab"
					aria-selected={!isRegister}
					class="flex-1 rounded-lg py-1.5 text-sm font-medium transition-all {!isRegister
						? 'bg-(--card-bg) text-(--primary) shadow-sm'
						: 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'}"
					onclick={() => switchMode("login")}
				>
					登录
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={isRegister}
					class="flex-1 rounded-lg py-1.5 text-sm font-medium transition-all {isRegister
						? 'bg-(--card-bg) text-(--primary) shadow-sm'
						: 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'}"
					onclick={() => switchMode("register")}
				>
					注册
				</button>
			</div>

			<form
				class="space-y-3"
				onsubmit={(e) => {
					e.preventDefault();
					submit();
				}}
			>
				{#if isRegister}
					<label class="block">
						<span
							class="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400"
							>昵称（可留空）</span
						>
						<input
							type="text"
							bind:value={nickname}
							maxlength="24"
							placeholder="怎么称呼你"
							autocomplete="nickname"
							class="w-full rounded-lg border border-(--line-divider) bg-(--btn-regular-bg) px-3 py-2 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-(--primary) dark:text-neutral-100"
						/>
					</label>
				{/if}

				<label class="block">
					<span
						class="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400"
						>邮箱</span
					>
					<input
						bind:this={emailInput}
						type="email"
						bind:value={email}
						required
						placeholder="you@example.com"
						autocomplete="email"
						class="w-full rounded-lg border border-(--line-divider) bg-(--btn-regular-bg) px-3 py-2 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-(--primary) dark:text-neutral-100"
					/>
				</label>

				<label class="block">
					<span
						class="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400"
						>密码</span
					>
					<input
						type="password"
						bind:value={password}
						required
						minlength="6"
						placeholder="至少 6 位"
						autocomplete={isRegister ? "new-password" : "current-password"}
						class="w-full rounded-lg border border-(--line-divider) bg-(--btn-regular-bg) px-3 py-2 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-(--primary) dark:text-neutral-100"
					/>
				</label>

				{#if isRegister}
					<label class="block">
						<span
							class="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400"
							>确认密码</span
						>
						<input
							type="password"
							bind:value={confirm}
							placeholder="再输一次"
							autocomplete="new-password"
							class="w-full rounded-lg border border-(--line-divider) bg-(--btn-regular-bg) px-3 py-2 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-(--primary) dark:text-neutral-100"
						/>
					</label>
				{/if}

				{#if errorMsg}
					<p
						class="m-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
						role="alert"
					>
						{errorMsg}
					</p>
				{/if}

				{#if infoMsg}
					<p
						class="m-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
						role="status"
					>
						{infoMsg}
					</p>
				{/if}

				<button
					type="submit"
					disabled={!canSubmit}
					class="mt-2 w-full rounded-lg bg-(--primary) py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{loading ? "请稍候…" : isRegister ? "注册" : "登录"}
				</button>
			</form>

			<p class="mt-4 mb-0 text-center text-xs text-neutral-500 dark:text-neutral-500">
				账号只用于留言、排行榜与联机对局，不会用于其他用途
			</p>
		</div>
	</div>
{/if}
