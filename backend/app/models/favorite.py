from sqlalchemy import Column, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.core.timeutils import get_current_time
from app.core.database import Base


class Favorite(Base):
    """用户对某条生成记录的收藏（同一用户对同一记录只能收藏一次）。"""
    __tablename__ = "favorites"
    __table_args__ = (
        UniqueConstraint("user_id", "generation_id", name="uq_favorite_user_generation"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    generation_id = Column(Integer, ForeignKey("generations.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=get_current_time)

    generation = relationship("Generation", back_populates="favorites")
