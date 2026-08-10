from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional

from app.core.database import get_db
from app.core.deps import get_current_active_user
from app.models.user import User
from app.models.generation import Generation
from app.schemas.generation import GenerationCreate, GenerationOut, GenerationPage

router = APIRouter(prefix="/api/generations", tags=["generations"])


def _to_out(
    gen: Generation,
    current_user: User,
    include_username: bool = False,
) -> GenerationOut:
    """将 Generation ORM 对象转为响应（附带当前用户的收藏/公开状态）。"""
    return GenerationOut(
        id=gen.id,
        module=gen.module,
        name=gen.name or "",
        stage_results=gen.stage_results or {},
        final_image_url=gen.final_image_url,
        status=gen.status,
        created_at=gen.created_at,
        is_favorited=any(f.user_id == current_user.id for f in gen.favorites),
        is_public=gen.public_share is not None,
        username=gen.user.username if include_username and gen.user else None,
    )


def _extract_generation_name(stage_results) -> str:
    """从生成记录的 stage_results 元数据中提取题名（bookplate 为 stage1.metadata.title）。"""
    metadata = (stage_results or {}).get("stage1", {}).get("metadata", {})
    if isinstance(metadata, dict):
        title = metadata.get("title")
        if isinstance(title, str):
            return title.strip()
    return ""


def _get_owned_generation(
    generation_id: int,
    current_user: User,
    db: Session,
) -> Generation:
    """获取当前用户自己的生成记录，不存在则 404。"""
    gen = (
        db.query(Generation)
        .filter(Generation.id == generation_id, Generation.user_id == current_user.id)
        .first()
    )
    if not gen:
        raise HTTPException(status_code=404, detail="生成记录不存在")
    return gen


def _get_any_generation(generation_id: int, db: Session) -> Generation:
    """获取任意用户的生成记录（画廊收藏他人作品用），不存在则 404。"""
    gen = db.query(Generation).filter(Generation.id == generation_id).first()
    if not gen:
        raise HTTPException(status_code=404, detail="生成记录不存在")
    return gen


@router.post("", response_model=GenerationOut)
def create_generation(
    payload: GenerationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """保存一次画布生成结果到历史记录。"""
    gen = Generation(
        user_id=current_user.id,
        module=payload.module or "bookplate",
        name=_extract_generation_name(payload.stage_results),
        stage_results=payload.stage_results or {},
        final_image_url=payload.final_image_url or "",
        status=payload.status or "completed",
    )
    db.add(gen)
    db.commit()
    db.refresh(gen)
    return _to_out(gen, current_user)


@router.get("", response_model=GenerationPage)
def list_generations(
    module: Optional[str] = None,
    keyword: Optional[str] = None,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """当前用户的历史记录（可按 module / keyword 过滤，分页返回）。"""
    query = db.query(Generation).filter(Generation.user_id == current_user.id)
    if module:
        query = query.filter(Generation.module == module)
    if keyword:
        query = query.filter(Generation.name.ilike(f"%{keyword}%"))
    total = query.count()
    page_limit = min(limit, 100)
    gens = (
        query.order_by(Generation.created_at.desc(), Generation.id.desc())
        .offset(skip)
        .limit(page_limit)
        .all()
    )
    return GenerationPage(
        items=[_to_out(g, current_user) for g in gens],
        total=total,
        skip=skip,
        limit=page_limit,
    )


@router.get("/{generation_id}", response_model=GenerationOut)
def get_generation(
    generation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """当前用户单条历史记录详情。"""
    gen = _get_owned_generation(generation_id, current_user, db)
    return _to_out(gen, current_user)


@router.delete("/{generation_id}")
def delete_generation(
    generation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """删除当前用户的生成记录（ORM 级联清理其收藏与公开状态）。"""
    gen = _get_owned_generation(generation_id, current_user, db)
    # Generation.favorites / public_share 已配置 cascade="all, delete-orphan"，
    # 删除父记录时（含其他用户对该记录的收藏）会一并删除
    db.delete(gen)
    db.commit()
    return {"message": "生成记录已删除"}
