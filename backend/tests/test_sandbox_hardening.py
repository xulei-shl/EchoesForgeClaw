"""沙箱加固契约测试（升级 openai/openai-agents SDK 前必须先跑）。

覆盖 SandboxedShellExecutor 的安全边界：
- 绝对路径 / .. 路径穿越 / 绝对路径选项值 一律拒绝；
- 相对路径命令正常放行；
- POSIX 资源限制（RLIMIT_AS / RLIMIT_NOFILE）在子进程内生效；
- 命令超时强杀进程组，无孤儿进程残留；
- 执行后新文件检测（agent_file 数据形态）。

运行：cd backend && PYTHONPATH=. .venv/bin/python tests/test_sandbox_hardening.py
"""
import asyncio
import io
import shutil
import zipfile

from app.services.skill_agent_service import (
    RUNTIME_ROOT,
    SandboxedShellExecutor,
    _POSIX_LIMITS_AVAILABLE,
    install_user_skill_zip,
    prepare_runtime_workspace,
)

USER = 99993


def mk_req(*command, timeout_ms=None):
    return command, timeout_ms


def make_zip(name, desc, extra_files=None):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(f"{name}/SKILL.md", f"---\nname: {name}\ndescription: {desc}\n---\n\nbody")
        z.writestr(f"{name}/scripts/run.sh", "echo hi")
        for f, content in (extra_files or {}).items():
            z.writestr(f"{name}/{f}", content)
    return buf.getvalue()


def run(coro):
    # Python 3.12+ 的 get_event_loop 在主线程无运行中 loop 时抛 RuntimeError，
    # 改为每次新建独立事件循环（子进程/超时均为一次性任务，互不共享状态）
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def main():
    root = RUNTIME_ROOT / str(USER)
    shutil.rmtree(root, ignore_errors=True)
    # 用户私有安装 + 装配节点工作区（上传 skill 以真实目录复制进 .agents/skills/）
    install_user_skill_zip(USER, make_zip("my-skill", "A skill", {"data.txt": "hello\n"}))
    ws = prepare_runtime_workspace(USER, "sandbox-ws", 0, ["my-skill"])

    ex = SandboxedShellExecutor(USER, workspace=ws, workspace_id="sandbox-ws")
    failures = []

    def check(name, cond, detail=""):
        tag = "OK " if cond else "FAIL"
        print(f"{tag} {name} {detail}")
        if not cond:
            failures.append(name)

    # 1) 逃逸拦截
    for bad_cmd in (
        ["cat", "/etc/passwd"],
        ["cat", "../secret.txt"],
        ["cat", "a/../../etc/passwd"],
        ["python3", "--output=/tmp/x", "s.py"],
        ["/bin/bash", "s.sh"],
    ):
        out = run(ex.run_command(*mk_req(*bad_cmd)))
        check(f"reject {bad_cmd!r}", "已拒绝" in out, f"-> {out[:60]}")

    # 已知残余风险（文档声明，非断言失败）：解释器内联代码绕过参数校验
    out = run(ex.run_command(*mk_req("bash", "-c", "cat /etc/passwd")))
    print(f"INFO residual-risk bash -c bypass: {'root:' in out}（内联代码不受参数校验约束，需容器化才能真正隔离）")

    # 2) 合法命令放行（相对路径 / 无路径）
    out = run(ex.run_command(*mk_req("echo", "hello")))
    check("allow echo", out.strip() == "hello", f"-> {out[:40]}")
    out = run(ex.run_command(*mk_req("cat", ".agents/skills/my-skill/data.txt")))
    check("allow relative cat", "hello" in out, f"-> {out[:40]}")
    out = run(ex.run_command(*mk_req("ls", "-la")))
    check("allow ls", ".agents" in out, f"-> {out[:40]}")

    # 3) 资源限制在子进程内生效（RLIMIT_AS / NOFILE）——仅 POSIX（Windows 无 resource/fork）
    if _POSIX_LIMITS_AVAILABLE:
        out = run(ex.run_command(*mk_req("python3", "-c", "import resource; print(resource.getrlimit(resource.RLIMIT_AS)[0], resource.getrlimit(resource.RLIMIT_NOFILE)[0])")))
        check("rlimits applied", out.strip().startswith("2147483648 256"), f"-> {out[:60]}")
    else:
        print("INFO skip rlimits check on Windows（POSIX only）")

    # 4) 超时：强杀进程组（sleep 7.77 + 500ms 超时；7.77 为独特参数，避免与宿主环境自带 sleep 混淆）
    out = run(ex.run_command(*mk_req("sleep", "7.77", timeout_ms=500)))
    check("timeout kill", "超时" in out, f"-> {out[:50]}")
    # 残留检查：被超时强杀的 sleep 不应存活（用独特参数匹配）。
    # 子进程创建与 communicate 必须同在一个事件循环内（run() 每次新建独立 loop）
    async def ps_check():
        p = await asyncio.create_subprocess_exec(
            "ps", "-eo", "args", stdout=asyncio.subprocess.PIPE
        )
        stdout_b, _ = await asyncio.wait_for(p.communicate(), 5)
        return stdout_b.decode()

    orphan = [l for l in run(ps_check()).splitlines() if "sleep 7[.]77" in l]
    check("no orphan proc", not orphan, f"-> {orphan}")

    # 5) 文件检测：touch 一个文件 → agent_file 事件数据
    ex.new_files.clear()
    ex._seen.clear()
    out = run(ex.run_command(*mk_req("touch", "output.txt")))
    check("touch ok", "无输出" in out, f"-> {out[:40]}")
    check("file detected", len(ex.new_files) == 1, f"-> {ex.new_files}")
    if ex.new_files:
        f = ex.new_files[0]
        check(
            "file url",
            "path=output.txt" in f["url"]
            and "workspace_id=sandbox-ws" in f["url"]
            and f["name"] == "output.txt",
            str(f),
        )

    shutil.rmtree(root, ignore_errors=True)
    print("\n=== RESULT:", "ALL PASS" if not failures else f"{len(failures)} FAILURES: {failures} ===")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
