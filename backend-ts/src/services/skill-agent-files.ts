import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { REAL_AGENTS_ROOT } from './skill-agent-service.js';

/**
 * Skill Agent AGENTS.md 物化（对应 Python `skill_agent_service.write_agent_md`）。
 *
 * SkillAgentConfig 引用的系统提示词以 `runtime/.agent/agents/{agent_id}/AGENTS.md`
 * 物化落盘（跨用户共享一份）；content 非空写入并返回路径，为空删除已存在文件并返回 null
 * （「未配置提示词则没有」语义，运行时以文件存在性为准，文件与 DB 同步刷新）。
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
