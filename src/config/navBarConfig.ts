import {
	type NavBarConfig,
	type NavBarLink,
	type NavBarSearchConfig,
	NavBarSearchMethod,
} from "../types/navBarConfig";

// ============================================================================
// 导航栏配置 - 根据顺序动态生成导航栏链接
// NavBar Configuration - Dynamically generate navigation bar links based on order
//
// 本站结构（2026-11 迁移后）：
//   顶栏一级：主页 / 文章 / 工具 / 分支 / 关于我 / 更多
//   文章下拉：归档 · 分类 · 标签 · 系列
//   更多下拉：相册 · 动态 · 友链 · GitHub · 站点仓库
// 「工具」与「分支」是本站在博客骨架之外自建的两个板块，
// 页面在 src/pages/tools/ 与 src/pages/branches/。
// 一级项从 9 个收到 6 个：1024–1280px 窗口下原方案会把链接压到换行。
// ============================================================================
const getDynamicNavBarConfig = (): NavBarConfig => {
	// 基础导航栏链接
	const links: NavBarLink[] = [];

	// 主页
	links.push(LinkPresets.Home);

	// 文章及其子菜单
	links.push({
		name: "文章",
		url: "#",
		icon: "material-symbols:article",
		children: [
			// 归档
			LinkPresets.Archive,

			// 分类
			LinkPresets.Categories,

			// 标签
			LinkPresets.Tags,

			// 系列
			LinkPresets.Series,
		],
	});

	// 工具（自建板块）
	links.push({
		name: "工具",
		url: "/tools/",
		icon: "material-symbols:build",
	});

	// 分支（自建板块）
	links.push({
		name: "分支",
		url: "/branches/",
		icon: "material-symbols:account-tree",
	});

	// 关于
	links.push(LinkPresets.About);

	// 「更多」：收纳低频页面与站外链接。
	// 相册/动态/友链属于偶尔一逛的内容页，放一级会挤掉常用入口的宽度。
	links.push({
		name: "更多",
		url: "#",
		icon: "material-symbols:more-horiz",
		children: [
			LinkPresets.Gallery,
			LinkPresets.Dynamic,
			LinkPresets.Friends,
			{
				name: "GitHub",
				url: "https://github.com/Junxi-Ma",
				external: true,
				icon: "fa7-brands:github",
			},
			{
				name: "站点仓库",
				url: "https://github.com/Junxi-Ma/Junxi-Ma.github.io",
				external: true,
				icon: "material-symbols:code",
			},
		],
	});

	return { links } as NavBarConfig;
};

// 导航搜索配置
export const navBarSearchConfig: NavBarSearchConfig = {
	method: NavBarSearchMethod.PageFind,
};

// ============================================================================
// 链接预设 - 可自由自定义导航栏链接的名称、图标和URL
// Link Presets - Allows free customization of the name, icon, and URL of navigation bar links
// ============================================================================
export const LinkPresets: Record<string, NavBarLink> = {
	Home: {
		name: "主页",
		url: "/",
		icon: "material-symbols:home",
	},
	Archive: {
		name: "归档",
		url: "/archive/",
		icon: "material-symbols:archive",
	},
	Categories: {
		name: "分类",
		url: "/categories/",
		icon: "material-symbols:folder-open-rounded",
	},
	Tags: {
		name: "标签",
		url: "/tags/",
		icon: "material-symbols:tag-rounded",
	},
	Series: {
		name: "系列",
		url: "/series/",
		icon: "material-symbols:layers",
	},
	Friends: {
		name: "友链",
		url: "/friends/",
		icon: "material-symbols:link-2-rounded",
		pageKey: "friends",
	},
	Guestbook: {
		name: "留言",
		url: "/guestbook/",
		icon: "material-symbols:chat",
		pageKey: "guestbook",
	},
	Dynamic: {
		name: "动态",
		url: "/dynamic/",
		icon: "material-symbols:forum-rounded",
		pageKey: "dynamic",
	},
	Projects: {
		name: "项目",
		url: "/projects/",
		icon: "material-symbols:rocket-launch",
		pageKey: "projects",
	},
	Gallery: {
		name: "相册",
		url: "/gallery/",
		icon: "material-symbols:photo-library",
		pageKey: "gallery",
	},
	Booknav: {
		name: "书签导航",
		url: "/booknav/",
		icon: "material-symbols:bookmarks",
		pageKey: "booknav",
	},
	Bilibili: {
		name: "哔哩哔哩",
		url: "/bilibili/",
		icon: "fa7-brands:bilibili",
		pageKey: "bilibili",
	},
	Bangumi: {
		name: "番组计划",
		url: "/bangumi/",
		icon: "material-symbols:movie",
		pageKey: "bangumi",
	},
	VNDB: {
		name: "VNDB",
		url: "/vndb/",
		icon: "material-symbols:chrome-reader-mode-rounded",
		pageKey: "vndb",
	},
	MAL: {
		name: "AnimeList",
		url: "/myanimelist/",
		icon: "material-symbols:menu-book",
		pageKey: "mal",
	},
	Sponsor: {
		name: "打赏",
		url: "/sponsor/",
		icon: "material-symbols:favorite",
		pageKey: "sponsor",
	},
	About: {
		name: "关于我",
		url: "/about/",
		icon: "material-symbols:person",
	},
};

export const navBarConfig: NavBarConfig = getDynamicNavBarConfig();
