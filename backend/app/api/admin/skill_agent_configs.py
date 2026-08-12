from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.core.deps import get_current_admin_user
from app.models.user import User
from app.models.llm_config import LLMConfig
from app.models.skill_agent_config import SkillAgentConfig
from app.schemas.admin import (
    SkillAgentConfigCreate,
    SkillAgentConfigUpdate,
    SkillAgentConfigOut,
)

router = APIRouter(prefix="/admin/skill-agent-configs", tags=["admin-skill-agent-configs"])


def _to_out(cfg: SkillAgentConfig) -> SkillAgentConfigOut:
    """ORM -> 响应：api_key 永不返回，仅标记是否已配置；展示字段优先引用解析，回退旧字段。"""
    llm = cfg.llm_config
    prompt = cfg.prompt
    has_api_key = bool(llm.api_key) if llm else bool(cfg.api_key)
    return SkillAgentConfigOut(
        id=cfg.id,
        name=cfg.name,
        llm_config_id=cfg.llm_config_id,
        prompt_id=cfg.prompt_id,
        llm_config_name=llm.name if llm else None,
        prompt_name=prompt.name if prompt else None,
        # 展示用：引用优先（存在引用即以其为准），无引用时回退旧字段（存量数据兼容）
        base_url=llm.base_url if llm else cfg.base_url,
        model_name=llm.model_name if llm else cfg.model_name,
        system_prompt=prompt.content if prompt else cfg.system_prompt,
        is_active=cfg.is_active,
        has_api_key=has_api_key,
        created_at=cfg.created_at,
        updated_at=cfg.updated_at,
    )


def _require_llm_config(db: Session, llm_config_id) -> None:
    """校验引用的模型配置存在且启用（Skill Agent 的 url/key/model 全部来自它）。"""
    if llm_config_id is None:
        return
    llm = db.query(LLMConfig).filter(LLMConfig.id == llm_config_id).first()
    if not llm or not llm.is_active or not llm.api_key:
        raise HTTPException(
            status_code=400, detail="所选模型配置不存在 / 未启用 / 未配置 API Key"
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
    """新建 Skill Agent 配置：必须引用一个模型配置（url/key/model 复用之），提示词可选。"""
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="配置名称不能为空")
    if payload.llm_config_id is None:
        raise HTTPException(status_code=400, detail="请选择模型配置（模型 url/key 复用于「模型配置」）")
    _require_llm_config(db, payload.llm_config_id)
    cfg = SkillAgentConfig(
        name=payload.name.strip(),
        llm_config_id=payload.llm_config_id,
        prompt_id=payload.prompt_id,
        is_active=payload.is_active,
    )
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
    """复制 Skill Agent 配置：沿用模型/提示词引用，名字加「(副本)」后缀。"""
    cfg = db.query(SkillAgentConfig).filter(SkillAgentConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Skill Agent 配置不存在")
    new_cfg = SkillAgentConfig(
        name=f"{cfg.name} (副本)",
        llm_config_id=cfg.llm_config_id,
        prompt_id=cfg.prompt_id,
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
    """修改 Skill Agent 配置（引用字段；prompt_id 传 null 表示清除提示词）。"""
    cfg = db.query(SkillAgentConfig).filter(SkillAgentConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Skill Agent 配置不存在")
    data = payload.model_dump(exclude_unset=True)
    if "llm_config_id" in data:
        _require_llm_config(db, data["llm_config_id"])
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
