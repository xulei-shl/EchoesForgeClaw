import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_admin_user
from app.models.user import User
from app.models.prompt_metadata import PromptMetadata
from app.services.bifrost_service import (
    BifrostError,
    PREVIEW_DIR,
    PREVIEW_MAX_BYTES,
    PREVIEW_PREFIX,
    bifrost_error_to_http,
    detect_image_ext,
    get_prompt,
    get_prompt_raw,
    list_folders,
    list_prompts,
    list_prompts_raw,
    sanitize_prompt_id,
)

router = APIRouter(prefix="/admin/bifrost", tags=["admin-bifrost"])


@router.get("/folders")
async def list_bifrost_folders(
    all: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Bifrost 文件夹列表（提示词按文件夹筛选用）。

    all=true 时返回全部文件夹（不过滤白名单），供管理页配置白名单多选用。
    """
    try:
        folders = await list_folders(db, include_all=all)
    except BifrostError as exc:
        raise bifrost_error_to_http(exc)
    return {"folders": folders}


@router.get("/prompts")
async def list_bifrost_prompts(
    folder_id: Optional[str] = None,
    q: str = "",
    raw: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Bifrost 提示词列表（可选 folder_id / 关键词 q 过滤），合并本地预览图。

    raw=true 时直接透传 Bifrost 原始响应（调试用，排查正文提取问题）。
    """
    try:
        if raw:
            return await list_prompts_raw(db, folder_id=folder_id or None)
        prompts = await list_prompts(db, folder_id=folder_id or None, q=q)
    except BifrostError as exc:
        raise bifrost_error_to_http(exc)
    return {"prompts": prompts}


@router.get("/prompts/{prompt_id}")
async def get_bifrost_prompt(
    prompt_id: str,
    raw: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Bifrost 提示词详情（含提取的正文文本与本地预览图）。

    raw=true 时直接透传 Bifrost 原始响应（调试用，排查正文提取问题）。
    """
    try:
        if raw:
            return await get_prompt_raw(db, prompt_id)
        return await get_prompt(db, prompt_id)
    except BifrostError as exc:
        raise bifrost_error_to_http(exc)


@router.post("/prompts/{prompt_id}/preview")
async def upload_bifrost_preview(
    prompt_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """上传 / 更换提示词预览图（本地存储，覆盖同 prompt_id 旧图）。

    文件名取 prompt_id（清洗后），魔数校验确为图片，防止任意文件写入。
    """
    data = await file.read()
    ext = detect_image_ext(data)
    if not ext:
        raise HTTPException(status_code=400, detail="仅支持 JPG / PNG / GIF / WebP 图片")
    if len(data) > PREVIEW_MAX_BYTES:
        raise HTTPException(status_code=400, detail="图片大小不能超过 5MB")

    safe = sanitize_prompt_id(prompt_id)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    # 覆盖同 prompt_id 的旧图（扩展名可能变化，按基名清掉所有历史扩展）
    for old in PREVIEW_DIR.glob(f"{safe}.*"):
        old.unlink(missing_ok=True)
    filename = f"{safe}{ext}"
    await asyncio.to_thread((PREVIEW_DIR / filename).write_bytes, data)
    preview_image = f"{PREVIEW_PREFIX}/{filename}"

    row = db.query(PromptMetadata).filter(PromptMetadata.prompt_id == prompt_id).first()
    if row:
        row.preview_image = preview_image
    else:
        row = PromptMetadata(prompt_id=prompt_id, preview_image=preview_image)
        db.add(row)
    db.commit()
    return {"preview_image": preview_image}


@router.delete("/prompts/{prompt_id}/preview")
async def delete_bifrost_preview(
    prompt_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """删除提示词预览图（文件 + 元数据）。"""
    row = db.query(PromptMetadata).filter(PromptMetadata.prompt_id == prompt_id).first()
    if row:
        if row.preview_image and row.preview_image.startswith(PREVIEW_PREFIX):
            filename = row.preview_image.split("/")[-1]
            (PREVIEW_DIR / filename).unlink(missing_ok=True)
        db.delete(row)
        db.commit()
    return {"preview_image": None}
