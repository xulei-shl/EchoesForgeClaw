"""存量迁移脚本（一次性）：旧 skill 工作区 -> runtime/（按用户私有处理）+ AGENTS.md 物化。

背景：v2 运行时工作区方案（plans/runtime-symlink-workspace.md）把真实文档集中到仓库根
runtime/（整目录 gitignore）。本脚本只把旧位置当来源，不触碰其它数据：

1. skill 迁移：遍历旧 backend/workspaces/skills/{uid}/skills/*（旧解压目录），
   统一移入 runtime/{uid}/skills/（按「用户私有」处理，保守不污染共享区），随后删除旧目录；
2. AGENTS.md 物化：遍历已有 SkillAgentConfig，按「最终生效提示词内容」规则写/删
   runtime/.agent/agents/{agent_id}/AGENTS.md（与 admin 保存配置时的逻辑一致）。

幂等：目标已存在时跳过；可重复运行。运行方式（仓库根）：
    PYTHONPATH=backend python scripts/migrate_runtime_workspace.py
"""
import shutil
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

from app.core.database import SessionLocal  # noqa: E402
from app.models.skill_agent_config import SkillAgentConfig  # noqa: E402
from app.services.skill_agent_service import (  # noqa: E402
    REPO_ROOT,
    user_skills_root,
    write_agent_md,
)


def _effective_prompt_content(cfg: SkillAgentConfig) -> str:
    """最终生效的提示词内容（与 admin skill_agent_configs 的口径一致）。"""
    if cfg.prompt and cfg.prompt.is_active:
        return cfg.prompt.content or ""
    return cfg.system_prompt or ""


def migrate_skills() -> int:
    """旧 backend/workspaces/skills/{uid}/skills/* -> runtime/{uid}/skills/（用户私有）。"""
    old_root = REPO_ROOT / "backend" / "workspaces" / "skills"
    if not old_root.is_dir():
        print("无旧工作区数据（backend/workspaces/skills 不存在），跳过 skill 迁移。")
        return 0
    moved = 0
    for uid_dir in sorted(old_root.iterdir()):
        if not uid_dir.is_dir():
            continue
        old_skills = uid_dir / "skills"
        if not old_skills.is_dir():
            continue
        try:
            uid = int(uid_dir.name)
        except ValueError:
            continue
        for skill_dir in sorted(old_skills.iterdir()):
            if not skill_dir.is_dir() or not (skill_dir / "SKILL.md").is_file():
                continue
            dest = user_skills_root(uid) / skill_dir.name
            if dest.exists():
                print(f"跳过（目标已存在）：{uid}/{skill_dir.name}")
                continue
            shutil.move(str(skill_dir), str(dest))
            moved += 1
            print(f"迁移：{uid}/skills/{skill_dir.name} -> runtime/{uid}/skills/")
    # 旧目录整体删除（其中已无有效 skill）
    shutil.rmtree(old_root, ignore_errors=True)
    print(f"skill 迁移完成：共 {moved} 个，旧目录 backend/workspaces/ 已删除。")
    return moved


def migrate_agent_mds() -> int:
    """遍历已有 SkillAgentConfig，按规则物化 / 删除 AGENTS.md。"""
    db = SessionLocal()
    try:
        configs = db.query(SkillAgentConfig).all()
        for cfg in configs:
            path = write_agent_md(cfg.id, _effective_prompt_content(cfg))
            print(f"AGENTS.md {'写入' if path else '删除/无'}: agent_id={cfg.id}")
        return len(configs)
    finally:
        db.close()


def main() -> int:
    print("=== Skill Agent 运行时工作区迁移 ===")
    migrate_skills()
    try:
        n = migrate_agent_mds()
        print(f"AGENTS.md 同步完成：共检查 {n} 个 SkillAgentConfig。")
    except Exception as exc:  # DB 不可用时（未初始化等）不阻塞 skill 迁移
        print(f"警告：AGENTS.md 同步失败（{exc}），可稍后重跑本脚本。")
    print("=== 完成 ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
