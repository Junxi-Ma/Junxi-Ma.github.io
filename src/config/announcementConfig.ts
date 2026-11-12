import type { AnnouncementConfig } from "../types/announcementConfig";

export const announcementConfig: AnnouncementConfig = {
	// 公告标题，留空则走i18n默认标题
	title: "",

	// 公告内容
	content: "小工具、子网页与学习笔记都在这里。所有工具在浏览器本地运行，不上传数据。",

	// 是否允许用户关闭公告
	closable: true,

	link: {
		// 启用链接
		enable: true,
		// 链接文本
		text: "看看工具",
		// 链接 URL
		url: "/tools/",
		// 内部链接
		external: false,
	},
};
