from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.core.deps import get_current_admin_user
from app.models.user import User
from app.models.skill_agent_config import SkillAgentConfig
from app.schemas.admin import (
    SkillAgentConfigCreate,
    SkillAgentConfigUpdate,
    SkillAgentConfigOut,
)

router = APIRouter(prefix="/admin/skill-agent-configs", tags=["admin-skill-agent-configs"])


def _to_out(cfg: SkillAgentConfig) -> SkillAgentConfigOut:
    """ORM -> 响应（api_key 永不返回，仅标记是否已配置）。"""
    return SkillAgentConfigOut(
        id=cfg.id,
        name=cfg.name,
        base_url=cfg.base_url,
        model_name=cfg.model_name,
        system_prompt=cfg.system_prompt,
        is_active=cfg.is_active,
        has_api_key=bool(cfg.api_key),
        created_at=cfg.created_at,
        updated_at=cfg.updated_at,
    )


@router.get("", response_model=List[SkillAgentConfigOut])
def list_skill_agent_configs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Skill Agent 配置列表。"""
    configs = db.query(SkillAgentConfig).order_by(SkillAgentConfig.id.asc()).all()
    return [_to_out(c) for c in configs]


@router.post("", response_model=SkillAgentConfigOut)
def create_skill_agent_config(
    payload: SkillAgentConfigCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """新建 Skill Agent 配置。"""
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="配置名称不能为空")
    if not payload.model_name.strip():
        raise HTTPException(status_code=400, detail="模型名称不能为空")
    cfg = SkillAgentConfig(**payload.model_dump())
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return _to_out(cfg)


@router.post("/{config_id}/duplicate", response_model=SkillAgentConfigOut)
def duplicate_skill_agent_config(
    config_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """复制 Skill Agent 配置：沿用 Base URL / API Key / 模型，名字加「(副本)」后缀。"""
    cfg = db.query(SkillAgentConfig).filter(SkillAgentConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Skill Agent 配置不存在")
    new_cfg = SkillAgentConfig(
        name=f"{cfg.name} (副本)",
        base_url=cfg.base_url,
        api_key=cfg.api_key,
        model_name=cfg.model_name,
        system_prompt=cfg.system_prompt,
        is_active=cfg.is_active,
    )
    db.add(new_cfg)
    db.commit()
    db.refresh(new_cfg)
    return _to_out(new_cfg)


@router.patch("/{config_id}", response_model=SkillAgentConfigOut)
def update_skill_agent_config(
    config_id: int,
    payload: SkillAgentConfigUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """修改 Skill Agent 配置（api_key 留空表示不修改）。"""
    cfg = db.query(SkillAgentConfig).filter(SkillAgentConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Skill Agent 配置不存在")
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
def delete_skill_agent_config(
    config_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """删除 Skill Agent 配置（引用它的节点配置解除绑定）。"""
    cfg = db.query(SkillAgentConfig).filter(SkillAgentConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Skill Agent 配置不存在")
    from app.models.node_config import NodeConfig

    for nc in db.query(NodeConfig).filter(NodeConfig.skill_agent_config_id == cfg.id).all():
        nc.skill_agent_config_id = None
    db.delete(cfg)
    db.commit()
    return {"message": "Skill Agent 配置已删除"}
