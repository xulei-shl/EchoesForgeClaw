# pi agent skill 加载路径修复（.agents/skills → .pi-agent/skills）

> 现象：skill_search 节点 Bifrost 检索的 skill 只登记在 `runtime/{uid}/skills/`，
> 未进入 `runtime/{uid}/workspace/{chatid}/.pi-agent/skills/`，pi agent 加载不到 skill。
>
> 根因（核对 pi 源码 @earendil-works/pi-coding-agent dist/core/package-manager.js
> `addAutoDiscoveredResources`）：pi 的 skill 自动发现只扫描——
> ① `{agentDir}/skills`（agentDir=PI_CODING_AGENT_DIR=ws/.pi-agent → **ws/.pi-agent/skills，无条件扫描**）；
> ② `cwd/.pi/skills` 与 `.agents/skills` 祖先链——**均需 projectTrusted**，
> headless json 模式无交互授信流程 → 被跳过。
> 当前 preparePiWorkspace 装配到 ws/.agents/skills/（需授信路径）→ pi 不加载。
>
> 修复：装配目标改为 `ws/.pi-agent/skills/{name}`（pi user-scope 技能目录，无需授信）。
> 两种来源语义不变（计划 plans/runtime-symlink-workspace.md）：Bifrost=软链共享区；上传 zip=真实复制。
> DIFF_EXCLUDED_PREFIXES 已含 `.pi-agent/`、resolveSkillAbs allowedRoots 已覆盖软链落点 → 下载/差分均无需改。

## 任务清单

- [x] 1. pi-agent-service.ts：skillsDir 改为 `.pi-agent/skills`，更新头注释与装配注释
- [x] 2. tests/api/pi-agent-workspace.test.ts：断言路径同步更新（空 skills 不建 .pi-agent/skills）
- [x] 3. tests/api/skills.test.ts：模拟装配路径同步为 .pi-agent/skills（下载放行回归）
- [x] 4. 验证：vitest run pi-agent-workspace + skills + pi-sse-wire；typecheck

## 验证记录

| 检查 | 结果 |
|---|---|
| `npx vitest run tests/api/pi-agent-workspace.test.ts tests/api/skills.test.ts tests/api/pi-sse-wire.test.ts` | ✅ 3 文件 27 用例全过 |
| 前端 `npm run lint` / `npx tsc -b` | ✅ EXIT=0 |

## 附带修复：chat 节点「上下文注入」不显示传入 skill

- 根因：skill_search 输出端口类型为 document（非 text/image），buildInjectedContextBlocks
  的父节点遍历只认 text/image 通道 → skill_search 永远不成块；skill 实际由 collectSkillNames
  单独收集随 /chat body 下发，仅 UI 缺展示。
- 修复：contextBlocks.ts 新增 includeSkills 选项 + skill_search 父节点独立成块
  （文本复用 nodeOutputText 的 selections 清单格式）；仅 ChatNodeHost 开启（图像/文本生成节点不传，
  因其后端不消费 skills）。

---

# Bifrost 提示词预览图持久化风险消除（迁移到 runtime/）

> 背景：打标备注存 `user_annotations` 表、预览图路径存 `prompt_metadata` 表均无问题；
> 唯一风险是预览图物理文件在 `backend-ts/static/prompt-previews/`（代码目录内），
> 若部署重建应用目录仅挂载 `runtime/` + db，文件丢失 → DB 悬空 URL 破图。
> 其他用户数据（covers / generated / map-posters）均已迁移到根目录 runtime/ 并由白名单路由服务。

## 方案

- 物理位置：`backend-ts/static/prompt-previews/` → 根目录 `runtime/prompt-previews/`
- URL 前缀不变（`/static/prompt-previews/*`）：DB 无需任何数据迁移
- 服务方式：fastify-static 通配 → server.ts 白名单精确路由（与 covers 同模式）
- 旧目录存量文件：启动时幂等搬迁（目标存在则跳过），升级无缝
- 自愈：列表/详情返回 preview_image 前校验文件存在，缺失则视为无预览图

## 任务清单

- [x] 1. bifrost-service.ts：PREVIEW_DIR 指向 RUNTIME_ROOT/prompt-previews；previewMap 加 existsSync 校验；新增 migrateLegacyPreviewFiles()；更新头注释
- [x] 2. server.ts：新增 /static/prompt-previews/:file 白名单路由；启动时调用迁移；更新注释
- [x] 3. 验证：typecheck + bifrost 相关测试（platform.test.ts 预览图上传/删除、annotations）
- [x] 4. 新增回归测试 tests/api/bifrost-preview-persistence.test.ts（白名单路由 / 防穿越 / 协商缓存 / 搬迁幂等）

## 验证记录

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ EXIT=0 |
| vitest 全量套件 | ✅ 12 文件 100 用例全过 |
| E2E 手工实证（一次性脚本，已删） | ✅ GET 200+no-cache / 穿越 404 / 搬迁·同名跳过·幂等 / 搬空清理 |
| 迁移实现 bug 自查 | ✅ 初版漏 unlinkSync 致旧目录永不清空——已修复（复制成功才删源）并固化为回归测试 |

## 关键决策记录

| 决策 | 结论 |
|---|---|
| URL 前缀不变 `/static/prompt-previews/*` | prompt_metadata 与前端零数据迁移，只动物理位置与服务方式 |
| 缓存策略 | 预览图文件名 `{prompt_id}{ext}` 同名覆盖内容 → 仅协商缓存（no-cache），不可照搬 covers 的 immutable 长缓存，否则换图后浏览器一年不更新 |
| 同名冲突处理 | runtime 已有同名则保留旧副本不覆盖（宁可冗余不可丢失），旧目录该文件留存导致目录暂不清空属预期 |
| 失败语义 | 单文件搬迁失败不阻断其余文件与其他启动流程，下次启动幂等重试 |

## 遗留与风险

- 无已知遗留。注意工作区另有用户自己的未提交改动（pi-agent-service / skills 相关），本次未触碰。
- 会话期间检测到用户侧提交 `45177bec`（含 bifrost-service.ts 中间态），最终修复以工作区未提交增量形式存在，提交时请一并纳入。

---

# Skill Agent（pi）工具调用日志显示排查与修复

> 现象：chat 节点 Skill Agent 模式只有思考过程与最终结果，无工具调用日志。
>
> 排查结论：链路本身无断点。逐环实证——pi json 事件流含 tool_execution_start/end（源码+官方文档）；
> 后端 runPiAgent 映射 tool_call/tool_result（E2E 真子进程通过）；SSE 线上产出 data-agent_tool_call 等
> transient part（新增 pi-sse-wire 集成测试）；前端 ai@7/@ai-sdk/react 对 transient chunk 触发 onData
> （vitest 实测）；onData→appendAgentStep→AgentActivity 渲染条件均正确。
>
> 根因：① 用户实测会话（runtime/1/workspace/chat-1787554683968-txvlst）中模型两轮均未发起工具调用
> （裸 pi、无 AGENTS.md、无 skill 装配，模型直接回答），无事件即无日志；② AgentActivity 默认折叠，
> 即使有日志也藏在折叠条内，感知为「没显示」。
>
> 修复：AgentActivity 运行中自动展开（用户手动开合优先；结束后未操作则收起为摘要条）。

## 任务清单

- [x] 1. 核对 pi 源码/文档（docs/skill-agent）确认 json 模式事件类型与映射一致
- [x] 2. 新增 backend-ts/tests/api/pi-sse-wire.test.ts：真实 pi 子进程 + chatStreamToResponse 映射 → 断言 SSE 线上出现 data-agent_tool_call / data-agent_tool_result / data-agent_file
- [x] 3. 前端 AgentActivity.tsx 运行中自动展开工具日志
- [x] 4. 验证：backend vitest 3 文件 9 用例全过；frontend oxlint + tsc/vite build 通过

## 验证记录

| 检查 | 结果 |
|---|---|
| `npx vitest run tests/api/pi-sse-wire.test.ts pi-agent-run pi-agent-workspace` | ✅ 3 passed (9 tests) |
| 线上 chunk 序列（绘图轮） | ✅ tool_call → tool_result → text-* → agent_file → finish（transient=true） |
| frontend `npm run lint` / `npm run build` | ✅ 通过（仅既有 maplibre/chunk 告警） |
| 浏览器实际交互 | ⚠️ 本环境无法启动浏览器，需画板实操确认展开效果 |

## 遗留与建议

- 若期望模型更积极调用工具：给节点绑定提示词（AGENTS.md）并在上游 skill_search 勾选技能；纯问候类问题模型无需工具属正常行为。
- 可选增强（未实施）：pi 的 tool_execution_update（bash 长任务部分输出）可映射为 status 进度，但需防刷屏。

---

# 结果图点击全屏（react-photo-view）— 四节点补齐

> 需求：手账制作 / 图书小票 / 图书卡片 / 图片处理 的最终结果图片，支持与「艺术地图生成」一致的点击全屏查看。
>
> 结论：全屏能力来自第三方库 `react-photo-view` v1.2.7（非项目自研组件），已在 15+ 处以统一模式复用
> （`PhotoProvider maskOpacity={0.8} bannerVisible={false}` + `PhotoView` 包 `<img>`），直接照搬即可。
>
> 用户决策：小票/卡片采用方案 A（卡片点击预览区放大；小票加「查看大图」浮钮）；文字编辑后旧 PNG 不失效（接受陈旧）。

## 任务清单

- [x] 1. 图片处理 `ImageProcessNode.tsx`：结果态 img 包 PhotoView（仅包 img，「调整参数」浮钮保持可点），去掉 pointer-events-none 加 cursor-zoom-in
- [x] 2. 手账制作 `JournalMakerNode.tsx`：结果态 img 同上处理
- [x] 3. 图书卡片 `BookCardNode.tsx`：有 imageUrl 时把整个预览区（iframe 非交互，安全）包进 PhotoView，容器加 cursor-zoom-in
- [x] 4. 图书小票 `ReceiptPrinterNode.tsx`：预览区右上角加「查看大图」浮钮（Maximize2 图标，作为 PhotoView 子元素天然触发全屏），滚动容器外包 relative 定位壳防浮钮随内容滚走
- [x] 5. 验证：frontend lint + build

## 关键决策记录

| 决策 | 结论 |
|---|---|
| 复用方式 | 直接使用 react-photo-view 原模式，不新造公共组件、不重构既有 15+ 用法 |
| 图片处理结果态 | 只包 img 本身，避免劫持悬浮「调整参数」按钮的点击 |
| 图书卡片 | 预览 iframe 为 pointerEvents:none，整块包安全；条件渲染避免 PhotoView src 为空 |
| 图书小票 | 纸面就地编辑含大量 input/textarea 不能整块包 → 浮钮即触发器 |
| 陈旧风险 | 文字编辑不清空 imageUrl（现状语义，收藏/公开按钮依赖），点击展示最近一次生成的 PNG |

## 验证记录

| 检查 | 结果 |
|---|---|
| frontend `npm run lint`（oxlint） | ✅ EXIT=0，无错误；warning 均为既有问题（public/maplibre 打包产物噪音 + BookCardNode 既有 exhaustive-deps，非本次改动行） |
| frontend `npm run build`（tsc -b + vite build） | ✅ 通过（chunk >1MB 警告为既有现象） |
| 浏览器交互验证 | ⚠️ 本环境无法启动浏览器，点击放大 / 浮钮位置需画板实际操作确认 |

## 遗留与风险

- 湿油彩 / 文本成图 / 贴纸 / 邮票裁切等同类结果态 img 也无全屏（用户未要求，未改动）。
