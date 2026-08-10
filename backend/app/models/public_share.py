from sqlalchemy import Column, Integer, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.timeutils import get_current_time
from app.core.database import Base


class PublicShare(Base):
    """将某条生成记录公开到画廊（每条记录最多公开一次）。"""
    __tablename__ = "public_shares"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    generation_id = Column(Integer, ForeignKey("generations.id"), nullable=False, unique=True, index=True)
    created_at = Column(DateTime, default=get_current_time)

    generation = relationship("Generation", back_populates="public_share")
