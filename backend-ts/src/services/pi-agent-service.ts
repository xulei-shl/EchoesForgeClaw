/**
 * pi CLI Skill Agent 执行器 suite（chat 节点第三模式）—— re-export 门面。
 *
 * 实现已按职责拆分至 services/pi/ 各模块与 file-utils.ts：
 * - pi/config.ts：运行时调优配置 / thinking 档位映射 / 会话落点
 * - pi/resolve.ts：pi CLI & 扩展包定位（二进制 / 白名单解析）
 * - pi/workspace.ts：运行时工作区装配（技能 / 模型物化 / 设置固化 / 清会话）
 * - pi/snapshot.ts：工作区快照差分（产物探测）+ 产物清单 manifest
 * - pi/events.ts：pi json 事件 → ChatStreamEvent 归一化映射 + 错误短语
 * - pi/registry.ts：RPC 子进程注册表（多租户并发 / 杀进程树）
 * - pi/runner.ts：runPiAgent RPC 编排
 * - file-utils.ts：MIME / 下载 URL / data-url 图片落盘（跨模块共用）
 *
 * 保持本文件路径不变（'../../../services/pi-agent-service.js'），既有消费方零改动接入。
 */

export { PI_THINKING_LEVELS, resolveThinkingArgs } from './pi/config.js';
export {
  type PiCommand,
  type PiExtensionSpec,
  resolvePiBin,
  resolveImageGenExtension,
  resolvePiExtensions,
} from './pi/resolve.js';
export {
  type PiChatModelConfig,
  type PiImageModelConfig,
  type PreparePiWorkspaceOptions,
  type PreparedWorkspaceInfo,
  preparePiWorkspace,
  clearPiSession,
} from './pi/workspace.js';
export {
  PI_ARTIFACTS_REL,
  type ArtifactRecord,
  type WorkspaceArtifact,
  appendArtifactManifest,
  listWorkspaceArtifacts,
} from './pi/snapshot.js';
export {
  type PiEventMapperState,
  mapPiJsonEvent,
} from './pi/events.js';
export {
  type WorkspaceGenerationInput,
  computeWorkspaceGeneration,
} from './pi/generation.js';
export {
  registerPiProcess,
  getPiProcess,
  killPiProcess,
  countActivePiProcesses,
  reapIdlePiProcesses,
  evictLeastRecentlyUsedPiProcess,
  sendExtensionUiResponse,
  type PiProcessEntry,
} from './pi/registry.js';
export { runPiAgent, type RunPiAgentOptions } from './pi/runner.js';
export { mimeOf, skillFileDownloadUrl, saveInputImages } from './file-utils.js';