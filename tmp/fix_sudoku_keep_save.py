#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""数独：切难度不再丢暂停存档。

规则改成：暂停过的那局留在存档里，切难度只是开新局；
只有这一局真正分出结果（完成 / 三振）时才清掉属于它的存档。

为此给每局一个 sid，存档带上它：
- clearSave() 先认 sid，不是本局的不动
- 云端那份同理，只有本局暂停上传过才删
- 上传时剔除 sid（数据库没这一列）
"""
import pathlib

P = pathlib.Path(__file__).resolve().parent.parent / "public" / "tools" / "sudoku" / "app.js"
s = P.read_text(encoding="utf-8")
done = []


def rep(old, new, expect=1, label=""):
    global s
    n = s.count(old)
    if n != expect:
        raise SystemExit(f"[FAIL] {label or old[:60]!r}: expect {expect}, got {n}")
    s = s.replace(old, new)
    done.append((label or old.strip().splitlines()[0][:48], n))


# A. 每局一个 id
rep(
    "  let paused = false;\n",
    """  let paused = false;

  /* 每一局一个 sid：存档带上它，才能分清「这份存档是不是当前这局的」。
     切难度时旧局要留住，不能因为开了新局就把别人的存档清掉。 */
  const newSid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  let sid = newSid();     // 当前这一局
  let savedSid = null;    // 暂停时写进存档的那一局
""",
    1, "sid-decl",
)

# B. 存档带 sid
rep(
    """    return {
      difficulty: diffKey,""",
    """    return {
      sid,
      difficulty: diffKey,""",
    1, "makeSave.sid",
)

# C. 上传时剔除 sid（数据库没有这一列）
rep(
    """      const { error } = await cloudSb.from('sudoku_saves').upsert({
        user_id: cloudUser.id,
        ...makeSave(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });""",
    """      const sv = makeSave();
      delete sv.sid;   // 表里没这一列，带上会被 PostgREST 拒绝
      const { error } = await cloudSb.from('sudoku_saves').upsert({
        user_id: cloudUser.id,
        ...sv,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });""",
    1, "pushSave.strip",
)

# D. 恢复存档：认下它的 sid，并就地规范化本地那份
rep(
    """    store.set(KEYS.diff, diffKey);
    if (pauseEl) pauseEl.hidden = true;
    fitSudoku();
  }""",
    """    store.set(KEYS.diff, diffKey);
    if (pauseEl) pauseEl.hidden = true;
    sid = sv.sid || newSid();
    savedSid = sid;                    // 恢复的就是本局的存档，做完时能清掉
    store.set(KEYS.save, makeSave());  // 云端那份没 sid，就地补上
    fitSudoku();
  }""",
    1, "applySave.sid",
)

# E. 开新局不再清存档
rep(
    """    paused = false;
    if (pauseEl) pauseEl.hidden = true;
    // 开新局就把上一局的暂停存档作废；启动时的第一局除外，那时还要拿它来问要不要续
    if (!opts.keepSave) clearSave();""",
    """    paused = false;
    if (pauseEl) pauseEl.hidden = true;
    // 切难度不再丢暂停存档：暂停过的那局留在那儿，下次打开还能接着做。
    // 只有这一局真正分出结果（完成 / 三振）时才清掉属于它的存档。
    sid = newSid();
    savedSid = null;""",
    1, "newGame.keep",
)

# F. clearSave 先认 sid
rep(
    """  /* 这局已经分出结果（完成或三振），暂停存档作废 */
  function clearSave() {
    store.set(KEYS.save, null);
    if (cloudSb && cloudUser) {""",
    """  /* 这一局分出结果（完成或三振）时，把它的暂停存档作废。
     存档可能属于别的局（切难度后旧局留着），所以先认 sid，不是本局的不动。 */
  function clearSave() {
    const cur = store.get(KEYS.save, null);
    if (!cur || !cur.sid || cur.sid === sid) store.set(KEYS.save, null);
    if (cloudSb && cloudUser && savedSid && savedSid === sid) {""",
    1, "clearSave.sid",
)

# G. 暂停时记下这份存档属于哪局
rep(
    """    store.set(KEYS.save, makeSave());
    if (pauseNoteEl) pauseNoteEl.textContent = '计时已停，进度已存在这台设备。';""",
    """    store.set(KEYS.save, makeSave());
    savedSid = sid;
    if (pauseNoteEl) pauseNoteEl.textContent = '计时已停，进度已存在这台设备。';""",
    1, "pauseGame.savedSid",
)

P.write_text(s, encoding="utf-8")
for name, n in done:
    print(f"  {n}x  {name}")
print("行数：", len(s.splitlines()))
