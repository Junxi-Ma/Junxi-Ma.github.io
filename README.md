# Michael — 个人网站

暗色高级感的个人网站：纯静态前端 + Supabase 动态后端（登录、统计、在线房间），小工具、子网页与学习笔记。
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
├── .githooks/pre-commit    提交钩子：commit 时自动刷新索引（见下文）
├── assets/
│   ├── css/                tokens.css 设计变量+深浅主题 · main.css 全站 ·
│   │                       markdown.css 笔记排版 · tool-ui.css 工具页组件
│   ├── js/                 main/nav+主题切换 · api/数据 · markdown/渲染 · 页面控制器
│   ├── vendor/             本地托管的 marked / DOMPurify / highlight.js（不依赖 CDN）
│   └── img/                favicon、og.png 分享图
├── notes/                  ★ 笔记放这里（.md 文件）
├── tools/<名字>/           ★ 工具放这里（每个工具一个文件夹 + index.html）
├── data/index.json         内容索引（生成物，已入库，提交钩子自动维护）
├── scripts/build_index.py  索引生成脚本（纯标准库）
└── README.md
```

---

## 本地预览

> ⚠️ **必须用 HTTP 服务器打开，不能双击 HTML 文件**（`file://` 下浏览器会拦截
> `fetch`，列表和笔记会渲染不出来）。

```bash
# 1. 生成内容索引（通常不用手动跑：git commit 时钩子会自动执行）
python scripts/build_index.py

# 2. 启动本地服务器
python -m http.server 8080

# 3. 浏览器打开
#    http://127.0.0.1:8080/
```

本机已装 Python 3.11，无需安装任何依赖。

## 日夜主题

导航栏右侧的 **☀ / 🌙** 按钮切换深色与浅色，选择存在浏览器 `localStorage`（键 `site-theme`），
下次访问保持；首次访问默认深色（站点基调）。多标签页会自动同步。

所有颜色都是变量，集中在 `assets/css/tokens.css`：暗色为近黑 + 琥珀金，亮色为**暖纸配色**
（刻意避开蓝白）。想换配色只改这个文件。笔记页的代码高亮也随主题切换了两套色板。

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

3. `git add . && git commit -m "新增笔记"` —— **提交钩子会自动刷新索引**，推送后约 1 分钟上线。

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

4. 同样 commit + push 即可。

---

## 部署说明（GitHub Pages）

**当前方案：Deploy from a branch（分支部署）**。

仓库 Settings → Pages → Source 应为 **Deploy from a branch**，分支 `main`，目录 `/(root)`。
（本仓库初次配置即为此模式，无需额外操作。）

推送流程就是普通三连，**没有任何额外步骤**：

```cmd
git add .
git commit -m "更新说明"
git push
```

- `git commit` 时，`.githooks/pre-commit` 自动运行 `scripts/build_index.py`
  并把最新的 `data/index.json` 加进本次提交 —— 所以索引永远和内容同步
- 推送后 GitHub 约 1 分钟完成部署
- 约 10 分钟内 CDN 可能短暂显示旧列表，强刷（Ctrl+F5）即可

### 提交钩子

钩子配置在仓库本地（`.git/config` 的 `core.hooksPath=.githooks`），不会影响别人。
**新 clone / 换电脑后执行一次**：

```cmd
git config core.hooksPath .githooks
```

移除钩子（改为手动跑脚本）：`git config --unset core.hooksPath`

> ⚠️ 在 GitHub 网页上直接编辑 `notes/` 里的文件不会触发钩子 —— 网页改完后，
> 本地 `git pull`，再随便 `git commit --amend --no-edit` 或下次提交时索引会自动追平。

### 部署须知

- **提交信息里不要写 `[skip ci]`** —— 会跳过 Pages 的部署流水线
- 本地忘跑索引脚本没关系（钩子兜底）；但若钩子被移除，推送前必须手动跑一次，
  否则新笔记/新工具不会出现在列表里

### 可选升级：恢复 GitHub Actions 自动部署

如果以后想改回「CI 自动生成索引、本地零维护」的模式：

1. 恢复工作流文件：`git show faa76a9:.github/workflows/deploy-site.yml > .github/workflows/deploy-site.yml`
2. Settings → Pages → Source 改为 **GitHub Actions**（若该选项灰色，检查
   Settings → General → Actions 是否被禁用、或账号邮箱是否已验证）
3. 推送后到 Actions 手动 Run workflow 一次

两种方案共用同一份 `data/index.json` 前端契约，站点代码零改动。

---

## 常见问题

| 现象 | 原因 / 解决 |
| --- | --- |
| 列表一直转圈或显示 Error | `data/index.json` 缺失或过期 → 跑 `python scripts/build_index.py` 后重新提交 |
| 钩子没生效（commit 时没有 `[pre-commit]` 输出） | 执行 `git config core.hooksPath .githooks` 重新挂上 |
| 双击打开全部空白 | 必须用 HTTP 服务器（见「本地预览」） |
| `.nojekyll` 删了之后笔记 404 | Jekyll 会把 .md 转成 .html，**别删这个文件** |
| 导航菜单改了没生效 | 导航/页脚在 7 个 html 里各有一份，需同步修改（无构建的代价） |
| 页面一闪而过变色（深→浅） | 正常：主题在 `<head>` 内联脚本里就已确定，闪的是浏览器首次绘制 |
| 新笔记文件名是中文 | 能用，但 URL 会带编码，建议英文 slug |
| 网页版 GitHub 改了笔记但列表没更新 | 网页编辑不走钩子，本地 pull 后下次提交自动追平 |

## 内容索引机制

纯静态站点没有服务端目录列表，所以：

```
你写笔记 → git commit（钩子自动运行 build_index.py 扫描 notes/ 和 tools/）
         → data/index.json 随提交入库（幂等：内容没变则字节级一致）
         → git push → GitHub 分支部署 → 前端读同源的 index.json
```

零第三方运行时 API（不依赖 api.github.com 等，国内访问稳定）。
脚本纯 Python 标准库，本地即可运行。

## 动态能力（Supabase 后端）

站点托管仍在 GitHub Pages；Supabase 提供数据库与账号体系，让部分功能"上云"：

| 功能 | 说明 | 数据 |
| --- | --- | --- |
| 全站访客统计 | 页脚展示 总访问 / 独立访客 / 今日访问 | `visits` 表（匿名，仅随机访客 id + 路径） |
| 登录注册 | 导航栏入口，邮箱 + 密码（Supabase Auth 托管） | `profiles` 表（触发器自动建档） |
| 管理后台 | `admin.html`：账号封禁/解封、访客黑名单、访客行为轨迹、管理员名单 | `admins` / `banned_visitors` + 管理员可读 `visits` |

管理后台要点：

- 管理员 = `admins` 表成员；第一个登录后在账号弹窗「认领管理员」的账号自动入选（仅一次），
  之后可在后台按邮箱提拔 / 移除（白名单）。
- 封禁是**服务端强制**：被封账号登录即被踢出，其所有动态写入被 RLS 策略拒绝；
  访客黑名单按浏览器随机访客 id 拦截上报。
- 后台入口：登录管理员账号后，账号弹窗出现「管理后台 →」，或直接访问 `/admin.html`。

启用步骤（一次性）：

1. Supabase 控制台 → SQL Editor → 粘贴运行 `supabase/schema.sql`（幂等）；
2. 把项目地址（Project URL，形如 `https://xxxx.supabase.co`）填入
   `assets/js/supabase.js` 的 `SUPABASE_URL`；
3. publishable key 已内置（公开密钥可放前端）；如需轮换在 Supabase → Settings → API。
4. 想注册后立即登录（跳过邮箱验证）：Authentication → Sign In / Up → 关闭 Confirm email。

安全设计：`visits` 开启 RLS，匿名只能写入、不能读原始记录；页脚统计走
`security definer` 聚合函数 `get_site_stats()`，仅暴露计数。
未配置 URL 或后端不可达时整站自动回退为纯静态行为（无报错、无动态元素）。

## Credits

| 库 | 版本 | 许可证 |
| --- | --- | --- |
| [marked](https://github.com/markedjs/marked) | 18.0.13 | MIT |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.16 | MPL-2.0 / Apache-2.0 |
| [highlight.js](https://github.com/highlightjs/highlight.js) | 11.11.2 | BSD-3-Clause |

均为本地托管（`assets/vendor/`），不依赖任何运行时 CDN。
