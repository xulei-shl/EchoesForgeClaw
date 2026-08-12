from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.timeutils import get_current_time
from app.core.database import Base


class NodeConfig(Base):
    """节点配置表：节点模板（node_type）的一个具体可执行实例。

    - 同一 node_type 允许多条配置，每条配置 = 画板「+」菜单中的一个节点变体
    - 模式互斥：agent_config_id 与 llm_config_id / prompt_id 只能选择一组（由 API 层校验）
    - 全部为空：提示词 / 大模型模式回退到环境变量 / 默认提示词
    - is_active=False 的配置不会出现在画板的可用节点列表中
    - group: 可选自定义分组（画板「+」菜单分组展示）；空则按模板类型分组
    - group_order: 自定义分组的排序序号（同组共享；0 表示未排序，按首见顺序回退）
    """

    __tablename__ = "node_configs"

    id = Column(Integer, primary_key=True, index=True)
    node_type = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    group = Column(String, nullable=True)
    group_order = Column(Integer, default=0, nullable=False)
    llm_config_id = Column(Integer, ForeignKey("llm_configs.id"), nullable=True)
    prompt_id = Column(Integer, ForeignKey("prompt_templates.id"), nullable=True)
    agent_config_id = Column(Integer, ForeignKey("fastclaw_agent_configs.id"), nullable=True)
    skill_agent_config_id = Column(Integer, ForeignKey("skill_agent_configs.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=get_current_time)
    updated_at = Column(DateTime, default=get_current_time, onupdate=get_current_time)

    llm_config = relationship("LLMConfig")
    prompt = relationship("PromptTemplate")
    agent_config = relationship("FastClawAgentConfig")
    skill_agent_config = relationship("SkillAgentConfig")
