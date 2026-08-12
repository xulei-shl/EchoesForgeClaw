from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import Optional

from app.core.database import get_db
from app.core.deps import get_current_active_user
from app.models.user import User
from app.models.generation import Generation
from app.schemas.generation import GenerationCreate, GenerationOut, GenerationPage, NodeTypeCount
from app.services.image_service import image_service

router = APIRouter(prefix="/api/generations", tags=["generations"])


def _to_out(
    gen: Generation,
    current_user: User,
    include_username: bool = False,
) -> GenerationOut:
    """将 Generation ORM 对象转为响应（附带当前用户的收藏/公开状态）。"""
    return GenerationOut(
        id=gen.id,
        node_type=gen.node_type,
        name=gen.name or "",
        stage_results=gen.stage_results or {},
        result_url=gen.result_url,
        status=gen.status,
        created_at=gen.created_at,
        is_favorited=any(f.user_id == current_user.id for f in gen.favorites),
        is_public=gen.public_share is not None,
        username=gen.user.username if include_username and gen.user else None,
    )


def _extract_generation_name(stage_results, node_type: str) -> str:
    """从生成记录的 stage_results 中提取题名（供关键词检索）。

    不同节点类型的结果结构不同，按 node_type 分发提取器：
    - image_generation（藏书票图像）：stage1.metadata.title
    新增节点类型时在此登记各自的取名字段即可。
    """
    if node_type == "image_generation":
        metadata = (stage_results or {}).get("stage1", {}).get("metadata", {})
        if isinstance(metadata, dict):
            title = metadata.get("title")
            if isinstance(title, str):
                return title.strip()
    return ""


def _collect_artifact_urls(gen: Generation) -> list[str]:
    urls = []
    if gen.result_url:
        urls.append(gen.result_url)
    sr = gen.stage_results or {}
    stage3 = sr.get("stage3", {}) or {}
    if isinstance(stage3, dict):
        u = stage3.get("image_url")
        if u:
            urls.append(u)
    return urls


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
        node_type=payload.node_type or "image_generation",
        name=_extract_generation_name(payload.stage_results, payload.node_type or "image_generation"),
        stage_results=payload.stage_results or {},
        result_url=payload.result_url or "",
        status=payload.status or "completed",
    )
    db.add(gen)
    db.commit()
    db.refresh(gen)
    return _to_out(gen, current_user)


@router.get("", response_model=GenerationPage)
def list_generations(
    keyword: Optional[str] = None,
    node_type: Optional[str] = None,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """当前用户的历史记录（可按 keyword / node_type 筛选，分页返回）。"""
    query = db.query(Generation).filter(Generation.user_id == current_user.id)
    if keyword:
        query = query.filter(Generation.name.ilike(f"%{keyword}%"))
    if node_type:
        query = query.filter(Generation.node_type == node_type)
    total = query.count()
    page_limit = min(limit, 100)
    gens = (
        query.order_by(Generation.created_at.desc(), Generation.id.desc())
        .offset(skip)
        .limit(page_limit)
        .all()
    )
    # 类型筛选项：全部记录按类型分组计数（不受 keyword/node_type 过滤影响，筛选时选项保持稳定）
    node_type_counts = [
        NodeTypeCount(node_type=row[0], count=row[1])
        for row in db.query(Generation.node_type, func.count(Generation.id))
        .filter(Generation.user_id == current_user.id)
        .group_by(Generation.node_type)
        .all()
    ]
    return GenerationPage(
        items=[_to_out(g, current_user) for g in gens],
        total=total,
        skip=skip,
        limit=page_limit,
        node_type_counts=node_type_counts,
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
    """删除当前用户的生成记录（ORM 级联清理其收藏与公开状态，并删除对应静态文件）。"""
    gen = _get_owned_generation(generation_id, current_user, db)
    # Generation.favorites / public_share 已配置 cascade="all, delete-orphan"，
    # 删除父记录时（含其他用户对该记录的收藏）会一并删除
    urls = _collect_artifact_urls(gen)
    db.delete(gen)
    db.commit()
    for url in urls:
        image_service.delete_file(url)
    return {"message": "生成记录已删除"}
