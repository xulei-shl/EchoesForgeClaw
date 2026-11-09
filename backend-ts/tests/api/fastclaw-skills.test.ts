/** FastClaw Agent 私有 skill 同步单测：候选列表 / 原子落盘 / 幂等 / 托管项清理 / 安全校验。 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  listSyncableSkills,
  syncFastClawAgentSkills,
} from '../../src/services/ai/fastclaw-skills.js';

const AGENT_ID = 'agt_73179efe1dbe5be1e1c0';
let dataRoot: string;
let sourceRoot: string;

function makeSkill(name: string, description: string, extra?: Record<string, string>): string {
  const dir = path.join(sourceRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
  for (const [rel, content] of Object.entries(extra ?? {})) {
    const file = path.join(dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return dir;
}

beforeEach(() => {
  dataRoot = mkdtempSync(path.join(os.tmpdir(), 'fc-skills-root-'));
  sourceRoot = mkdtempSync(path.join(os.tmpdir(), 'fc-skills-src-'));
  makeSkill('alpha', '字母技能');
  makeSkill('beta', '测试技能');
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
  rmSync(sourceRoot, { recursive: true, force: true });
});

function sync(skillNames: string[], agentId = AGENT_ID) {
  return syncFastClawAgentSkills({ root: dataRoot, agentId, skillNames, sourceRoots: [sourceRoot] });
}

describe('listSyncableSkills', () => {
  it('列出共享区候选并解析 SKILL.md frontmatter', () => {
    const items = listSyncableSkills([sourceRoot]);
    expect(items.map((i) => i.name)).toEqual(['alpha', 'beta']);
    expect(items[0]?.description).toBe('字母技能');
    expect(items[0]?.source).toBe('shared');
  });

  it('缺 SKILL.md 的目录不算候选', () => {
    mkdirSync(path.join(sourceRoot, 'no-skill-md'));
    expect(listSyncableSkills([sourceRoot]).map((i) => i.name)).toEqual(['alpha', 'beta']);
  });

  it('源目录不存在时返回空列表', () => {
    expect(listSyncableSkills([path.join(sourceRoot, 'missing')])).toEqual([]);
  });
});

describe('syncFastClawAgentSkills', () => {
  it('按 {root}/agents/{agentId}/agent/skills/{name} 落盘，重复同步不重写', () => {
    const first = sync(['alpha', 'beta']);
    expect(first.synced.sort()).toEqual(['alpha', 'beta']);
    expect(first.skipped).toEqual([]);
    expect(first.warning).toBeUndefined();
    expect(first.target_dir.endsWith(path.join('agents', AGENT_ID, 'agent', 'skills'))).toBe(true);
    expect(existsSync(path.join(first.target_dir, 'alpha', 'SKILL.md'))).toBe(true);
    expect(existsSync(path.join(first.target_dir, 'beta', 'SKILL.md'))).toBe(true);
    expect(existsSync(path.join(first.target_dir, '.bf-skills.json'))).toBe(true);

    const second = sync(['alpha', 'beta']);
    expect(second.synced).toEqual([]);
    expect(second.unchanged).toBe(2);
  });

  it('源包内容变化后重新同步该技能，未变化的保持不动', () => {
    sync(['alpha', 'beta']);
    writeFileSync(path.join(sourceRoot, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: 改过了\n---\n\n# v2\n');
    const next = sync(['alpha', 'beta']);
    expect(next.synced).toEqual(['alpha']);
    expect(next.unchanged).toBe(1);
    expect(existsSync(path.join(next.target_dir, 'alpha', 'SKILL.md'))).toBe(true);
  });

  it('取消选中只删本系统托管过的目录，不误删 FastClaw 自装技能', () => {
    const first = sync(['alpha', 'beta']);
    const manual = path.join(first.target_dir, 'manual-skill');
    mkdirSync(manual, { recursive: true });
    writeFileSync(path.join(manual, 'SKILL.md'), '# 管理员自行安装');

    const next = sync(['alpha']);
    expect(next.removed).toEqual(['beta']);
    expect(existsSync(path.join(first.target_dir, 'beta'))).toBe(false);
    expect(existsSync(path.join(manual, 'SKILL.md'))).toBe(true);
    expect(existsSync(path.join(first.target_dir, 'alpha', 'SKILL.md'))).toBe(true);
  });

  it('不把 .env 密钥文件带进 FastClaw 数据目录，并清理暂存目录', () => {
    makeSkill('gamma', '带密钥的技能', { '.env': 'SECRET=1', 'scripts/run.sh': 'echo hi' });
    const result = sync(['gamma']);
    expect(result.synced).toEqual(['gamma']);
    const dest = path.join(result.target_dir, 'gamma');
    expect(existsSync(path.join(dest, 'scripts', 'run.sh'))).toBe(true);
    expect(existsSync(path.join(dest, '.env'))).toBe(false);
    const agentDir = path.dirname(result.target_dir);
    expect(readdirSync(agentDir).some((n) => n.startsWith('.bf-skills-tmp-'))).toBe(false);
  });

  it('非法 Agent ID / 未配置数据根 / 非法或缺失 skill 名都只报警告，不抛错', () => {
    const badAgent = sync(['alpha'], '../escape');
    expect(badAgent.warning).toContain('Agent ID 非法');
    expect(badAgent.skipped).toEqual(['alpha']);

    const noRoot = syncFastClawAgentSkills({ root: null, agentId: AGENT_ID, skillNames: ['alpha'] });
    expect(noRoot.warning).toContain('数据根目录');
    expect(existsSync(path.join(dataRoot, 'agents'))).toBe(false);

    const badNames = sync(['../escape', 'missing-skill', 'alpha']);
    expect(badNames.skipped).toEqual(['../escape', 'missing-skill']);
    expect(badNames.synced).toEqual(['alpha']);
    expect(badNames.warning).toContain('已跳过');
  });

  it('清单损坏时按首次同步处理并自愈', () => {
    const first = sync(['alpha']);
    writeFileSync(path.join(first.target_dir, '.bf-skills.json'), '{ not json');
    const next = sync(['alpha']);
    expect(next.synced).toEqual(['alpha']);
    expect(next.warning).toBeUndefined();
  });
});
