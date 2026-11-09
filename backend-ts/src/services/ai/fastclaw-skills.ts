/**
 * FastClaw Agent 私有 skill 同步（管理端配置驱动）。
 *
 * 与 pi 工作区装配（pi/workspace.ts）的区别：FastClaw 的 skills 是 **agent 级共享目录**
 * （{data_root}/agents/{agent_id}/agent/skills），只有 session 按 sessionKey 隔离；
 * 因此不能按画布节点/用户在运行时动态写入，否则不同会话会互相覆盖。
 * 本模块由 admin 保存 FastClaw Agent 配置时调用，把配置里选中的共享 skill 包物化到该目录：
 *
 *   - 源：runtime/.agent/skills/{name}（Bifrost 共享真实包）、packages/pi-canvas-tools/skills/{name}（同捆）
 *   - 目标：{root}/agents/{agentId}/agent/skills/{name}
 *   - 写入：先复制到 agent 目录下的临时暂存区，再 rename 原子替换，避免 FastClaw
 *     每轮 LoadSkills 读到半份目录
 *   - 幂等：.bf-skills.json 清单记录每个已同步 skill 的内容哈希，未变化则跳过写盘
 *   - 清理：仅移除「上次由本系统同步、本次不再选中」的目录，绝不清空整个 skills 目录
 *     （那里可能有管理员在 FastClaw 里自行安装的技能）
 *
 * 所有失败都以 warning 返回、不抛错：skill 同步是 best-effort，不应阻断配置保存。
 */

import { createHash } from 'node:crypto';
import {
  accessSync,
  constants as fsConstants,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  isValidSkillName,
  readSkillMeta,
  REAL_SKILLS_ROOT,
  REPO_ROOT,
} from './skill-agent-service.js';

/** 本系统托管的同步清单文件名（隐藏文件，FastClaw 的 scanSkillsDir 只认目录，不会误加载）。 */
const MANIFEST_NAME = '.bf-skills.json';
/** 暂存目录前缀（位于 agent 目录下，保证与目标目录同一文件系统，rename 才是原子操作）。 */
const STAGING_PREFIX = '.bf-skills-tmp-';
/** 单个 agent 允许绑定的 skill 数量上限。 */
export const MAX_AGENT_SKILLS = 50;
/** agent id 白名单：FastClaw 形如 agt_xxx，也允许常见的字母数字/下划线/连字符 id。 */
const AGENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** hash 时最多遍历的文件数 / 目录深度，防止异常 skill 包拖慢同步。 */
const MAX_HASH_FILES = 500;
const MAX_HASH_DEPTH = 8;

const BUNDLED_SKILLS_ROOT = path.join(REPO_ROOT, 'packages', 'pi-canvas-tools', 'skills');
const DEFAULT_SOURCE_ROOTS = [REAL_SKILLS_ROOT, BUNDLED_SKILLS_ROOT];

export interface FastClawSkillCatalogItem {
  name: string;
  description: string;
  source: 'shared' | 'bundled';
}

export interface FastClawSkillSyncResult {
  root: string | null;
  target_dir: string;
  synced: string[];
  skipped: string[];
  removed: string[];
  unchanged: number;
  warning?: string;
}

interface SkillManifest {
  version: 1;
  /** skill 名 → 源目录内容哈希 */
  skills: Record<string, string>;
}

/** 源目录真值（realpath），并校验仍落在允许的源码根内，防软链逃逸到任意路径。 */
function resolvedSourceRoots(sourceRoots: string[]): string[] {
  return sourceRoots.map((r) => {
    try {
      return realpathSync(r);
    } catch {
      return path.resolve(r);
    }
  });
}

function isWithin(target: string, root: string): boolean {
  const p = path.resolve(target);
  const r = path.resolve(root);
  return p === r || p.startsWith(r + path.sep);
}

/** 与画布 skill 下载链路一致：不把 .env* 之类的密钥文件带进 FastClaw 数据目录。 */
function includeSkillFile(absPath: string): boolean {
  return !/^\.env(\.|$)/i.test(path.basename(absPath));
}

/** 列出可同步到 FastClaw Agent 的 skill（共享区优先，其次同捆包；按目录名去重）。 */
export function listSyncableSkills(sourceRoots: string[] = DEFAULT_SOURCE_ROOTS): FastClawSkillCatalogItem[] {
  const out = new Map<string, FastClawSkillCatalogItem>();
  sourceRoots.forEach((root, index) => {
    let entries: string[];
    try {
      entries = readdirSync(root).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      if (out.has(name) || !isValidSkillName(name)) continue;
      const dir = path.join(root, name);
      try {
        if (!statSync(dir).isDirectory() || !existsSync(path.join(dir, 'SKILL.md'))) continue;
      } catch {
        continue;
      }
      const meta = readSkillMeta(dir);
      out.set(name, {
        name,
        description: typeof meta.description === 'string' ? meta.description : '',
        source: index === 0 ? 'shared' : 'bundled',
      });
    }
  });
  return [...out.values()];
}

/** 按 skill 名定位真实源目录；找不到 / 越界 / 缺 SKILL.md 返回 null。 */
export function resolveSkillSource(name: string, sourceRoots: string[] = DEFAULT_SOURCE_ROOTS): string | null {
  if (!isValidSkillName(name)) return null;
  const roots = resolvedSourceRoots(sourceRoots);
  for (const root of roots) {
    const candidate = path.join(root, name);
    try {
      const real = realpathSync(candidate);
      if (!isWithin(real, root)) continue;
      if (!statSync(real).isDirectory() || !existsSync(path.join(real, 'SKILL.md'))) continue;
      return real;
    } catch {
      /* 该来源没有此 skill，继续下一个 */
    }
  }
  return null;
}

/** skill 目录内容哈希（相对路径 + 文件字节），用于判断源包是否更新，避免每轮重复写盘。 */
function hashSkillDir(dir: string): string {
  const hash = createHash('sha256');
  const files: string[] = [];
  const walk = (current: string, rel: string, depth: number): void => {
    if (depth > MAX_HASH_DEPTH || files.length >= MAX_HASH_FILES) return;
    let entries: string[];
    try {
      entries = readdirSync(current).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_HASH_FILES) break;
      const abs = path.join(current, entry);
      const childRel = rel ? `${rel}/${entry}` : entry;
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(abs, childRel, depth + 1);
      else if (st.isFile() && includeSkillFile(abs)) files.push(childRel);
    }
  };
  walk(dir, '', 0);
  for (const rel of files.sort()) {
    hash.update(rel).update('\0');
    try {
      hash.update(readFileSync(path.join(dir, rel)));
    } catch {
      /* 单个文件不可读：以空字节计入，仍能得到稳定哈希 */
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}

function readManifest(manifestPath: string): SkillManifest {
  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      version?: unknown;
      skills?: unknown;
    };
    if (raw?.version === 1 && raw.skills && typeof raw.skills === 'object' && !Array.isArray(raw.skills)) {
      const skills: Record<string, string> = {};
      for (const [name, digest] of Object.entries(raw.skills)) {
        if (isValidSkillName(name) && typeof digest === 'string') skills[name] = digest;
      }
      return { version: 1, skills };
    }
  } catch {
    /* 清单缺失/损坏：按「首次同步」处理 */
  }
  return { version: 1, skills: {} };
}

function writeManifest(manifestPath: string, manifest: SkillManifest): void {
  const tmp = `${manifestPath}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf-8');
    renameSync(tmp, manifestPath);
  } finally {
    rmSync(tmp, { force: true });
  }
}

function addWarning(result: FastClawSkillSyncResult, message: string): void {
  result.warning = result.warning ? `${result.warning}；${message}` : message;
}

/**
 * 把选中的 skill 同步到某个 FastClaw agent 的私有 skills 目录。
 * root 由调用方用 fastclawDataRoot(settings) 解析（目录不存在 / 不可读时为 null）。
 */
export function syncFastClawAgentSkills(opts: {
  root: string | null;
  agentId: string;
  skillNames: string[];
  /** 仅测试注入：替换默认的共享区/同捆包源目录。 */
  sourceRoots?: string[];
}): FastClawSkillSyncResult {
  const sourceRoots = opts.sourceRoots ?? DEFAULT_SOURCE_ROOTS;
  const agentId = String(opts.agentId ?? '').trim();
  const desired = [...new Set((opts.skillNames ?? []).map((n) => String(n ?? '').trim()))];
  const result: FastClawSkillSyncResult = {
    root: opts.root ?? null,
    target_dir: '',
    synced: [],
    skipped: [],
    removed: [],
    unchanged: 0,
  };

  if (!AGENT_ID_RE.test(agentId)) {
    result.skipped = desired;
    addWarning(result, 'Agent ID 非法，已跳过技能同步');
    return result;
  }
  if (!opts.root) {
    result.skipped = desired;
    addWarning(result, '未配置 FastClaw 数据根目录或目录不存在，已跳过技能同步');
    return result;
  }

  let realRoot: string;
  try {
    realRoot = realpathSync(opts.root);
    accessSync(realRoot, fsConstants.W_OK);
  } catch {
    result.skipped = desired;
    addWarning(result, 'FastClaw 数据根目录不可写，已跳过技能同步');
    return result;
  }

  // 层级见 docs/fastclaw-dev/internal/config/config.go: AgentHomeDir = {root}/agents/{id}/agent
  const agentDir = path.join(realRoot, 'agents', agentId, 'agent');
  const skillsDir = path.join(agentDir, 'skills');
  result.target_dir = skillsDir;
  if (!isWithin(skillsDir, realRoot)) {
    result.skipped = desired;
    addWarning(result, '目标目录越界，已跳过技能同步');
    return result;
  }

  const plan: Array<{ name: string; source: string; digest: string }> = [];
  for (const name of desired.slice(0, MAX_AGENT_SKILLS)) {
    const source = resolveSkillSource(name, sourceRoots);
    if (!source) {
      result.skipped.push(name);
      continue;
    }
    plan.push({ name, source, digest: hashSkillDir(source) });
  }
  if (desired.length > MAX_AGENT_SKILLS) {
    result.skipped.push(...desired.slice(MAX_AGENT_SKILLS));
    addWarning(result, `单个 Agent 最多同步 ${MAX_AGENT_SKILLS} 个技能，多余项已跳过`);
  }

  let previous: SkillManifest = { version: 1, skills: {} };
  try {
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(skillsDir, { recursive: true });
    previous = readManifest(path.join(skillsDir, MANIFEST_NAME));
  } catch (err) {
    result.skipped = desired;
    addWarning(result, `无法创建目标目录：${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  // 1) 取消选中：只删除清单里由本系统托管过的目录，FastClaw 自行安装的技能保持原样
  const nextNames = new Set(plan.map((p) => p.name));
  for (const name of Object.keys(previous.skills)) {
    if (nextNames.has(name)) continue;
    const dest = path.join(skillsDir, name);
    try {
      rmSync(dest, { recursive: true, force: true });
      result.removed.push(name);
    } catch {
      addWarning(result, `移除已取消的技能 ${name} 失败`);
    }
  }

  // 2) 新增/更新：暂存区复制 → 原子替换，避免 FastClaw 读到半份 skill
  const ready = new Set<string>();
  let staging = '';
  try {
    staging = mkdtempSync(path.join(agentDir, STAGING_PREFIX));
    for (const item of plan) {
      const dest = path.join(skillsDir, item.name);
      if (previous.skills[item.name] === item.digest && existsSync(path.join(dest, 'SKILL.md'))) {
        result.unchanged += 1;
        ready.add(item.name);
        continue;
      }
      const staged = path.join(staging, item.name);
      cpSync(item.source, staged, {
        recursive: true,
        dereference: true,
        filter: (src) => includeSkillFile(src),
      });
      rmSync(dest, { recursive: true, force: true });
      renameSync(staged, dest);
      result.synced.push(item.name);
      ready.add(item.name);
    }
  } catch (err) {
    addWarning(result, `技能复制失败：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
  }

  // 3) 写回清单：只记录本轮确实已就位（复制成功或未变化）的托管项
  const skills: Record<string, string> = {};
  for (const item of plan) {
    if (ready.has(item.name) && existsSync(path.join(skillsDir, item.name, 'SKILL.md'))) {
      skills[item.name] = item.digest;
    }
  }
  try {
    writeManifest(path.join(skillsDir, MANIFEST_NAME), { version: 1, skills });
  } catch (err) {
    addWarning(result, `同步清单写入失败：${err instanceof Error ? err.message : String(err)}`);
  }
  if (result.skipped.length) {
    addWarning(result, `以下技能未安装或名称非法，已跳过：${result.skipped.join('、')}`);
  }
  return result;
}
