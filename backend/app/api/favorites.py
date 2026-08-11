from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import Optional

from app.core.database import get_db
from app.core.deps import get_current_active_user
from app.models.user import User
from app.models.favorite import Favorite
from app.models.generation import Generation
from app.schemas.generation import GenerationIdAction, GenerationOut, GenerationPage
from app.api.generations import _get_any_generation, _to_out

router = APIRouter(prefix="/api/favorites", tags=["favorites"])


@router.post("", response_model=GenerationOut)
def add_favorite(
    payload: GenerationIdAction,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """收藏某条生成记录（可收藏画廊中他人的作品）。幂等：重复收藏直接返回。"""
    gen = _get_any_generation(payload.generation_id, db)
    existing = (
        db.query(Favorite)
        .filter(
            Favorite.user_id == current_user.id,
            Favorite.generation_id == gen.id,
        )
        .first()
    )
    if not existing:
        try:
            db.add(Favorite(user_id=current_user.id, generation_id=gen.id))
            db.commit()
        except IntegrityError:
            # 并发重复收藏时命中唯一约束，回滚后按已收藏处理
            db.rollback()
        db.refresh(gen)
    return _to_out(gen, current_user, include_username=True)


@router.get("", response_model=GenerationPage)
def list_favorites(
    keyword: Optional[str] = None,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """当前用户的收藏列表（含生成记录内容，可按 keyword 搜索，分页返回）。"""
    query = db.query(Favorite).filter(Favorite.user_id == current_user.id)
    if keyword:
        query = query.join(Generation, Favorite.generation_id == Generation.id)
        query = query.filter(Generation.name.ilike(f"%{keyword}%"))
    total = query.count()
    page_limit = min(limit, 100)
    favs = (
        query.order_by(Favorite.created_at.desc(), Favorite.id.desc())
        .offset(skip)
        .limit(page_limit)
        .all()
    )
    return GenerationPage(
        items=[_to_out(fav.generation, current_user, include_username=True) for fav in favs if fav.generation],
        total=total,
        skip=skip,
        limit=page_limit,
    )


@router.delete("/{generation_id}", response_model=GenerationOut)
def remove_favorite(
    generation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """取消收藏。"""
    fav = (
        db.query(Favorite)
        .filter(
            Favorite.user_id == current_user.id,
            Favorite.generation_id == generation_id,
        )
        .first()
    )
    if fav:
        db.delete(fav)
        db.commit()
    gen = db.query(Generation).filter(Generation.id == generation_id).first()
    if not gen:
        raise HTTPException(status_code=404, detail="生成记录不存在")
    return _to_out(gen, current_user, include_username=True)
