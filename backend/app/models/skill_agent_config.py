from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.timeutils import get_current_time
from app.core.database import Base


class SkillAgentConfig(Base):
    """Skill Agent 配置（openai-agents-python 多步执行的接入参数）。

    与 NodeConfig 同构：模型接入参数（base_url / api_key / model_name）通过
    llm_config_id 引用「模型配置」，系统提示词通过 prompt_id 引用「提示词模板」，
    管理后台不再手填。旧字段 base_url / api_key / model_name / system_prompt
    仅作存量数据兼容回退（运行时在引用缺失时使用）。
    - 同一节点模板通过 NodeConfig.skill_agent_config_id 绑定，
      与「提示词+大模型」/「FastClaw Agent」模式互斥（API 层校验）
    """

    __tablename__ = "skill_agent_configs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    llm_config_id = Column(Integer, ForeignKey("llm_configs.id"), nullable=True)
    prompt_id = Column(Integer, ForeignKey("prompt_templates.id"), nullable=True)
    # 旧字段（兼容存量数据，新配置不再写入）
    base_url = Column(String, default="", nullable=False)
    api_key = Column(String, default="", nullable=False)
    model_name = Column(String, default="", nullable=False)
    system_prompt = Column(String, default="", nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=get_current_time)
    updated_at = Column(DateTime, default=get_current_time, onupdate=get_current_time)

    llm_config = relationship("LLMConfig")
    prompt = relationship("PromptTemplate")
