import logging

import httpx
import openai
from fastapi import APIRouter, Depends, HTTPException
from openai import AsyncOpenAI
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.core.deps import get_current_admin_user
from app.models.user import User
from app.models.llm_config import LLMConfig
from app.schemas.admin import (
    LLMConfigCreate,
    LLMConfigUpdate,
    LLMConfigOut,
    LLMConfigTestPayload,
    LLMConfigTestOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/llm-configs", tags=["admin-llm-configs"])

# 连通性测试超时（秒）：比正式调用更短，让管理员快速拿到结果
TEST_TIMEOUT = 20.0


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
    # 解除引用（置空），避免悬空外键：NodeConfig + SkillAgentConfig
    from app.models.node_config import NodeConfig
    from app.models.skill_agent_config import SkillAgentConfig

    for nc in db.query(NodeConfig).filter(NodeConfig.llm_config_id == cfg.id).all():
        nc.llm_config_id = None
    for sac in db.query(SkillAgentConfig).filter(SkillAgentConfig.llm_config_id == cfg.id).all():
        sac.llm_config_id = None
    db.delete(cfg)
    db.commit()
    return {"message": "模型配置已删除"}


def _explain_llm_error(exc: Exception) -> str:
    """把 openai SDK 异常翻译成面向管理员的可读原因。"""
    if isinstance(exc, openai.APIConnectionError):
        return "无法连接：网络不通或 Base URL 有误（请检查地址、端口与网络代理）"
    if isinstance(exc, openai.AuthenticationError):
        return "认证失败：API Key 无效或无权限"
    if isinstance(exc, openai.NotFoundError):
        return "地址或模型不存在：请检查 Base URL 与模型名称"
    if isinstance(exc, openai.RateLimitError):
        return "请求被限流（Rate Limit），请稍后再试"
    if isinstance(exc, openai.APIStatusError):
        return f"调用失败（HTTP {exc.status_code}）：{exc.message}"
    return f"调用失败：{exc}"


async def _probe_models(base_url: str, api_key: str) -> str:
    """GET {base_url}/models 验证地址与 Key；成功返回描述，失败抛 ValueError（带原因）。"""
    url = f"{base_url.rstrip('/')}/models" if base_url else "https://api.openai.com/v1/models"
    try:
        async with httpx.AsyncClient(timeout=TEST_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(url, headers={"Authorization": f"Bearer {api_key}"})
    except httpx.HTTPError as exc:
        raise ValueError(f"无法连接：网络不通或 Base URL 有误（{type(exc).__name__}）") from exc
    if resp.status_code == 200:
        try:
            data = resp.json()
        except ValueError:
            data = None
        models = data.get("data", []) if isinstance(data, dict) else []
        count = len([m for m in models if isinstance(m, dict)])
        return f"连接正常：Base URL 与 API Key 有效（该服务暴露 {count} 个模型）"
    if resp.status_code in (401, 403):
        raise ValueError("认证失败：API Key 无效或无访问权限")
    if resp.status_code == 404:
        raise ValueError("地址不可达：Base URL 路径有误，或该服务未提供 /models 接口")
    raise ValueError(f"连接异常：HTTP {resp.status_code}")


async def _run_connectivity_test(
    api_key: str, base_url: str, model_name: str, kind: str
) -> str:
    """对一组 OpenAI 兼容三要素发起连通性测试，返回成功描述；失败抛 ValueError（带原因）。

    - text / multimodal：最小 chat 调用（max_tokens=1，仅验证链路、无实际生成成本）；
      chat 失败时降级用 /models 复核，把「连通但模型不可用」与「完全不连通」区分开。
    - image / video / audio：图像/音视频模型通常不支持 chat 接口，直接用 /models 验证地址与 Key。
    """
    base_url = (base_url or "").strip()
    model_name = (model_name or "").strip()
    if not api_key:
        raise ValueError("未配置 API Key：请先在表单中填写，或保存配置后再测试")

    client = AsyncOpenAI(
        api_key=api_key,
        base_url=base_url or None,
        timeout=TEST_TIMEOUT,
        max_retries=0,
    )

    if kind in ("text", "multimodal"):
        try:
            await client.chat.completions.create(
                model=model_name or "gpt-3.5-turbo",
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=1,
            )
            return f"连接正常：模型「{model_name or 'gpt-3.5-turbo'}」可正常响应"
        except Exception as exc:
            chat_msg = _explain_llm_error(exc)
            try:
                models_msg = await _probe_models(base_url, api_key)
            except ValueError as probe_err:
                raise ValueError(f"{chat_msg}；{probe_err}") from exc
            return f"{models_msg}（对话接口调用失败：{chat_msg}）"

    # image / video / audio
    return await _probe_models(base_url, api_key)


@router.post("/test", response_model=LLMConfigTestOut)
async def test_llm_config(
    payload: LLMConfigTestPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """测试模型配置连通性（不落库、不发真实生成请求）。

    - 传 id：以已保存配置为基底，请求中提供的字段覆盖之；api_key 留空时使用库中保存的 Key。
    - 不传 id（新建前测试）：需提供 base_url / api_key / model_name。
    成功返回 ok=true + 描述；失败抛 502，detail 为可读原因。
    """
    cfg = None
    if payload.id is not None:
        cfg = db.query(LLMConfig).filter(LLMConfig.id == payload.id).first()
        if not cfg:
            raise HTTPException(status_code=404, detail="模型配置不存在")

    api_key = (payload.api_key or "").strip() or (cfg.api_key if cfg else "")
    base_url = (
        payload.base_url if payload.base_url is not None else (cfg.base_url if cfg else "")
    )
    model_name = (
        payload.model_name
        if payload.model_name is not None
        else (cfg.model_name if cfg else "")
    )
    kind = payload.kind or (cfg.kind if cfg else "text")

    if not api_key:
        raise HTTPException(
            status_code=400, detail="未配置 API Key：请先在表单中填写，或保存配置后再测试"
        )
    if not model_name:
        raise HTTPException(status_code=400, detail="未填写模型名称（model_name）")

    try:
        message = await _run_connectivity_test(api_key, base_url, model_name, kind)
    except ValueError as exc:
        logger.warning("模型配置连通性测试失败 (id=%s): %s", payload.id, exc)
        raise HTTPException(status_code=502, detail=str(exc))
    return LLMConfigTestOut(ok=True, message=message)
