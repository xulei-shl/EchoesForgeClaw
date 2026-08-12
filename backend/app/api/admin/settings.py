from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.core.deps import get_current_admin_user
from app.models.user import User
from app.models.app_setting import AppSetting
from app.schemas.admin import AppSettingCreate, AppSettingUpdate, AppSettingOut

router = APIRouter(prefix="/admin/settings", tags=["admin-settings"])

# 敏感设置键：值永不回传明文（如 Bifrost 管理密码 / API Key）。
# 判定规则取键名中的 api_key / secret / password 片段，命中即以掩码回传、留空保存不修改。
_SENSITIVE_MARKERS = ("api_key", "secret", "password")


def _is_sensitive(key: str) -> bool:
    lowered = key.lower()
    return any(marker in lowered for marker in _SENSITIVE_MARKERS)


def _to_out(item: AppSetting) -> AppSettingOut:
    """序列化设置项：敏感键且已配置时值替换为掩码，明文永不回传。"""
    sensitive = _is_sensitive(item.key)
    value = item.value
    if sensitive and value:
        value = "********"
    return AppSettingOut(
        id=item.id,
        key=item.key,
        value=value,
        description=item.description,
        updated_at=item.updated_at,
        sensitive=sensitive,
    )


@router.get("", response_model=List[AppSettingOut])
def list_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """全部系统设置（敏感键返回掩码）。"""
    items = db.query(AppSetting).order_by(AppSetting.id.asc()).all()
    return [_to_out(item) for item in items]


@router.post("", response_model=AppSettingOut)
def create_setting(
    payload: AppSettingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """新建系统设置（key 重复则覆盖）。敏感键不允许写入掩码字面量。"""
    if _is_sensitive(payload.key) and payload.value == "********":
        payload.value = ""
    item = db.query(AppSetting).filter(AppSetting.key == payload.key).first()
    if item:
        item.value = payload.value
        item.description = payload.description
    else:
        item = AppSetting(**payload.model_dump())
        db.add(item)
    db.commit()
    db.refresh(item)
    return _to_out(item)


@router.put("/{key}", response_model=AppSettingOut)
def update_setting(
    key: str,
    payload: AppSettingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """修改系统设置（按 key）。敏感键留空 / 掩码保存时不修改密钥。"""
    item = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not item:
        raise HTTPException(status_code=404, detail="设置项不存在")
    data = payload.model_dump(exclude_unset=True)
    if _is_sensitive(key):
        # 敏感键：空串 / "********" 视为「不修改密钥」，保留原值
        if not data.get("value") or data.get("value") == "********":
            data.pop("value", None)
    for k, v in data.items():
        setattr(item, k, v)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _to_out(item)


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
