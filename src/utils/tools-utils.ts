/**
 * 工具数据源：public/tools/<folder>/meta.json
 *   { title, description, tags: string[], icon: string, order: number }
 * 构建时读取（fs），工具列表页与顶部分类条共用，保持口径一致。
 */
import fs from "node:fs";
import path from "node:path";

export interface ToolMeta {
	folder: string;
	title: string;
	description: string;
	tags: string[];
	icon: string;
	order: number;
}

export function getAllTools(): ToolMeta[] {
	const toolsRoot = path.join(process.cwd(), "public", "tools");
	if (!fs.existsSync(toolsRoot)) return [];
	return fs
		.readdirSync(toolsRoot, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => {
			const metaPath = path.join(toolsRoot, d.name, "meta.json");
			if (!fs.existsSync(metaPath)) return null;
			try {
				const raw = JSON.parse(fs.readFileSync(metaPath, "utf8"));
				return {
					folder: d.name,
					title: raw.title ?? d.name,
					description: raw.description ?? "",
					tags: Array.isArray(raw.tags) ? raw.tags : [],
					icon: raw.icon ?? "🧩",
					order: typeof raw.order === "number" ? raw.order : 100,
				} satisfies ToolMeta;
			} catch {
				return null;
			}
		})
		.filter((t): t is ToolMeta => t !== null)
		.sort((a, b) => a.order - b.order);
}

/** 工具标签聚合：按出现次数降序，同名合并 */
export function getToolTagList(): { name: string; count: number }[] {
	const counter = new Map<string, number>();
	for (const tool of getAllTools()) {
		for (const tag of tool.tags) {
			counter.set(tag, (counter.get(tag) || 0) + 1);
		}
	}
	return [...counter.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"));
}

/**
 * 分支数据源：public/branches/index.json 的 branches 数组（登记清单）。
 * 与 branches 列表页的登记部分同口径；未登记的兜底目录不参与分类计数。
 */
export function getAllBranches(): { title: string; tags: string[] }[] {
	const jsonPath = path.join(process.cwd(), "public", "branches", "index.json");
	if (!fs.existsSync(jsonPath)) return [];
	try {
		const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
		const list = Array.isArray(raw?.branches) ? raw.branches : [];
		return list.map((b: any) => ({
			title: String(b.title ?? b.folder ?? ""),
			tags: Array.isArray(b.tags) ? b.tags : [],
		}));
	} catch {
		return [];
	}
}

/** 分支标签聚合：按出现次数降序 */
export function getBranchTagList(): { name: string; count: number }[] {
	const counter = new Map<string, number>();
	for (const branch of getAllBranches()) {
		for (const tag of branch.tags) {
			counter.set(tag, (counter.get(tag) || 0) + 1);
		}
	}
	return [...counter.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"));
}
