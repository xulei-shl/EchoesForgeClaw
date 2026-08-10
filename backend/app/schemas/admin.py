from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional, Literal


# ---------------------------------------------------------------------------
# LLMConfig（大模型配置）
# ---------------------------------------------------------------------------

# 模型类型：text（文本）/ multimodal（多模态）/ image（图像）/ video（视频）/ audio（音频）
LLMKind = Literal["text", "multimodal", "image", "video", "audio"]

class LLMConfigBase(BaseModel):
    name: str
    kind: LLMKind = "text"
    base_url: str = ""
    model_name: str = ""
    is_active: bool = True


class LLMConfigCreate(LLMConfigBase):
    api_key: str = ""


class LLMConfigUpdate(BaseModel):
    name: Optional[str] = None
    kind: Optional[LLMKind] = None
    api_key: Optional[str] = None  # 留空/None 表示不修改
    base_url: Optional[str] = None
    model_name: Optional[str] = None
    is_active: Optional[bool] = None


class LLMConfigOut(BaseModel):
    id: int
    name: str
    kind: str
    base_url: str
    model_name: str
    is_active: bool
    has_api_key: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# PromptTemplate（提示词模板）
# ---------------------------------------------------------------------------

class PromptTemplateBase(BaseModel):
    name: str
    module: str = "bookplate"
    stage: str = "stage2"
    content: str = ""
    is_active: bool = True


class PromptTemplateCreate(PromptTemplateBase):
    pass


class PromptTemplateUpdate(BaseModel):
    name: Optional[str] = None
    module: Optional[str] = None
    stage: Optional[str] = None
    content: Optional[str] = None
    is_active: Optional[bool] = None


class PromptTemplateOut(BaseModel):
    id: int
    # 系统种子身份标识（仅启动写入时使用，创建/编辑接口不涉及，只读回传）
    key: Optional[str] = None
    name: str
    module: str
    stage: str
    content: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# FastClawAgentConfig（FastClaw Agent 接入配置）
# ---------------------------------------------------------------------------

class FastClawAgentConfigBase(BaseModel):
    name: str
    base_url: str = ""
    agent_id: str = ""
    is_active: bool = True


class FastClawAgentConfigCreate(FastClawAgentConfigBase):
    api_key: str = ""


class FastClawAgentConfigUpdate(BaseModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None  # 留空/None 表示不修改
    agent_id: Optional[str] = None
    is_active: Optional[bool] = None


class FastClawAgentConfigOut(BaseModel):
    id: int
    name: str
    base_url: str
    agent_id: str
    is_active: bool
    has_api_key: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# StageConfig（阶段绑定）
# ---------------------------------------------------------------------------

class StageConfigCreate(BaseModel):
    module: str = "bookplate"
    stage: str
    # 模式互斥：agent_config_id 与 llm_config_id / prompt_id 只能选择一组
    llm_config_id: Optional[int] = None
    prompt_id: Optional[int] = None
    agent_config_id: Optional[int] = None


class StageConfigUpdate(BaseModel):
    module: Optional[str] = None
    stage: Optional[str] = None
    llm_config_id: Optional[int] = None
    prompt_id: Optional[int] = None
    agent_config_id: Optional[int] = None


class StageConfigOut(BaseModel):
    id: int
    module: str
    stage: str
    llm_config_id: Optional[int] = None
    prompt_id: Optional[int] = None
    agent_config_id: Optional[int] = None
    llm_config_name: Optional[str] = None
    prompt_name: Optional[str] = None
    agent_config_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# AppSetting（通用键值设置）
# ---------------------------------------------------------------------------

class AppSettingCreate(BaseModel):
    key: str
    value: str = ""
    description: str = ""


class AppSettingUpdate(BaseModel):
    value: Optional[str] = None
    description: Optional[str] = None


class AppSettingOut(BaseModel):
    id: int
    key: str
    value: str
    description: str
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
