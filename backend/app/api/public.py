from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional

from app.core.database import get_db
from app.core.deps import get_current_active_user
from app.models.user import User
from app.models.generation import Generation
from app.models.public_share import PublicShare
from app.schemas.generation import GenerationIdAction, GenerationOut, GenerationPage
from app.api.generations import _get_owned_generation, _to_out

router = APIRouter(prefix="/api/public", tags=["public"])


@router.post("", response_model=GenerationOut)
def share_generation(
    payload: GenerationIdAction,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """将当前用户自己的生成记录公开到画廊。幂等：重复公开直接返回。"""
    gen = _get_owned_generation(payload.generation_id, current_user, db)
    if not gen.public_share:
        db.add(PublicShare(user_id=current_user.id, generation_id=gen.id))
        db.commit()
        db.refresh(gen)
    return _to_out(gen, current_user, include_username=True)


@router.get("", response_model=GenerationPage)
def list_public_shares(
    module: Optional[str] = None,
    keyword: Optional[str] = None,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """公开画廊：所有用户公开的生成记录（可按 module / keyword 过滤，分页返回）。"""
    query = db.query(PublicShare)
    needs_join = module or keyword
    if needs_join:
        query = query.join(Generation, PublicShare.generation_id == Generation.id)
        if module:
            query = query.filter(Generation.module == module)
        if keyword:
            query = query.filter(Generation.name.ilike(f"%{keyword}%"))
    total = query.count()
    page_limit = min(limit, 100)
    shares = (
        query.order_by(PublicShare.created_at.desc(), PublicShare.id.desc())
        .offset(skip)
        .limit(page_limit)
        .all()
    )
    return GenerationPage(
        items=[
            _to_out(share.generation, current_user, include_username=True)
            for share in shares
            if share.generation
        ],
        total=total,
        skip=skip,
        limit=page_limit,
    )


@router.delete("/{generation_id}", response_model=GenerationOut)
def unshare_generation(
    generation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """将当前用户自己的生成记录从画廊撤下。"""
    gen = _get_owned_generation(generation_id, current_user, db)
    share = (
        db.query(PublicShare)
        .filter(PublicShare.generation_id == gen.id, PublicShare.user_id == current_user.id)
        .first()
    )
    if share:
        db.delete(share)
        db.commit()
        db.refresh(gen)
    return _to_out(gen, current_user, include_username=True)
