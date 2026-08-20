#!/usr/bin/env python3
"""邮票风格锯齿边处理:给图片加打孔锯齿边 + 白边 + 柔和投影。

默认输出真透明背景 PNG(锯齿孔洞和四周 alpha=0),可直接叠到任何背景上。

用法:
    python3 stamp_effect.py <输入图> <输出图.png> [bg]

    第三个参数省略     -> 透明背景(默认)
    第三个参数为 bg    -> 浅灰白背景(适合直接当成品图分享)

依赖: Pillow (pip install Pillow)
"""
import sys
from PIL import Image, ImageDraw, ImageFilter

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else "stamp.png"
opts = set(sys.argv[3:])
WITH_BG = "bg" in opts        # 浅灰白底成品图(默认透明)
WITH_MARGIN = "margin" in opts  # 加白边(默认无白边,内容顶到锯齿边)

img = Image.open(SRC).convert("RGBA")
W, H = img.size

# ---- 参数(可按需调整) ----
margin = 46 if WITH_MARGIN else 0  # 内容到邮票边的白边宽度(默认无白边)
hole_r = 14                 # 打孔半径
pitch = hole_r * 2 + 18     # 打孔间距
outer_pad = 90              # 邮票外留白(给投影空间)
bg_color = (245, 245, 247, 255)
shadow_alpha = 70           # 投影不透明度 0-255

sw, sh = W + margin * 2, H + margin * 2  # 邮票尺寸

# ---- 邮票形状:矩形减四边半圆孔 ----
mask = Image.new("L", (sw, sh), 255)
d = ImageDraw.Draw(mask)

def holes_horizontal(y):
    n = round((sw - pitch) / pitch)
    start = (sw - n * pitch) / 2 + pitch / 2
    for i in range(n + 1):
        cx = start + i * pitch - pitch / 2
        d.ellipse([cx - hole_r, y - hole_r, cx + hole_r, y + hole_r], fill=0)

def holes_vertical(x):
    n = round((sh - pitch) / pitch)
    start = (sh - n * pitch) / 2 + pitch / 2
    for i in range(n + 1):
        cy = start + i * pitch - pitch / 2
        d.ellipse([x - hole_r, cy - hole_r, x + hole_r, cy + hole_r], fill=0)

holes_horizontal(0)
holes_horizontal(sh)
holes_vertical(0)
holes_vertical(sw)

# ---- 邮票纸面(白色),贴上内容 ----
stamp = Image.new("RGBA", (sw, sh), (255, 255, 255, 255))
stamp.paste(img, (margin, margin))
stamp.putalpha(mask)

# ---- 画布 + 投影 ----
canvas = Image.new("RGBA", (sw + outer_pad * 2, sh + outer_pad * 2),
                   bg_color if WITH_BG else (0, 0, 0, 0))
shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
sh_mask = mask.filter(ImageFilter.GaussianBlur(12))
black = Image.new("RGBA", (sw, sh), (0, 0, 0, shadow_alpha))
shadow.paste(black, (outer_pad + 4, outer_pad + 10), sh_mask)
shadow = shadow.filter(ImageFilter.GaussianBlur(6))
canvas.alpha_composite(shadow)

# ---- 贴上邮票本体 ----
canvas.alpha_composite(stamp, (outer_pad, outer_pad))

if WITH_BG:
    canvas.convert("RGB").save(OUT, "PNG")
else:
    canvas.save(OUT, "PNG")  # 保留 alpha 通道,锯齿孔洞和四周均为真透明

print("saved:", OUT, canvas.size)
