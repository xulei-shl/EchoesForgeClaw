#!/usr/bin/env python3
"""Bifrost Skills API 调用示例。

Management API 需要 Basic Auth（管理员账号密码），
Serving API 公开无需认证。

凭证（见 docs/bifrost/prompts-api/bitfrost后端管理密钥.md）：
    管理员账号：admin
    管理员密码：Yfzjlxy_0527
    Base URL  ：http://10.40.92.18:8080/
"""

import base64
import json
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = "http://10.40.92.18:8080"
ADMIN_USER = "admin"
ADMIN_PASS = "Yfzjlxy_0527"

# Basic Auth 头：base64("admin:password")
BASIC_AUTH = base64.b64encode(f"{ADMIN_USER}:{ADMIN_PASS}".encode()).decode()


def _request(method: str, url: str, auth: str | None = None,
             as_text: bool = True) -> tuple[int, object | bytes]:
    """发送 HTTP 请求，返回 (status_code, body)。"""
    headers = {}
    if auth:
        headers["Authorization"] = auth
    req = urllib.request.Request(url, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
            return resp.status, data.decode() if as_text else data
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        return e.code, body


def list_skills(limit: int = 50, search: str | None = None) -> dict:
    """1. 列出所有 Skill（Management API，需 Basic Auth）。"""
    url = f"{BASE_URL}/api/skills?limit={limit}"
    if search:
        url += f"&search={urllib.parse.quote(search)}"
    status, body = _request("GET", url, f"Basic {BASIC_AUTH}")
    if status != 200:
        raise RuntimeError(f"list_skills failed: {status} {body}")
    return json.loads(body)


def get_skill(skill_id: str, version: str | None = None) -> dict:
    """2. 查看单个 Skill 元数据 + 文件列表（Management API）。"""
    url = f"{BASE_URL}/api/skills/{skill_id}"
    if version:
        url += f"?version={version}"
    status, body = _request("GET", url, f"Basic {BASIC_AUTH}")
    if status != 200:
        raise RuntimeError(f"get_skill failed: {status} {body}")
    return json.loads(body)


def list_versions(skill_id: str) -> dict:
    """3. 查看 Skill 版本历史（Management API）。"""
    url = f"{BASE_URL}/api/skills/{skill_id}/versions"
    status, body = _request("GET", url, f"Basic {BASIC_AUTH}")
    if status != 200:
        raise RuntimeError(f"list_versions failed: {status} {body}")
    return json.loads(body)


def download_skill_zip(skill_name: str, dest: str) -> None:
    """4.1 完整下载某个 Skill 为 ZIP（Serving API，公开）。"""
    url = f"{BASE_URL}/api/skills/serve/{skill_name}/download.zip"
    status, body = _request("GET", url, as_text=False)
    if status != 200:
        raise RuntimeError(f"download_skill_zip failed: {status}")
    with open(dest, "wb") as f:
        f.write(body)
    print(f"已保存: {dest} ({len(body)} bytes)")


def download_all_zip(dest: str) -> None:
    """4.2 打包下载所有 Skill（Serving API，公开）。"""
    url = f"{BASE_URL}/api/skills/serve/all/download.zip"
    status, body = _request("GET", url, as_text=False)
    if status != 200:
        raise RuntimeError(f"download_all_zip failed: {status}")
    with open(dest, "wb") as f:
        f.write(body)
    print(f"已保存: {dest} ({len(body)} bytes)")


def download_file(skill_name: str, filepath: str, dest: str) -> None:
    """4.3 按路径下载单个文件（Serving API，公开）。"""
    url = f"{BASE_URL}/api/skills/serve/{skill_name}/files/{filepath}"
    status, body = _request("GET", url, as_text=False)
    if status != 200:
        raise RuntimeError(f"download_file failed: {status}")
    with open(dest, "wb") as f:
        f.write(body)
    print(f"已保存: {dest} ({len(body)} bytes)")


def main() -> None:
    # 1. 列出 skill
    listing = list_skills(limit=50)
    print(f"共 {listing.get('total')} 个 skill")
    for s in listing.get("skills", []):
        print(f"  - {s['name']} (id={s['id']}, 版本={s.get('latest_version')})")

    if not listing.get("skills"):
        print("没有可用的 skill，示例结束。")
        return

    skill = listing["skills"][0]
    skill_id = skill["id"]
    skill_name = skill["name"]

    # 2. 查看单个 skill 元数据 + 文件列表
    detail = get_skill(skill_id)
    files = detail.get("skill", {}).get("files", [])
    print(f"\n[{skill_name}] 文件数: {len(files)}")
    for f in files:
        print(f"    {f.get('path')} ({f.get('source_type')})")

    # 3. 版本历史
    versions = list_versions(skill_id)
    print(f"\n[{skill_name}] 版本历史: {[v.get('version') for v in versions.get('versions', [])]}")

    # 4.1 完整下载 ZIP（推荐，公开接口）
    download_skill_zip(skill_name, f"{skill_name}.zip")

    # 4.2 打包全部
    download_all_zip("all-skills.zip")

    # 4.3 下载第一个文本文件
    for f in files:
        if f.get("source_type") == "text" and f.get("path"):
            download_file(skill_name, f["path"], f"dl_{f['path'].replace('/', '_')}")
            break


if __name__ == "__main__":
    main()
