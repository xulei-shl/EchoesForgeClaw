"""画布侧 Bifrost 提示词检索接口（供「提示词检索」节点使用）。

与管理端接口（app/api/admin/bifrost.py）职责相同、仅鉴权不同：
画布节点对普通登录用户开放，因此这里用 get_current_active_user；
列表/详情都经服务层代理 Bifrost，本地预览图一并合并返回。
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_active_user
from app.models.user import User
from app.services.bifrost_service import (
    BifrostError,
    BifrostNotConfiguredError,
    BifrostNotFoundError,
    get_prompt,
    list_prompts,
)

router = APIRouter(prefix="/api/modules/bookplate/bifrost", tags=["bookplate-bifrost"])


def _bifrost_error_http(exc: BifrostError) -> HTTPException:
    if isinstance(exc, BifrostNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, BifrostNotConfiguredError):
        return HTTPException(status_code=503, detail=str(exc))
    return HTTPException(status_code=502, detail=str(exc))


@router.get("/prompts")
async def list_bifrost_prompts(
    folder_id: Optional[str] = None,
    q: str = "",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """提示词检索节点：默认加载 / 关键词检索提示词（合并本地预览图）。"""
    try:
        prompts = await list_prompts(db, folder_id=folder_id or None, q=q)
    except BifrostError as exc:
        raise _bifrost_error_http(exc)
    return {"prompts": prompts}


@router.get("/prompts/{prompt_id}")
async def get_bifrost_prompt(
    prompt_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """提示词详情（含提取的正文文本与本地预览图）。"""
    try:
        return await get_prompt(db, prompt_id)
    except BifrostError as exc:
        raise _bifrost_error_http(exc)
