"""运行时工作区（runtime/ 软链装配）契约测试。

覆盖 plans/runtime-symlink-workspace.md 的核心语义：
- Bifrost 检索安装 -> 共享真实包 runtime/.agent/skills/{name} + 用户登记软链；
  用户上传安装 -> 私有真实目录 runtime/{user_id}/skills/{name}（非软链）；
- prepare_runtime_workspace：节点工作区 .agents/skills/ 下 Bifrost skill 软链（或复制兜底）、
  上传 skill 真实复制，二者共存；AGENTS.md 仅当配置了提示词才存在（软链 -> 共享物化文件）；
- write_agent_md：非空写入 / 清空删除（「未配置提示词则没有」语义）；
- resolve_skill_abs：软链穿透到共享/登记区放行，../ 越界仍拒绝；
- Windows 无 symlink 权限时软链创建退化为真实复制（功能等价）；
- 跨用户列表隔离：用户 A 安装的 skill 不出现在用户 B 的已安装列表。

运行：cd backend && PYTHONPATH=. .venv/bin/python tests/test_runtime_symlink.py
"""
import io
import os
import shutil
import zipfile

from app.services.skill_agent_service import (
    RUNTIME_ROOT,
    REAL_AGENTS_ROOT,
    REAL_SKILLS_ROOT,
    SkillRuntimeConfig,
    _build_instructions,
    _symlink_or_copy,
    install_skill_zip,
    install_user_skill_zip,
    list_installed_skills,
    prepare_runtime_workspace,
    read_skill_meta,
    resolve_skill_abs,
    user_skills_root,
    write_agent_md,
)

USER_A = 90001
USER_B = 90002
AGENT = 424242


def make_zip(name, desc, extra_files=None):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(f"{name}/SKILL.md", f"---\nname: {name}\ndescription: {desc}\n---\n\nbody-{name}")
        for f, content in (extra_files or {}).items():
            z.writestr(f"{name}/{f}", content)
    return buf.getvalue()


def cleanup():
    shutil.rmtree(RUNTIME_ROOT / str(USER_A), ignore_errors=True)
    shutil.rmtree(RUNTIME_ROOT / str(USER_B), ignore_errors=True)
    shutil.rmtree(REAL_SKILLS_ROOT / "bifrost-demo", ignore_errors=True)
    shutil.rmtree(REAL_AGENTS_ROOT / str(AGENT), ignore_errors=True)


def main():
    cleanup()
    failures = []

    def check(name, cond, detail=""):
        tag = "OK " if cond else "FAIL"
        print(f"{tag} {name} {detail}")
        if not cond:
            failures.append(name)

    # 1) Bifrost 检索安装：共享真实包 + 用户登记软链（无权限时退化为复制，均需可读）
    install_skill_zip(USER_A, make_zip("bifrost-demo", "共享 skill", {"data.txt": "shared\n"}))
    real = REAL_SKILLS_ROOT / "bifrost-demo"
    reg_a = user_skills_root(USER_A) / "bifrost-demo"
    check("bifrost 真实包在共享区", (real / "SKILL.md").is_file())
    check("bifrost 登记可读 SKILL.md", (reg_a / "SKILL.md").is_file())
    check("bifrost 登记为软链或复制", reg_a.is_symlink() or (reg_a / "data.txt").is_file())

    # 2) 用户上传安装：私有真实目录（非软链）
    install_user_skill_zip(USER_A, make_zip("upload-demo", "私有 skill", {"data.txt": "private\n"}))
    reg_u = user_skills_root(USER_A) / "upload-demo"
    check("上传登记为真实目录（非软链）", (reg_u / "SKILL.md").is_file() and not reg_u.is_symlink())

    # 3) 跨用户列表隔离
    a_names = [s["name"] for s in list_installed_skills(USER_A)]
    b_names = [s["name"] for s in list_installed_skills(USER_B)]
    check("用户 A 列表含已装 skill", "bifrost-demo" in a_names and "upload-demo" in a_names, f"-> {a_names}")
    check("用户 B 列表不含用户 A 的 skill", len(b_names) == 0, f"-> {b_names}")

    # 4) AGENTS.md 条件存在：写提示词 -> 物化；清空 -> 删除
    md = write_agent_md(AGENT, "你是藏书票专家")
    md_real = REAL_AGENTS_ROOT / str(AGENT) / "AGENTS.md"
    check("AGENTS.md 物化", md is not None and md_real.is_file())
    write_agent_md(AGENT, "")
    check("AGENTS.md 清空即删除", not md_real.exists())
    write_agent_md(AGENT, "你是藏书票专家")
    check("AGENTS.md 重新写入", md_real.is_file())

    # 5) 工作区装配：Bifrost 软链 + 上传真实复制共存；AGENTS.md 软链存在
    ws = prepare_runtime_workspace(USER_A, "ws_1_123", AGENT, ["bifrost-demo", "upload-demo"])
    ws_skills = ws / ".agents" / "skills"
    ws_b = ws_skills / "bifrost-demo"
    ws_u = ws_skills / "upload-demo"
    check("工作区含两个 skill", ws_b.exists() and ws_u.exists())
    check("工作区 Bifrost skill 可读", (ws_b / "SKILL.md").is_file())
    check("工作区上传 skill 为真实复制", not ws_u.is_symlink() and (ws_u / "SKILL.md").is_file())
    check("工作区 AGENTS.md 存在", (ws / "AGENTS.md").is_file())

    # 6) resolve_skill_abs：软链穿透放行 + 越界拒绝
    ok = resolve_skill_abs(USER_A, ".agents/skills/bifrost-demo/SKILL.md", workspace=ws)
    check("resolve 放行软链 skill 文件", ok is not None and ok.is_file())
    ok2 = resolve_skill_abs(USER_A, ".agents/skills/upload-demo/SKILL.md", workspace=ws)
    check("resolve 放行上传 skill 文件", ok2 is not None and ok2.is_file())
    bad = resolve_skill_abs(USER_A, "../../../../etc/passwd", workspace=ws)
    check("resolve 拒绝 ../ 越界", bad is None)
    bad2 = resolve_skill_abs(USER_A, ".agents/skills/../../../etc/passwd", workspace=ws)
    check("resolve 拒绝嵌套穿越", bad2 is None)
    # 回归防护：禁止通过任意 ../ 直达共享 AGENTS.md / 共享 skill（跨用户读取泄漏）
    bad3 = resolve_skill_abs(USER_A, "../../../.agent/agents/424242/AGENTS.md", workspace=ws)
    check("resolve 拒绝直达共享 AGENTS.md", bad3 is None)
    bad4 = resolve_skill_abs(USER_A, "../../../.agent/skills/bifrost-demo/SKILL.md", workspace=ws)
    check("resolve 拒绝直达共享 skill", bad4 is None)

    # 7) Windows 复制兜底：软链创建失败退化为真实复制（功能等价）。
    #    测试产物放在独立 fallback 区域，避免污染 USER_B 的「已安装 skill」登记目录
    fallback_area = RUNTIME_ROOT / "fallback_area"
    shutil.rmtree(fallback_area, ignore_errors=True)
    real_symlink = os.symlink
    try:
        os.symlink = lambda *a, **k: (_ for _ in ()).throw(OSError("no privilege"))
        link = fallback_area / "fallback-demo"
        _symlink_or_copy(REAL_SKILLS_ROOT / "bifrost-demo", link)
        check("复制兜底目录可读", (link / "SKILL.md").is_file() and not link.is_symlink())
        file_link = fallback_area / "file-link.txt"
        _symlink_or_copy(REAL_SKILLS_ROOT / "bifrost-demo" / "SKILL.md", file_link)
        check("复制兜底文件可读", file_link.is_file() and not file_link.is_symlink())
    finally:
        os.symlink = real_symlink
        shutil.rmtree(fallback_area, ignore_errors=True)

    # 8) 指令构造：AGENTS.md 系统提示词段 + 位置 .agents/skills/{name}（不依赖 SDK）
    cfg = SkillRuntimeConfig(user_id=USER_A, agent_id=AGENT)
    instr = _build_instructions(cfg, USER_A, ["bifrost-demo", "upload-demo"], workspace=ws)
    check("指令含系统提示词", "你是藏书票专家" in instr)
    check("指令含 skill 段", "## Skill: bifrost-demo" in instr and "## Skill: upload-demo" in instr)
    check("指令位置为 .agents/skills", "位置：.agents/skills/bifrost-demo" in instr)

    # 9) 无 AGENTS.md 且无 skill：不产生系统提示词段（用 USER_B：无已装 skill）
    ws2 = prepare_runtime_workspace(USER_B, "ws_2_456", 0, [])
    cfg_b = SkillRuntimeConfig(user_id=USER_B, agent_id=0)
    instr2 = _build_instructions(cfg_b, USER_B, [], workspace=ws2)
    check("无提示词/无 skill 时指令精简", "你是藏书票专家" not in instr2 and "## Skill:" not in instr2)

    # 10) 同名重装：Bifrost 重装 = 更新共享包，用户登记仍有效
    install_skill_zip(USER_A, make_zip("bifrost-demo", "共享 skill v2"))
    check("重装后共享包更新且登记可读", "body-bifrost-demo" in read_skill_meta(reg_a)["body"])

    cleanup()
    print("\n=== RESULT:", "ALL PASS" if not failures else f"{len(failures)} FAILURES: {failures} ===")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
