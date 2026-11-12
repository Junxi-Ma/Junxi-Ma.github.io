<script lang="ts">
/**
 * AccountButton — 导航栏右侧的账号入口
 *
 * 放在搜索 / 音乐 / 主题那一排的最左边，尺寸与它们一致（h-11 w-11）。
 *
 * 三种状态：
 *   未配置 Supabase → 完全不渲染（整站退回纯静态）
 *   未登录           → 「登录」按钮，点开弹窗
 *   已登录           → 头像按钮 + 下拉菜单（账号信息 / 管理后台 / 退出）
 *
 * 首帧处理：SSR 只能渲染一个同尺寸占位，否则已登录用户会先看到「登录」
 * 再闪成头像。onMount 里同步读 localStorage 的会话缓存，几乎没有空窗。
 */
import { onMount } from "svelte";
import { getSupabase, isConfigured } from "@/lib/supabase";
import LoginModal from "./LoginModal.svelte";

/* biome-ignore lint/suspicious/noExplicitAny: supabase-js 是运行时动态加载的，类型不参与构建 */
type SbUser = any;

const configured = isConfigured();

let ready = $state(false);
/** biome-ignore lint/suspicious/noExplicitAny: 同上 */
let user = $state<SbUser | null>(null);
let isAdmin = $state(false);
let avatarUrl = $state("");
let nickName = $state("");

let menuOpen = $state(false);
let modalOpen = $state(false);
let wrapEl = $state<HTMLDivElement>();

/** biome-ignore lint/suspicious/noExplicitAny: 同上 */
let sb: any = null;

const loggedIn = $derived(Boolean(user));

const displayName = $derived(
	nickName ||
		(user?.user_metadata?.display_name as string | undefined) ||
		(user?.email ? String(user.email).split("@")[0] : "用户"),
);

const initial = $derived(
	(displayName || "?").trim().charAt(0).toUpperCase() || "?",
);

/**
 * 同步读取 supabase-js 缓存的会话，避免换页时按钮先显示「登录」再闪变。
 * 缓存键形如 sb-<项目ref>-auth-token，值是会话 JSON。
 */
function cachedUser(): SbUser | null {
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (!k?.startsWith("sb-") || !k.endsWith("-auth-token")) continue;
			const raw = JSON.parse(localStorage.getItem(k) || "null");
			const u = raw?.user ?? raw?.currentUser?.user ?? null;
			if (u?.id) return u;
		}
	} catch {
		/* 隐私模式忽略 */
	}
	return null;
}

/** 读资料与管理员身份；被封禁的账号直接踢下线 */
async function loadIdentity(u: SbUser | null) {
	if (!sb || !u) {
		isAdmin = false;
		avatarUrl = "";
		nickName = "";
		return;
	}

	// profiles 表目前只有 display_name / banned，avatar_url 是预留字段。
	// 先按含 avatar_url 查；列不存在时 Supabase 返回 error 而不抛异常，
	// 所以要显式判断 error 再走回退，不能只靠 try/catch。
  	/** biome-ignore lint/suspicious/noExplicitAny: 同上 */
	let profile: any = null;

	try {
		const { data, error } = await sb
			.from("profiles")
			.select("display_name, avatar_url, banned")
			.eq("id", u.id)
			.maybeSingle();
		if (!error) profile = data;
	} catch {
		/* 忽略，走下面的回退 */
	}

	if (!profile) {
		try {
			const { data, error } = await sb
				.from("profiles")
				.select("display_name, banned")
				.eq("id", u.id)
				.maybeSingle();
			if (!error) profile = data;
		} catch {
			/* profiles 表还不存在时忽略 */
		}
	}

	if (profile) {
		nickName = profile.display_name || "";
		avatarUrl = profile.avatar_url || "";
		if (profile.banned) {
			await sb.auth.signOut();
			window.alert("该账号已被封禁，如有疑问请联系站长。");
			return;
		}
	}

	try {
		const { data } = await sb.rpc("is_admin");
		isAdmin = data === true;
	} catch {
		isAdmin = false;
	}
}

async function refresh() {
	if (!sb) return;
	try {
		const { data } = await sb.auth.getSession();
		user = data?.session?.user ?? null;
	} catch {
		user = null;
	}
	await loadIdentity(user);
}

async function signOut() {
	menuOpen = false;
	try {
		await sb?.auth.signOut();
	} catch {
		/* 忽略：refresh() 由 onAuthStateChange 触发 */
	}
	user = null;
	isAdmin = false;
	avatarUrl = "";
	nickName = "";
}

function toggleMenu() {
	menuOpen = !menuOpen;
}

function onDocPointerDown(e: PointerEvent) {
	if (!menuOpen) return;
	const t = e.target as Node | null;
	if (wrapEl && t && !wrapEl.contains(t)) menuOpen = false;
}

function onKeydown(e: KeyboardEvent) {
	if (e.key === "Escape" && menuOpen) menuOpen = false;
}

onMount(() => {
	if (!configured) return;

	// 同步出首帧：有缓存就直接显示头像，没有就显示「登录」
	user = cachedUser();
	ready = true;

	/** biome-ignore lint/suspicious/noExplicitAny: 同上 */
	let subscription: any = null;

	getSupabase().then(async (client: any) => {
		if (!client) return;
		sb = client;
		await refresh();
		const res = client.auth.onAuthStateChange(() => {
			refresh();
		});
		subscription = res?.data?.subscription ?? null;
	});

	return () => {
		subscription?.unsubscribe?.();
	};
});
</script>

<svelte:window
	onkeydown={onKeydown}
	onpointerdown={onDocPointerDown}
/>

{#if configured}
	{#if !ready}
		<!-- 与服务端渲染的同尺寸占位，避免布局跳动 -->
		<div class="h-11 w-11" aria-hidden="true"></div>
	{:else}
		<div class="relative" bind:this={wrapEl}>
			{#if loggedIn}
				<button
					type="button"
					class="btn-plain scale-animation flex h-11 w-11 items-center justify-center rounded-lg active:scale-90"
					aria-label="账号菜单"
					aria-haspopup="menu"
					aria-expanded={menuOpen}
					title={user?.email ?? displayName}
					onclick={toggleMenu}
				>
					{#if avatarUrl}
						<img
							src={avatarUrl}
							alt=""
							class="h-7 w-7 rounded-full object-cover"
							loading="lazy"
						/>
					{:else}
						<span
							class="flex h-7 w-7 items-center justify-center rounded-full bg-(--primary) text-xs font-bold text-white"
						>
							{initial}
						</span>
					{/if}
				</button>

				{#if menuOpen}
					<div
						class="absolute top-[3.25rem] right-0 z-50 w-60 overflow-hidden rounded-xl border border-(--line-divider) bg-(--float-panel-bg) shadow-xl"
						role="menu"
					>
						<div class="px-3.5 py-3">
							<p
								class="m-0 truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100"
							>
								{displayName}
							</p>
							<p class="m-0 mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-500">
								{user?.email ?? ""}
							</p>
						</div>

						<div class="h-px bg-(--line-divider)"></div>

						<div class="p-1.5">
							{#if isAdmin}
								<a
									href="/admin/"
									class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-neutral-700 no-underline transition-colors hover:bg-(--btn-regular-bg) hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
									role="menuitem"
								>
									<svg
										viewBox="0 0 24 24"
										class="h-4 w-4 shrink-0"
										fill="none"
										stroke="currentColor"
										stroke-width="1.8"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M12 2 4 6v6c0 5 3.4 9.3 8 10 4.6-.7 8-5 8-10V6l-8-4Z" />
									</svg>
									管理后台
								</a>
							{/if}

							<button
								type="button"
								class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-neutral-700 transition-colors hover:bg-(--btn-regular-bg) hover:text-red-600 dark:text-neutral-300 dark:hover:text-red-400"
								role="menuitem"
								onclick={signOut}
							>
								<svg
									viewBox="0 0 24 24"
									class="h-4 w-4 shrink-0"
									fill="none"
									stroke="currentColor"
									stroke-width="1.8"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
									<path d="m16 17 5-5-5-5M21 12H9" />
								</svg>
								退出登录
							</button>
						</div>
					</div>
				{/if}
			{:else}
				<button
					type="button"
					class="btn-plain scale-animation flex h-11 items-center gap-1.5 rounded-lg px-3 active:scale-90"
					aria-label="登录或注册"
					title="登录 / 注册"
					onclick={() => {
						modalOpen = true;
					}}
				>
					<svg
						viewBox="0 0 24 24"
						class="h-[1.15rem] w-[1.15rem] shrink-0"
						fill="none"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<circle cx="12" cy="8" r="4" />
						<path d="M20 21a8 8 0 0 0-16 0" />
					</svg>
					<span class="hidden text-sm font-medium md:inline">登录</span>
				</button>
			{/if}
		</div>

		<LoginModal bind:open={modalOpen} />
	{/if}
{/if}
