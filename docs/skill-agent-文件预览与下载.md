# Skill Agent / FastClaw 产物文件：预览与下载链路

> 适用范围：ChatNode（AI 对话节点）两种 Agent 模式产生的图片 / 文档等产物文件的展示、预览与下载。
> 本文面向后续维护与扩展（如音频播放、PDF 内嵌预览），先讲清现有链路与约束，再给扩展步骤。

## 1. 链路总览

```
Agent 执行（Skill Agent = pi 子进程；FastClaw = 远程 SSE + 同机桥接）
        │  产物落盘
        ▼
┌─ 后端 ────────────────────────────────────────────────┐
│ Skill Agent 模式（pi-agent-service.runPiAgent）：       │
│   进程退出后工作区快照差分 → agent_file 事件             │
│ FastClaw 模式（routes/ai-nodes.ts + fastclaw-artifacts）：│
│   流结束后扫 tool_result/正文里的本机绝对路径            │
│   → 安全校验 → 拷入节点工作区 outputs/ → agent_file 事件 │
│ 统一事件形状 {url, name, mime, size, path}               │
│   经 stream.ts 映射为 transient data-agent_file part     │
│ routes/skills.ts  GET /api/modules/bookplate/skill-files │
│     ?path=<工作区相对路径>&workspace_id=<wsId>            │
│     （登录鉴权 + 路径校验 + Content-Type + 流式返回）      │
└──────────────────────────────────────────────────────┘
        ▼
┌─ 前端 ────────────────────────────────────────────────┐
│ ChatNodeHost.onData：事件只入 pendingFilesRef 缓冲       │
│   流结束后一次性并入最后一条 assistant 的 metadata        │
│ workspaceFiles.extractWorkspaceFiles：                   │
│   渲染时从正文提取文件引用（纯函数，刷新后可重建）         │
│ ChatNode.SkillFileCard：合并两路来源（按 url 去重）       │
│   图片 → fetch→blob→缩略图 + PhotoView 放大 + 下载        │
│   其他 → 文件名 + 大小 + 下载按钮                         │
└──────────────────────────────────────────────────────┘
```

**两条互补的文件来源**（前端视角，两模式通用）：

| 来源 | 触发时机 | 覆盖范围 | 持久性 |
| --- | --- | --- | --- |
| `agent_file` 事件 | 流末尾 | Skill Agent=差分出的新文件；FastClaw=本轮正文/tool_result 引用的文件 | transient 不持久化，靠 metadata 镜像 |
| 正文提取（`extractWorkspaceFiles`） | 渲染时实时计算 | 正文里引用到的本工作区文件 | 正文本身持久化，刷新后可重建 |

## 2. 关键文件

| 文件 | 职责 |
| --- | --- |
| `backend-ts/src/services/pi-agent-service.ts` | pi 执行、快照差分发 `agent_file`；导出 `mimeOf`、`skillFileDownloadUrl` |
| `backend-ts/src/services/fastclaw-artifacts.ts` | FastClaw 同机桥接：路径识别 / 双重安全校验 / 收割拷贝 |
| `backend-ts/src/modules/bookplate/routes/ai-nodes.ts` | chat 路由三模式分发；FastClaw 分支在流末尾收割并发 `agent_file` |
| `backend-ts/src/modules/bookplate/stream.ts` | `ChatStreamEvent` → AI SDK UI Message Stream |
| `backend-ts/src/modules/bookplate/routes/skills.ts` | `GET /skill-files`：鉴权、路径校验、Content-Type、RFC 5987 中文名、流式发送 |
| `frontend/src/modules/bookplate/workspaceFiles.ts` | 正文提取 / 路径换算 / 剔除裂图 / 去重合并（全部纯函数） |
| `frontend/src/modules/bookplate/ChatNodeHost.tsx` | `onData` 缓冲、流结束并入 metadata、镜像写 store、透传 workspaceId |
| `frontend/src/modules/bookplate/components/ChatNode.tsx` | `SkillFileCard` 渲染分发、气泡内剔除不可加载图片 |

## 3. 路径换算规则

### 前端提取（resolveWorkspaceRef）

- **绝对路径**：`…/runtime/{uid}/workspace/{wsId}/<rel>` —— wsId 以路径内嵌为准；显式传入不一致则拒绝
- **相对路径**：`outputs/foo.png` 等至少一层目录形式；拒绝 `../`、拒绝无目录层级的裸单词
- 网页 URL / data URL / 未知扩展名一律拒绝
- URL 口径：`/api/modules/bookplate/skill-files?path=<enc(rel)>&workspace_id=<enc(wsId)>`

### 后端 FastClaw 桥接（fastclaw-artifacts）

- 数据根：env `FASTCLAW_DATA_ROOT` 可覆盖，默认 `/var/lib/fastclaw`（官方安装布局）；目录不存在则整个桥接静默停用
- 只认「以 `/` 开头、无空白、扩展名可识别」的**绝对** POSIX 路径（相对引用无法安全定位，不收）
- 安全面：词法 normalize 包含校验 + realpath 软链穿透校验双道防线；单文件 ≤50MB、单轮 ≤12 个
- 拷贝进节点工作区 `outputs/`（同名不同来源自动 `_2` 序号；同名新内容覆盖，最新胜出）
- 单个文件失败只跳过，不影响对话流（best-effort）

## 4. 核心约束：鉴权与 blob 管线

skill-files 接口要求 `Authorization` 头，而 `<img>` / `<audio>` / `<video>` / `<iframe>` / `<a href>` 都带不上自定义头。**因此一切预览与下载都必须走**：

```
fetchSkillFile(file)  // fetch + authHeaders
  → resp.blob()
  → URL.createObjectURL(blob)
  → 媒体元素 src / a.download
  → 用毕 revokeObjectURL
```

该管线集中在 `ChatNode.tsx` 的 `fetchSkillFile`。后续音频/视频/PDF 预览同样复用它。

推论：blob 全量缓冲，objectURL 上没有 HTTP Range 流式。生成的短音视频没问题；**超大文件应设体积阈值退化为纯下载卡**（事件来源的 `size` 已携带；正文提取来源记 0，可在 fetch 后补读 `blob.size`）。

## 5. 渲染分发与扩展方式

现状是 `SkillFileCard` 内的二分支（image / 兜底下载行）。加第三种类型时建议重构为「mime → 组件」注册表：

```tsx
const PREVIEW_RENDERERS: Array<[(mime: string) => boolean, React.FC<{ file: AgentFile }>]> = [
  [(m) => m.startsWith('image/'), ImagePreviewCard],   // 现有逻辑迁入
  [(m) => m.startsWith('audio/'), AudioPlayerCard],    // <audio controls src={objectUrl}>
  [(m) => m === 'application/pdf', PdfEmbedCard],      // <iframe> 或 pdf.js
];
```

### 扩展一个新类型的步骤清单

1. **两端 MIME 表各加一行**：`pi-agent-service.ts` 与 `workspaceFiles.ts` 的 `MIME_BY_EXT`（跨进程无法共享，务必同步）
2. **实现预览组件**：复用 `fetchSkillFile` → objectURL；卸载时 revoke；失败态可退化下载
3. **登记进分发表**
4. **测试**：`tests/api/skills.test.ts` 加 Content-Type 断言；前端纯函数可用 tsx 脚本验证

## 6. 已知限制与历史教训（勿回退）

- **流中禁写消息状态**：曾在 `onData` 里直接 `setMessages/setNodes`，与 AI SDK 事件处理竞态 —— 多个背靠背 `agent_file` 会丢事件、metadata 流结束被清空（症状即"只有文本没有卡片"）。现行为缓冲到 `pendingFilesRef`，流结束后一次性并入。
- **transient 事件不持久化**：刷新后消失；正文提取是兜底重建通道。pi-image-gen 工具会指示模型原样内联 markdown 图片，是最可靠来源；FastClaw 模式下正文里是本机绝对路径，卡片完全依赖事件桥接。
- **裂图清洗范围**：`stripUnrenderableImages` 剔除「本工作区产物 + 其它本机绝对路径（非 /api/、/static/）」两类图片语法；网页图与 data URL 正常渲染。
- **差分排除目录**：`.agents/`、`.pi/`、`.pi-agent/`、`inputs/` 与 `AGENTS.md` 不算产物（`DIFF_EXCLUDED_*`）。
- **中文名**：接口用 RFC 5987 `filename*=UTF-8''…` + ASCII 兜底；前端下载统一 blob + `a.download`。
