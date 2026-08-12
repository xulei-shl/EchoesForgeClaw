from sqlalchemy import Column, String, DateTime
from app.core.timeutils import get_current_time
from app.core.database import Base


class PromptMetadata(Base):
    """Bifrost 提示词预览图元数据表（本地扩展，Bifrost 官方无图片字段）。

    - prompt_id: Bifrost 的 prompt.id（主键，一一对应）
    - preview_image: 本地预览图访问路径（如 /static/prompt-previews/xxx.jpg）
    """

    __tablename__ = "prompt_metadata"

    prompt_id = Column(String(64), primary_key=True)
    preview_image = Column(String(512), default="", nullable=False)
    created_at = Column(DateTime, default=get_current_time)
    updated_at = Column(DateTime, default=get_current_time, onupdate=get_current_time)
