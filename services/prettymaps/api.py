#!/usr/bin/env python3
"""
FastAPI wrapper for prettymaps.

Exposes POST /generate endpoint that accepts JSON parameters,
calls prettymaps.plot(), and returns the generated PNG as bytes.

Usage:
  uvicorn api:app --host 0.0.0.0 --port 8101
"""

import io
import os
import sys
import logging
from pathlib import Path
from typing import Optional

import matplotlib
matplotlib.use('Agg')

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).parent))
import prettymaps

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="Prettymaps API", version="1.0.0")


class GenerateRequest(BaseModel):
    lat: float = Field(..., description="Latitude")
    lon: float = Field(..., description="Longitude")
    query: str = Field("", description="Original query text (fallback if lat/lon not used)")
    radius: float = Field(0.75, description="Radius in km")
    circle: bool = Field(False, description="Circular boundary")
    preset: str = Field("default", description="Preset name")
    figsize_width: float = Field(8.27, description="Figure width in inches")
    figsize_height: float = Field(8.27, description="Figure height in inches")


@app.get("/presets")
async def list_presets():
    presets_df = prettymaps.presets()
    presets_list = []
    for _, row in presets_df.iterrows():
        presets_list.append({
            "name": row["preset"],
            "params": row["params"],
        })
    return {"presets": presets_list}


@app.get("/presets/simple")
async def list_presets_simple():
    presets_df = prettymaps.presets()
    names = sorted(presets_df["preset"].tolist())
    return {"presets": names}


@app.post("/generate")
async def generate_map(req: GenerateRequest):
    available = prettymaps.presets()["preset"].tolist()
    if req.preset not in available:
        raise HTTPException(
            status_code=400,
            detail=f"Preset '{req.preset}' not found. Available: {', '.join(available)}",
        )

    query = (req.lat, req.lon)
    radius_m = req.radius * 1000

    figsize = (req.figsize_width, req.figsize_height)

    logger.info("Generating map: query=%s, radius=%.2fkm, circle=%s, preset=%s, figsize=%s",
                query, req.radius, req.circle, req.preset, figsize)

    try:
        from matplotlib import pyplot as plt

        fig, ax = plt.subplots(figsize=figsize, dpi=150)

        prettymaps.plot(
            query,
            radius=radius_m,
            circle=req.circle,
            preset=req.preset,
            show=False,
            ax=ax,
            fig=fig,
        )

        buf = io.BytesIO()
        plt.savefig(buf, format="png", bbox_inches="tight", dpi=150)
        buf.seek(0)
        plt.close(fig)

        image_bytes = buf.getvalue()
        if not image_bytes:
            raise HTTPException(status_code=500, detail="Generated image is empty")

        return Response(
            content=image_bytes,
            media_type="image/png",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Map generation failed")
        raise HTTPException(status_code=500, detail=f"Map generation failed: {str(e)}")


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    port = int(os.environ.get("PRETTYMAPS_PORT", "8101"))
    uvicorn.run(app, host="0.0.0.0", port=port)