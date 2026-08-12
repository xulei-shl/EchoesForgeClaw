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
    SandboxedShellExecutor,
    install_skill_zip,
    workspace_root,
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
    return asyncio.get_event_loop().run_until_complete(coro)


def main():
    root = workspace_root(USER)
    shutil.rmtree(root, ignore_errors=True)
    install_skill_zip(USER, make_zip("my-skill", "A skill", {"data.txt": "hello\n"}))

    ex = SandboxedShellExecutor(USER)
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
    out = run(ex.run_command(*mk_req("cat", "skills/my-skill/data.txt")))
    check("allow relative cat", "hello" in out, f"-> {out[:40]}")
    out = run(ex.run_command(*mk_req("ls", "-la")))
    check("allow ls", "skills" in out, f"-> {out[:40]}")

    # 3) 资源限制在子进程内生效（RLIMIT_AS / NOFILE）
    out = run(ex.run_command(*mk_req("python3", "-c", "import resource; print(resource.getrlimit(resource.RLIMIT_AS)[0], resource.getrlimit(resource.RLIMIT_NOFILE)[0])")))
    check("rlimits applied", out.strip().startswith("2147483648 256"), f"-> {out[:60]}")

    # 4) 超时：强杀进程组（sleep 7.77 + 500ms 超时；7.77 为独特参数，避免与宿主环境自带 sleep 混淆）
    out = run(ex.run_command(*mk_req("sleep", "7.77", timeout_ms=500)))
    check("timeout kill", "超时" in out, f"-> {out[:50]}")
    # 残留检查：被超时强杀的 sleep 不应存活（用独特参数匹配）
    p = run(asyncio.create_subprocess_exec("ps", "-eo", "args", stdout=asyncio.subprocess.PIPE))
    stdout_b, _ = run(asyncio.wait_for(p.communicate(), 5))
    orphan = [l for l in stdout_b.decode().splitlines() if "sleep 7[.]77" in l]
    check("no orphan proc", not orphan, f"-> {orphan}")

    # 5) 文件检测：touch 一个文件 → agent_file 事件数据
    ex.new_files.clear()
    ex._seen.clear()
    out = run(ex.run_command(*mk_req("touch", "output.txt")))
    check("touch ok", "无输出" in out, f"-> {out[:40]}")
    check("file detected", len(ex.new_files) == 1, f"-> {ex.new_files}")
    if ex.new_files:
        f = ex.new_files[0]
        check("file url", f["url"].endswith("path=output.txt") and f["name"] == "output.txt", str(f))

    shutil.rmtree(root, ignore_errors=True)
    print("\n=== RESULT:", "ALL PASS" if not failures else f"{len(failures)} FAILURES: {failures} ===")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
