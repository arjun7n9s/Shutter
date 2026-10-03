"""Real OS click on the Chrome extensions puzzle, then the first extension row."""
import ctypes
import time
from ctypes import wintypes

user32 = ctypes.windll.user32
user32.SetProcessDPIAware()

found: list[tuple[int, int, int, int]] = []


@ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
def enum(hwnd, _lparam):
    if not user32.IsWindowVisible(hwnd):
        return True
    length = user32.GetWindowTextLengthW(hwnd)
    if length == 0:
        return True
    buf = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buf, length + 1)
    if "Scholarship" not in buf.value:
        return True
    rect = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    w, h = rect.right - rect.left, rect.bottom - rect.top
    if w < 400 or h < 300:
        return True
    user32.ShowWindow(hwnd, 9)
    user32.SetForegroundWindow(hwnd)
    found.append((rect.left, rect.top, rect.right, rect.bottom))
    print(buf.value)
    return True


user32.EnumWindows(enum, 0)
if not found:
    raise SystemExit("no window")
left, top, right, bottom = found[-1]
# Measured on a 1942px-wide window: puzzle sits 218px in from the right, 78px down.
puzzle_x = right - 218
puzzle_y = top + 78


def click(x: int, y: int) -> None:
    user32.SetCursorPos(x, y)
    time.sleep(0.05)
    user32.mouse_event(0x0002, 0, 0, 0, 0)
    user32.mouse_event(0x0004, 0, 0, 0, 0)


click(puzzle_x, puzzle_y)
print(f"puzzle {puzzle_x},{puzzle_y}")
time.sleep(0.5)

from PIL import ImageGrab

img = ImageGrab.grab(bbox=(left, top, right, bottom))
px = img.load()
w, h = img.size
# Extensions menu: a dark card under the toolbar, not the full-width bar.
menu: list[tuple[int, int]] = []
for y in range(110, 420):
    run = 0
    run_x = 0
    for x in range(w - 620, w - 8):
        r, g, b = px[x, y]
        dark = 24 <= r <= 70 and 24 <= g <= 70 and 26 <= b <= 74
        if dark:
            if run == 0:
                run_x = x
            run += 1
        else:
            if 220 <= run <= 460:
                menu.append((run_x, y))
            run = 0
    if 220 <= run <= 460:
        menu.append((run_x, y))
img.save(r"C:\Users\arjun\Desktop\ISRO\docs\shots\menu-now.png")
if not menu:
    raise SystemExit("extensions menu did not open")
# The Shutter name, left of the pin, measured on this window.
click(right - 362, top + 270)
print("row", right - 362, top + 270)
