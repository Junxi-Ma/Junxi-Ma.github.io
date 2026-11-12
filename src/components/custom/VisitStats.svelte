<script lang="ts">
/**
 * VisitStats.svelte — 侧栏的实时访客统计
 *
 * 替代模板在构建时算死的静态数字。数据来自 Supabase：
 *   · 上报：每次加载向 visits 表插一条 { visitor_id, path }
 *   · 聚合：RPC get_site_stats() 返回 total_views / unique_visitors / today_views
 *
 * 三条原则：
 *   1. 没配后端或加载失败 → 数字显示「—」，不报错、不塌陷
 *   2. 上报失败不影响看统计
 *   3. 先上报再取数，让本次访问立即算进去
 *
 * 用法：包在侧栏的 WidgetLayout 里
 *   <WidgetLayout name="访客统计"><VisitStats client:only="svelte" /></WidgetLayout>
 */
import { onMount } from "svelte";
import { getSupabase, isConfigured, visitorId } from "@/lib/supabase";

interface SiteStats {
	total_views: number;
	unique_visitors: number;
	today_views: number;
}

let loading = $state(true);
let stats = $state<SiteStats | null>(null);

onMount(() => {
	let cancelled = false;

	function toCount(v: unknown): number {
		const n = Number(v);
		return Number.isFinite(n) && n >= 0 ? n : 0;
	}

	(async () => {
		try {
			if (!isConfigured()) return;
			const sb = await getSupabase();
			if (!sb || cancelled) return;

			// 1. 先上报本次访问（失败继续，统计照样看）
			try {
				await sb.from("visits").insert({
					visitor_id: visitorId(),
					path: location.pathname,
				});
			} catch {
				/* 上报失败不影响读统计 */
			}

			if (cancelled) return;

			// 2. 再取聚合数，这样包含刚上报的这一次
			const { data, error } = await sb.rpc("get_site_stats");
			if (error) return;

			const row = Array.isArray(data) ? data[0] : data;
			if (!row || cancelled) return;

			stats = {
				total_views: toCount(row.total_views),
				unique_visitors: toCount(row.unique_visitors),
				today_views: toCount(row.today_views),
			};
		} catch {
			/* 静默降级 */
		} finally {
			if (!cancelled) loading = false;
		}
	})();

	return () => {
		cancelled = true;
	};
});

/** 三条统计行：图标内联 SVG，避免依赖图标数据的注册情况 */
const rows = [
	{
		key: "total",
		label: "总访问",
		path: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
	},
	{
		key: "unique",
		label: "独立访客",
		path: "M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20 M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7 M21 20v-1.5a4 4 0 0 0-3-3.87 M16.5 3.6a4 4 0 0 1 0 7.75",
	},
	{
		key: "today",
		label: "今日",
		path: "M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z M8 3v4 M16 3v4 M4 10h16 M9 14h2 M13 14h2",
	},
] as const;

const values = $derived({
	total: stats?.total_views,
	unique: stats?.unique_visitors,
	today: stats?.today_views,
});

function display(v: number | undefined): string {
	if (loading) return "";
	if (v === undefined) return "—";
	return v.toLocaleString();
}
</script>

<div class="flex flex-col gap-2">
	{#each rows as row (row.key)}
		<div class="flex items-center justify-between px-3 py-1.5">
			<div class="flex items-center gap-2.5">
				<svg
					class="visit-icon text-(--primary)"
					viewBox="0 0 24 24"
					aria-hidden="true"
					fill="none"
					stroke="currentColor"
					stroke-width="1.7"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d={row.path} />
				</svg>
				<span class="text-sm font-medium text-neutral-700 dark:text-neutral-300">
					{row.label}
				</span>
			</div>

			{#if loading}
				<span class="visit-skeleton" aria-hidden="true"></span>
			{:else}
				<span class="text-base font-bold text-neutral-900 dark:text-neutral-100">
					{display(values[row.key])}
				</span>
			{/if}
		</div>
	{/each}
</div>

<style>
	.visit-icon {
		width: 20px;
		height: 20px;
		flex: none;
	}

	.visit-skeleton {
		width: 34px;
		height: 15px;
		border-radius: 6px;
		background: var(--btn-regular-bg);
		animation: visit-pulse 1.4s ease-in-out infinite;
	}

	@keyframes visit-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.45;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.visit-skeleton {
			animation: none;
			opacity: 0.6;
		}
	}
</style>
