# Michael — 个人网站

暗色高级感的纯静态个人网站：小工具、子网页与学习笔记。
**零框架、零构建步骤** —— 只有 HTML / CSS / JavaScript，部署在 GitHub Pages。

![风格] 近黑底色 `#0A0A0B` + 琥珀金强调色 `#F2A93B`，所有视觉变量集中在 `assets/css/tokens.css`。

---

## 目录结构

```
├── index.html              首页（hero / 精选工具 / 最新笔记 / 关于）
├── tools.html              工具列表
├── notes.html              笔记列表（搜索 + 标签筛选）
├── note.html               笔记详情（?path=notes/xxx.md）
├── 404.html                自定义 404（GitHub Pages 自动生效）
├── .nojekyll               ★ 必须保留：禁用 Jekyll，否则 .md 文件会被它转换吃掉
├── assets/
│   ├── css/                tokens.css 设计变量 · main.css 全站 · markdown.css 笔记排版
│   ├── js/                 main/nav · api/数据 · markdown/渲染 · home/notes/tools/note 页面
│   ├── vendor/             本地托管的 marked / DOMPurify / highlight.js（不依赖 CDN）
│   └── img/                favicon 等
├── notes/                  ★ 笔记放这里（.md 文件）
├── tools/<名字>/           ★ 工具放这里（每个工具一个文件夹 + index.html）
├── data/index.json         内容索引（生成物，不入库）
├── scripts/build_index.py  索引生成脚本（纯标准库）
└── .github/workflows/      GitHub Actions 自动部署
```

---

## 本地预览

> ⚠️ **必须用 HTTP 服务器打开，不能双击 HTML 文件**（`file://` 下浏览器会拦截
> `fetch`，列表和笔记会渲染不出来）。

```bash
# 1. 生成内容索引（每次新增/修改笔记后执行）
python scripts/build_index.py

# 2. 启动本地服务器
python -m http.server 8080

# 3. 浏览器打开
#    http://127.0.0.1:8080/
```

本机已装 Python 3.11，无需安装任何依赖。

---

## 新增一篇笔记

1. 在 `notes/` 下新建 `.md` 文件（文件名建议用英文小写，如 `my-note.md`）
2. 写入内容（frontmatter 全部可选）：

```markdown
---
title: 笔记标题
date: 2026-09-25
tags: [前端, 随笔]
description: 一句话摘要，显示在列表里。
---

# 笔记标题

正文……
```

3. `python scripts/build_index.py` 刷新索引 → 本地预览确认
4. 推送到 GitHub → 自动上线

**回退规则**：缺 `title` 取正文第一个 `#` 标题；缺 `description` 取首段文字；
缺 `date` 归入「未标注」分组；缺 `tags` 不显示标签。

笔记里引用其他笔记写相对链接即可：`[另一篇](other-note.md)`，页面会自动改写成
`note.html?path=notes/other-note.md` 路由。

## 新增一个小工具

1. 新建文件夹 `tools/<你的工具名>/`
2. 放入 `index.html`（可用 `tools/json-formatter/` 当模板，注意相对路径是 `../../assets/…`）
3. 可选 `meta.json` 自定义列表展示（没有则从 `<title>` 和 `meta description` 提取）：

```json
{
  "title": "工具显示名",
  "description": "一句话介绍。",
  "tags": ["开发"],
  "icon": "🧩",
  "order": 1
}
```

4. 同样执行索引脚本 → 预览 → 推送

---

## 部署到 GitHub Pages（3 步）

1. **建仓库**：在 GitHub 新建**公开（Public）**仓库
   （免费计划下 Pages 只支持公开仓库）。仓库名建议用 `用户名.github.io`，
   这样网站挂在域名根路径。
2. **推送代码**：

   ```bash
   git add .
   git commit -m "初始版本"
   git remote add origin https://github.com/用户名/仓库名.git
   git push -u origin main
   ```

3. **开启 Pages**：仓库 Settings → Pages → Source 选 **GitHub Actions**。

之后每次 `git push`，Actions 会自动：生成索引 → 打包站点 → 部署上线。
首次部署后地址是 `https://用户名.github.io/`（约 1 分钟）。

### 部署须知

- **提交信息里不要写 `[skip ci]`** —— 它会把 Pages 部署流程一起跳过
- 改动后线上生效约需 1 分钟；`data/index.json` 有 CDN 缓存，列表最迟 10 分钟内更新
- 本地忘跑索引脚本不影响部署：CI 每次都会重新生成

### 备选方案（如果不用 GitHub Actions 部署）

把 Source 改成 **Deploy from a branch**（main /(root)），并把
`.gitignore` 里的 `data/index.json` 一行删掉（让索引入库），再手动跑一次
脚本提交即可。前端完全不用改 —— 两种方案共用同一份 `data/index.json` 契约。

---

## 常见问题

| 现象 | 原因 / 解决 |
| --- | --- |
| 列表一直转圈 | 没跑 `build_index.py`，或 `data/index.json` 不存在 |
| 双击打开全部空白 | 必须用 HTTP 服务器（见「本地预览」） |
| `.nojekyll` 删了之后笔记 404 | Jekyll 会把 .md 转成 .html，**别删这个文件** |
| 导航菜单改了没生效 | 导航/页脚在 5 个 html 里各有一份，需同步修改（无构建的代价） |
| 笔记里 `{% raw %}` 报错 | 不会了 —— 已禁用 Jekyll |
| 新笔记文件名是中文 | 能用，但 URL 会带编码，建议英文 slug |

## 内容索引机制

纯静态站点没有服务端目录列表，所以：

```
git push
  → GitHub Actions 运行 scripts/build_index.py（扫描 notes/ 和 tools/）
  → 生成 data/index.json（幂等：内容没变则字节级一致）
  → 打包部署，前端只读同源的 index.json
```

零第三方运行时 API（不依赖 api.github.com 等，国内访问稳定）。
脚本纯 Python 标准库，本地和 CI 同一份逻辑。

## Credits

| 库 | 版本 | 许可证 |
| --- | --- | --- |
| [marked](https://github.com/markedjs/marked) | 18.0.13 | MIT |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.16 | MPL-2.0 / Apache-2.0 |
| [highlight.js](https://github.com/highlightjs/highlight.js) | 11.11.2 | BSD-3-Clause |

均为本地托管（`assets/vendor/`），不依赖任何运行时 CDN。
