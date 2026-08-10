from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.core.deps import get_current_admin_user
from app.models.user import User
from app.models.stage_config import StageConfig
from app.models.llm_config import LLMConfig
from app.models.prompt_template import PromptTemplate
from app.models.fastclaw_agent_config import FastClawAgentConfig
from app.schemas.admin import (
    StageConfigCreate,
    StageConfigUpdate,
    StageConfigOut,
)

router = APIRouter(prefix="/admin/stage-configs", tags=["admin-stage-configs"])


def _validate_mode(payload) -> None:
    """校验模式互斥：agent 模式与「提示词 + 大模型」只能选择一组。"""
    has_llm = getattr(payload, "llm_config_id", None) is not None
    has_prompt = getattr(payload, "prompt_id", None) is not None
    has_agent = getattr(payload, "agent_config_id", None) is not None
    if has_agent and (has_llm or has_prompt):
        raise HTTPException(
            status_code=400,
            detail="Agent 模式与「提示词 + 大模型」互斥，只能选择一组",
        )


def _to_out(sc: StageConfig) -> StageConfigOut:
    return StageConfigOut(
        id=sc.id,
        module=sc.module,
        stage=sc.stage,
        llm_config_id=sc.llm_config_id,
        prompt_id=sc.prompt_id,
        agent_config_id=sc.agent_config_id,
        llm_config_name=sc.llm_config.name if sc.llm_config else None,
        prompt_name=sc.prompt.name if sc.prompt else None,
        agent_config_name=sc.agent_config.name if sc.agent_config else None,
        created_at=sc.created_at,
        updated_at=sc.updated_at,
    )


def _load_sc(db: Session, sc_id: int) -> StageConfig:
    sc = (
        db.query(StageConfig)
        .filter(StageConfig.id == sc_id)
        .first()
    )
    if not sc:
        raise HTTPException(status_code=404, detail="阶段配置不存在")
    return sc


@router.get("", response_model=List[StageConfigOut])
def list_stage_configs(
    module: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """阶段配置列表（可按 module 过滤）。"""
    query = db.query(StageConfig)
    if module:
        query = query.filter(StageConfig.module == module)
    items = query.order_by(StageConfig.id.asc()).all()
    return [_to_out(sc) for sc in items]


@router.post("", response_model=StageConfigOut)
def upsert_stage_config(
    payload: StageConfigCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """创建阶段绑定；同一 (module, stage) 已存在时直接覆盖。"""
    _validate_mode(payload)
    if payload.llm_config_id is not None:
        if not db.query(LLMConfig).filter(LLMConfig.id == payload.llm_config_id).first():
            raise HTTPException(status_code=400, detail="所选模型配置不存在")
    if payload.prompt_id is not None:
        if not db.query(PromptTemplate).filter(PromptTemplate.id == payload.prompt_id).first():
            raise HTTPException(status_code=400, detail="所选提示词模板不存在")
    if payload.agent_config_id is not None:
        if not db.query(FastClawAgentConfig).filter(FastClawAgentConfig.id == payload.agent_config_id).first():
            raise HTTPException(status_code=400, detail="所选 FastClaw Agent 配置不存在")

    sc = (
        db.query(StageConfig)
        .filter(
            StageConfig.module == payload.module,
            StageConfig.stage == payload.stage,
        )
        .first()
    )
    if sc:
        sc.llm_config_id = payload.llm_config_id
        sc.prompt_id = payload.prompt_id
        sc.agent_config_id = payload.agent_config_id
    else:
        sc = StageConfig(**payload.model_dump())
        db.add(sc)
    db.commit()
    db.refresh(sc)
    db.expire(sc)
    return _to_out(sc)


@router.patch("/{sc_id}", response_model=StageConfigOut)
def update_stage_config(
    sc_id: int,
    payload: StageConfigUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """修改阶段绑定（若 module/stage 变化则按新键查重，避免唯一约束冲突）。"""
    sc = _load_sc(db, sc_id)
    data = payload.model_dump(exclude_unset=True)
    new_module = data.get("module", sc.module)
    new_stage = data.get("stage", sc.stage)
    if (new_module, new_stage) != (sc.module, sc.stage):
        conflict = (
            db.query(StageConfig)
            .filter(
                StageConfig.module == new_module,
                StageConfig.stage == new_stage,
                StageConfig.id != sc_id,
            )
            .first()
        )
        if conflict:
            raise HTTPException(status_code=400, detail="该模块/阶段已存在绑定，请直接修改那条记录")
    # 模式互斥：合并后校验（覆盖现有字段后判定）
    merged = {**{"llm_config_id": sc.llm_config_id, "prompt_id": sc.prompt_id, "agent_config_id": sc.agent_config_id}, **data}
    has_llm = merged.get("llm_config_id") is not None
    has_prompt = merged.get("prompt_id") is not None
    has_agent = merged.get("agent_config_id") is not None
    if has_agent and (has_llm or has_prompt):
        raise HTTPException(status_code=400, detail="Agent 模式与「提示词 + 大模型」互斥，只能选择一组")
    if "llm_config_id" in data and data["llm_config_id"] is not None:
        if not db.query(LLMConfig).filter(LLMConfig.id == data["llm_config_id"]).first():
            raise HTTPException(status_code=400, detail="所选模型配置不存在")
    if "prompt_id" in data and data["prompt_id"] is not None:
        if not db.query(PromptTemplate).filter(PromptTemplate.id == data["prompt_id"]).first():
            raise HTTPException(status_code=400, detail="所选提示词模板不存在")
    if "agent_config_id" in data and data["agent_config_id"] is not None:
        if not db.query(FastClawAgentConfig).filter(FastClawAgentConfig.id == data["agent_config_id"]).first():
            raise HTTPException(status_code=400, detail="所选 FastClaw Agent 配置不存在")
    for key, value in data.items():
        setattr(sc, key, value)
    db.add(sc)
    db.commit()
    db.refresh(sc)
    db.expire(sc)
    return _to_out(sc)


@router.delete("/{sc_id}")
def delete_stage_config(
    sc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """删除阶段绑定。"""
    sc = _load_sc(db, sc_id)
    db.delete(sc)
    db.commit()
    return {"message": "阶段配置已删除"}
