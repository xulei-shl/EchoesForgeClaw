#!/usr/bin/env python3
"""
FastAPI wrapper for City Map Poster Generator.

Exposes a single POST /generate endpoint that accepts JSON parameters,
runs create_poster(), and returns the generated PNG as bytes.

Usage:
  uvicorn api:app --host 0.0.0.0 --port 8100
"""

import base64
import io
import json
import os
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

# Ensure the maptoposter module is importable
sys.path.insert(0, str(Path(__file__).parent))

from create_map_poster import (
    load_theme,
    get_available_themes,
    get_coordinates,
    create_poster,
    THEME,
)
from font_management import load_fonts

app = FastAPI(title="City Map Poster API", version="1.0.0")

# Cache fonts at startup for performance
_cached_fonts = None


def get_fonts():
    global _cached_fonts
    if _cached_fonts is None:
        _cached_fonts = load_fonts()
    return _cached_fonts


class GenerateRequest(BaseModel):
    city: str = Field(..., description="City name for geocoding")
    country: str = Field(..., description="Country name for geocoding")
    theme: str = Field("terracotta", description="Theme name from themes/ directory")
    latitude: Optional[float] = Field(None, description="Override latitude center point")
    longitude: Optional[float] = Field(None, description="Override longitude center point")
    distance: int = Field(18000, description="Map radius in meters")
    width: float = Field(12.0, description="Image width in inches (max 20)")
    height: float = Field(16.0, description="Image height in inches (max 20)")
    display_city: Optional[str] = Field(None, description="Custom display city name (i18n)")
    display_country: Optional[str] = Field(None, description="Custom display country name (i18n)")
    country_label: Optional[str] = Field(None, description="Override country text on poster")
    font_family: Optional[str] = Field(None, description="Google Fonts family name")
    output_format: str = Field("png", description="Output format: png, svg, pdf")


@app.get("/themes")
async def list_themes():
    """List available themes."""
    available = get_available_themes()
    themes_info = []
    for name in available:
        theme_path = os.path.join("themes", f"{name}.json")
        try:
            with open(theme_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                themes_info.append({
                    "name": name,
                    "display_name": data.get("name", name),
                    "description": data.get("description", ""),
                })
        except (OSError, json.JSONDecodeError):
            themes_info.append({"name": name, "display_name": name, "description": ""})
    return {"themes": themes_info}


@app.post("/generate")
async def generate_poster(req: GenerateRequest):
    """
    Generate a map poster and return the image bytes directly.

    The response is the raw image file (PNG/SVG/PDF) with appropriate Content-Type.
    """
    available = get_available_themes()
    if req.theme not in available:
        raise HTTPException(
            status_code=400,
            detail=f"Theme '{req.theme}' not found. Available: {', '.join(available)}",
        )

    # Clamp dimensions
    width = min(req.width, 20.0)
    height = min(req.height, 20.0)

    # Resolve coordinates
    if req.latitude is not None and req.longitude is not None:
        coords = (req.latitude, req.longitude)
    else:
        try:
            coords = get_coordinates(req.city, req.country)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    # Load theme into global (create_poster reads THEME global)
    import create_map_poster
    create_map_poster.THEME = load_theme(req.theme)

    # Load custom fonts if specified
    custom_fonts = None
    if req.font_family:
        custom_fonts = load_fonts(req.font_family)

    # Generate to a temp file, read bytes, clean up
    suffix = f".{req.output_format.lower()}"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp_path = tmp.name

    try:
        create_poster(
            city=req.city,
            country=req.country,
            point=coords,
            dist=req.distance,
            output_file=tmp_path,
            output_format=req.output_format,
            width=width,
            height=height,
            country_label=req.country_label,
            display_city=req.display_city,
            display_country=req.display_country,
            fonts=custom_fonts,
        )

        # Read the generated file
        image_bytes = Path(tmp_path).read_bytes()

        # Determine content type
        content_type_map = {
            "png": "image/png",
            "svg": "image/svg+xml",
            "pdf": "application/pdf",
        }
        content_type = content_type_map.get(req.output_format.lower(), "image/png")

        return Response(
            content=image_bytes,
            media_type=content_type,
            headers={
                "Content-Disposition": f'attachment; filename="map-poster-{uuid.uuid4().hex[:8]}{suffix}"',
            },
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Poster generation failed: {str(e)}")
    finally:
        # Clean up temp file
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8100)
