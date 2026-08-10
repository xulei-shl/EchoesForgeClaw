from sqlalchemy import Column, Integer, String, Boolean, DateTime
from app.core.timeutils import get_current_time
from app.core.database import Base


class LLMConfig(Base):
    """大模型配置（文本 / 多模态 / 图像 / 视频 / 音频，统一 OpenAI 兼容格式）。

    - kind: text（文本）/ multimodal（多模态）/ image（图像）/ video（视频）/ audio（音频）
    - api_key: 明文存储于数据库，对外响应一律只返回 has_api_key 布尔标记
    - base_url / model_name: OpenAI 兼容 API 的三要素
    """
    __tablename__ = "llm_configs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    kind = Column(String, default="text", nullable=False)  # text / multimodal / image / video / audio
    api_key = Column(String, default="", nullable=False)
    base_url = Column(String, default="", nullable=False)
    model_name = Column(String, default="", nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=get_current_time)
    updated_at = Column(DateTime, default=get_current_time, onupdate=get_current_time)
