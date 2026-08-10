from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.core.deps import get_current_admin_user, get_current_active_user
from app.models.user import User
from app.schemas.user import UserCreate, UserOut, UserUpdate
from app.core.security import get_password_hash

router = APIRouter()

@router.get("/me", response_model=UserOut)
def read_users_me(current_user: User = Depends(get_current_active_user)):
    """获取当前用户信息"""
    return current_user

@router.get("", response_model=List[UserOut])
def read_users(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: User = Depends(get_current_admin_user)):
    """用户列表（管理员）"""
    users = db.query(User).offset(skip).limit(limit).all()
    return users

@router.post("", response_model=UserOut)
def create_user(user_in: UserCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_admin_user)):
    """创建用户（管理员）"""
    user = db.query(User).filter(User.username == user_in.username).first()
    if user:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    hashed_password = get_password_hash(user_in.password)
    db_user = User(
        username=user_in.username,
        password_hash=hashed_password,
        role=user_in.role,
        is_active=user_in.is_active
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, user_in: UserUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_admin_user)):
    """修改用户（管理员）"""
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    update_data = user_in.model_dump(exclude_unset=True)
    if "password" in update_data:
        hashed_password = get_password_hash(update_data["password"])
        del update_data["password"]
        update_data["password_hash"] = hashed_password
        
    for key, value in update_data.items():
        setattr(db_user, key, value)
        
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@router.delete("/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_admin_user)):
    """删除用户（管理员）"""
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    db.delete(db_user)
    db.commit()
    return {"message": "User deleted successfully"}
