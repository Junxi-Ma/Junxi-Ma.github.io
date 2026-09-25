---
title: 无构建步骤下的自动索引与渲染管线
date: 2026-09-10
tags: [架构, GitHub Actions, 前端]
description: 不用任何框架和打包器，怎么让纯静态网站自动发现新笔记并安全地渲染 Markdown。
---

# 无构建步骤下的自动索引与渲染管线

纯静态网站的经典难题：**服务器不会给你目录列表**。GitHub Pages 访问一个文件夹只会得到 404，那前端怎么知道 `notes/` 里有哪些文件？

## 方案选型

| 方案 | 思路 | 否决原因 |
| --- | --- | --- |
| 运行时调 GitHub API | `api.github.com` 列目录 | 未认证 60 次/小时/IP，国内网络不稳 |
| 手动维护清单 | 每加一篇改一行 JSON | 忘记登记 = 内容丢失，违背「放进去就上线」 |
| **构建时生成清单** ✅ | 部署时扫描目录写 JSON | 无运行时依赖，清单只是一份静态文件 |

## 索引脚本

`scripts/build_index.py`，纯标准库，部署时由 GitHub Actions 调用：

```python
import json, re
from pathlib import Path

def parse_frontmatter(text: str) -> dict:
    """解析简单 YAML 子集：key: value 与 tags: [a, b]。"""
    m = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n?", text, re.S)
    if not m:
        return {}
    meta = {}
    for line in m.group(1).splitlines():
        kv = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if not kv:
            continue
        key, val = kv[1], kv[2].strip()
        if val.startswith("[") and val.endswith("]"):
            meta[key] = [v.strip().strip("'\"") for v in val[1:-1].split(",")]
        else:
            meta[key] = val.strip("'\"")
    return meta

notes = []
for p in sorted(Path("notes").rglob("*.md")):
    text = p.read_text(encoding="utf-8")
    meta = parse_frontmatter(text)
    notes.append({
        "path": p.as_posix(),
        "title": meta.get("title") or "未命名",
        "date": meta.get("date"),
        "tags": meta.get("tags", []),
    })

Path("data").mkdir(exist_ok=True)
Path("data/index.json").write_text(
    json.dumps({"version": 1, "notes": notes}, ensure_ascii=False, indent=2),
    encoding="utf-8",
)
```

两个关键细节：

1. **不写时间戳**。`generatedAt` 会让每次生成的文件都不一样，破坏「内容没变就跳过」的幂等判断。
2. **单文件解析失败只告警不中断**。个人网站不该因为一个坏文件挂掉整个部署。

## 渲染管线

前端三步走，顺序不可颠倒：

```javascript
const html = window.marked.parse(body);          // 1. Markdown → HTML
const clean = window.DOMPurify.sanitize(html);    // 2. 净化（必须在注入前）
container.innerHTML = clean;                      // 3. 注入 DOM
```

> **永远不要跳过第二步。** 即使笔记都是自己写的，一个复制粘贴来的 `<img onerror=...>` 就足以让页面变成别人的画布。DOMPurify 会在浏览器端解析 HTML 并剥掉所有危险属性。

## 路径白名单

详情页用 `note.html?path=notes/xxx.md` 这样的查询参数路由（纯静态站点没有服务端 rewrite）。参数是用户可控的，必须校验：

```javascript
function validatePath(raw) {
  if (!raw) return null;
  const path = raw.trim();
  if (path.startsWith('/') || path.includes('..')) return null;
  if (path.includes('://') || path.includes('//')) return null;
  if (!/^notes\/[A-Za-z0-9_][A-Za-z0-9_\-./]*\.md$/.test(path)) return null;
  return path;
}
```

没有这层校验，`?path=https://evil.com/x.md` 会让浏览器去攻击者的服务器拉内容，再原样渲染到你的页面上。

## 部署时序

```
git push
   │
   ▼
GitHub Actions: build_index.py → 生成 data/index.json
   │
   ▼
upload-pages-artifact（打包整个目录）
   │
   ▼
deploy-pages → 上线
```

整条链路里没有任何第三方运行时依赖——访问者只需要拿到同源的几个静态文件。
