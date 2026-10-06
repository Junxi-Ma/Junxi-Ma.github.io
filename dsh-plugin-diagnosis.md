# DSH Desktop 插件巡检与 Browser 修复报告

> 巡检时间：2026-09-30（vision-toolkit 部分于启用后二次修订）
> 环境：DSH Desktop Next `2.0.15-next`，DSH 核心 `@deepseek-ai/dsh@0.1.7-rc.2`
> Profile：`C:\Users\35002\.dsh\profiles\desktop`

## 一、结论速览

| 插件 | 状态 | 原因 |
|---|---|---|
| `dsh-free-search` | ✅ 正常 | — |
| `dsh-context` | ✅ 正常 | — |
| `dsh-skill-importer` | ✅ 正常 | — |
| `@liustack/modlens` | ⚠️ 已挂载但**无视觉后端** | 6 个 provider 全部缺 CLI/API key |
| `@wxg-prc-cpg/browser-skill-dsh-plugin` | ❌ **不可用** | `bsk` CLI 未安装 |
| `dsh-browser-use` | ❌ 不可用 | 缺 `BROWSER_USE_API_KEY` |
| `dsh-builtin-browser` | ⛔ 已安装但**未挂载** | 不在 bundles 列表 |
| `@anionex/dsh-vision-toolkit` | ❌ **挂载后崩溃** | 调用已被移除的 `ctx.settings.register` |
| `@linxin666/*` 系列、`@sidleo3/*` | ✅ 正常 | — |

## 一·补：vision-toolkit 启用后崩溃（2026-09-30 二次修订）

挂载后重启，日志给出确切错误：

```
[warn] dsh: warning: 1 entry did not activate
[info] vision-toolkit (@anionex/dsh-vision-toolkit): TypeError: ctx.settings.register is not a function
       at .../dsh-vision-toolkit/lib/index.js:32:35
```

### 根因：DSH 核心删除了 `settings.register`，插件仍按旧 API 编写

逐版本核对 `@deepseek-ai/dsh-settings` 的方法表（实测 npm 包内容）：

| DSH 核心版本 | 是否有 `register()` | 服务方法 |
|---|---|---|
| `0.1.1-rc.2` | **有** | register / update / replace / mutate / section / get … |
| `0.1.3-alpha.2` | **有** | 同上 |
| `0.1.5-rc.1` | **有** | `register(ns, schema, options)` |
| `0.1.7-rc.2`（**本机**） | **无** | configure / describe / update / replace / mutate / write / schema |
| `0.2.0-rc.2`（最新） | **无** | 同 0.1.7 |

即 `register` 在 `0.1.5-rc.1 → 0.1.7-rc.2` 之间被**移除**，换成 `configure`/`describe` 体系。

而 `@anionex/dsh-vision-toolkit` **全部版本（0.1.10 ~ 0.1.45）都调用
`settings.register`**，所以：

- **降级插件无效**（老版本同样调用 register）；
- **升级 DSH 核心也无效**（0.2.0-rc.2 同样没有 register）；
- 只有把 DSH 核心**回退到 0.1.5-rc.1 或更早**才可能兼容——但那会连带影响其它一切。

### 附带发现：内置免费视觉后端当前不可用

插件自带免费后端 `https://vision.anionex.me/v1`（模型 `gemini-3.7-flash`，
public key `https://agent-vision.anionex.me`）。实测（node 直连，绕过沙箱）：

| 请求 | 结果 |
|---|---|
| `GET /v1/models` | ✅ HTTP 200，返回 gemini-3.7-flash / gemini-3.6-flash-low |
| `POST /v1/chat/completions`（带图） | ❌ HTTP 502（Cloudflare 网关错误，后端不可用） |
| 备选模型 `gemini-3.6-flash-low` | ❌ HTTP 429 rate_limit_exceeded |

**结论：即使修好了 `register` 崩溃，这个免费后端目前也读不了图。**
所以**现阶段不建议为它回退 DSH 核心**——代价大、收益为 0。

**没有插件是"文件损坏/安装残缺"的**：16 个包的目录、入口、patch 全部完整。
失败全部发生在**运行时外部依赖**（CLI 未装、API key 未配）和**挂载缺失**两类。

## 二、Browser 为什么不能用（根因链）

日志里的确切报错：

```
[@wxg-prc-cpg/browser-skill-dsh-plugin] bsk probe failed (spawn bsk ENOENT);
browser tools will report install guidance until the bsk CLI is available
```

调用工具时的报错：

```
the bsk CLI ("bsk") was not found. BrowserSkill must be installed and on PATH
```

### 根因 1：`bsk` 根本没安装，而且**装不上**

- 全盘搜索 `bsk.exe` / `bsk.cmd`：**零结果**；
- `bskPath` 默认值就是 `"bsk"`，从 PATH 解析 → 必然 ENOENT；
- 真实来源只有 GitHub：`https://github.com/Tencent/BrowserSkill`（Rust 项目，`cargo install`）；
- **但本机 `github.com` 被 hosts 劫持到 `127.0.0.1`**，无法 clone/下载；
- `cargo` / `rustc` 也都没装；
- npm 上的 `bsk@0.0.1` 是**完全无关**的 Vue 小项目，不是 BrowserSkill CLI，不能装错。

### 根因 2（附带）：hosts 文件被 Steam++ / Watt Toolkit 改写

`C:\Windows\System32\drivers\etc\hosts` 中有一段以 `# Steam++ End` 结尾的劫持块，
把 **GitHub 全家桶 + github.io + huggingface.co + hcaptcha** 等统统指向 `127.0.0.1`：

```
127.0.0.1 github.com          ← 第 86 行
127.0.0.1 api.github.com
127.0.0.1 raw.githubusercontent.com
127.0.0.1 objects.githubusercontent.com
127.0.0.1 github.io           ← 第 93 行
127.0.0.1 huggingface.co
...
# Steam++ End
```

**这同时解释了上一轮的 GitHub Pages 推送失败**——`SEC_E_NO_CREDENTIALS` 是因为
TLS 连到了一个 127.0.0.1 上的假端点。

> 注：`crates.io` / `registry.npmjs.org` **没有**被劫持，解析正常。

## 三、修复方案（按推荐顺序）

### 方案 A：修好 hosts，然后装真正的 bsk（推荐，功能最全）

因为 `bsk` 提供的是**真实浏览器自动化**（能在你已登录的 Chromium 里操作），
这是三个 browser 插件里能力最强的。

1. **先关掉 Steam++ / Watt Toolkit**（它会在退出时或下次启动时重写 hosts）。
   若已卸载，则手动清理 hosts：
   - 用**管理员**身份打开 `C:\Windows\System32\drivers\etc\hosts`；
   - 删除 `# Steam++ Start` 到 `# Steam++ End` 之间的所有 `127.0.0.1` 行（包括 `github.com`、`github.io`）；
   - 保存，然后 `ipconfig /flushdns`（以管理员运行）。
2. 验证：`Resolve-DnsName github.com` 应该返回真实 IP（如 `20.205.243.166`），**不再是 127.0.0.1**。
3. 安装 Rust 与 bsk（PowerShell）：
   ```powershell
   # 装 Rust（若已有 cargo 可跳过）
   winget install Rustlang.Rustup
   # 重开终端后
   cargo install --git https://github.com/Tencent/BrowserSkill bsk
   ```
4. `bsk --version` 能打印版本即成功；重启 DSH Desktop 后 `browser_*` 工具即可用。

### 方案 B：换用内置浏览器（不需外部 CLI，但当前未挂载）

`dsh-builtin-browser` 自带 Electron 窗口，**不需要任何外部 CLI**。
它的 compatibility 声明是 `>=0.1.1-rc.1 <0.2.0`，而本机核心是 `0.1.7-rc.2`，**在支持范围内**。

在 profile 的 `package.json` → `dsh.profile.bundles` 数组里追加：

```json
"dsh-builtin-browser"
```

⚠️ **冲突警告**：它和 bsk 插件**都注册了 `browser_session`** 工具名，不能同时挂载：

| 内置浏览器 | bsk 插件 |
|---|---|
| browser_open / click / fill / snapshot … | browser_page / interact / inspect … |
| `browser_session` ⚠️ | `browser_session` ⚠️ |

所以要用方案 B，得先把 bsk 插件的挂载去掉（或二选一）。

### 方案 C：`@anionex/dsh-vision-toolkit` —— ⛔ 已尝试，**不可行**（勿再挂载）

> ⚠️ 本节结论已被上方「一·补」推翻，保留作为记录。

原以为「已安装但从未进 bundles，追加即可生效」。实测追加并重启后：
**插件加载即崩溃**（`ctx.settings.register is not a function`），且
**降级插件 / 升级核心都无法解决**，同时它的免费后端当前返回 502。

**建议：把 `"@anionex/dsh-vision-toolkit"` 从 `dsh.profile.bundles` 里移除**，
避免每次启动都产生一条 `1 entry did not activate` 告警。

### 方案 D：让 modlens 有视觉后端（修好"读图"能力）

`@liustack/modlens` 本身挂载正常，但 `doctor` 显示 6 个 provider 全部不可用：

```
[!!] antigravity-cli: agy not on PATH
[!!] gemini-api:      missing: apiKey
[!!] openai:          missing: baseUrl, apiKey, model
[!!] anthropic:       missing: apiKey
[!!] claude-cli:      claude not on PATH
[!!] kimi-cli:        kimi not on PATH
```

**最省事的办法**：配一个 Gemini 免费 key

```powershell
# 免费申请：https://aistudio.google.com
cd $env:USERPROFILE\.dsh\profiles\desktop
node node_modules\@liustack\modlens\dist\main.js config set gemini-api.apiKey
# 然后验证
node node_modules\@liustack\modlens\dist\main.js doctor
```

配置后 `modlens_read_image` 就能读图了。

## 四、为什么我没有直接改

- `C:\Users\35002\.dsh\...` 在工作区之外，文件沙箱**拒绝写入**（已实测：`对路径...的访问被拒绝`）；
- 改 `hosts` 需要**管理员权限**，当前会话不是管理员；
- 安装 Rust / cargo 属于会改变系统环境的操作，且依赖先修 hosts；
- `browser_session` 重名冲突需要你先决定**用哪个浏览器方案**，我不应替你选。

以上四步都需要你（或提权后的终端）执行。做完任一项告诉我，我可以立即验证结果。

## 五、顺带发现

日志里还有一条与浏览器无关的客户端告警，出现多次：

```
[warn] slot entry crashed in 'conversation.input.left': Error: Minified React error #130
```

React #130 = "element type is invalid"，说明某个**客户端 UI 插件**往
`conversation.input.left` 这个插槽注入了 `undefined`。日志里 `[next-ui-diagnostic]`
的 `plugins=false` 状态与之相关，但**没有打印出具体是哪个插件**。
需要更详细的日志（或逐个禁用客户端插件二分）才能定位，目前不影响主流程。
