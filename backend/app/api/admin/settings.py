from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.core.deps import get_current_admin_user
from app.models.user import User
from app.models.app_setting import AppSetting
from app.schemas.admin import AppSettingCreate, AppSettingUpdate, AppSettingOut

router = APIRouter(prefix="/admin/settings", tags=["admin-settings"])


@router.get("", response_model=List[AppSettingOut])
def list_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """全部系统设置。"""
    return db.query(AppSetting).order_by(AppSetting.id.asc()).all()


@router.post("", response_model=AppSettingOut)
def create_setting(
    payload: AppSettingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """新建系统设置（key 重复则覆盖）。"""
    item = db.query(AppSetting).filter(AppSetting.key == payload.key).first()
    if item:
        item.value = payload.value
        item.description = payload.description
    else:
        item = AppSetting(**payload.model_dump())
        db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/{key}", response_model=AppSettingOut)
def update_setting(
    key: str,
    payload: AppSettingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """修改系统设置（按 key）。"""
    item = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not item:
        raise HTTPException(status_code=404, detail="设置项不存在")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{key}")
def delete_setting(
    key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """删除系统设置。"""
    item = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not item:
        raise HTTPException(status_code=404, detail="设置项不存在")
    db.delete(item)
    db.commit()
    return {"message": "设置项已删除"}
