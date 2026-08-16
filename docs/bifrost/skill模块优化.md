# 目标

修复 SkillSearchNode 节点选择 skill 响应慢的问题，并提供手动集中管理、更新已下载 Bifrost skill 的能力。

## 问题分析

当前在 `SkillSearchNode` 弹窗中点击安装 skill 时，由于直接无条件调用 `download_bifrost_skill_zip` 从 Bifrost API 下载完整的 zip 压缩包，导致每次点击选择（即便本地已经下载过）都会产生显著的网络延迟，响应非常慢。此外，现有机制也没有途径去专门管理和触发这些真实 skill 包的更新。

## 解决方案

总体思路是**按需下载 + 集中管理更新**：画布安装节点在安装前先检查缓存（共享区）是否已存在，已存在则直接软链（毫秒级）；而全量下载和版本更新则交由 Admin 端的专用管理页面进行手动操作。

### 1. 改造画布端安装逻辑（按需下载）

- **后端改动 (`backend/app/modules/bookplate/router.py`)**：修改 `install_bifrost_skill` 接口。在调用 `download_bifrost_skill_zip` 之前，先检查共享真实包目录 `runtime/.agent/skills/{name}` 是否存在。
- **后端改动 (`backend/app/services/skill_agent_service.py`)**：新增 `register_existing_bifrost_skill(user_id, name)` 方法。如果本地已经有了这个共享包，就跳过网络下载，直接在 `runtime/{user_id}/skills/{name}` 建立软链即可。这将使“二次选择/多画布复用”变为毫秒级操作。

### 2. 新增 Admin 端的 Skill 管理页面

- **后端 API (`backend/app/api/admin/bifrost_skills.py` 暂定)**：
  - `GET /api/admin/bifrost-skills`：扫描 `runtime/.agent/skills/` 目录，读取各 skill 的 `SKILL.md` 元数据，返回本地已缓存的 Bifrost Skills 列表。
  - `POST /api/admin/bifrost-skills/{name}/sync`：强制调用 `download_bifrost_skill_zip` 从 Bifrost 获取最新的 zip 包，清空本地对应目录并重新解压覆盖。
  - `DELETE /api/admin/bifrost-skills/{name}`：从共享区彻底删除该 skill 包。
- **前端页面 (`frontend/src/admin/pages/BifrostSkillsPage.tsx`)**：
  - 增加一个「Bifrost Skills」管理页面，列表展示当前服务器上缓存的所有 Bifrost Skills（名称、版本、描述等）。
  - 提供单行或批量的「同步最新 (Sync)」按钮，允许管理员主动从 Bifrost 拉取最新版本覆盖本地。
  - 提供删除功能。
- **前端路由与导航**：
  - 在 `frontend/src/app/App.tsx` 中注册新的 Admin 路由 `/admin/bifrost-skills`。
  - 在 `frontend/src/admin/AdminLayout.tsx` 的侧边栏添加导航入口。

## User Review Required

> [!IMPORTANT]
> **设计确认点：**
>
> 1. 画布上（用户侧）若首次点击一个以前从未下载过的 skill，系统依然会自动阻塞下载一次。如果觉得此时也慢，通常只能接受（毕竟是真没下载过）。
> 2. 管理员在 admin 页面点击「同步最新」时，会覆盖所有工作区的基座代码（因为是软链共享）。因此下一次 chat 节点运行时就会直接用到最新的 skill 逻辑。
> 3. 目前并没有实现后台自动定时轮询比对更新的功能（避免过多心跳干扰），纯依赖管理员感知到“有新版本了”再通过后台点一次「同步最新」，这是否符合您的期望？

## 验证计划

- **手动验证**：
  - 在 Bookplate 画布中，搜索同一个已经下载过的 Bifrost skill 并点击「安装」，应该瞬间完成、不再看到长达数秒的 loading。
  - 前端管理员登录后，在 Admin 侧边栏能看到并进入 Bifrost Skills 页面，成功列出现有本地 skill。
  - 点击「同步最新」按钮，接口返回正常，后端完成覆盖下载（通过观察控制台或文件修改时间验证）。
  - 删除本地 skill，可以在画布再次触发全新下载。