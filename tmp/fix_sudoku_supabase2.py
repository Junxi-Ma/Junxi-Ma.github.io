#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""数独第二轮修复：

1. Supabase 的 PostgrestBuilder 只有 then，没有 catch / finally
   （本地打包的 @supabase/supabase-js 2.117.2 实测：then=function, catch=undefined）。
   直接 .catch() 挂在查询链上会抛 TypeError：
   - clearSave() 抛错 → newGame 中断 → 点难度「出题失败」
   - clearSave() 抛错 → lose() 中断 → 三振时报错
   - offerResume「不下了」抛错 → 云端存档根本没删 → 刷新后又问一遍
2. 术语：数独说「做一局 / 玩一局」，不说「下一局」。
"""
import pathlib

JS = pathlib.Path(__file__).resolve().parent.parent / "public" / "tools" / "sudoku" / "app.js"
HTML = JS.parent / "index.html"

s = JS.read_text(encoding="utf-8")
done = []


def rep(old, new, expect=1, label=""):
    global s
    n = s.count(old)
    if n != expect:
        raise SystemExit(f"[FAIL] {label or old[:60]!r}: expect {expect}, got {n}")
    s = s.replace(old, new)
    done.append((label or old.strip().splitlines()[0][:50], n))


# ---------- A. clearSave：去掉 .catch()，只发请求不等结果 ----------
rep(
    """  function clearSave() {
    store.set(KEYS.save, null);
    if (cloudSb && cloudUser) {
      cloudSb.from('sudoku_saves').delete().eq('user_id', cloudUser.id).catch(() => {});
    }
  }""",
    """  function clearSave() {
    store.set(KEYS.save, null);
    if (cloudSb && cloudUser) {
      // PostgrestBuilder 只有 then，没有 catch：挂 .catch() 会抛 TypeError，
      // 而 clearSave() 在 newGame / checkWin / lose 里都是同步调用的，
      // 一抛就会把换难度、结算这些流程整个打断。
      try {
        cloudSb.from('sudoku_saves').delete().eq('user_id', cloudUser.id)
          .then(() => {}, () => {});
      } catch { /* 云端删不掉不影响本地已清 */ }
    }
  }""",
    1, "clearSave",
)

# ---------- B. 「不下了」：真的把云端那份删掉，删完再收工 ----------
rep(
    """      no.addEventListener('click', async () => {
        closeDialog();
        store.set(KEYS.save, null);
        if (cloud && cloudSb && cloudUser) {
          cloudSb.from('sudoku_saves').delete().eq('user_id', cloudUser.id).catch(() => {});
        }
      });""",
    """      no.addEventListener('click', async () => {
        store.set(KEYS.save, null);
        closeDialog();
        if (cloud && cloudSb && cloudUser) {
          // 等云端删完再算放下，否则立刻刷新会读到旧存档、又被问一遍
          try {
            await cloudSb.from('sudoku_saves').delete().eq('user_id', cloudUser.id);
          } catch (e) {
            console.warn('[数独] 云端存档删除失败：', e?.message || e);
          }
        }
      });""",
    1, "offerResume.no",
)

# ---------- C. 术语：不用「下」 ----------
rep("showDialog('发现没下完的一局'", "showDialog('有一局没做完'", 1, "title")
rep("      no.textContent = '不下了';", "      no.textContent = '不做了';", 1, "btn-no")
rep("      yes.textContent = '接着下';", "      yes.textContent = '接着做';", 1, "btn-yes")
rep("换设备登录同一账号即可接着下。", "换设备登录同一账号即可继续。", 2, "pause-note")
rep("登录后，暂停的进度会存到你的账号下，换设备也能接着下。",
    "登录后，暂停的进度会存到你的账号下，换设备也能继续。", 1, "login-tip")
rep("还没有收藏。下一局下完，在结算框里点「收藏这局」就会出现在这里。",
    "还没有收藏。做完一局后，在结算框里点「收藏这局」就会出现在这里。", 1, "fav-empty")
rep("问一句要不要接着下。", "问一句要不要接着做。", 1, "comment1")
rep("查到再问要不要接着下", "查到再问要不要接着做", 1, "comment2")

JS.write_text(s, encoding="utf-8")

# ---------- D. index.html 里的同类文案 ----------
h = HTML.read_text(encoding="utf-8")
h2 = h.replace("app.js?v=6", "app.js?v=7")
changed_html = h2 != h
if changed_html:
    HTML.write_text(h2, encoding="utf-8")

for name, n in done:
    print(f"  {n}x  {name}")
print("index.html:", "app.js?v=6 -> v7" if changed_html else "无改动")
print("剩余 .catch 直接挂查询链：",
      s.count(".eq('user_id', cloudUser.id).catch("))
print("行数：", len(s.splitlines()))
