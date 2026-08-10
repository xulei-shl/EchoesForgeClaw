from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.core.deps import get_current_admin_user
from app.models.user import User
from app.models.llm_config import LLMConfig
from app.schemas.admin import LLMConfigCreate, LLMConfigUpdate, LLMConfigOut

router = APIRouter(prefix="/admin/llm-configs", tags=["admin-llm-configs"])


def _to_out(cfg: LLMConfig) -> LLMConfigOut:
    """ORM -> 响应（api_key 永不返回，仅标记是否已配置）。"""
    return LLMConfigOut(
        id=cfg.id,
        name=cfg.name,
        kind=cfg.kind,
        base_url=cfg.base_url,
        model_name=cfg.model_name,
        is_active=cfg.is_active,
        has_api_key=bool(cfg.api_key),
        created_at=cfg.created_at,
        updated_at=cfg.updated_at,
    )


@router.get("", response_model=List[LLMConfigOut])
def list_llm_configs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """模型配置列表。"""
    return [_to_out(c) for c in db.query(LLMConfig).order_by(LLMConfig.id.asc()).all()]


@router.post("", response_model=LLMConfigOut)
def create_llm_config(
    payload: LLMConfigCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """新建模型配置。"""
    cfg = LLMConfig(**payload.model_dump())
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return _to_out(cfg)


@router.patch("/{config_id}", response_model=LLMConfigOut)
def update_llm_config(
    config_id: int,
    payload: LLMConfigUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """修改模型配置（api_key 留空表示不修改）。"""
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="模型配置不存在")
    data = payload.model_dump(exclude_unset=True)
    if "api_key" in data and not data["api_key"]:
        del data["api_key"]  # 空字符串 = 保留原 key
    for key, value in data.items():
        setattr(cfg, key, value)
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return _to_out(cfg)


@router.delete("/{config_id}")
def delete_llm_config(
    config_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """删除模型配置（引用它的阶段配置解除绑定）。"""
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="模型配置不存在")
    # 解除 StageConfig 引用（置空），避免悬空外键
    from app.models.stage_config import StageConfig

    for sc in db.query(StageConfig).filter(StageConfig.llm_config_id == cfg.id).all():
        sc.llm_config_id = None
    db.delete(cfg)
    db.commit()
    return {"message": "模型配置已删除"}
