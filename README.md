# Michael — 个人网站

小工具、子网页与学习笔记。

前端是 Astro 7 + Firefly 主题（Svelte 5 / Tailwind 4），后端是 Supabase，
部署在 GitHub Pages。12 个小工具和 4 个分支页是**纯静态页面**，原样放在
`public/` 下，不经过 Astro 构建，各自跑各自的逻辑。

> 2026-11 从「零框架静态站」迁移而来。旧站的结构、配色和构建方式已全部替换，
> 迁移前整站备份在 `_backups/`，历史提交也从没被删过。

---

## 本地开发

需要 Node **>= 22.23.0**。

```bash
npm install --legacy-peer-deps --ignore-scripts
npm run dev          # http://localhost:4321
npm run build        # 产物在 dist/
npm run preview      # 预览 dist/
```

两个附加参数不是可选的：

- `--legacy-peer-deps`：模板里 `@astrojs/cloudflare` 声明 peer `astro@^7.4.0`，
  项目锁的是 7.3.2。本站用 Pages，根本不碰 Cloudflare adapter。
- `--ignore-scripts`：`preinstall` 是 `npx only-allow pnpm`，会把 npm 安装拦下来。

`package.json` 里写的是 pnpm，CI 也用 pnpm（`strict-peer-dependencies = false`
已配好）。**Windows 本地请用 npm** —— pnpm 的 symlink 在这个盘上会栈溢出。

构建链路：

```
astro build → 裁剪看板娘资源 → 字体子集化 → 压缩内联脚本 → Pagefind 索引
```

`npm run build:full` 保留了模板完整的八步链路（多出 GitHub 卡片、LQIP、
VNDB 封面三个要联网的步骤），本站用不到，留着备用。

---

## 目录结构

```
├── src/
│   ├── pages/                路由（[ ...page ].astro 是首页分页）
│   ├── content/
│   │   ├── posts/            ★ 笔记，一篇一个 .md
│   │   └── spec/             关于页 / 友链页的正文
│   ├── config/               ★ 站点配置都在这里
│   │   ├── siteConfig.ts     标题、副标题、页面开关、分页
│   │   ├── navBarConfig.ts   导航栏
│   │   ├── sidebarConfig.ts  侧栏组件与顺序
│   │   ├── displaySettingsConfig.ts  外观设置面板开关
│   │   ├── backgroundWallpaper.ts    壁纸与 banner
│   │   ├── profileConfig.ts  头像、简介、社交链接
│   │   └── galleryConfig.ts / friendsConfig.ts  相册与友链
│   ├── components/           组件（controls / layout / custom ...）
│   ├── layouts/              Layout 与 MainGridLayout
│   ├── lib/supabase.ts       Supabase 客户端
│   └── styles/               全局样式、自定义 Markdown 样式
├── public/                   ← 原样复制进 dist，不经构建
│   ├── tools/                ★ 12 个小工具
│   ├── branches/             ★ 4 个分支页 + index.json
│   ├── admin/                管理后台（静态页）
│   ├── assets/               共享 CSS / JS / 图片 / 音乐 / KaTeX
│   ├── data/index.json       旧站内容索引（历史遗留，两篇笔记正文引用）
│   └── .nojekyll             ★ 必须保留
├── scripts/                  构建与维护脚本
├── supabase/schema.sql       数据库结构（幂等，可重复执行）
├── dist/                     构建产物，不进 git
└── .github/workflows/        部署
```

`public/` 下的东西**不会**被 Astro 处理，工具页里的相对路径
（`../../assets/js/...`）在构建后依然成立，这是能"原样搬运"的前提。

---

## 新增一篇笔记

在 `src/content/posts/` 下新建 `.md`：

```markdown
---
title: 笔记标题
published: 2026-09-25
description: 一句话摘要
category: 动力气象学
tags: [动力气象学]
---

正文……
```

`category` 决定归档页的归类，现有六个：天气学原理 / 动力气象学 / 大气探测学 /
技术 / 工具 / 生活。`tags` 用于标签页。

正文不要写 `# 标题`，页面 banner 已经显示了标题，重复会撞出两个大标题。

### 公式必须写成独占行的定界符

这是踩过的坑，KaTeX 的解析规则比想象中严格：

```markdown
✅ 正确
$$
\frac{1}{\rho}\frac{d\rho}{dt}=0
$$

❌ 错误：单行写会被当成行内公式
$$\frac{1}{\rho}\frac{d\rho}{dt}=0$$

❌ 错误：结束符贴在内容后面
$$
\frac{1}{\rho}\frac{d\rho}{dt}=0 \tag{1}$$
```

`remark-math` 只认**独占整行**的 `$$`。写错的话公式会退化成行内样式（不居中、
字号变小），带 `\tag` 的直接报错，更糟的是它会一路吞掉后面的正文。

批量修好的工具：`python scripts/fix_math_delimiters.py --apply`（幂等，可重复跑）。

### 多色批注

旧站的五色批注样式已迁移到 `src/styles/custom-markdown.css`，写法不变：

```html
<span class="mk-red">易错点</span>
<span class="mk-blue">物理意义</span>
<span class="mk-green">最终方程</span>
<span class="mk-purple">数学技巧</span>
<span class="mk-orange">课件对应</span>
```

---

## 新增一个小工具

```
public/tools/<名字>/
├── index.html      页面（自己写样式和脚本，和主站互不依赖）
└── meta.json       列表卡片信息
```

```json
{
  "title": "工具名",
  "description": "一句话介绍",
  "icon": "🧩",
  "tags": ["工具"],
  "order": 10
}
```

`/tools/` 列表页和首页的工具卡片都在构建时读这些 `meta.json`，`order` 越小越靠前。
不需要改任何 Astro 代码。

工具页如果要用门禁和访客统计，引 `../../assets/js/site-gate.js` 即可；
要用 Supabase 引 `../../assets/js/supabase.js`（注意是 ES module）。

---

## 新增一个分支页

和工具一样的结构，放在 `public/branches/<名字>/`，然后在
`public/branches/index.json` 的 `branches` 数组里登记一条：

```json
{
  "folder": "your-page",
  "url": "branches/your-page/index.html",
  "title": "页面名",
  "description": "一句话介绍",
  "tags": ["生活"],
  "icon": "🎖️",
  "order": 5
}
```

> `url` 写「相对站点根目录」的路径，不要带前导斜杠——构建时会自动补。
> 没登记的目录也会被扫描到（有 `index.html` 就行），用目录里的 `meta.json` 兜底。

`branches/junxun/` 是自包含的特例：它把 Supabase 的 URL 和 publishable key
直接写在文件里的 `CONFIG` 常量中，走 REST 而不引 `supabase.js`。

---

## 部署

GitHub Actions：push 到 `main` 后

```
checkout → pnpm → node 22 → pnpm install → pnpm build
→ upload-pages-artifact(dist) → deploy-pages
```

上传的是 `dist/`，不是仓库根。工具页、分支页、`.nojekyll` 都在 `dist/` 里，
所以不需要旧的 `rm -rf .git .github` 那套操作。

第一次 push 后建议看一眼 Actions 日志：本地是 npm 装的依赖，CI 是 pnpm 装的，
两边 `node_modules` 结构不同，"本地构建成功"不完全等价于"CI 构建成功"。

---

## 动态能力（Supabase）

站点托管在 GitHub Pages，Supabase 提供数据库和账号体系：

| 功能 | 说明 | 数据 |
| --- | --- | --- |
| 全站门禁 | 未登录/未放行时遮罩挡住内容，可开关 | `site_settings.guest_access` |
| 访客统计 | 侧栏总访问 / 独立访客 / 今日 | `visits` 表 + `get_site_stats()` |
| 登录注册 | 导航栏入口，邮箱 + 密码 | `profiles` 表（触发器建档） |
| 管理后台 | `/admin/`：账号封禁、访客黑名单、行为轨迹 | `admins` / `banned_visitors` |
| 留言墙 | `/guestbook/`：留言 / 点赞 / 回复 | `wall_posts` / `wall_replies` |
| 在线房间 | 军训页留言、看图识天研判、棋类排行榜 | 见 `supabase/schema.sql` |

启用步骤（一次性）：

1. Supabase 控制台 → SQL Editor → 运行 `supabase/schema.sql`（幂等）；
2. Project URL 与 publishable key 填进 `src/lib/supabase.ts`；
3. 想注册后立即登录：Authentication → 关闭 Confirm email；
4. 执行 RPC 后如果报 `PGRST202`，去 SQL Editor 跑一次 `NOTIFY pgrst, 'reload schema'`。

安全设计：`visits` 开 RLS，匿名只能写不能读原始记录，统计走
`security definer` 聚合函数只暴露计数。管理员判定在数据库层，
前端拿不到额外权限。

后端不可达时整站自动退化为纯静态（无报错、无动态元素）。

---

## 已知的外部依赖

这几处在离线或受限网络下会失败，属于可接受的降级：

| 位置 | 依赖 | 影响 |
| --- | --- | --- |
| 看板娘 Spine | `unpkg.com` 的 spine-player | 加载不到就是没有看板娘 |
| 军训页 | `cdn.bootcdn.net` 的 xlsx | 名单解析失效 |
| 分支页 cloud-cover | 本地 `model/ort.min.js` | 已在仓库内，无外网依赖 |

---

## Credits

Astro · [Firefly](https://github.com/CuteLeaf/Firefly)（主题）· Svelte · Tailwind CSS
· KaTeX · Pagefind · Supabase
