from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.core.deps import get_current_admin_user
from app.models.user import User
from app.models.fastclaw_agent_config import FastClawAgentConfig
from app.schemas.admin import (
    FastClawAgentConfigCreate,
    FastClawAgentConfigUpdate,
    FastClawAgentConfigOut,
)

router = APIRouter(prefix="/admin/fastclaw-agents", tags=["admin-fastclaw-agents"])


def _to_out(cfg: FastClawAgentConfig) -> FastClawAgentConfigOut:
    """ORM -> 响应（api_key 永不返回，仅标记是否已配置）。"""
    return FastClawAgentConfigOut(
        id=cfg.id,
        name=cfg.name,
        base_url=cfg.base_url,
        agent_id=cfg.agent_id,
        is_active=cfg.is_active,
        has_api_key=bool(cfg.api_key),
        created_at=cfg.created_at,
        updated_at=cfg.updated_at,
    )


@router.get("", response_model=List[FastClawAgentConfigOut])
def list_fastclaw_agents(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """FastClaw Agent 配置列表。"""
    return [
        _to_out(c)
        for c in db.query(FastClawAgentConfig).order_by(FastClawAgentConfig.id.asc()).all()
    ]


@router.post("", response_model=FastClawAgentConfigOut)
def create_fastclaw_agent(
    payload: FastClawAgentConfigCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """新建 FastClaw Agent 配置。"""
    cfg = FastClawAgentConfig(**payload.model_dump())
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return _to_out(cfg)


@router.patch("/{config_id}", response_model=FastClawAgentConfigOut)
def update_fastclaw_agent(
    config_id: int,
    payload: FastClawAgentConfigUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """修改 FastClaw Agent 配置（api_key 留空表示不修改）。"""
    cfg = db.query(FastClawAgentConfig).filter(FastClawAgentConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="FastClaw Agent 配置不存在")
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
def delete_fastclaw_agent(
    config_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """删除 FastClaw Agent 配置（引用它的阶段配置解除绑定）。"""
    cfg = db.query(FastClawAgentConfig).filter(FastClawAgentConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="FastClaw Agent 配置不存在")
    # 解除 StageConfig 引用（置空），避免悬空外键
    from app.models.stage_config import StageConfig

    for sc in db.query(StageConfig).filter(StageConfig.agent_config_id == cfg.id).all():
        sc.agent_config_id = None
    db.delete(cfg)
    db.commit()
    return {"message": "FastClaw Agent 配置已删除"}
