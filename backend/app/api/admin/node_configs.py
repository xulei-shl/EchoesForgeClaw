from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.core.deps import get_current_admin_user
from app.models.user import User
from app.models.node_config import NodeConfig
from app.models.llm_config import LLMConfig
from app.models.prompt_template import PromptTemplate
from app.models.fastclaw_agent_config import FastClawAgentConfig
from app.models.skill_agent_config import SkillAgentConfig
from app.modules.bookplate.node_types import NODE_TEMPLATE_MAP
from app.schemas.admin import (
    NodeConfigCreate,
    NodeConfigUpdate,
    NodeConfigOut,
    NodeConfigReorderPayload,
)

router = APIRouter(prefix="/admin/node-configs", tags=["admin-node-configs"])


def _validate_node_type(node_type: str) -> None:
    """校验节点模板类型是否为代码内置模板。"""
    if node_type not in NODE_TEMPLATE_MAP:
        raise HTTPException(status_code=400, detail=f"未知的节点模板类型: {node_type}")


def _validate_mode(
    has_llm: bool,
    has_prompt: bool,
    has_agent: bool,
    has_skill_agent: bool,
) -> None:
    """校验模式互斥：agent / skill_agent 模式与「提示词 + 大模型」只能选择一组。"""
    if (has_agent or has_skill_agent) and (has_llm or has_prompt):
        raise HTTPException(
            status_code=400,
            detail="Agent / Skill Agent 模式与「提示词 + 大模型」互斥，只能选择一组",
        )
    if has_agent and has_skill_agent:
        raise HTTPException(
            status_code=400,
            detail="FastClaw Agent 与 Skill Agent 模式互斥，只能选择一组",
        )


def _validate_refs(
    db: Session,
    llm_config_id: Optional[int],
    prompt_id: Optional[int],
    agent_config_id: Optional[int],
    skill_agent_config_id: Optional[int],
) -> None:
    if llm_config_id is not None:
        if not db.query(LLMConfig).filter(LLMConfig.id == llm_config_id).first():
            raise HTTPException(status_code=400, detail="所选模型配置不存在")
    if prompt_id is not None:
        if not db.query(PromptTemplate).filter(PromptTemplate.id == prompt_id).first():
            raise HTTPException(status_code=400, detail="所选提示词模板不存在")
    if agent_config_id is not None:
        if not db.query(FastClawAgentConfig).filter(FastClawAgentConfig.id == agent_config_id).first():
            raise HTTPException(status_code=400, detail="所选 FastClaw Agent 配置不存在")
    if skill_agent_config_id is not None:
        if not db.query(SkillAgentConfig).filter(SkillAgentConfig.id == skill_agent_config_id).first():
            raise HTTPException(status_code=400, detail="所选 Skill Agent 配置不存在")


def _to_out(nc: NodeConfig) -> NodeConfigOut:
    return NodeConfigOut(
        id=nc.id,
        node_type=nc.node_type,
        name=nc.name,
        group=nc.group,
        group_order=nc.group_order,
        llm_config_id=nc.llm_config_id,
        prompt_id=nc.prompt_id,
        agent_config_id=nc.agent_config_id,
        skill_agent_config_id=nc.skill_agent_config_id,
        llm_config_name=nc.llm_config.name if nc.llm_config else None,
        prompt_name=nc.prompt.name if nc.prompt else None,
        agent_config_name=nc.agent_config.name if nc.agent_config else None,
        skill_agent_config_name=nc.skill_agent_config.name if nc.skill_agent_config else None,
        agent_config_agent_name=nc.agent_config.agent_name if nc.agent_config else None,
        is_active=nc.is_active,
        created_at=nc.created_at,
        updated_at=nc.updated_at,
    )


def _load_nc(db: Session, nc_id: int) -> NodeConfig:
    nc = db.query(NodeConfig).filter(NodeConfig.id == nc_id).first()
    if not nc:
        raise HTTPException(status_code=404, detail="节点配置不存在")
    return nc


@router.get("", response_model=List[NodeConfigOut])
def list_node_configs(
    node_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """节点配置列表（可按 node_type 过滤）。"""
    query = db.query(NodeConfig)
    if node_type:
        query = query.filter(NodeConfig.node_type == node_type)
    items = query.order_by(NodeConfig.id.asc()).all()
    return [_to_out(nc) for nc in items]


@router.post("", response_model=NodeConfigOut)
def create_node_config(
    payload: NodeConfigCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """创建节点配置：同一节点模板可创建多条配置（= 画板中的多个节点变体）。"""
    _validate_node_type(payload.node_type)
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="节点名称不能为空")
    _validate_mode(
        payload.llm_config_id is not None,
        payload.prompt_id is not None,
        payload.agent_config_id is not None,
        payload.skill_agent_config_id is not None,
    )
    _validate_refs(
        db,
        payload.llm_config_id,
        payload.prompt_id,
        payload.agent_config_id,
        payload.skill_agent_config_id,
    )
    nc = NodeConfig(**payload.model_dump())
    db.add(nc)
    db.commit()
    db.refresh(nc)
    db.expire(nc)
    return _to_out(nc)


@router.patch("/{nc_id}", response_model=NodeConfigOut)
def update_node_config(
    nc_id: int,
    payload: NodeConfigUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """修改节点配置（合并现有字段后校验模式互斥与引用有效性）。"""
    nc = _load_nc(db, nc_id)
    data = payload.model_dump(exclude_unset=True)
    if "node_type" in data and data["node_type"] is not None:
        _validate_node_type(data["node_type"])
    if "name" in data and data["name"] is not None and not str(data["name"]).strip():
        raise HTTPException(status_code=400, detail="节点名称不能为空")

    merged = {
        "node_type": nc.node_type,
        "llm_config_id": nc.llm_config_id,
        "prompt_id": nc.prompt_id,
        "agent_config_id": nc.agent_config_id,
        "skill_agent_config_id": nc.skill_agent_config_id,
        **data,
    }
    _validate_mode(
        merged.get("llm_config_id") is not None,
        merged.get("prompt_id") is not None,
        merged.get("agent_config_id") is not None,
        merged.get("skill_agent_config_id") is not None,
    )
    _validate_refs(
        db,
        merged.get("llm_config_id"),
        merged.get("prompt_id"),
        merged.get("agent_config_id"),
        merged.get("skill_agent_config_id"),
    )
    for key, value in data.items():
        setattr(nc, key, value)
    db.add(nc)
    db.commit()
    db.refresh(nc)
    db.expire(nc)
    return _to_out(nc)


@router.post("/reorder-groups")
def reorder_node_groups(
    payload: NodeConfigReorderPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """批量更新自定义分组排序：按 group 名写入排序序号（同组所有配置共享）。

    接收完整分组顺序列表（仅含自定义分组）；未出现的分组序号不变。
    """
    seen: List[str] = []
    for item in payload.groups:
        g = item.group.strip()
        if not g or g in seen:
            raise HTTPException(status_code=400, detail="分组名不能为空或重复")
        seen.append(g)
        for nc in db.query(NodeConfig).filter(NodeConfig.group == g).all():
            nc.group_order = item.order
    db.commit()
    return {"message": "分组排序已更新"}


@router.delete("/{nc_id}")
def delete_node_config(
    nc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """删除节点配置（画板「+」菜单中将不再出现该节点变体）。"""
    nc = _load_nc(db, nc_id)
    db.delete(nc)
    db.commit()
    return {"message": "节点配置已删除"}
