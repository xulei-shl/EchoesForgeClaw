#!/usr/bin/env python3
"""
FastAPI service for Chinese Traditional Colors (中国传统配色与调色板生成服务).

Exposes:
- GET  /health
- GET  /categories
- POST /colors/search
- GET  /colors/{color_id}
- POST /colors/palette/generate
- GET  /colors/scenes/presets
- Static files under /static/*

Usage:
  uvicorn api:app --host 0.0.0.0 --port 8103
"""

import csv
import json
import logging
import random
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.resolve()
HARMONY_CSV = BASE_DIR / "docs" / "chinese-color-harmony.csv"
USE_CASES_CSV = BASE_DIR / "docs" / "chinese-color-harmony-use-cases.csv"
IMAGES_DIR = BASE_DIR / "images"
THUMBNAILS_DIR = BASE_DIR / "thumbnails"

app = FastAPI(title="Chinese Traditional Colors API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载静态文件目录，使得图片可以直接通过 /static/colors/images/... 和 /static/colors/thumbnails/... 访问
app.mount("/static/colors", StaticFiles(directory=str(BASE_DIR)), name="static_colors")
app.mount("/static", StaticFiles(directory=str(BASE_DIR)), name="static")

# 内存缓存
_COLORS: List[Dict[str, Any]] = []
_COLOR_BY_ID: Dict[str, Dict[str, Any]] = {}
_CATEGORIES: List[str] = []
_TEMPERATURES: List[str] = ["暖", "冷", "中性"]



def _hex_to_rgb(hex_str: str) -> Dict[str, int]:
    clean = hex_str.lstrip("#")
    if len(clean) == 3:
        clean = "".join(c * 2 for c in clean)
    if len(clean) != 6:
        return {"r": 0, "g": 0, "b": 0}
    try:
        r = int(clean[0:2], 16)
        g = int(clean[2:4], 16)
        b = int(clean[4:6], 16)
        return {"r": r, "g": g, "b": b}
    except Exception:
        return {"r": 0, "g": 0, "b": 0}


def _parse_relation_colors(raw_str: str) -> List[Dict[str, str]]:
    """解析如 '053-蚌肉白 #F9F1DB | 098-粉白 #FBF2E3' 为结构化列表"""
    if not raw_str or not raw_str.strip():
        return []
    items = []
    for part in raw_str.split("|"):
        part = part.strip()
        if not part:
            continue
        # 格式可能为 '053-蚌肉白 #F9F1DB' 或 '053 蚌肉白 #F9F1DB'
        match = re.match(r"^(\d{1,3})[-_ ]?([^\s#]+)\s+(#[0-9a-fA-F]{3,6})", part)
        if match:
            items.append({
                "id": match.group(1).zfill(3),
                "name": match.group(2).strip(),
                "hex": match.group(3).upper(),
            })
        else:
            # 简单降级
            tokens = part.split()
            c_hex = next((t for t in tokens if t.startswith("#")), "")
            items.append({
                "id": tokens[0] if tokens else "",
                "name": part,
                "hex": c_hex.upper(),
            })
    return items


def _calibrate_category(name: str, hex_val: str, h: int, s: int, l: int, raw_cat: str) -> str:
    if s < 12 or l >= 92 or l <= 12:
        if "黄" in name and s >= 10:
            pass
        else:
            return "中性色"
    if name.endswith(("绿", "碧", "翠")) or "绿" in name:
        return "绿色系"
    if name.endswith(("黄", "金")) or ("黄" in name and not any(k in name for k in ["绿", "青", "蓝"])):
        return "黄色系"
    if name.endswith(("红", "朱", "赤", "茜", "绯", "丹", "绛", "殷", "胭", "彤")):
        return "红色系"
    if name.endswith(("橙", "橘", "赭", "褐", "驼", "栗", "咖")):
        return "橙色系"
    if name.endswith(("蓝", "靛", "绀")):
        return "蓝色系"
    if name.endswith(("紫", "黛", "青莲")):
        return "紫色系"
    if name.endswith(("青", "苍", "葱", "湖")):
        return "青色系"
    if name.endswith(("白", "灰", "黑", "玄", "墨", "炭", "银")):
        return "中性色"
    if h >= 345 or h < 20:
        return "红色系"
    elif 20 <= h < 45:
        return "橙色系"
    elif 45 <= h < 65:
        return "黄色系"
    elif 65 <= h < 155:
        return "绿色系"
    elif 155 <= h < 195:
        return "青色系"
    elif 195 <= h < 255:
        return "蓝色系"
    elif 255 <= h < 345:
        return "紫色系"
    return raw_cat or "中性色"


def _calibrate_temperature(name: str, hex_val: str, h: int, s: int, l: int, hue_cat: str, raw_temp: str) -> str:
    if (
        hue_cat == "中性色"
        or name.endswith(("白", "灰", "黑", "银", "玄", "墨", "炭", "素"))
        or (s < 14 and not any(k in name for k in ["黄", "红", "绿"]))
    ):
        return "中性"
    if hue_cat in ["黄色系", "橙色系"]:
        return "暖"
    if hue_cat == "红色系":
        if 310 <= h <= 340 and any(k in name for k in ["紫", "藕"]):
            return "冷"
        return "暖"
    if hue_cat in ["蓝色系", "青色系", "紫色系"]:
        return "冷"
    if hue_cat == "绿色系":
        if 60 <= h <= 85 and (any(k in name for k in ["嫩", "黄", "芽"]) or raw_temp == "暖"):
            return "暖"
        return "冷"
    return raw_temp or "中性"


def load_data():
    global _COLORS, _COLOR_BY_ID, _CATEGORIES
    if not HARMONY_CSV.exists():
        logger.error(f"Harmony CSV not found at: {HARMONY_CSV}")
        return

    # 加载主调色与搭配 CSV
    colors: List[Dict[str, Any]] = []
    color_map: Dict[str, Dict[str, Any]] = {}
    categories_set = set()

    try:
        with open(HARMONY_CSV, "r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                raw_id = str(row.get("编号", "")).strip()
                if not raw_id:
                    continue
                cid = raw_id.zfill(3)
                name = row.get("色名", "").strip()
                hex_val = row.get("HEX", "").strip().upper()
                h = int(row.get("H", 0) or 0)
                s = int(row.get("S", 0) or 0)
                l = int(row.get("L", 0) or 0)
                raw_hue_cat = row.get("色相分类", "").strip()
                hue_cat = _calibrate_category(name, hex_val, h, s, l, raw_hue_cat)
                raw_temp = row.get("冷暖属性", "").strip()
                temp = _calibrate_temperature(name, hex_val, h, s, l, hue_cat, raw_temp)

                if hue_cat:
                    categories_set.add(hue_cat)

                # 图片 URL 映射
                image_rel = f"images/{cid}-{name}.png"
                thumb_rel = f"thumbnails/color-card-{cid}.jpg"

                full_img_url = f"/static/colors/{image_rel}" if (IMAGES_DIR / f"{cid}-{name}.png").exists() else ""
                thumb_url = f"/static/colors/{thumb_rel}" if (THUMBNAILS_DIR / f"color-card-{cid}.jpg").exists() else full_img_url

                rgb = _hex_to_rgb(hex_val)

                item = {
                    "id": cid,
                    "name": name,
                    "hex": hex_val,
                    "h": h,
                    "s": s,
                    "l": l,
                    "hsl": {"h": h, "s": s, "l": l},
                    "rgb": rgb,
                    "hue_category": hue_cat,
                    "temperature": temp,
                    "full_image_url": full_img_url,
                    "thumb_url": thumb_url,
                    "preview_url": full_img_url,
                    # 搭配关系
                    "harmonies": {
                        "same": _parse_relation_colors(row.get("同类色", "")),
                        "analogous": _parse_relation_colors(row.get("邻近色", "")),
                        "complementary": _parse_relation_colors(row.get("互补色", "")),
                        "split_complementary": _parse_relation_colors(row.get("分裂互补", "")),
                        "triadic": _parse_relation_colors(row.get("三角色", "")),
                        "tetradic": _parse_relation_colors(row.get("四角色", "")),
                        "temperature_contrast": _parse_relation_colors(row.get("冷暖对照", "")),
                        "lighter": _parse_relation_colors(row.get("明色搭配", "")),
                        "darker": _parse_relation_colors(row.get("暗色搭配", "")),
                        "gray_tone": _parse_relation_colors(row.get("灰调搭配", "")),
                        "neutral": _parse_relation_colors(row.get("中性色搭配", "")),
                        "primary": row.get("主色", "").strip(),
                        "secondary": _parse_relation_colors(row.get("辅色", "")),
                        "accent": _parse_relation_colors(row.get("点缀色", "")),
                        "curated_plan": row.get("主辅点缀方案", "").strip(),
                        "algorithm_note": row.get("算法说明", "").strip(),
                    },
                }

                colors.append(item)
                color_map[cid] = item

        _COLORS = colors
        _COLOR_BY_ID = color_map
        _CATEGORIES = sorted(list(categories_set))
        logger.info(f"Loaded {len(_COLORS)} traditional colors, {len(_CATEGORIES)} categories from {HARMONY_CSV}")
    except Exception as e:
        logger.exception(f"Failed to load harmony CSV: {e}")


@app.on_event("startup")
def startup_event():
    load_data()


# 模块初始化时载入数据
load_data()


# ---------------- 5 色调色板生成算法 ----------------

def _get_candidate_ids(anchor_item: Dict[str, Any], method: str) -> List[str]:
    """根据配色方法从搭配关系中提取候选色 ID 并动态洗牌抽样"""
    harmonies = anchor_item.get("harmonies") or {}
    def _shuffled_ids(key: str) -> List[str]:
        items = [c["id"] for c in (harmonies.get(key) or []) if isinstance(c, dict) and "id" in c]
        shuffled = list(items)
        random.shuffle(shuffled)
        return shuffled

    same_ids = _shuffled_ids("same")
    analogous_ids = _shuffled_ids("analogous")
    comp_ids = _shuffled_ids("complementary")
    split_ids = _shuffled_ids("split_complementary")
    triadic_ids = _shuffled_ids("triadic")
    tetradic_ids = _shuffled_ids("tetradic")
    temp_ids = _shuffled_ids("temperature_contrast")
    lighter_ids = _shuffled_ids("lighter")
    darker_ids = _shuffled_ids("darker")
    gray_ids = _shuffled_ids("gray_tone")
    neutral_ids = _shuffled_ids("neutral")
    accent_ids = _shuffled_ids("accent")

    if method == "analogous":
        # 近似：同类 + 邻近 + 明色 + 暗色
        res = same_ids + analogous_ids + lighter_ids + darker_ids
    elif method == "complementary":
        # 对比：互补 + 分裂互补 + 中性
        res = comp_ids + split_ids + neutral_ids
    elif method == "triadic":
        # 三分：三角 + 四角 + 点缀
        res = triadic_ids + tetradic_ids + accent_ids
    elif method == "neutral":
        # 中性：中性 + 灰调 + 同类
        res = neutral_ids + gray_ids + same_ids
    else:
        # auto 自动模式：综合平衡搭配（主辅点缀 + 邻近 + 冷暖对照 + 明暗）
        res = []
        if same_ids:
            res.append(same_ids[0])
        if analogous_ids:
            res.append(analogous_ids[0])
        if neutral_ids:
            res.append(neutral_ids[0])
        if accent_ids:
            res.append(accent_ids[0])
        if temp_ids:
            res.append(temp_ids[0])
        if darker_ids:
            res.append(darker_ids[0])
        if not res:
            res = same_ids + analogous_ids + comp_ids + accent_ids

    random.shuffle(res)
    return res


def build_5_palette(
    anchor_id: str,
    method: str = "auto",
    previous_palette: Optional[List[Dict[str, Any]]] = None,
    locked_state: Optional[List[bool]] = None,
) -> List[Dict[str, Any]]:
    """生成 5 色调色板，支持锁定状态保留"""
    if not _COLORS:
        load_data()

    anchor = _COLOR_BY_ID.get(anchor_id)
    if not anchor:
        anchor = random.choice(_COLORS) if _COLORS else {}

    if not anchor:
        return []

    palette_size = 5
    if not locked_state or len(locked_state) != palette_size:
        locked_state = [False] * palette_size

    # 已锁定的 ID 集合
    locked_ids = set()
    if previous_palette:
        for idx, is_locked in enumerate(locked_state):
            if is_locked and idx < len(previous_palette) and previous_palette[idx]:
                locked_ids.add(previous_palette[idx].get("id"))

    candidates = _get_candidate_ids(anchor, method)
    candidates = [cid for cid in candidates if cid in _COLOR_BY_ID]

    # 洗牌所有颜色作为兜底池
    all_shuffled_ids = [c["id"] for c in _COLORS]
    random.shuffle(all_shuffled_ids)

    # 组装不重复候选序列
    seen = set()
    sequence = []
    for cid in [anchor["id"]] + candidates + all_shuffled_ids:
        if cid not in seen and cid not in locked_ids and cid in _COLOR_BY_ID:
            seen.add(cid)
            sequence.append(cid)

    cursor = 0
    result_palette = []
    for idx in range(palette_size):
        if locked_state[idx] and previous_palette and idx < len(previous_palette) and previous_palette[idx]:
            result_palette.append(previous_palette[idx])
        else:
            cid = sequence[cursor] if cursor < len(sequence) else random.choice(_COLORS)["id"]
            cursor += 1
            result_palette.append(_COLOR_BY_ID.get(cid, anchor))

    return result_palette


# ---------------- API 请求与响应模型 ----------------

class ColorSearchRequest(BaseModel):
    category: Optional[str] = Field(None, description="色相分类筛选（黄色系、红色系、青色系等）")
    temperature: Optional[str] = Field(None, description="冷暖属性筛选（暖/冷/中性）")
    query: Optional[str] = Field(None, description="搜索关键词（色名、编号、HEX、寓意）")
    page: int = Field(1, ge=1, description="页码，从1开始")
    per_page: int = Field(24, ge=1, le=100, description="每页条数")
    random: bool = Field(False, description="是否随机打乱返回")


class PaletteGenerateRequest(BaseModel):
    anchor_id: Optional[str] = Field(None, description="基准色编号（如 001）")
    method: str = Field("auto", description="配色算法：auto / analogous / complementary / triadic / neutral")
    locked: Optional[List[bool]] = Field(None, description="5 个色块的锁定状态列表 [bool, bool, bool, bool, bool]")
    previous_palette: Optional[List[Dict[str, Any]]] = Field(None, description="上一轮的调色板列表")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "total_colors": len(_COLORS),
        "total_categories": len(_CATEGORIES),
    }


@app.get("/categories")
async def get_categories():
    if not _CATEGORIES:
        load_data()
    return {
        "categories": _CATEGORIES,
        "temperatures": _TEMPERATURES,
    }


@app.post("/colors/search")
async def search_colors(req: ColorSearchRequest):
    if not _COLORS:
        load_data()

    results = list(_COLORS)

    # 1. 色系分类筛选
    if req.category and req.category.strip() and req.category != "全部":
        target_cat = req.category.strip()
        results = [c for c in results if c.get("hue_category") == target_cat]

    # 2. 冷暖属性筛选
    if req.temperature and req.temperature.strip() and req.temperature != "全部":
        target_temp = req.temperature.strip()
        results = [c for c in results if c.get("temperature") == target_temp]

    # 3. 关键词检索
    if req.query and req.query.strip():
        raw_query = req.query.strip().lower()
        keywords = raw_query.split()
        filtered = []
        for c in results:
            name = (c.get("name") or "").lower()
            cid = (c.get("id") or "").lower()
            hex_val = (c.get("hex") or "").lower()
            hue = (c.get("hue_category") or "").lower()
            temp = (c.get("temperature") or "").lower()

            if all(
                kw in name or kw in cid or kw in hex_val or kw in hue or kw in temp
                for kw in keywords
            ):
                filtered.append(c)

        # 智能排序：色名完全匹配 > 色名开头匹配 > 色名包含 > 色系匹配
        def _score(c: Dict[str, Any]) -> int:
            c_name = (c.get("name") or "").lower()
            if c_name == raw_query:
                return 4
            if c_name.startswith(raw_query):
                return 3
            if raw_query in c_name:
                return 2
            return 1

        filtered.sort(key=_score, reverse=True)
        results = filtered
    elif req.random:
        results = list(results)
        random.shuffle(results)

    total = len(results)
    start = (req.page - 1) * req.per_page
    end = start + req.per_page
    paged_items = results[start:end]

    return {
        "items": paged_items,
        "total": total,
        "page": req.page,
        "per_page": req.per_page,
    }


@app.get("/colors/{color_id}")
async def get_color_detail(color_id: str):
    if not _COLORS:
        load_data()

    cid = color_id.strip().zfill(3)
    target = _COLOR_BY_ID.get(cid) or _COLOR_BY_ID.get(color_id.strip())
    if not target:
        raise HTTPException(status_code=404, detail=f"Color with id {color_id} not found")

    return target


@app.post("/colors/palette/generate")
async def generate_palette(req: PaletteGenerateRequest):
    if not _COLORS:
        load_data()

    anchor_id = req.anchor_id
    if not anchor_id or anchor_id not in _COLOR_BY_ID:
        if req.previous_palette and len(req.previous_palette) > 0 and req.previous_palette[0].get("id"):
            anchor_id = req.previous_palette[0]["id"]
        else:
            anchor_id = random.choice(_COLORS)["id"] if _COLORS else "001"

    palette = build_5_palette(
        anchor_id=anchor_id,
        method=req.method,
        previous_palette=req.previous_palette,
        locked_state=req.locked,
    )

    return {
        "anchor_id": anchor_id,
        "method": req.method,
        "palette": palette,
    }


if __name__ == "__main__":
    uvicorn.run("api:app", host="0.0.0.0", port=8103, reload=False)
