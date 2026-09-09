import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { REAL_AGENTS_ROOT } from './skill-agent-service.js';
import { promptTemplates } from '../../db/schema.js';
import type { DB } from '../../config/database.js';
import type { skillAgentConfigs } from '../../db/schema.js';

/**
 * Skill Agent AGENTS.md 物化（对应 Python `skill_agent_service.write_agent_md`）。
 *
 * SkillAgentConfig 引用的系统提示词以 `runtime/.agent/agents/{agent_id}/AGENTS.md`
 * 物化落盘（跨用户共享一份）；content 非空写入并返回路径，为空删除已存在文件并返回 null
 * （「未配置提示词则没有」语义，运行时以文件存在性为准，文件与 DB 同步刷新）。
 *
 * 同步触发点有两处，保证「文件存在性」这一装配期事实始终与 DB 一致：
 * - 管理端保存/复制/修改/删除 SkillAgentConfig（writeAgentMd）；
 * - 运行时装配（skillAgentConfigFrom → ensureAgentMd）：存量配置或经其它途径导入的
 *   配置从未走过 admin 写入接口，读取配置时按 DB 最新值增量同步，避免装配期缺 AGENTS.md。
 */

/** 物化 / 删除 AGENTS.md；返回文件路径（删除时为 null）。 */
export function writeAgentMd(agentId: number | string, content: string): string | null {
  const targetDir = path.join(REAL_AGENTS_ROOT, String(agentId));
  const target = path.join(targetDir, 'AGENTS.md');
  if (content && content.trim()) {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(target, content, 'utf-8');
    return target;
  }
  if (existsSync(target)) unlinkSync(target);
  return null;
}

/** 最终生效的提示词内容：引用模板优先（且启用），回退旧字段（与 admin 展示口径一致）。 */
export function effectivePromptContent(db: DB, cfg: typeof skillAgentConfigs.$inferSelect): string {
  if (cfg.promptId != null) {
    const prompt = db.select().from(promptTemplates).where(eq(promptTemplates.id, cfg.promptId)).get();
    if (prompt?.isActive) return prompt.content ?? '';
  }
  return cfg.systemPrompt ?? '';
}

/**
 * 按 DB 最新配置增量同步 AGENTS.md（运行时装配前置调用）。
 * 内容一致时不重写（避免每轮对话无谓写盘）；无提示词时删除残留文件。
 * 返回物化后文件路径（无提示词为 null）。
 */
export function ensureAgentMd(db: DB, cfg: typeof skillAgentConfigs.$inferSelect): string | null {
  const content = effectivePromptContent(db, cfg);
  const target = path.join(REAL_AGENTS_ROOT, String(cfg.id), 'AGENTS.md');
  if (content.trim() && existsSync(target) && readFileSync(target, 'utf-8') === content) {
    return target;
  }
  return writeAgentMd(cfg.id, content);
}