# 前端迁移计划：Firefly 融合方案

> 目标：用 Firefly 模板替换整站前端，后端与动态能力全部保留，模板的额外功能吸收进来。
> 原则：**先划边界，再动手**。上次失败的原因就是没搞清楚哪里该改、哪里该保留。

---

## 0. 结论摘要

| 项 | 决定 |
| --- | --- |
| 技术路线 | 混合迁移：主站用 Astro 重建，12 个工具与 4 个分支页作为静态资源原样保留 |
| 视觉 | Firefly 原味：浅色清新 + 壁纸大图 + 看板娘 |
| 部署 | GitHub Actions 里跑 `pnpm build`，产物部署 GitHub Pages |
| 分支 | 新开 `firefly-migration`，全程不碰 `main`，最后一次性切换 |
| 后端 | Supabase 17 表 18 个 RPC 全部保留，前端换成新壳 |
| 功能 | 模板功能全吸收（侧栏/搜索/转场/壁纸/看板娘/音乐/相册/动态/友链/书签/归档/标签/系列/RSS/特效/追番/打赏） |
| 素材 | 先用模板自带的跑通，以后再换 |
| 工期 | Phase 0 已完成（模板本机构建通过）；剩 16–25 个工作日 |
| 最大风险 | 本地 Windows 构建环境、工具页与旧 CSS 的耦合、Supabase 接进 Astro 的时序 |

---

## 1. 现状盘点

### 1.1 现有站点资产

| 类别 | 内容 | 规模 |
| --- | --- | --- |
| 主页面 | `index.html` `tools.html` `notes.html` `note.html` `branches.html` `admin.html` `404.html` | 1226 行 |
| 工具 | aes-cipher / chess / cloud-quiz / connect4 / cube-solver / guandan / json-formatter / minesweeper / outing / roll-call / stardy / sudoku | 12 个，约 8 MB |
| 分支页 | cloud-cover（ONNX 云图识别，24 MB）/ junxun（军训留言板，1.6 MB）/ shiroha-quiz（题库 + PDF.js，8.2 MB）/ sky-watch（看图识天，69 KB） | 4 个 |
| 笔记 | `notes/*.md` | 9 篇 |
| 样式 | `assets/css/`：tokens / main / markdown / tool-ui / site-gate | 3749 行 |
| 脚本 | `assets/js/`：18 个文件 | 2427 行 |
| 索引 | `data/index.json`，由 `scripts/build_index.py` 扫描生成 | 10 KB |
| 后端 | `supabase/schema.sql` + 1 个迁移文件 | 926 行 |
| 部署 | `.github/workflows/pages.yml`：Python 生成索引 → 打包 → 部署 Pages | 无 Node |

### 1.2 后端能力（必须全部保留）

**表（17）**：`visits` `profiles` `admins` `banned_visitors` `site_data` `site_settings` `wall_posts` `wall_replies` `outing_rooms` `outing_entries` `minesweeper_records` `sudoku_records` `chess_results` `chess_rooms` `board_rooms` `sky_watch_messages` `sky_watch_favorites`

**RPC（18）**：`is_admin` `is_banned` `is_banned_visitor` `claim_admin_if_first` `get_site_stats` `get_visitor_overview` `handle_new_user` `bump_likes` `admin_set_pinned` `admin_delete_post` `admin_edit_post` `outing_room_exists` `ms_resolve_name` `sudoku_resolve_name` `chess_resolve_name` `get_chess_leaderboard` `sky_watch_bump_likes` `sky_watch_resolve_name`

**功能归口**：

| 功能 | 涉及表 / RPC | 前端位置 |
| --- | --- | --- |
| 登录注册 | Supabase Auth + `profiles` | 全站导航 |
| 全站门禁 | `site_settings.guest_access` | 20 个页面注入 `site-gate.js` |
| 访客统计 | `visits` + `get_site_stats` | 页脚 / 侧栏 |
| 管理后台 | `admins` + `get_visitor_overview` + 封禁表 | `admin.html` |
| 军训留言板 | `wall_posts` `wall_replies` `site_data` | `branches/junxun/` |
| 游戏排行榜 | 三个 `*_records` + `get_chess_leaderboard` | 各工具页内 |
| 联机房间 | `board_rooms` `chess_rooms` | 棋类工具页内 |
| 外出名额 | `outing_rooms` `outing_entries` | `tools/outing/` |
| 看图识天 | `sky_watch_messages` `sky_watch_favorites` | `branches/sky-watch/` |

### 1.3 现有机制

| 机制 | 实现 | 迁移后 |
| --- | --- | --- |
| 内容索引 | Python 扫目录 → `data/index.json` → 前端 fetch | 改为 Astro 构建时读取，索引文件保留给工具页兜底 |
| 主题 | `site-theme` localStorage，`<head>` 内联脚本防闪 | Firefly 自带三态主题（亮/暗/跟随系统），键名要统一 |
| 门禁 | `site-gate.js` + `site-gate.css` 注入 20 个页面 | 主站走 Astro Layout 注入，静态页保留原注入 |
| 部署 | Actions 跑 Python → 上传 Pages | Actions 加 Node 22 + pnpm → `pnpm build` → 上传 `dist` |

### 1.4 Firefly 模板能力

- **技术栈**：Astro 7.3.2 + Svelte 5.57 + Tailwind 4.3 + TypeScript 6，pnpm 11.22，Node ≥ 22.23
- **规模**：123 个组件、33 个路由、24 个配置模块、1273 个依赖
- **构建链**：`generate-github-card-data` → `generate-lqips` → `generate-vndb-covers` → `astro build` → `prune-pio-assets` → `subset-fonts` → `minify-inline-scripts` → `pagefind`
- **样式架构**：Tailwind 4 CSS-first（`@theme`）+ `variables.styl` 335 行 OKLCH 变量 + 分模块 CSS
- **主题色**：`--hue` 单一变量控制 360° 色相

### 1.5 两边的结构性冲突

| # | 冲突 | 后果 | 解法（见 §7） |
| --- | --- | --- | --- |
| 1 | 零构建 vs 必须打包 | 部署链路要重写 | Actions 加构建步骤 |
| 2 | 暗金极简 vs 清新 ACGN | 全站视觉推倒 | 接受（已确认） |
| 3 | 12 个工具页引用主站 `tokens.css` + `main.css` + `main.js` | 主站换 CSS 会连带改工具页外观 | 做一份 `tool-shell.css` 变量映射 |
| 4 | 工具/分支页是独立 HTML 应用 | 塞不进 Astro 的文章模型 | 放 `public/`，用 Astro 页面做列表 |
| 5 | 模板没有账号系统 | 登录/门禁/统计要自己接 | 加 Supabase 适配层 |

---

## 2. 边界清单：动什么、不动什么

**这张表是本次迁移的核心。执行时任何超出「要改造」和「新增」两栏的改动，都必须先停下来说明理由。**

### 2.1 绝对不动

| 路径 | 内容 | 为什么不能动 |
| --- | --- | --- |
| `tools/*/app.js` `engine.js` `*.js`（除主题/导航脚本） | 12 个工具的全部业务逻辑 | 棋类规则引擎、AI、扫雷算法、魔方求解器，改一行就可能崩 |
| `tools/*/vendor/` `tools/*/img/` | 第三方库与素材 | 含 wasm、图片 |
| `branches/*/` 内部全部文件 | 4 个分支页的完整应用 | ONNX 模型、PDF.js cmaps、留言板逻辑 |
| `branches/*/meta.json` | 列表元数据 | 字段结构要保持 |
| `supabase/schema.sql` + `migrations/` | 数据库结构与 RLS | 线上正在跑，改了会锁死用户 |
| `notes/*.md` 正文 | 9 篇笔记内容 | 只允许改 frontmatter |
| `scripts/build_index.py` `lint_notes.py` | 索引与排版检查 | 迁移后仍要能跑 |
| `.github/workflows/pages.yml` 的部署动作 | Pages 上传逻辑 | 只允许在前面插入构建步骤 |

### 2.2 要改造

| 路径 | 改成什么 | 注意 |
| --- | --- | --- |
| 6 个主页面 HTML | Astro 页面（`src/pages/`） | 迁移完旧文件删除 |
| `assets/css/tokens.css` `main.css` `markdown.css` | 弃用；工具页改用 `tool-shell.css` | 先并存，验证完再删 |
| `assets/css/tool-ui.css` | 改造成 Firefly 风格 | 工具页共用组件 |
| `assets/js/main.js` | 弃用（Firefly 自带导航/主题） | 工具页改用轻量版 |
| `assets/js/home.js` `notes.js` `note.js` `branches.js` `tools.js` `markdown.js` | 弃用（Astro 构建时渲染） | |
| `assets/js/supabase.js` `auth.js` `api.js` `analytics.js` `admin.js` `site-gate.js` | **保留并适配** | 换成 supabase-js 或继续用 REST |
| 12 个工具页的 `<nav>` + `<footer>` | 换成「返回站点」胶囊 | 见 §7.2 |
| 12 个工具页的 `style.css` | 只改硬编码颜色为变量，布局不动 | 8 个文件共 531 处颜色 |
| `admin.html` | 改成 Astro 页面，套 Firefly 壳 | 逻辑复用 `admin.js` |

### 2.3 新增

| 路径 | 内容 |
| --- | --- |
| `astro.config.mjs` `package.json` `tsconfig.json` `pnpm-lock.yaml` | Astro 工程骨架 |
| `src/` 全部 | 组件、布局、页面、配置 |
| `src/content/posts/` | 9 篇笔记（从 `notes/` 迁入） |
| `src/components/` 下自建组件 | `ToolList` `BranchList` `SiteGate` `VisitStats` `AccountMenu` |
| `public/tools/` `public/branches/` | 工具与分支页（从根目录搬入） |
| `public/assets/` | 工具页用的 CSS/JS/图片/favicon |
| `assets/css/tool-shell.css` | 工具页共用壳样式 |
| `.github/workflows/pages.yml` 新增步骤 | Node 22 + pnpm + build |

### 2.4 删除

| 路径 | 时机 |
| --- | --- |
| Firefly 示例文章 13 篇、示例图片、示例相册 | Phase 1 |
| Firefly 示例友链、示例动态 | Phase 1 |
| 旧的 6 个主页面 HTML | Phase 4 完成并验证后 |
| `assets/css/tokens.css` `main.css` `markdown.css` | Phase 3 验证完工具页后 |
| `Firefly-master/` 原模板目录 | Phase 7 切换后（保留为 tag） |

---

## 3. 目标架构

### 3.1 目录结构

```
E:\My Website\
├── astro.config.mjs
├── package.json
├── pnpm-lock.yaml
├── src/
│   ├── config/              # Firefly 24 个配置模块，逐个改成你的
│   ├── content/
│   │   └── posts/           # 9 篇笔记（原 notes/*.md）
│   ├── components/
│   │   ├── firefly/         # 模板自带 123 个组件
│   │   └── custom/          # 自建：ToolList / BranchList / SiteGate / VisitStats / AccountMenu
│   ├── layouts/             # Layout.astro / MainGridLayout.astro
│   ├── pages/
│   │   ├── index.astro      # 首页（工坊版）
│   │   ├── about.astro
│   │   ├── tools/index.astro        # 工具列表
│   │   ├── branches/index.astro     # 分支列表
│   │   ├── posts/[...slug].astro    # 笔记详情
│   │   ├── archive.astro
│   │   ├── tags/ categories/ series/
│   │   ├── admin.astro      # 管理后台
│   │   └── 404.astro
│   └── styles/
├── public/
│   ├── tools/               # 12 个工具（原 tools/）
│   ├── branches/            # 4 个分支页（原 branches/）
│   ├── assets/              # 工具页依赖的 css/js/img
│   ├── notes/               # 笔记原始 md（保留，供旧链接）
│   ├── data/index.json      # 索引（工具页兜底用）
│   └── favicon/ pio/ music/ gallery/
├── notes/                   # 保留为笔记源（构建时复制或软链）
├── supabase/                # 不动
├── scripts/                 # 不动
└── .github/workflows/pages.yml
```

### 3.2 数据流变化

**现在**：
```
写 notes/xxx.md → git push → Actions 跑 Python → data/index.json → 前端 fetch 渲染
```

**迁移后**：
```
写 src/content/posts/xxx.md → git push → Actions 跑 pnpm build
  → Astro 构建时读 content collection 生成 HTML
  → Pagefind 建搜索索引
  → 工具/分支页从 public/ 原样复制
  → 上传 dist 到 Pages
```

关键变化：**渲染从浏览器搬到构建时**。好处是首屏快、SEO 好、搜索能搜正文；代价是改内容必须重新构建（约 3–6 分钟）。

### 3.3 构建与部署链路

```yaml
# .github/workflows/pages.yml 改造要点
- uses: actions/setup-node@v4
  with: { node-version: '22' }
- uses: pnpm/action-setup@v4
  with: { version: '11.22.0' }
- run: pnpm install --frozen-lockfile
- run: pnpm build          # 含 pagefind / 字体子集化 / 图片优化
- run: python scripts/build_index.py   # 保留，给工具页兜底
- uses: actions/upload-pages-artifact@v3
  with: { path: ./dist }
```

---

## 4. 分阶段实施计划

### Phase 0：可行性验证（已完成 ✅ 2026-11-12）

**结论：模板在本机可以完整构建并运行，方案成立。**

实测结果：

| 项 | 结果 |
| --- | --- |
| 依赖安装 | `npm install --legacy-peer-deps --ignore-scripts`，1182 个包，12 分钟 |
| 构建 | `astro build` 成功，**40 个页面，18.4 秒** |
| 产物 | `dist/` 40 MB（含未裁剪的 15 MB 看板娘素材） |
| 运行 | 静态服务预览正常，深浅两套主题都完整渲染 |
| 首页体积 | `dist/index.html` 404 KB（内联了大量样式与主题变量） |

**踩到并已解决的 4 个坑**（写进 Phase 6 的构建配置）：

| 坑 | 现象 | 解法 |
| --- | --- | --- |
| pnpm 符号链接 | Windows 下 `Maximum call stack size exceeded` | 本地改用 npm 扁平安装；线上 Actions 用 pnpm 正常 |
| 遥测写盘 | `EPERM mkdir ...\appdata\astro\Config` | 构建时设 `ASTRO_TELEMETRY_DISABLED=1` |
| esbuild 子进程 | `spawn EPERM` | 构建需要进程创建权限（沙箱环境要放宽） |
| 远程字体 | `CannotFetchFontFile`，jsdelivr 在国内拉不动 | `fontConfig` 里把 `bannerTitleFont`/`bannerSubtitleFont`/`codeFont` 留空，全站用系统字体 |

> **最后一条最重要**：Firefly 默认从 fontsource CDN 拉 Zen Maru Gothic / Inter / JetBrains Mono 做字体度量。国内网络下每次构建都会失败。改法见 §5.9。

**还没验证的**：`pnpm build` 的完整链路（含 pagefind 搜索索引、字体子集化、pio 素材裁剪）。Phase 6 再验，预计加 1–2 分钟。

**本地开发的硬前提**：这台机器上跑构建需要放宽沙箱（esbuild 要 spawn 子进程）。日常改样式用 `astro dev` 更省事，只在验证产物时跑 build。

### Phase 1：配置与清壳（1–2 天）

| 动作 | 文件 |
| --- | --- |
| 改站点身份 | `src/config/siteConfig.ts`：title / subtitle / site_url / description / keywords |
| 删示例内容 | `src/content/posts/` 13 篇、`src/content/dynamic/`、`src/assets/images/` 示例图 |
| 配导航 | `navBarConfig.ts`：首页 / 文章 / 工具 / 分支 / 相册 / 动态 / 友链 / 关于 |
| 配侧栏 | `sidebarConfig.ts`：左 profile + 公告 + 音乐；右 动态 + 统计 + 日历 |
| 配壁纸 | `backgroundWallpaper.ts`：先用模板自带 d1–d6 |
| 配看板娘 | `pioConfig.ts`：先用流萤 Spine 模型 |
| 配音乐 | `musicConfig.ts`：先用模板自带 mp3 |
| 配页脚 | `FooterConfig.html` |
| 关掉不用的页面 | `siteConfig.ts` 的 `pages`：bilibili / bangumi / vndb / mal 先关 |

**验收**：导航每一项都能点开，不 404；首页是空的但结构完整。

### Phase 2：笔记迁移（2–3 天）

| 动作 | 说明 |
| --- | --- |
| 写转换脚本 | `scripts/migrate_notes.py`：`notes/*.md` → `src/content/posts/*.md` |
| frontmatter 映射 | `title` → `title`；`date` → `published`；`tags` → `tags`；`description` → `description`；新增 `category`（8 个标签收敛成分类） |
| 处理图片 | 笔记里的相对图片路径改到 `src/assets/` |
| 校验渲染 | 9 篇逐篇打开对照原文 |
| 分类体系 | 8 个标签 → 4–6 个分类（天气学原理 / 动力气象学 / 大气探测学 / 技术 / 工具 / 生活） |

**验收**：9 篇都能打开、公式（KaTeX）正常、代码高亮正常、标签页和归档页有内容。

### Phase 3：工具与分支板块（3–5 天）

| 动作 | 说明 |
| --- | --- |
| 搬目录 | `tools/` → `public/tools/`，`branches/` → `public/branches/` |
| 建列表页 | `src/pages/tools/index.astro` 读 `public/tools/*/meta.json` 渲染卡片 |
| 建分支页 | `src/pages/branches/index.astro` 同理，读 `branches/index.json` |
| 写 `tool-shell.css` | 见 §7.1 |
| 改 12 个工具页 | 换 CSS 引用、换导航为返回胶囊、硬编码颜色改变量 |
| 改 4 个分支页 | 同上，保留各自内部逻辑 |

**验收**：12 个工具逐个打开，功能与现在一致（棋类能下、扫雷能玩、魔方能解）；4 个分支页能开；深浅主题切换正常。

**这是最容易出事的一期**，因为工具页依赖主站 CSS。必须逐个验证，不能批量改完再看。

### Phase 4：主站页面（3–4 天）

| 动作 | 说明 |
| --- | --- |
| 首页 | 用 Firefly 的 banner + 卡片流，内容换成：精选工具 / 最新笔记 / 分支入口 / 关于 |
| 关于页 | 迁 `index.html` 的 about 区块 |
| 404 | 用模板的 404 |
| 管理后台 | `admin.html` → `src/pages/admin.astro`，套 Firefly 壳，逻辑复用 `admin.js` |

**验收**：首页、关于、404、后台四个页面视觉连贯，移动端不塌。

### Phase 5：后端接入（4–6 天）

| 动作 | 说明 |
| --- | --- |
| Supabase 客户端 | 加 `@supabase/supabase-js`，或继续用 REST（现有 `assets/js/supabase.js` 只有 40 行） |
| 登录/注册弹窗 | 用 Firefly 风格重写，替代现在的 `auth.js` 弹窗 |
| 账号入口 | 导航栏加头像菜单（模板没有，要自建） |
| 门禁 | `SiteGate.astro` 注入所有 Astro 页面；`public/` 静态页保留原 `site-gate.js` 注入 |
| 访客统计 | 自建 `VisitStats.svelte` 岛，接 `get_site_stats`，塞进侧栏 `stats` 位置 |
| 留言板 | 分支页不动，逻辑复用 |
| 排行榜 / 房间 | 工具页不动，逻辑复用 |
| 主题键统一 | `site-theme`（现有）vs Firefly 的存储键，写一个兼容层 |
| 管理后台 | 复用 `admin.js`，改 DOM 选择器 |

**验收**：注册→登录→锁站→访客看到登录页→管理员解封，整条链路走通；页脚/侧栏统计数字与数据库一致。

### Phase 6：构建部署（2–3 天）

| 动作 | 说明 |
| --- | --- |
| 改 workflow | 加 Node/pnpm 步骤，产物从 `dist` 上传 |
| 处理 `[skip ci]` | 保留现有约定 |
| 首次部署 | 在分支上跑一次，确认 Pages 产物正常 |
| 性能检查 | Lighthouse 跑一遍，看首屏与 LCP |
| 构建时间记录 | 若超过 10 分钟要查原因（字体子集化 / 图片优化是大头） |

**验收**：推代码 → Actions 绿 → 线上更新，全程无人值守。

### Phase 7：切换（1 天）

| 动作 | 说明 |
| --- | --- |
| 打 tag | `pre-firefly-2026` 存旧站 |
| 合并 main | `firefly-migration` → `main` |
| 线上验证 | 7 类页面 × 深色/浅色 × 桌面/移动，逐项过 |
| 保留回退 | 旧 tag 保留至少 1 个月 |

**验收**：线上所有功能正常，回退路径可用。

---

## 5. 关键技术方案

### 5.1 工具页样式适配（最关键）

**问题**：12 个工具页引用 `assets/css/tokens.css` + `main.css`，里面是暗金变量名（`--bg` `--fg` `--accent` 等）。Firefly 用的是另一套（`--page-bg` `--card-bg` `--primary`，OKLCH）。

**方案**：写一份 `public/assets/css/tool-shell.css`，做**变量映射 + 壳组件**：

```css
/* 1. 引入 Firefly 的变量（从 variables.styl 编译产物摘取） */
:root {
  --hue: 160;
  --page-bg: oklch(0.95 0.01 var(--hue));
  --card-bg: white;
  --primary: oklch(0.70 0.14 var(--hue));
  /* ... */
}

/* 2. 把旧变量名映射过去，工具页零改动 */
:root {
  --bg: var(--page-bg);
  --surface: var(--card-bg);
  --fg: var(--deep-text);
  --accent: var(--primary);
  --border: var(--line-color);
  /* ... 约 30 个 */
}

/* 3. 壳组件：返回胶囊、页脚、容器 */
```

工具页只需要把 `<link rel="stylesheet" href="../../assets/css/tokens.css">` 换成 `tool-shell.css`，其余不动。

**工作量**：映射表 1 天；工具页逐个验证 1–2 天。

**工具页内硬编码颜色**（需要逐个处理）：

| 工具 | 硬编码颜色数 | 建议 |
| --- | --- | --- |
| chess | 133 | 木纹/棋子质感是刻意的，保留；只改外围壳 |
| guandan | 125 | 同上 |
| sudoku | 77 | 改 |
| minesweeper | 73 | 改（经典 9x 配色可保留） |
| cloud-quiz | 50 | 改 |
| connect4 | 35 | 改 |
| cube-solver | 26 | 改 |
| aes-cipher | 12 | 改 |

### 5.2 工具页导航策略（我的建议）

现在 12 个工具页各自硬编码了一份完整的站点导航（logo + 5 个链接 + 主题按钮 + 移动端菜单）。Firefly 的导航是带下拉菜单、搜索框、音乐按钮的复杂组件，硬塞进去不现实，而且 12 份要同步维护。

**建议改成**：工具页只保留一个左上角「← 返回站点」胶囊（`sky-watch` 现在就是这么做的），去掉完整导航和页脚。

好处：工具变全屏应用、不用维护 12 份导航、与 Swup 转场不冲突。
代价：工具页内不能直接跳去别的板块（要先回主站）。

> 这条需要你点头。如果你要保留完整导航，工作量加 2–3 天。

### 5.3 门禁注入

| 页面类型 | 注入方式 |
| --- | --- |
| Astro 页面 | `SiteGate.astro` 组件放进 `Layout.astro`，全站自动生效 |
| `public/tools/*` `public/branches/*` | 保留现有 `<script src=".../site-gate.js">` 标签，CSS 换成新配色 |
| 404 | Astro 的 404 页面，走 Layout |

**注意**：门禁是 UI 级，`public/data/*.json` 直链仍可访问（现在就是这样）。不要因为迁移而误以为能加安全。

### 5.4 Supabase 接入

**现状**：`assets/js/supabase.js` 只有 40 行，走 REST + publishable key；`auth.js` 377 行管登录态。

**迁移后**：
- 保留 `supabase.js` / `auth.js` 的**逻辑**，改成 ES module 放进 `public/assets/js/`，供静态页与 Astro 页共用
- 或者引入 `@supabase/supabase-js`（体积约 100 KB，但省事）

**建议**：先继续用 REST（零依赖、体积小、已验证），只在需要 realtime 的地方用 supabase-js。棋类联机现在已经在用 realtime，检查它是否已引 supabase-js。

### 5.5 访客统计接进侧栏

Firefly 的 `SiteStats.astro` 是**构建时**算的（文章数/分类数/字数），拿不到真实访问量。

**方案**：在 `stats` 位置加一个自建 Svelte 岛 `VisitStats.svelte`，客户端调 `get_site_stats()` RPC，显示 总访问 / 独立访客 / 今日。构建时渲染的静态统计保留在旁边。

### 5.6 笔记 frontmatter 迁移

| 现在 | 迁移后 | 处理 |
| --- | --- | --- |
| `title` | `title` | 直通 |
| `date: 2026-09-25` | `published: 2026-09-25` | 改名 |
| `tags: [技术]` | `tags: [技术]` | 直通 |
| `description` | `description` | 直通 |
| （无） | `category` | 按 8 个标签映射到 6 个分类 |
| （无） | `slug` | 用文件名 |

现有解析器（`api.js` 的 `parseFrontmatter`）是简化 YAML，Astro 用 gray-matter 解析，兼容标准 YAML，没问题。

### 5.7 搜索范围

Pagefind 会索引 `dist/` 里所有 HTML，包括 `public/tools/` 复制过来的工具页。工具页是应用外壳，正文很少，索引了也无害。若想排除，在工具页 `<body>` 加 `data-pagefind-ignore`。

### 5.8 素材配置

| 素材 | 模板自带 | 换成你的 |
| --- | --- | --- |
| 壁纸 | `src/assets/images/DesktopWallpaper/d1–d6.avif` + Mobile m1–m6 | 以后放自己的图，命名不要用 d1–d6 |
| 头像 | `src/assets/images/avatar.avif` | 以后换 |
| 看板娘 | `public/pio/models/spine/firefly/`（流萤 Spine）+ `live2d/snow_miku/` | 先用流萤 |
| 音乐 | `public/assets/music/使一颗心免于哀伤-哼唱.mp3` | 以后换 |
| favicon | `public/favicon/*` | 可保留 M 字母图标或换 |

### 5.9 中文字体与构建时间

**实测坑（Phase 0 踩到）**：Firefly 默认从 fontsource CDN 拉三种字体（Zen Maru Gothic / Inter / JetBrains Mono）做度量计算，国内网络下构建直接失败：`CannotFetchFontFile`。

**解法（三选一，推荐第 1 个）**：

1. **改区域字体为系统字体**（最简单）：`src/config/fontConfig.ts` 里把 `bannerTitleFont` `bannerSubtitleFont` `codeFont` 全部留空。`selected` 已经是 `["system"]`，留空即继承系统字体，构建不再联网。
2. 把 `fontConfig.enable` 设为 `false`，彻底关掉 Astro Font API。
3. 改用 `provider: "npm"` + 已装的 `@fontsource-variable/noto-sans-sc` 本地包（不联网，但中文子集化仍耗时）。

**构建时间**：实测 `astro build` 18.4 秒。加上 pagefind 索引与字体子集化，预计 1–3 分钟。Actions 上同理。若超过 10 分钟，优先关字体子集化。

---

## 6. 验收矩阵

每个现有功能一行，迁移后逐项打勾。**这份表就是「哪里该保留」的答案。**

| # | 功能 | 现在的位置 | 迁移后位置 | 验收方式 |
| --- | --- | --- | --- | --- |
| 1 | 首页 | `index.html` | `src/pages/index.astro` | 打开看结构 |
| 2 | 工具列表 | `tools.html` | `src/pages/tools/index.astro` | 12 个卡片都在 |
| 3 | 笔记列表 + 筛选 | `notes.html` | `src/pages/archive.astro` + 标签页 | 9 篇都在，标签能筛 |
| 4 | 笔记详情 | `note.html?path=` | `src/pages/posts/[...slug].astro` | 9 篇逐篇对照 |
| 5 | 分支列表 | `branches.html` | `src/pages/branches/index.astro` | 4 个卡片都在 |
| 6 | 404 | `404.html` | `src/pages/404.astro` | 访问不存在路径 |
| 7 | 主题切换 | `main.js` | Firefly 自带 | 亮/暗/跟随系统三态 |
| 8 | 全站门禁 | `site-gate.js` | `SiteGate.astro` + 静态注入 | 锁站后访客只见登录页 |
| 9 | 登录注册 | `auth.js` | 适配后 | 注册→登录→退出 |
| 10 | 账号菜单 | `auth.js` | 自建 `AccountMenu` | 头像、后台入口、退出 |
| 11 | 管理后台 | `admin.html` | `src/pages/admin.astro` | 封禁/黑名单/轨迹/设置 |
| 12 | 访客统计 | 页脚 | 侧栏 `VisitStats` | 数字与库一致 |
| 13 | 12 个工具 | `tools/*/` | `public/tools/*/` | 逐个玩一遍 |
| 14 | 4 个分支页 | `branches/*/` | `public/branches/*/` | 逐个打开 |
| 15 | 军训留言板 | `branches/junxun/` | 不动 | 发帖/点赞/回复 |
| 16 | 看图识天 | `branches/sky-watch/` | 不动 | 图源/留言/收藏 |
| 17 | 云图识别 | `branches/cloud-cover/` | 不动 | 上传图片能识别 |
| 18 | 题库 | `branches/shiroha-quiz/` | 不动 | 能刷题 |
| 19 | 游戏排行榜 | 各工具内 | 不动 | 下完一局看榜单 |
| 20 | 联机房间 | 棋类工具内 | 不动 | 双端进同一房间 |
| 21 | 外出名额 | `tools/outing/` | 不动 | 建房间/报名 |
| 22 | 内容索引 | `data/index.json` | 构建时生成 + 保留兜底 | 工具页列表正常 |
| 23 | 笔记排版自检 | `lint_notes.py` | 保留 | `python scripts/lint_notes.py` |
| 24 | 部署 | Actions | Actions + build | 推代码→上线 |

**模板新增功能**（要新验收的）：

| # | 功能 | 验收方式 |
| --- | --- | --- |
| 25 | 全文搜索 | 搜一个笔记正文里的词，能搜到 |
| 26 | Swup 转场 | 点导航不白屏 |
| 27 | 侧栏 | 头像/公告/音乐/分类/标签/动态/统计/日历 都在 |
| 28 | 壁纸模式 | banner / fullscreen / overlay / none 四种切换 |
| 29 | 看板娘 | 流萤模型加载，能互动 |
| 30 | 音乐播放器 | 能播能停 |
| 31 | 相册 | 能开，图片能看大图 |
| 32 | 动态 | 能显示 |
| 33 | 友链 / 书签 | 能开 |
| 34 | 归档 / 分类 / 标签 / 系列 | 四个页面都有内容 |
| 35 | RSS / Atom | 订阅地址能出 XML |
| 36 | 樱花 / 波浪特效 | 能在设置面板开关 |
| 37 | 追番 / 打赏 | 页面能开（内容以后填） |

---

## 7. 风险登记表

| # | 风险 | 概率 | 影响 | 缓解 |
| --- | --- | --- | --- | --- |
| R1 | 本地构建环境 | **已排除** | — | Phase 0 实测通过，4 个坑都有解法（见 Phase 0） |
| R2 | 工具页换 CSS 后布局塌 / 功能坏 | 中高 | 12 个工具不可用 | 逐个改逐个验，改前先截图存档 |
| R3 | 门禁在 Astro 页面与静态页行为不一致 | 中 | 锁站失效或误锁 | 写一个门禁状态测试页，两边都测 |
| R4 | 主题键冲突（旧 `site-theme` vs Firefly 的键） | 中 | 主题闪、切换失效 | 写兼容层，读旧键写新键 |
| R5 | Supabase 调用时序（构建时 vs 客户端） | 中 | 统计/登录报错 | 所有 Supabase 调用限定在客户端（`client:only`） |
| R6 | 构建时间过长（>10 分钟） | 中 | Actions 额度与耐心 | 关字体子集化；图片不放进 `src/assets` |
| R7 | 仓库体积膨胀（现有 383 MB） | 中 | clone/部署变慢 | `.gitignore` 排除 `node_modules` `dist` `tmp`；工具与分支页的二进制保留 |
| R8 | Firefly 升级后自建组件不兼容 | 低 | 维护成本 | 自建组件放 `src/components/custom/`，与模板隔离 |
| R9 | Pagefind 索引了工具页导致搜索噪音 | 低 | 搜索体验 | 工具页加 `data-pagefind-ignore` |
| R10 | 迁移期间线上旧站与新分支配置漂移 | 低 | 切换时漏改 | 迁移期间旧站只做内容更新，不做结构改动 |

---

## 8. 回退预案

| 层级 | 手段 | 恢复时间 |
| --- | --- | --- |
| 单次提交 | `git revert` | 分钟级 |
| 单期回退 | 每期结束打 tag（`phase0`…`phase7`） | 分钟级 |
| 整体回退 | `pre-firefly-2026` tag + GitHub Pages 重新部署旧提交 | 10 分钟 |
| 数据库 | 本次迁移**不改 schema**，无数据库回退需求 | — |

**硬规则**：Phase 7 之前，`main` 分支一行不改。

---

## 9. 待你确认的遗留问题

| # | 问题 | 我的建议 |
| --- | --- | --- |
| Q1 | 工具页要不要保留完整站点导航？ | 建议只留「返回站点」胶囊（§5.2），省 2–3 天 |
| Q2 | 8 个笔记标签怎么收敛成分类？ | 建议 6 类：天气学原理 / 动力气象学 / 大气探测学 / 技术 / 工具 / 生活 |
| Q3 | 壁纸用哪几张？ | 先用模板自带 d1–d6，跑通后你挑图 |
| Q4 | 看板娘用流萤还是雪初音？ | 建议流萤（与主题同名，素材更全） |
| Q5 | 音乐播放器放什么歌？ | 先用模板自带，以后换 |
| Q6 | 要不要自定义域名？ | 现在 `Junxi-Ma.github.io` 能用，先不动 |
| Q7 | 追番页（bilibili/bangumi/vndb/mal）要填内容吗？ | 页面留着，配置里先关，以后要用再开 |
| Q8 | 旧站 `assets/` 里的 KaTeX / highlight.js 要不要保留？ | 保留给工具页与旧链接兜底，Phase 7 后再评估 |
| Q9 | 迁移期间你还要往旧站加内容吗？ | 建议冻结结构改动，只加笔记 |
| Q10 | 本地开发环境要不要装 WSL？ | 如果 R1 反复失败，装 WSL 是最彻底的解法 |

---

## 10. 下一步

1. **你确认 §9 的 10 个问题**（尤其 Q1 和 Q2）
2. 我执行 Phase 0：建分支、跑通本地构建
3. Phase 0 结论出来后，再细化 Phase 1–7 的具体文件清单

> Phase 0 是**决策点**：跑通就按计划推进，跑不通就回来重谈方案（可能要换模板或换静态移植路线）。
