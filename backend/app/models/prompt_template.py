from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from app.core.timeutils import get_current_time
from app.core.database import Base


class PromptTemplate(Base):
    """提示词模板表。

    - key: 系统种子身份标识（如 bookplate.stage2.default），用户创建/编辑不涉及；
          可空，启动时按固定 key 判重，避免因 name 可编辑导致重复写入
    - module: 模块标识（bookplate 等），与 Generation.module 同维度
    - stage: 阶段标识（stage2 / stage3 等）
    - content: 模板正文（作为 LLM 的 system prompt）
    """
    __tablename__ = "prompt_templates"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, nullable=True, index=True, unique=True)
    name = Column(String, nullable=False)
    module = Column(String, default="bookplate", nullable=False, index=True)
    stage = Column(String, default="stage2", nullable=False, index=True)
    content = Column(Text, default="", nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=get_current_time)
    updated_at = Column(DateTime, default=get_current_time, onupdate=get_current_time)
