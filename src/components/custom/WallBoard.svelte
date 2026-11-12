<script lang="ts">
/**
 * 留言墙（Supabase 版）
 *
 * 后端是 supabase/schema.sql 里的 wall_posts / wall_replies 两张表，
 * 与 branches/junxun/ 军训祝福页共用同一套数据和 RPC，字段名严格照抄，
 * 不额外加列。行级安全策略是公开读写，读不需要登录，发帖才要。
 *
 * 降级策略（按优先级）：
 *   - isConfigured() 为 false        → 整块不渲染
 *   - 表/列还没建齐（pinned 是后加的）→ 逐级退掉 select 里的列，不停服务
 *   - 请求失败                        → 显示「留言墙暂时不可用」，不抛错
 */
import { onMount } from "svelte";
import { currentUser, getSupabase, isConfigured } from "@/lib/supabase";

interface Reply {
	id: number;
	post_id: number;
	name: string | null;
	content: string;
	created_at: string;
}

interface Post {
	id: number;
	name: string | null;
	content: string;
	likes: number;
	created_at: string;
	has_photo?: boolean;
	pinned?: boolean;
	replies: Reply[];
}

const PAGE_SIZE = 8;
const LIKED_KEY = "wall-liked-ids";
const NAME_KEY = "wall-name";

// biome-ignore lint/suspicious/noExplicitAny: 运行时加载的库，类型不进构建图
let sb: any = null;

let mounted = $state(false);
let loading = $state(true);
let failed = $state(false);
let posts = $state<Post[]>([]);
let hasMore = $state(false);
let loadingMore = $state(false);

// biome-ignore lint/suspicious/noExplicitAny: Supabase 的 User 类型不参与构建
let user = $state<any>(null);
let authorName = $state("");

let draft = $state("");
let posting = $state(false);
let expandedId = $state<number | null>(null);
let replyDraft = $state("");
let replyingId = $state<number | null>(null);
let likedIds = $state<number[]>([]);
let notice = $state("");

const canPost = $derived(Boolean(user));

/* ───────────────────────── 工具函数 ───────────────────────── */

function readLiked(): number[] {
	try {
		const raw = localStorage.getItem(LIKED_KEY);
		const arr = raw ? JSON.parse(raw) : [];
		return Array.isArray(arr) ? arr.filter((n) => typeof n === "number") : [];
	} catch {
		return [];
	}
}

function rememberLiked(id: number) {
	if (likedIds.includes(id)) return;
	likedIds = [...likedIds, id];
	try {
		localStorage.setItem(LIKED_KEY, JSON.stringify(likedIds));
	} catch {
		/* 隐私模式忽略 */
	}
}

function rememberName(name: string) {
	try {
		localStorage.setItem(NAME_KEY, name);
	} catch {
		/* 忽略 */
	}
}

/** 「3 分钟前」「2 天前」；超过一年显示日期 */
function relativeTime(iso: string): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return "";
	const diff = Date.now() - then;
	if (diff < 0) return "刚刚";
	const min = Math.floor(diff / 60000);
	if (min < 1) return "刚刚";
	if (min < 60) return `${min} 分钟前`;
	const hour = Math.floor(min / 60);
	if (hour < 24) return `${hour} 小时前`;
	const day = Math.floor(hour / 24);
	if (day < 30) return `${day} 天前`;
	const month = Math.floor(day / 30);
	if (month < 12) return `${month} 个月前`;
	return new Date(iso).toLocaleDateString("zh-CN");
}

/** 头像用名字首字：wall_posts 没有 user_id，profiles 也没有头像列，关联不上 */
function initial(name: string | null): string {
	const n = (name || "匿").trim();
	if (!n) return "匿";
	// 中文取第一个字，拉丁字母取首字母大写
	return /^[a-zA-Z]/.test(n) ? n[0].toUpperCase() : n[0];
}

/* ───────────────────────── 数据层 ───────────────────────── */

/** 逐级降级取帖子：pinned 与 has_photo 都是后加列，老库可能没有 */
async function fetchPosts(from: number) {
	// 多取一条用来判断还有没有下一页（range 的右端是闭区间）
	const to = from + PAGE_SIZE;
	const base = "id,name,content,likes,created_at";
	const attempts = [
		{ cols: `${base},has_photo,pinned`, byPinned: true },
		{ cols: `${base},has_photo`, byPinned: false },
		{ cols: base, byPinned: false },
	];

	let lastError: unknown = null;
	for (const a of attempts) {
		let q = sb.from("wall_posts").select(a.cols);
		if (a.byPinned) q = q.order("pinned", { ascending: false });
		q = q.order("created_at", { ascending: false }).range(from, to);
		const { data, error } = await q;
		if (!error) return { rows: (data ?? []) as Post[], byPinned: a.byPinned };
		lastError = error;
	}
	throw lastError ?? new Error("fetch failed");
}

/** 一次性取全部回复并在内存里分桶：留言量不大，比逐帖查询省往返 */
async function fetchReplies(): Promise<Record<number, Reply[]>> {
	const { data, error } = await sb
		.from("wall_replies")
		.select("id,post_id,name,content,created_at")
		.order("created_at", { ascending: true });
	if (error) return {};
	const map: Record<number, Reply[]> = {};
	for (const r of (data ?? []) as Reply[]) {
		(map[r.post_id] ||= []).push(r);
	}
	return map;
}

async function load() {
	loading = true;
	failed = false;
	try {
		const { rows } = await fetchPosts(0);
		const replies = await fetchReplies();
		const filled = rows.map((p) => ({
			...p,
			has_photo: Boolean(p.has_photo),
			pinned: Boolean(p.pinned),
			replies: replies[p.id] ?? [],
		}));
		posts = filled.slice(0, PAGE_SIZE);
		hasMore = filled.length > PAGE_SIZE;
	} catch (e) {
		console.warn("[wall] 读取失败：", e);
		failed = true;
	} finally {
		loading = false;
	}
}

async function loadMore() {
	if (loadingMore || !hasMore) return;
	loadingMore = true;
	try {
		const { rows } = await fetchPosts(posts.length);
		const replies = await fetchReplies();
		const next = rows
			.slice(0, PAGE_SIZE)
			.map((p) => ({
				...p,
				has_photo: Boolean(p.has_photo),
				pinned: Boolean(p.pinned),
				replies: replies[p.id] ?? [],
			}));
		// 去重：并发插入时 offset 分页可能重复
		const seen = new Set(posts.map((p) => p.id));
		posts = [...posts, ...next.filter((p) => !seen.has(p.id))];
		hasMore = rows.length > PAGE_SIZE;
	} catch (e) {
		console.warn("[wall] 加载更多失败：", e);
		hasMore = false;
	} finally {
		loadingMore = false;
	}
}

/** 被封禁的账号不允许发帖（后端 RPC 判定，前端只做提前提示） */
async function isBanned(): Promise<boolean> {
	try {
		const { data } = await sb.rpc("is_banned");
		return data === true;
	} catch {
		return false;
	}
}

async function submitPost() {
	const content = draft.trim();
	if (!content || posting) return;
	if (!canPost) {
		notice = "登录后可以留言";
		return;
	}
	posting = true;
	notice = "";
	try {
		if (await isBanned()) {
			notice = "当前账号已被限制发言";
			return;
		}
		const name = (authorName || user?.email?.split("@")[0] || "访客").slice(0, 24);
		const { data, error } = await sb
			.from("wall_posts")
			.insert({ name, content, photo: null, likes: 0 })
			.select("id,name,content,likes,created_at,has_photo,pinned")
			.single();
		if (error) throw error;
		rememberName(name);
		posts = [
			{
				...(data as Post),
				has_photo: Boolean(data?.has_photo),
				pinned: Boolean(data?.pinned),
				replies: [],
			},
			...posts,
		];
		draft = "";
	} catch (e) {
		console.warn("[wall] 发帖失败：", e);
		notice = "发布失败，稍后再试";
	} finally {
		posting = false;
	}
}

async function submitReply(post: Post) {
	const content = replyDraft.trim();
	if (!content || replyingId !== null) return;
	if (!canPost) {
		notice = "登录后可以回复";
		return;
	}
	replyingId = post.id;
	notice = "";
	try {
		if (await isBanned()) {
			notice = "当前账号已被限制发言";
			return;
		}
		const name = (authorName || user?.email?.split("@")[0] || "访客").slice(0, 24);
		const { data, error } = await sb
			.from("wall_replies")
			.insert({ post_id: post.id, name, content })
			.select("id,post_id,name,content,created_at")
			.single();
		if (error) throw error;
		posts = posts.map((p) =>
			p.id === post.id ? { ...p, replies: [...p.replies, data as Reply] } : p,
		);
		replyDraft = "";
	} catch (e) {
		console.warn("[wall] 回复失败：", e);
		notice = "回复失败，稍后再试";
	} finally {
		replyingId = null;
	}
}

async function toggleLike(post: Post) {
	if (likedIds.includes(post.id)) return;
	rememberLiked(post.id);
	// 先动 UI，失败再回滚
	const before = post.likes;
	posts = posts.map((p) => (p.id === post.id ? { ...p, likes: p.likes + 1 } : p));
	try {
		const { error } = await sb.rpc("bump_likes", { p_id: post.id, p_delta: 1 });
		if (error) throw error;
	} catch (e) {
		console.warn("[wall] 点赞失败：", e);
		posts = posts.map((p) => (p.id === post.id ? { ...p, likes: before } : p));
	}
}

function toggleExpand(post: Post) {
	expandedId = expandedId === post.id ? null : post.id;
	replyDraft = "";
	notice = "";
}

/* ───────────────────────── 生命周期 ───────────────────────── */

onMount(() => {
	// onMount 的回调不能用 async：返回的 Promise 会被当成清理函数
	(async () => {
		mounted = true;
		if (!isConfigured()) {
			loading = false;
			return;
		}
		sb = await getSupabase();
		if (!sb) {
			loading = false;
			return;
		}
		likedIds = readLiked();
		try {
			authorName = localStorage.getItem(NAME_KEY) ?? "";
		} catch {
			/* 忽略 */
		}
		user = await currentUser();
		await load();
	})();
});
</script>

{#if mounted && isConfigured()}
	<section
		class="mt-4 rounded-(--radius-large) border border-(--line-divider) bg-(--card-bg) px-6 py-6 sm:px-9"
		aria-labelledby="wall-title"
	>
		<header class="mb-5 flex items-end justify-between gap-3">
			<div>
				<h2
					id="wall-title"
					class="m-0 text-xl font-bold text-neutral-900 dark:text-neutral-100"
				>
					留言墙
				</h2>
				<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
					说点什么，或者回应别人。
				</p>
			</div>
			{#if posts.length > 0}
				<span class="text-sm text-neutral-500 dark:text-neutral-400">
					{posts.length}{hasMore ? "+" : ""} 条
				</span>
			{/if}
		</header>

		<!-- 发帖区 -->
		<div class="mb-6">
			{#if !canPost}
				<div
					class="rounded-xl border border-(--line-divider) bg-(--btn-regular-bg) px-4 py-3 text-sm text-neutral-600 dark:text-neutral-400"
				>
					登录后可以留言
				</div>
			{:else}
				<div class="flex flex-col gap-2">
					<input
						class="w-full rounded-lg border border-(--line-divider) bg-(--page-bg) px-3 py-2 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-(--primary) dark:text-neutral-100"
						placeholder="署名（可留空，默认用账号名）"
						maxlength="24"
						bind:value={authorName}
					/>
					<textarea
						class="min-h-[76px] w-full resize-y rounded-lg border border-(--line-divider) bg-(--page-bg) px-3 py-2 text-sm leading-relaxed text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-(--primary) dark:text-neutral-100"
						placeholder="写点什么……"
						maxlength="2000"
						bind:value={draft}
					></textarea>
					<div class="flex items-center justify-between gap-3">
						<span class="text-xs text-neutral-500 dark:text-neutral-400">
							{#if notice}{notice}{/if}
						</span>
						<button
							type="button"
							class="rounded-lg bg-(--primary) px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
							disabled={posting || !draft.trim()}
							onclick={submitPost}
						>
							{posting ? "发布中…" : "发布"}
						</button>
					</div>
				</div>
			{/if}
		</div>

		<!-- 列表 -->
		{#if loading}
			<div class="space-y-3">
				{#each [0, 1, 2] as i (i)}
					<div class="animate-pulse rounded-xl border border-(--line-divider) p-4">
						<div class="mb-3 flex items-center gap-3">
							<div class="h-9 w-9 rounded-full bg-(--btn-regular-bg)"></div>
							<div class="h-3 w-24 rounded bg-(--btn-regular-bg)"></div>
						</div>
						<div class="mb-2 h-3 w-full rounded bg-(--btn-regular-bg)"></div>
						<div class="h-3 w-2/3 rounded bg-(--btn-regular-bg)"></div>
					</div>
				{/each}
				<p class="text-center text-sm text-neutral-500 dark:text-neutral-400">加载中…</p>
			</div>
		{:else if failed}
			<p class="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
				留言墙暂时不可用
			</p>
		{:else if posts.length === 0}
			<p class="py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
				还没有人留言，来当第一个吧。
			</p>
		{:else}
			<ul class="m-0 list-none space-y-3 p-0">
				{#each posts as post (post.id)}
					{@const liked = likedIds.includes(post.id)}
					{@const open = expandedId === post.id}
					<li
						class="rounded-xl border border-(--line-divider) bg-(--page-bg) p-4 transition-colors"
					>
						<div class="flex gap-3">
							<div
								class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--btn-regular-bg) text-sm font-semibold text-neutral-700 dark:text-neutral-200"
								aria-hidden="true"
							>
								{initial(post.name)}
							</div>
							<div class="min-w-0 flex-1">
								<div class="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
									<span class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
										{post.name || "匿名"}
									</span>
									{#if post.pinned}
										<span
											class="rounded bg-(--btn-regular-bg) px-1.5 py-0.5 text-[11px] text-(--primary)"
										>
											置顶
										</span>
									{/if}
									<span class="text-xs text-neutral-500 dark:text-neutral-400">
										{relativeTime(post.created_at)}
									</span>
								</div>
								<p
									class="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-700 dark:text-neutral-300"
								>
									{post.content}
								</p>
								<div class="mt-2 flex items-center gap-4">
									<button
										type="button"
										class="inline-flex items-center gap-1 text-xs transition-colors {liked
											? 'text-(--primary)'
											: 'text-neutral-500 dark:text-neutral-400'}"
										disabled={liked}
										aria-pressed={liked}
										onclick={() => toggleLike(post)}
									>
										<span aria-hidden="true">{liked ? "♥" : "♡"}</span>
										<span>{post.likes}</span>
									</button>
									<button
										type="button"
										class="inline-flex items-center gap-1 text-xs text-neutral-500 transition-colors hover:text-(--primary) dark:text-neutral-400"
										aria-expanded={open}
										onclick={() => toggleExpand(post)}
									>
										<span aria-hidden="true">💬</span>
										<span>{open ? "收起" : `回复 ${post.replies.length}`}</span>
									</button>
								</div>
							</div>
						</div>

						{#if open}
							<div class="mt-3 border-t border-(--line-divider) pt-3 pl-12">
								{#if post.replies.length > 0}
									<ul class="m-0 mb-3 list-none space-y-2 p-0">
										{#each post.replies as reply (reply.id)}
											<li class="text-sm">
												<span class="font-medium text-neutral-900 dark:text-neutral-100">
													{reply.name || "匿名"}
												</span>
												<span class="ml-2 text-xs text-neutral-500 dark:text-neutral-400">
													{relativeTime(reply.created_at)}
												</span>
												<p
													class="m-0 mt-0.5 whitespace-pre-wrap break-words leading-relaxed text-neutral-700 dark:text-neutral-300"
												>
													{reply.content}
												</p>
											</li>
										{/each}
									</ul>
								{:else}
									<p class="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
										还没有回复。
									</p>
								{/if}

								{#if canPost}
									<div class="flex gap-2">
										<input
											class="min-w-0 flex-1 rounded-lg border border-(--line-divider) bg-(--card-bg) px-3 py-1.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-(--primary) dark:text-neutral-100"
											placeholder="回复这条留言…"
											maxlength="1000"
											bind:value={replyDraft}
										/>
										<button
											type="button"
											class="shrink-0 rounded-lg bg-(--primary) px-3 py-1.5 text-sm font-medium text-white transition-opacity disabled:opacity-50"
											disabled={replyingId === post.id || !replyDraft.trim()}
											onclick={() => submitReply(post)}
										>
											{replyingId === post.id ? "发送中…" : "回复"}
										</button>
									</div>
								{:else}
									<p class="text-xs text-neutral-500 dark:text-neutral-400">
										登录后可以回复
									</p>
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ul>

			{#if hasMore}
				<div class="mt-4 text-center">
					<button
						type="button"
						class="rounded-lg border border-(--line-divider) px-4 py-2 text-sm text-neutral-600 transition-colors hover:border-(--primary) hover:text-(--primary) disabled:opacity-50 dark:text-neutral-400"
						disabled={loadingMore}
						onclick={loadMore}
					>
						{loadingMore ? "加载中…" : "加载更多"}
					</button>
				</div>
			{/if}
		{/if}
	</section>
{/if}
