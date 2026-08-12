from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from app.core.timeutils import get_current_time
from app.core.database import Base


class Generation(Base):
    """一次素材生成的完整记录（历史列表的数据来源）。

    - node_type: 产出该结果的节点模板类型（image_generation 等），
      统一画布下取代旧 module 维度；不同节点产出不同类型的结果数据
    - name: 从元数据中自动提取的题名，供关键词检索使用
    - stage_results: 各节点中间结果的 JSON 存储，不同节点结构不同
    - result_url: 最终产物地址（图片/音频/视频等 URL；文本类结果可为空）
    """
    __tablename__ = "generations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    node_type = Column(String, default="image_generation", nullable=False, index=True)
    name = Column(String, default="", nullable=False, index=True)
    stage_results = Column(JSON, default=dict)
    result_url = Column(String, default="")
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
