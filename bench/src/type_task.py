"""Click the Shutter task box, paste the task, and press Start. Coordinates are from a real window capture."""
import ctypes
import sys
import time
from ctypes import wintypes

user32 = ctypes.windll.user32
user32.SetProcessDPIAware()

CF_UNICODETEXT = 13
GMEM_MOVEABLE = 0x0002
kernel32 = ctypes.windll.kernel32
kernel32.GlobalAlloc.restype = ctypes.c_void_p
kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
kernel32.GlobalLock.restype = ctypes.c_void_p
kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]
user32.OpenClipboard.argtypes = [wintypes.HWND]
user32.SetClipboardData.argtypes = [wintypes.UINT, ctypes.c_void_p]

text = open(sys.argv[1], encoding="utf-8").read()
data = text.encode("utf-16-le") + b"\x00\x00"
if not user32.OpenClipboard(None):
    raise SystemExit("clipboard busy")
try:
    user32.EmptyClipboard()
    handle = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(data))
    locked = kernel32.GlobalLock(handle)
    ctypes.memmove(locked, data, len(data))
    kernel32.GlobalUnlock(handle)
    if not user32.SetClipboardData(CF_UNICODETEXT, handle):
        raise SystemExit("clipboard set failed")
finally:
    user32.CloseClipboard()

found: list[tuple[int, int, int, int]] = []


@ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
def enum(hwnd, _lparam):
    if not user32.IsWindowVisible(hwnd):
        return True
    length = user32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buf, length + 1)
    if "Scholarship" not in buf.value:
        return True
    rect = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    if rect.right - rect.left < 400:
        return True
    user32.ShowWindow(hwnd, 9)
    user32.SetForegroundWindow(hwnd)
    found.append((rect.left, rect.top, rect.right, rect.bottom))
    return True


user32.EnumWindows(enum, 0)
if not found:
    raise SystemExit("no window")
left, top, right, _ = found[-1]


def click(x: int, y: int) -> None:
    user32.SetCursorPos(x, y)
    time.sleep(0.08)
    user32.mouse_event(0x0002, 0, 0, 0, 0)
    user32.mouse_event(0x0004, 0, 0, 0, 0)


def key(vk: int, up: bool = False) -> None:
    user32.keybd_event(vk, 0, 0x0002 if up else 0, 0)


# Task field and Start, measured on the docked panel in a 1942px-wide window.
click(right - 292, top + 430)
time.sleep(0.25)
key(0x11)
key(0x41)
key(0x41, True)
key(0x11, True)
time.sleep(0.05)
key(0x11)
key(0x56)
key(0x56, True)
key(0x11, True)
time.sleep(0.3)
click(right - 402, top + 565)
print("typed and started")
