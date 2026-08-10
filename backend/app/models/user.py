from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.orm import relationship
from app.core.timeutils import get_current_time
from app.core.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="user", nullable=False) # admin or user
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=get_current_time)
    updated_at = Column(DateTime, default=get_current_time, onupdate=get_current_time)

    generations = relationship("Generation", back_populates="user", cascade="all, delete-orphan")
