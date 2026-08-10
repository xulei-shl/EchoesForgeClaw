from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.core.timeutils import get_current_time
from app.core.database import Base


class StageConfig(Base):
    """阶段配置表：每个模块的每个阶段绑定「提示词 + 大模型」或「Agent」两种模式之一。

    - 同一 (module, stage) 唯一，重复绑定自动覆盖
    - 模式互斥：agent_config_id 与 llm_config_id/prompt_id 只能选择一组（由 API 层校验）
    - 全部为空：提示词/大模型模式回退到环境变量 / 默认提示词
    """
    __tablename__ = "stage_configs"
    __table_args__ = (
        UniqueConstraint("module", "stage", name="uq_stage_config_module_stage"),
    )

    id = Column(Integer, primary_key=True, index=True)
    module = Column(String, default="bookplate", nullable=False, index=True)
    stage = Column(String, nullable=False, index=True)
    llm_config_id = Column(Integer, ForeignKey("llm_configs.id"), nullable=True)
    prompt_id = Column(Integer, ForeignKey("prompt_templates.id"), nullable=True)
    agent_config_id = Column(Integer, ForeignKey("fastclaw_agent_configs.id"), nullable=True)
    created_at = Column(DateTime, default=get_current_time)
    updated_at = Column(DateTime, default=get_current_time, onupdate=get_current_time)

    llm_config = relationship("LLMConfig")
    prompt = relationship("PromptTemplate")
    agent_config = relationship("FastClawAgentConfig")
