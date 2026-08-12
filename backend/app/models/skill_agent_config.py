from sqlalchemy import Column, Integer, String, Boolean, DateTime
from app.core.timeutils import get_current_time
from app.core.database import Base


class SkillAgentConfig(Base):
    """Skill Agent 配置（openai-agents-python 多步执行的接入参数）。

    - base_url / api_key / model_name: 任意 OpenAI 兼容端点（与 LLMConfig 一致）
    - system_prompt: 可选，作为 Agent 的 instructions 基础（skill 指令在运行时追加）
    - 同一节点模板通过 NodeConfig.skill_agent_config_id 绑定，
      与「提示词+大模型」/「FastClaw Agent」模式互斥（API 层校验）
    """

    __tablename__ = "skill_agent_configs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    base_url = Column(String, default="", nullable=False)
    api_key = Column(String, default="", nullable=False)
    model_name = Column(String, default="", nullable=False)
    system_prompt = Column(String, default="", nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=get_current_time)
    updated_at = Column(DateTime, default=get_current_time, onupdate=get_current_time)
