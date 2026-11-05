# -*- coding: utf-8 -*-
"""把解包出来的 Strawberry Perl 写入【用户】PATH（HKCU\\Environment），
   不改系统 PATH、不需要管理员；只加 perl\\bin，不加 c\\bin(避免 gcc 冲突)。"""
import ctypes
import winreg
from pathlib import Path

PERL_BIN = r"C:\tools\strawberry\Strawberry\perl\bin"

# 1. 确认目录真的存在
assert Path(PERL_BIN, "perl.exe").is_file(), f"找不到 {PERL_BIN}\\perl.exe"
print(f"perl.exe: {Path(PERL_BIN, 'perl.exe')}")

# 2. 读原值（DoNotExpand: QueryValueEx 返回未展开的原始串）
with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment", 0,
                    winreg.KEY_READ | winreg.KEY_WRITE) as k:
    try:
        cur, kind = winreg.QueryValueEx(k, "Path")
    except FileNotFoundError:
        cur, kind = "", winreg.REG_EXPAND_SZ

print(f"原 kind={'REG_EXPAND_SZ' if kind == winreg.REG_EXPAND_SZ else 'REG_SZ'}")
print(f"原 PATH 长度={len(cur)}")

parts = [p for p in cur.split(";") if p.strip()]
low = {p.rstrip("\\").lower() for p in parts}
if PERL_BIN.lower() in low:
    print("已存在，无需追加")
else:
    parts.append(PERL_BIN)
    new = ";".join(parts)
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment", 0,
                        winreg.KEY_READ | winreg.KEY_WRITE) as k:
        winreg.SetValueEx(k, "Path", 0, kind, new)
    print(f"已追加，新长度={len(new)}")

    # 3. 广播 WM_SETTINGCHANGE，让新进程立即感知
    HWND_BROADCAST, WM_SETTINGCHANGE, SMTO_ABORTIFHUNG = 0xFFFF, 0x001A, 0x0002
    res = ctypes.c_ulong()
    ctypes.windll.user32.SendMessageTimeoutW(
        HWND_BROADCAST, WM_SETTINGCHANGE, 0, "Environment",
        SMTO_ABORTIFHUNG, 5000, ctypes.byref(res))
    print("已广播 WM_SETTINGCHANGE")

# 4. 回读验证
with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
    val, _ = winreg.QueryValueEx(k, "Path")
print("\n--- 回读用户 PATH 末尾 ---")
for p in [x for x in val.split(";") if x.strip()][-4:]:
    print("  ", p)
