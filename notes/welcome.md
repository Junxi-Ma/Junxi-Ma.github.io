---
title: 欢迎来到我的数字工坊
date: 2026-09-25
tags: [建站, 元]
description: 这个网站是怎么运作的：纯静态架构、自动内容索引与 GitHub Pages 部署。
---

# 欢迎来到我的数字工坊

这是这个网站的第一篇笔记。它同时也是一个最小可行示例：**你正在阅读的这个页面，就是由这样一个 Markdown 文件自动生成的**。

## 新增一篇笔记要做什么？

只需两步，不需要碰任何 HTML：

1. 在 `notes/` 文件夹里新建一个 `.md` 文件（建议用英文小写命名，例如 `my-first-note.md`）
2. 写入 frontmatter 和正文，保存

```markdown
---
title: 笔记标题
date: 2026-09-25
tags: [前端, 随笔]
description: 一句话摘要，会显示在列表里。
---

# 笔记标题

正文从这里开始……
```

> frontmatter 里的字段都是可选的。即使一个都不写，标题会回退到正文的第一个 `#` 标题，摘要回退到首段文字。

## 支持的 Markdown 语法

笔记支持完整的 GFM 语法，包括表格、任务列表和代码高亮：

| 语法 | 说明 | 支持情况 |
| --- | --- | --- |
| 表格 | GFM 表格 | ✅ |
| 任务列表 | `- [x]` | ✅ |
| 代码块 | 40+ 语言高亮 | ✅ |
| 数学公式 | LaTeX | ❌ 暂不支持 |

任务列表示例：

- [x] 搭好网站骨架
- [x] 写出第一篇笔记
- [ ] 部署到 GitHub Pages
- [ ] 积累 100 篇笔记

## 代码高亮

```python
from pathlib import Path

def scan_notes(folder: str = "notes"):
    """扫描所有 Markdown 笔记，返回文件名列表。"""
    return sorted(p.name for p in Path(folder).glob("*.md"))

if __name__ == "__main__":
    for name in scan_notes():
        print(f"发现笔记：{name}")
```

## 网站是怎么发现新笔记的？

部署时，GitHub Actions 会运行 `scripts/build_index.py` 扫描整个 `notes/` 目录，生成一份 `data/index.json` 清单，前端页面读取这份清单来渲染列表。所以——

> 推送到 GitHub 之后，新笔记会自动出现在列表页，无需任何手工登记。

架构的取舍细节，我在[《无构建步骤下的自动索引》](markdown-render-pipeline.md)里有更详细的记录。
