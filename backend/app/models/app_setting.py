from sqlalchemy import Column, Integer, String, DateTime
from app.core.timeutils import get_current_time
from app.core.database import Base


class AppSetting(Base):
    """通用键值设置表（豆瓣代理、速率等平台级配置）。

    - key 唯一；value 以字符串存储（结构化值用 JSON 字符串）
    """
    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, index=True, nullable=False)
    value = Column(String, default="", nullable=False)
    description = Column(String, default="", nullable=False)
    updated_at = Column(DateTime, default=get_current_time, onupdate=get_current_time)
