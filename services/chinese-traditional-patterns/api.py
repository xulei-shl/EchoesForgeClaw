#!/usr/bin/env python3
"""
FastAPI service for Chinese Traditional Patterns (中国传统纹样检索服务).

Exposes:
- GET  /health
- GET  /categories
- POST /patterns/search
- GET  /patterns/{pattern_id}
- Static files under /static/*

Usage:
  uvicorn api:app --host 0.0.0.0 --port 8102
"""

import json
import logging
import random
from pathlib import Path
from typing import List, Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.resolve()
DATA_FILE = BASE_DIR / "data" / "patterns.json"

app = FastAPI(title="Chinese Traditional Patterns API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载静态文件目录，使得图片可以直接通过 /static/patterns/... 访问
app.mount("/static", StaticFiles(directory=str(BASE_DIR)), name="static")

# 内存缓存
_PATTERNS: List[dict] = []
_CATEGORIES: List[str] = []


def load_data():
    global _PATTERNS, _CATEGORIES
    if not DATA_FILE.exists():
        logger.error(f"Data file not found: {DATA_FILE}")
        _PATTERNS = []
        _CATEGORIES = []
        return

    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        patterns = []
        categories = []
        for item in data:
            # 补齐 static URL
            card_image = item.get("card_image", "")
            card_image_url = f"/static/{card_image.lstrip('/')}" if card_image else ""
            item_copy = dict(item)
            item_copy["card_image_url"] = card_image_url
            patterns.append(item_copy)

            cat = item.get("category")
            if cat and cat not in categories:
                categories.append(cat)

        _PATTERNS = patterns
        _CATEGORIES = categories
        logger.info(f"Loaded {len(_PATTERNS)} patterns, {len(_CATEGORIES)} categories from {DATA_FILE}")
    except Exception as e:
        logger.exception(f"Failed to load data: {e}")
        _PATTERNS = []
        _CATEGORIES = []


@app.on_event("startup")
def startup_event():
    load_data()


class SearchRequest(BaseModel):
    category: Optional[str] = Field(None, description="分类筛选（如：植物花卉纹、动物瑞兽纹等）")
    query: Optional[str] = Field(None, description="搜索关键词")
    page: int = Field(1, ge=1, description="页码，从1开始")
    per_page: int = Field(24, ge=1, le=100, description="每页条数")
    random: bool = Field(False, description="是否随机打乱返回")


@app.get("/health")
async def health():
    return {"status": "ok", "total_patterns": len(_PATTERNS)}


@app.get("/categories")
async def get_categories():
    if not _CATEGORIES:
        load_data()
    return {"categories": _CATEGORIES}


@app.post("/patterns/search")
async def search_patterns(req: SearchRequest):
    if not _PATTERNS:
        load_data()

    results = list(_PATTERNS)

    # 1. 分类筛选
    if req.category and req.category.strip() and req.category != "全部":
        target_cat = req.category.strip()
        results = [p for p in results if p.get("category") == target_cat]

    # 2. 关键词检索
    if req.query and req.query.strip():
        keywords = req.query.strip().lower().split()
        filtered = []
        for p in results:
            text_corpus = " ".join([
                p.get("id", ""),
                p.get("name_cn", ""),
                p.get("name_en", ""),
                p.get("category", ""),
                p.get("summary", ""),
                p.get("meaning", ""),
                " ".join(p.get("visual_keywords", [])),
                p.get("source_note", ""),
            ]).lower()

            if all(kw in text_corpus for kw in keywords):
                filtered.append(p)
        results = filtered
    elif req.random:
        # 无关键词且请求随机时打乱
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


@app.get("/patterns/{pattern_id}")
async def get_pattern_detail(pattern_id: str):
    if not _PATTERNS:
        load_data()

    target = next((p for p in _PATTERNS if p.get("id") == pattern_id), None)
    if not target:
        raise HTTPException(status_code=404, detail=f"Pattern with id {pattern_id} not found")

    detail_data = dict(target)

    # 读取详情 Markdown 内容
    detail_page_path = target.get("detail_page")
    if detail_page_path:
        full_md_path = BASE_DIR / detail_page_path.lstrip("/")
        if full_md_path.exists():
            try:
                detail_data["detail_markdown"] = full_md_path.read_text(encoding="utf-8")
            except Exception as e:
                logger.error(f"Failed to read markdown at {full_md_path}: {e}")
                detail_data["detail_markdown"] = ""
        else:
            detail_data["detail_markdown"] = ""
    else:
        detail_data["detail_markdown"] = ""

    return detail_data


if __name__ == "__main__":
    uvicorn.run("api:app", host="0.0.0.0", port=8102, reload=False)
