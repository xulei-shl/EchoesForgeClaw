from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.core.deps import get_current_admin_user
from app.models.user import User
from app.models.prompt_template import PromptTemplate
from app.schemas.admin import (
    PromptTemplateCreate,
    PromptTemplateUpdate,
    PromptTemplateOut,
)

router = APIRouter(prefix="/admin/prompts", tags=["admin-prompts"])


@router.get("", response_model=List[PromptTemplateOut])
def list_prompts(
    node_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """提示词模板列表（可按 node_type 过滤）。"""
    query = db.query(PromptTemplate)
    if node_type:
        query = query.filter(PromptTemplate.node_type == node_type)
    return query.order_by(PromptTemplate.id.desc()).all()


@router.post("", response_model=PromptTemplateOut)
def create_prompt(
    payload: PromptTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """新建提示词模板。"""
    item = PromptTemplate(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{prompt_id}", response_model=PromptTemplateOut)
def update_prompt(
    prompt_id: int,
    payload: PromptTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """修改提示词模板。"""
    item = db.query(PromptTemplate).filter(PromptTemplate.id == prompt_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="提示词模板不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{prompt_id}")
def delete_prompt(
    prompt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """删除提示词模板（引用它的节点配置解除绑定）。"""
    item = db.query(PromptTemplate).filter(PromptTemplate.id == prompt_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="提示词模板不存在")
    from app.models.node_config import NodeConfig
    from app.models.skill_agent_config import SkillAgentConfig

    for nc in db.query(NodeConfig).filter(NodeConfig.prompt_id == item.id).all():
        nc.prompt_id = None
    for sac in db.query(SkillAgentConfig).filter(SkillAgentConfig.prompt_id == item.id).all():
        sac.prompt_id = None
    db.delete(item)
    db.commit()
    return {"message": "提示词模板已删除"}