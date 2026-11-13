import type { GalleryConfig } from "@/types/galleryConfig";

// 相册配置
export const galleryConfig: GalleryConfig = {
	// 相册列表
	// 模板自带的示例相册（可爱流萤 / 加密相册示例）已清空。
	// 想加相册：往 albums 里追加一项，并在 public/gallery/<id>/ 下放图片，
	// 字段说明见上方注释块。
	albums: [],

	// 瀑布流最小列宽(px)，浏览器根据容器宽度自动计算列数，默认 240
	// 值越小列数越多，值越大列数越少
	columnWidth: 240,
};
