#!/usr/bin/env python3
"""把多张邮票 PNG 拼成一张合集图(sheet):等宽列瀑布流排版,
每张邮票撑满列宽、无 letterbox 留白,列高自动贪心均衡。

用法:
  python3 stamp_sheet.py <输出.png> <图1.png> <图2.png> ...            # 默认 4 列深色背景
  python3 stamp_sheet.py <输出.png> --cols 3 --bg "#f5f2ea" -- <图...> # 自定义列数/底色
"""
import argparse
import os

from PIL import Image

MARGIN = 60   # 画布外边距
GUT = 36      # 邮票间距


def parse_color(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("output")
    ap.add_argument("images", nargs="+")
    ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--bg", default="#0e0e0e", help="背景色,如 #0e0e0e 或 #f5f2ea")
    ap.add_argument("--colw", type=int, default=780, help="列宽(px)")
    args = ap.parse_args()

    imgs = []
    for p in args.images:
        im = Image.open(p).convert("RGBA")
        nh = int(args.colw * im.height / im.width)
        imgs.append(im.resize((args.colw, nh), Image.LANCZOS))

    # 贪心均衡:高的优先,放进当前最矮的列
    columns = [[] for _ in range(args.cols)]
    col_h = [0] * args.cols
    for im in sorted(imgs, key=lambda i: -i.height):
        c = col_h.index(min(col_h))
        columns[c].append(im)
        col_h[c] += im.height + GUT

    w = MARGIN * 2 + args.cols * args.colw + (args.cols - 1) * GUT
    h = max(col_h) - GUT + MARGIN * 2
    sheet = Image.new("RGB", (w, h), parse_color(args.bg))

    for c, col in enumerate(columns):
        x = MARGIN + c * (args.colw + GUT)
        y = MARGIN
        for im in col:
            sheet.paste(im, (x, y), im)
            y += im.height + GUT

    sheet.save(args.output)
    print("saved:", os.path.abspath(args.output), sheet.size)


if __name__ == "__main__":
    main()
