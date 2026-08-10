from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from app.core.timeutils import get_current_time
from app.core.database import Base


class PromptTemplate(Base):
    """提示词模板表。

    - key: 系统种子身份标识（如 bookplate.prompt_generation.default），用户创建/编辑不涉及；
          可空，启动时按固定 key 判重，避免因 name 可编辑导致重复写入
    - node_type: 所属节点模板类型（prompt_generation / image_analysis 等）
    - content: 模板正文（作为 LLM 的 system prompt）
    """

    __tablename__ = "prompt_templates"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, nullable=True, index=True, unique=True)
    name = Column(String, nullable=False)
    node_type = Column(String, default="prompt_generation", nullable=False, index=True)
    content = Column(Text, default="", nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=get_current_time)
    updated_at = Column(DateTime, default=get_current_time, onupdate=get_current_time)
