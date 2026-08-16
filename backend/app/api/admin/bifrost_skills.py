"""Admin 端 Bifrost Skills 管理接口。

职责与画布侧（app/modules/bookplate/router.py 的 skills/*）互补：
- 画布：按需下载安装（缓存命中则秒级软链登记）；
- 此处：集中管理共享区 runtime/.agent/skills/ 的真实 skill 包
  （列表 / 同步最新 / 删除），供管理员主动拉取版本更新。
"""
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_admin_user
from app.models.user import User
from app.services.bifrost_service import (
    BifrostError,
    bifrost_error_to_http,
    download_bifrost_skill_zip,
    search_bifrost_skills,
)
from app.services.skill_agent_service import (
    SkillValidationError,
    list_shared_bifrost_skills,
    remove_shared_bifrost_skill,
    update_shared_bifrost_skill,
)

router = APIRouter(prefix="/admin/bifrost-skills", tags=["admin-bifrost-skills"])


def _check_skill_name(name: str) -> str:
    """URL 路径参数卫生检查（服务层有同套校验，此处提前给出友好错误）。"""
    name = (name or "").strip()
    if not name or name in (".", "..") or "/" in name or "\\" in name:
        raise HTTPException(status_code=400, detail="非法 skill 名称")
    return name


@router.get("")
async def list_bifrost_skills(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """扫描共享区 runtime/.agent/skills/，返回本地已缓存的 Bifrost Skills 列表。

    本地为事实来源（离线可用）；若 Bifrost 可访问，再用检索接口（TTL 缓存）做
    最佳努力富化：附带 latest_version / license / compatibility，供管理员判断
    是否需要「同步最新」。Bifrost 不可达时仅返回本地信息，不影响页面使用。
    """
    skills = list_shared_bifrost_skills()
    try:
        remote = await search_bifrost_skills(db)
    except BifrostError:
        remote = []
    remote_map: Dict[str, Dict[str, Any]] = {
        s["name"]: s for s in remote if isinstance(s, dict) and s.get("name")
    }
    for s in skills:
        r = remote_map.get(s["name"])
        if r:
            s["latest_version"] = r.get("latest_version") or ""
            s["license"] = r.get("license") or ""
            s["compatibility"] = r.get("compatibility") or ""
            s["remote_updated_at"] = r.get("updated_at")
    return {"skills": skills}


@router.post("/{name}/sync")
async def sync_bifrost_skill(
    name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """强制从 Bifrost 拉取最新 zip，覆盖共享区对应 skill 包（不动用户登记）。

    用户登记为软链（POSIX）的部署：覆盖后下次节点运行即用最新版本；
    Windows 无软链权限（登记为复制副本）的部署：已登记用户保留旧副本，
    需重新安装该 skill 才更新。返回更新后的元数据。
    """
    skill_name = _check_skill_name(name)
    try:
        zip_bytes = await download_bifrost_skill_zip(db, skill_name)
    except BifrostError as exc:
        raise bifrost_error_to_http(exc)
    if not zip_bytes or len(zip_bytes) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="skill 压缩包为空或超过 20MB 上限")
    try:
        meta = update_shared_bifrost_skill(zip_bytes)
    except SkillValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # 防御性校验：Bifrost 按 name 分发 zip，zip 内 SKILL.md 的 name 应一致，
    # 否则会出现「同步的是 A、落盘的是 B」的困惑状态
    if meta.get("name") != skill_name:
        from app.services.skill_agent_service import REAL_SKILLS_ROOT

        target = REAL_SKILLS_ROOT / (meta.get("name") or "")
        if target.exists():
            import shutil

            shutil.rmtree(target, ignore_errors=True)
        raise HTTPException(
            status_code=400,
            detail=f"zip 内 SKILL.md 的 name（{meta.get('name')}）与请求的 skill 名称（{skill_name}）不一致，已中止",
        )
    return {"skill": meta}


@router.delete("/{name}")
async def delete_bifrost_skill(
    name: str,
    current_user: User = Depends(get_current_admin_user),
):
    """从共享区彻底删除该 skill 包，并清理指向它的用户登记软链。

    删除后画布再次安装该 skill 会重新触发网络下载（缓存未命中）。
    返回清理掉的用户登记软链条目数（用户上传的真实副本不受影响）。
    """
    skill_name = _check_skill_name(name)
    try:
        cleaned = remove_shared_bifrost_skill(skill_name)
    except SkillValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"message": f"已删除 skill：{skill_name}", "cleaned_registries": cleaned}
