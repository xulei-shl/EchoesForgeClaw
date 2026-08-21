#!/usr/bin/env python3
"""
生成中国传统纹样高清卡片图的轻量缩略图（WebP 格式，宽 320px，单张约 20~40KB）。
用于在画板节点 3 列网格中毫秒级加载与流畅渲染。

使用方法:
  python generate_thumbnails.py
"""

import json
from pathlib import Path
from PIL import Image

BASE_DIR = Path(__file__).parent.resolve()
PATTERNS_DIR = BASE_DIR / "patterns"
DATA_FILE = BASE_DIR / "data" / "patterns.json"

THUMB_WIDTH = 320
QUALITY = 85


def generate_thumbnails():
    if not PATTERNS_DIR.exists():
        print(f"Directory not found: {PATTERNS_DIR}")
        return

    print("=== 开始生成中国传统纹样高清卡片缩略图 ===")
    
    # 查找所有 *_卡片图.png
    card_images = list(PATTERNS_DIR.glob("**/*_卡片图.png"))
    print(f"找到 {len(card_images)} 张卡片原图")

    processed = 0
    skipped = 0
    total_orig_bytes = 0
    total_thumb_bytes = 0

    for img_path in sorted(card_images):
        thumb_path = img_path.parent / f"{img_path.stem}_thumb.webp"
        orig_size = img_path.stat().st_size
        total_orig_bytes += orig_size

        if thumb_path.exists() and thumb_path.stat().st_mtime >= img_path.stat().st_mtime:
            skipped += 1
            total_thumb_bytes += thumb_path.stat().st_size
            continue

        try:
            with Image.open(img_path) as im:
                # 转换 RGB（处理 RGBA / Palette 兼容性）
                if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
                    alpha = im.convert("RGBA")
                    bg = Image.new("RGBA", alpha.size, (255, 255, 255, 255))
                    im = Image.alpha_composite(bg, alpha).convert("RGB")
                else:
                    im = im.convert("RGB")

                w, h = im.size
                new_w = THUMB_WIDTH
                new_h = int(h * (new_w / w))
                thumb_im = im.resize((new_w, new_h), Image.Resampling.LANCZOS)
                thumb_im.save(thumb_path, "WEBP", quality=QUALITY, method=6)

            thumb_size = thumb_path.stat().st_size
            total_thumb_bytes += thumb_size
            processed += 1
            print(f"  [√] {img_path.name} ({orig_size // 1024}KB) -> {thumb_path.name} ({thumb_size // 1024}KB)")
        except Exception as e:
            print(f"  [X] 处理失败 {img_path}: {e}")

    print("\n=== 处理完成 ===")
    print(f"新建/更新: {processed} 张, 跳过已存在: {skipped} 张")
    print(f"原图总大小: {total_orig_bytes / 1024 / 1024:.2f} MB")
    print(f"缩略图总大小: {total_thumb_bytes / 1024 / 1024:.2f} MB (体积压缩比: {(1 - total_thumb_bytes / max(1, total_orig_bytes)) * 100:.1f}%)")

    # 更新 data/patterns.json 补充 card_image_thumb 字段
    if DATA_FILE.exists():
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)

            for item in data:
                card_img = item.get("card_image", "")
                if card_img:
                    card_p = Path(card_img)
                    thumb_rel = card_p.parent / f"{card_p.stem}_thumb.webp"
                    item["card_image_thumb"] = str(thumb_rel).replace("\\", "/")

            with open(DATA_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

            print(f"[√] 成功更新 {DATA_FILE} 中的 card_image_thumb 字段")
        except Exception as e:
            print(f"[X] 更新 patterns.json 失败: {e}")


if __name__ == "__main__":
    generate_thumbnails()
