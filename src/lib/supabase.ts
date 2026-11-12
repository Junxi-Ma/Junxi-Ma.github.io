/**
 * Supabase 客户端（前端专用）
 *
 * 设计要点：
 *   1. 只有浏览器端才会真正加载库；构建时不留任何服务端调用
 *   2. 库文件走 public/assets/js/vendor/supabase.esm.js，不用 CDN
 *      （2026-10 的教训：jsdelivr 在国内移动网络经常不可达，
 *       库加载失败会让全站显示"未连接云端"，排行榜直接打不开）
 *   3. URL / key 留空时 isConfigured() 返回 false，整站优雅降级为纯静态
 *   4. 单例：多处调用只初始化一次
 *
 * 后端结构见 supabase/schema.sql（17 张表 + 18 个 RPC），不要改它。
 */

const SUPABASE_URL = "https://pimyumfvricwpigqlacv.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Lz1UOc8oPtTOxv6shuYPYA__5bBUcE9";

/** 运行时从 public 目录加载，路径与页面无关 */
const LIB = "/assets/js/vendor/supabase.esm.js?v=1";

export function isConfigured(): boolean {
	return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

// 用 any 是为了不把 @supabase/supabase-js 的类型拉进构建图（库是运行时加载的）
// biome-ignore lint/suspicious/noExplicitAny: 运行时动态加载，类型不参与构建
let clientPromise: Promise<any> | null = null;

/**
 * 返回 Supabase 客户端的 Promise。
 * 未配置、或在浏览器加载失败时 resolve(null)，调用方必须处理 null。
 */
// biome-ignore lint/suspicious/noExplicitAny: 同上
export function getSupabase(): Promise<any> {
	if (!isConfigured()) return Promise.resolve(null);
	if (!clientPromise) {
		clientPromise = import(/* @vite-ignore */ LIB)
			.then(({ createClient }) =>
				createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
					auth: { persistSession: true, autoRefreshToken: true },
				}),
			)
			.catch((e: unknown) => {
				console.warn("[supabase] 初始化失败，退回静态模式：", e);
				clientPromise = null;
				return null;
			});
	}
	return clientPromise;
}

/** 当前登录用户（未登录或未配置返回 null） */
// biome-ignore lint/suspicious/noExplicitAny: 同上
export async function currentUser(): Promise<any | null> {
	const sb = await getSupabase();
	if (!sb) return null;
	try {
		const { data } = await sb.auth.getUser();
		return data?.user ?? null;
	} catch {
		return null;
	}
}

/**
 * 访客匿名 id：只用于统计去重，不含任何个人信息。
 * 与旧站共用同一个 localStorage 键，迁移后访客不会重复计数。
 */
const VISITOR_KEY = "site-visitor-id";

export function visitorId(): string {
	let id: string | null = null;
	try {
		id = localStorage.getItem(VISITOR_KEY);
	} catch {
		/* 隐私模式忽略 */
	}
	if (!id) {
		id = globalThis.crypto?.randomUUID
			? crypto.randomUUID()
			: `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
		try {
			localStorage.setItem(VISITOR_KEY, id);
		} catch {
			/* 忽略 */
		}
	}
	return id;
}
