from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from app.core.timeutils import get_current_time
from app.core.database import Base


class Generation(Base):
    """一次素材生成的完整记录（历史列表的数据来源）。

    - module: 模块标识（bookplate 等），是多模块扩展的核心维度
    - name: 从元数据中自动提取的题名，供关键词检索使用
    - stage_results: 各阶段中间结果的 JSON 存储，不同模块阶段数/结构不同
    - final_image_url: 最终产物图片
    """
    __tablename__ = "generations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    module = Column(String, default="bookplate", nullable=False, index=True)
    name = Column(String, default="", nullable=False, index=True)
    stage_results = Column(JSON, default=dict)
    final_image_url = Column(String, default="")
    status = Column(String, default="completed")
    created_at = Column(DateTime, default=get_current_time)

    user = relationship("User", back_populates="generations")
    favorites = relationship(
        "Favorite", back_populates="generation", cascade="all, delete-orphan"
    )
    public_share = relationship(
        "PublicShare", back_populates="generation", cascade="all, delete-orphan",
        uselist=False,
    )
