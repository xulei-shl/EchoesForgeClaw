import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REAL_AGENTS_ROOT, userSkillsRoot } from '../skill-agent-service.js';
import type { PiChatModelConfig, PiImageModelConfig } from './workspace.js';

/**
 * pi 进程「配置代数」（generation）：决定 RPC 进程能否复用。
 *
 * 代数 = 影响 pi 行为的工作区装配物哈希（提示词 AGENTS.md、选中技能、对话/绘图模型、
 * 扩展白名单）。pi 进程在 spawn 时把这些固化到启动参数/启动扫描里，之后不会热读。
 * 因此：
 * - 代数相同 → 复用已存活的进程（跳过重装与冷启动）；
 * - 代数不同（上游节点改接提示词/skill/模型/扩展）→ 必须杀旧进程重拉。
 *
 * 只比较「配置」，不比较对话内容——多轮上下文始终以会话文件为真相源，不随代数变化。
 */

export interface WorkspaceGenerationInput {
  userId: number;
  agentId: number;
  skillNames: string[];
  chatModel: PiChatModelConfig;
  imageModel: PiImageModelConfig | null;
  /** 扩展白名单解析后的有序包名（resolvePiExtensions → name）。 */
  extensionNames: string[];
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** 稳定序列化（键序固定），供 hash 输入。 */
function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

export function computeWorkspaceGeneration(input: WorkspaceGenerationInput): string {
  const parts: string[] = [];

  // 1) 提示词（AGENTS.md）：内容哈希；缺失/不可读视为空
  parts.push(`agent:${input.agentId}`);
  const agentsMd = path.join(REAL_AGENTS_ROOT, String(input.agentId), 'AGENTS.md');
  let promptHash = '';
  try {
    if (existsSync(agentsMd)) promptHash = sha256(readFileSync(agentsMd, 'utf-8'));
  } catch {
    /* 不可读 → 空哈希 */
  }
  parts.push(`prompt:${promptHash}`);

  // 2) 选中技能：SKILL.md 内容哈希（装配只校验 SKILL.md 存在并整体复制；目录其它文件不纳入——
  //    复用路径跳过重装配，技能目录保持生成时内容，与 spawn 时 pi 扫描加载一致）
  const registryRoot = userSkillsRoot(input.userId);
  for (const name of input.skillNames) {
    const skillMd = path.join(registryRoot, name, 'SKILL.md');
    let h = '';
    try {
      if (existsSync(skillMd)) h = sha256(readFileSync(skillMd, 'utf-8'));
    } catch {
      /* 缺失/不可读 → 空哈希 */
    }
    parts.push(`skill:${name}:${h}`);
  }

  // 3) 对话模型（含 apiKey：改 Key 必须重拉才生效）
  parts.push(
    `chat:${stableJson({
      baseUrl: input.chatModel.baseUrl,
      apiKey: input.chatModel.apiKey,
      modelName: input.chatModel.modelName,
      multimodal: input.chatModel.multimodal,
      apiFormat: input.chatModel.apiFormat ?? null,
      thinkingFormat: input.chatModel.thinkingFormat ?? null,
      contextWindow: input.chatModel.contextWindow ?? null,
      maxTokens: input.chatModel.maxTokens ?? null,
    })}`
  );

  // 4) 绘图模型（有则 baseUrl/modelName/apiKey）
  parts.push(
    `image:${stableJson(
      input.imageModel
        ? { baseUrl: input.imageModel.baseUrl, apiKey: input.imageModel.apiKey, modelName: input.imageModel.modelName }
        : null
    )}`
  );

  // 5) 扩展白名单（有序包名）
  parts.push(`ext:${stableJson(input.extensionNames)}`);

  return sha256(parts.join('\u0000'));
}
