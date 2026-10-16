# Michael — 个人网站

暗色高级感的个人网站：纯静态前端 + Supabase 动态后端（登录、统计、在线房间），小工具、子网页与学习笔记。
**零框架、零打包步骤** —— 只有 HTML / CSS / JavaScript，部署在 GitHub Pages
（唯一的 CI 环节是用 Python 标准库生成内容索引，见「内容索引机制」）。

![风格] 深空底 `#080F1F` + 靛蓝强调色 `#818CF8` + 玻璃拟态卡片，所有视觉变量集中在 `assets/css/tokens.css`。
站点身份、氛围特效、天气、预留栏目集中在 `assets/js/site-config.js`。

---

## 目录结构

```
├── index.html              首页（hero / 精选工具 / 最新笔记 / 分支 / 资料卡+天气）
├── tools.html              工具列表
├── notes.html              笔记列表（搜索 + 标签筛选）
├── note.html               笔记详情（?path=notes/xxx.md）
├── branches.html           分支列表（子网页索引，数据来自 data/index.json）
├── photos.html             照片墙（预留，默认空）
├── timeline.html           时间线（预留，默认空）
├── moments.html            朋友圈（预留，默认空）
├── admin.html              管理后台（Supabase 管理员可访问）
├── 404.html                自定义 404（GitHub Pages 自动生效，完全自包含）
├── .nojekyll               ★ 必须保留：禁用 Jekyll，否则 .md 文件会被它转换吃掉
├── .github/workflows/      GitHub Actions：现场生成索引并部署 Pages（见下文）
├── .githooks/pre-commit    本地提交钩子：commit 时刷新索引，仅为本地预览方便
├── assets/
│   ├── css/                tokens.css 设计变量+深浅主题 · main.css 全站（两层结构）·
│   │                       markdown.css 笔记排版 · tool-ui.css 部分工具页组件
│   ├── js/                 site-config.js 全站控制中心 ★
│   │                       main/nav+主题切换 · effects/氛围特效 · weather/天气
│   │                       api/数据 · markdown/渲染 · collection/预留栏目 · 页面控制器
│   ├── vendor/             本地托管的 marked / DOMPurify / highlight.js（不依赖 CDN）
│   └── img/                favicon、og.png 分享图、avatar.svg 头像
├── notes/                  ★ 笔记放这里（.md 文件）
├── tools/<名字>/           ★ 工具放这里（每个工具一个文件夹 + index.html）
├── branches/               ★ 分支子网页放这里（每个子网页一个文件夹）
│   ├── index.json          分支定制清单（标题/简介/标签/排序，可选）
│   └── junxun/             军训专属祝福（留言板）
├── data/                   index.json 内容索引（生成物）·
│                           photos/timeline/moments.json 预留栏目数据
├── scripts/build_index.py  索引生成脚本（纯标准库）
└── README.md
```

### main.css 的两层结构

`assets/css/main.css` 按层叠顺序分成四段，**顺序不能调换**：

1. **基础层** —— 组件结构、排版、布局
2. **补充层** —— 认证弹窗、工具类等零散规则
3. **动效层** —— 入场动画、滚动进度、返回顶部
4. **皮肤层** —— 靛蓝玻璃质感，最终视觉出口

改样式时优先改皮肤层或 `tokens.css`，不要在基础层里继续打补丁 —— 之前
「两段互相重复的覆盖层叠在文件末尾」就是这么来的。
**所有颜色走 `tokens.css` 的变量**，不要写死色值；需要带透明度时用
`rgba(var(--accent-rgb), α)`。

---

## 全站控制中心：`assets/js/site-config.js`

身份信息、氛围特效、天气、预留栏目都在这一个文件里，改这里不用碰任何页面代码。

```js
export const siteConfig = {
  name: 'Michael',
  avatar: 'assets/img/avatar.svg',   // 换头像：丢进 assets/img/ 再改这个路径
  bio: '……',
  social: { email: '…', github: '…' },

  effects: {
    click: true,        // 点击涟漪
    dark: 'fireflies',  // 暗色氛围：fireflies | sakura | snow | none
    light: 'sakura',    // 亮色氛围：同上
    danmaku: false,     // 弹幕
    grass: false,       // 页面底部风动草丛
  },
  danmakuList: ['…'],

  weather: { enabled: true, city: '北京', latitude: 39.9042, longitude: 116.4074 },

  reserved: { photos: false, timeline: false, moments: false },
};
```

### 氛围特效

特效由 `assets/js/effects.js` 实现（原生 DOM + CSS 动画），开关在上面
`effects` 段。**全部关掉时页面零额外开销**；`prefers-reduced-motion` 下自动全部停用。

- 暗色默认萤火虫、亮色默认樱花，跟随主题自动切换
- 点击涟漪走 canvas 绘制，颜色取自 `--accent-rgb`
- 弹幕文案池是 `danmakuList`，默认关（打开后文字会横穿屏幕）

调好后在浏览器控制台可以 `window.siteEffects.rerender()` 立即看到效果。

### 天气组件

用 [Open-Meteo](https://open-meteo.com/) 免密钥接口，**浏览器直连，不需要任何后端**，
所以纯静态的 GitHub Pages 也能跑。改 `weather.latitude/longitude` 换城市；
请求超时（5 秒）或被墙时自动降级为「暂不可用」占位，不会报错也不会留空。

### 预留栏目（照片墙 / 时间线 / 朋友圈）

三个页面已经建好、样式和主站一致，数据为空时显示引导文案。
**默认不在导航里** —— 因为空的页面挂在菜单上不好看。

启用步骤：

1. 往 `data/photos.json`（或 `timeline.json` / `moments.json`）里填数据：

```json
{
  "items": [
    { "src": "photos/2026-春.jpg", "title": "春天的操场", "date": "2026-04-01" }
  ]
}
```

  时间线条目字段：`date` / `title` / `text` / `tag`（可选）；
  朋友圈条目字段：`date` / `text` / `images`（图片路径数组）。

2. 把 `site-config.js` 里对应的 `reserved.photos` 改成 `true` —— 导航会自动出现入口，
   **不用去改十几个页面里各自一份的导航标记**。


---

## 本地预览

> ⚠️ **必须用 HTTP 服务器打开，不能双击 HTML 文件**（`file://` 下浏览器会拦截
> `fetch`，列表和笔记会渲染不出来）。

```bash
# 1. 生成内容索引（本地预览需要；线上由 GitHub Actions 自动生成，无需手动跑）
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

全站只有一套配色身份：**靛蓝玻璃**。暗色是深空底 + 靛蓝 + 玻璃卡片，亮色是薰衣草白玻璃。
所有颜色都是变量，集中在 `assets/css/tokens.css`，想换色只改这个文件。

笔记页的代码高亮也随主题切换了两套色板。氛围特效（萤火虫 / 樱花）同样跟着主题走。

---

## 新增一篇笔记

1. 在 `notes/` 下新建 `.md` 文件（文件名建议用英文小写，如 `my-note.md`）
2. 写入内容（frontmatter 全部可选）：

```markdown
---
title: 笔记标题
date: 2026-09-25
tags: [技术]
description: 一句话摘要，显示在列表里。
---

# 笔记标题

正文……
```

3. `git add . && git commit -m "新增笔记"` —— **不用管索引**，推送后 GitHub Actions 会自动生成，
   约 1 分钟上线。

**回退规则**：缺 `title` 取正文第一个 `#` 标题；缺 `description` 取首段文字；
缺 `date` 归入「未标注」分组；缺 `tags` 不显示标签。

### 标签词表（请只从这里选）

标签是列表页的筛选按钮，**每个内容只挂一个**，全站共用这 8 个词：

| 标签 | 用于 | 当前数量 |
| --- | --- | --- |
| `天气学原理` | 天气学原理课程笔记、天气图/锋面相关项目 | 2 |
| `动力气象学` | 动力气象学课程笔记 | 2 |
| `大气探测学` | 大气探测学课程笔记、云相关项目 | 3 |
| `技术` | 建站、样式、构建链路等技术笔记 | 3 |
| `工具` | 实用小工具 | 4 |
| `游戏` | 休闲游戏 | 4 |
| `学习` | 刷题、记忆、题库 | 2 |
| `生活` | 纪念页、留言板等杂项 | 1 |

> 别自己发明新词（`CSS`、`GitHub Actions`、`球坐标系` 这类是内容细节，不是分类）。
> 确实需要新分类时，先在这里加一行，再统一改。

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

## 新增一个分支子网页

「分支」是给**独立成篇的小网页**准备的收纳区 —— 和「工具」不同，它们不必是
单一功能的效率工具，可以有自己完整的视觉风格与交互，只是和主站同源部署。

1. 新建文件夹 `branches/<你的页面名>/`
2. 放入 `index.html` 作为入口（页面内部的相对路径按自己的目录算即可）
3. 可选 `meta.json` 自定义列表展示：

```json
{
  "title": "页面显示名",
  "description": "一句话介绍。",
  "tags": ["纪念"],
  "icon": "🎖️",
  "order": 1
}
```

4. 也建议在 `branches/index.json` 的 `branches` 数组里登记一条
   （字段同上，外加 `folder` 和可选的 `url`）。

**两条路都能上线**：登记过的走清单；没登记的子目录也会被
`scripts/build_index.py` 自动扫描到，用它的 `meta.json` 兜底 —— 所以不会因为
忘了登记而漏掉页面。清单方式优先级更高，适合想改标题/简介/排序的情况。

页面里想跳回站点，用相对路径指 `../../branches.html` 或 `../../index.html`。
同样 commit + push 即可上线。

> 现有示例：`branches/junxun/`（军训专属祝福留言板）。它保留了原本的军绿色
> 纸感设计，只额外加了一个常驻左下角的「返回站点」入口。

---

## 部署说明（GitHub Pages）

**当前方案：GitHub Actions 构建并部署**，工作流在 `.github/workflows/pages.yml`。

仓库 Settings → Pages → Source 必须设为 **GitHub Actions**
（若该选项灰色，检查 Settings → General → Actions 是否被禁用、或账号邮箱是否已验证）。

服务端每次推送会：检出仓库 → **现场运行 `scripts/build_index.py` 生成 `data/index.json`**
→ 打包整个站点 → 部署。

推送流程就是普通三连，**不需要跑任何脚本**：

```cmd
git add .
git commit -m "更新说明"
git push
```

- 索引由**服务端现场生成**，永远和内容同步；本地不需要跑任何脚本
- 用 GUI 客户端提交、甚至直接在 GitHub 网页上改 `notes/`，一样会自动生效
- 推送后 GitHub 约 1 分钟完成部署
- 约 10 分钟内 CDN 可能短暂显示旧列表，强刷（Ctrl+F5）即可

### 本地钩子（可选，只为本地预览）

`.githooks/pre-commit` 会在 `git commit` 时刷新 `data/index.json`，好处是本地预览
立刻就是最新列表。它**不再是线上正确性的依赖** —— 线上由工作流兜底。

**新 clone / 换电脑后想启用，执行一次**：

```cmd
git config core.hooksPath .githooks
```

移除钩子：`git config --unset core.hooksPath`

> 之前「网页上改笔记不会更新索引」的坑已经不存在了：索引改由服务端生成，
> 任何提交方式都能追平。

### 部署须知

- **提交信息里不要写 `[skip ci]`** —— 会跳过整个部署工作流，站点不会更新
- 别忘了 `Settings → Pages → Source` 得是 **GitHub Actions**；若仍是
  "Deploy from a branch"，工作流会在部署步骤报错（此时站点靠分支部署仍能上线，
  但索引不会自动生成）

### 回退到分支部署

把 `Settings → Pages → Source` 改回 **Deploy from a branch**（分支 `main`、
目录 `/(root)`），并删除 `.github/workflows/pages.yml`。此时索引要自己保证最新：
本地钩子会兜底，或在推送前手动跑 `python scripts/build_index.py`。

两种方案共用同一份 `data/index.json` 前端契约，站点代码零改动。

---

## 常见问题

| 现象 | 原因 / 解决 |
| --- | --- |
| 列表一直转圈或显示 Error | `data/index.json` 缺失或过期 → 本地 `python scripts/build_index.py`；线上看 Actions 是否部署成功 |
| 钩子没生效（commit 时没有 `[pre-commit]` 输出） | 执行 `git config core.hooksPath .githooks` 重新挂上（仅影响本地预览，线上由工作流兜底） |
| 双击打开全部空白 | 必须用 HTTP 服务器（见「本地预览」） |
| `.nojekyll` 删了之后笔记 404 | Jekyll 会把 .md 转成 .html，**别删这个文件** |
| 导航菜单改了没生效 | 导航/页脚在每个页面里各有一份（8 个主页面 + 9 个工具页），需同步修改（无构建的代价）。预留栏目走 `site-config.js` 自动注入，不受此影响 |
| 新增分支页面后列表里没有 | `data/index.json` 缺失或过期 → 本地 `python scripts/build_index.py`；线上看 Actions 是否部署成功 |
| 分支页面从子目录跳不回站点 | 用相对路径 `../../branches.html`，别写绝对路径 `/branches.html`（站内需兼容子路径部署） |
| 页面一闪而过变色（深→浅） | 正常：主题在 `<head>` 内联脚本里就已确定，闪的是浏览器首次绘制 |
| 新笔记文件名是中文 | 能用，但 URL 会带编码，建议英文 slug |
| 网页版 GitHub 改了笔记但列表没更新 | 索引由服务端工作流生成，等部署完成即可；若一直没变，检查 Pages Source 是否为 GitHub Actions |
| **推送后网页没变化** | ① `git status -sb` 看是否还领先 `origin/main`（没推送成功最常被忽略）；② 查 Actions 是否有红灯；③ 提交信息里别带 `[skip ci]` |
| 改了 Markdown 但线上还是旧索引 | 看 Actions 的 `构建索引并部署站点` 是否成功；失败时站点会停在上一版 |

## 内容索引机制

纯静态站点没有服务端目录列表，所以：

```
你写笔记（任意方式：编辑器 / GUI / GitHub 网页）
   → git push
   → GitHub Actions 检出仓库并现场运行 build_index.py（扫描 notes/ 和 tools/ 和 branches/）
   → 生成 data/index.json 打进发布产物（幂等：内容没变则字节级一致）
   → 部署到 Pages → 前端读同源的 index.json
```

索引由**服务端生成**，所以本地不需要跑任何脚本，也不会再出现「改了笔记但列表是旧的」。
仓库里入库的 `data/index.json` 只服务本地预览。

零第三方运行时 API（不依赖 api.github.com 等，国内访问稳定）。
脚本纯 Python 标准库，本地即可运行。

## 动态能力（Supabase 后端）

站点托管仍在 GitHub Pages；Supabase 提供数据库与账号体系，让部分功能"上云"：

| 功能 | 说明 | 数据 |
| --- | --- | --- |
| 全站访客统计 | 页脚展示 总访问 / 独立访客 / 今日访问 | `visits` 表（匿名，仅随机访客 id + 路径） |
| 登录注册 | 导航栏入口，邮箱 + 密码（Supabase Auth 托管） | `profiles` 表（触发器自动建档） |
| 管理后台 | `admin.html`：账号封禁/解封、访客黑名单、访客行为轨迹、管理员名单 | `admins` / `banned_visitors` + 管理员可读 `visits` |
| 留言板 | 分支页 `branches/junxun/` 的共享留言墙：留言/点赞/回复 + 管理员置顶改删 | `wall_posts` / `wall_replies` / `site_data` |

`supabase/schema.sql` 里**同时包含**留言板那三张表的建表语句，整段都是幂等的
（表已存在就什么都不做，不会动任何一行数据），仅供「这个项目的完整结构有据可查」；
万一要重建项目，跑一遍本文件就能恢复出同样的结构。

> 留言板前端**没有引用站点的 `assets/js/supabase.js`**：它是一个自包含的单文件页面
> （`branches/junxun/index.html`），把 URL 与 publishable key 直接写在文件里的
> `CONFIG` 常量中，走 REST 而非 supabase-js。两处配置是**同一个项目、同一个
> publishable key**，改的时候记得各改各的，别只改一边。

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

天气数据来自 [Open-Meteo](https://open-meteo.com/)（CC BY 4.0），免密钥、浏览器直连，
不引入任何前端依赖。氛围特效移植自
[XinghuisamaBlogs](https://github.com/XingHuiSama/XinghuisamaBlogs) 的视觉组件，
用原生 DOM + CSS 动画重写，无 React / 无构建依赖。
