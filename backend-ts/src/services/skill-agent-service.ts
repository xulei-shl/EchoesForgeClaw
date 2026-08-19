import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

/**
 * Skill 工作区管理（对应 Python `app/services/skill_agent_service.py` 的
 * 工作区 & skill 元数据部分；Agent 执行器为第二阶段迁移，不在此文件）。
 *
 * 目录约定（根目录 runtime/，整目录 gitignore，与 Python 后端 REPO_ROOT 口径一致）：
 *   runtime/.agent/skills/{name}          Bifrost 检索安装的真实 skill 包（跨用户共享，只读「源」）
 *   runtime/.agent/agents/{agent_id}/AGENTS.md   SkillAgentConfig 引用的提示词物化文件（见 skill-agent-files.ts）
 *   runtime/{user_id}/skills/{name}       用户「已安装 skill」登记：Bifrost=软链->共享区；上传=真实目录
 *   runtime/{user_id}/workspace/{ws_id}/  单个 chat 节点的运行时工作区（软链装配 + agent 产物）
 */

// 仓库根 = 本文件（backend-ts/src/services/）向上三层；runtime/ 在仓库根下，不在 backend-ts/ 下
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const RUNTIME_ROOT = path.join(REPO_ROOT, 'runtime');
export const REAL_SKILLS_ROOT = path.join(RUNTIME_ROOT, '.agent', 'skills');
export const REAL_AGENTS_ROOT = path.join(RUNTIME_ROOT, '.agent', 'agents');

/** skill 名称长度上限（目录名）。 */
const MAX_SKILL_NAME_LEN = 100;
/** skill 解压总大小上限（字节，防 zip 炸弹）。 */
const MAX_EXTRACT_BYTES = 100 * 1024 * 1024;
/** skill 解压文件数上限。 */
const MAX_EXTRACT_FILES = 500;
/** workspace_id 允许的字符集（防目录穿越）。 */
const WORKSPACE_ID_PATTERN = /[^A-Za-z0-9_-]+/g;
const MAX_WORKSPACE_ID_LEN = 120;

/** skill zip 校验失败（对外暴露为 400 + 中文原因）。 */
export class SkillValidationError extends Error {}

/** skill 不存在（对外暴露为 404）。 */
export class SkillNotFoundError extends Error {}

/** 该用户「已安装 skill」登记目录：runtime/{user_id}/skills/。 */
export function userSkillsRoot(userId: number): string {
  const d = path.join(RUNTIME_ROOT, String(userId), 'skills');
  mkdirSync(d, { recursive: true });
  return d;
}

/** 该用户的运行时工作区根目录：runtime/{user_id}/workspace/。 */
export function workspaceRoot(userId: number): string {
  const root = path.join(RUNTIME_ROOT, String(userId), 'workspace');
  mkdirSync(root, { recursive: true });
  return root;
}

/** 消毒 workspace_id：剔除非法字符并限长，防目录穿越。 */
export function sanitizeWorkspaceId(workspaceId: string): string {
  return (workspaceId ?? '').replace(WORKSPACE_ID_PATTERN, '').slice(0, MAX_WORKSPACE_ID_LEN);
}

/** 创建并返回单个 chat 节点的工作区：runtime/{user_id}/workspace/{workspace_id}。 */
export function nodeWorkspace(userId: number, workspaceId: string): string {
  let ws = sanitizeWorkspaceId(workspaceId);
  if (!ws) ws = `node_${Date.now()}`;
  const d = path.join(RUNTIME_ROOT, String(userId), 'workspace', ws);
  mkdirSync(d, { recursive: true });
  return d;
}

/** 删除文件 / 软链 / 目录（软链不穿透：删除软链本身，不动其指向的真实目录）。 */
function removePath(p: string): void {
  try {
    const st = lstatSync(p);
    if (st.isSymbolicLink() || st.isFile()) {
      unlinkSync(p);
    } else if (st.isDirectory()) {
      rmSync(p, { recursive: true, force: true });
    }
  } catch {
    /* 不存在则忽略 */
  }
}

/** 建软链指向绝对目标；失败（如 Windows 无 symlink 权限）退化为真实复制。 */
function symlinkOrCopy(target: string, link: string): void {
  mkdirSync(path.dirname(link), { recursive: true });
  try {
    const isDir = statSync(target).isDirectory();
    symlinkSync(target, link, isDir ? 'dir' : 'file');
  } catch {
    try {
      if (statSync(target).isDirectory()) cpSync(target, link, { recursive: true });
      else copyFileSync(target, link);
    } catch {
      /* 目标已不存在：忽略 */
    }
  }
}

/** 解析 SKILL.md 的 YAML frontmatter（--- ... ---）与正文；仅取 name / description。 */
export function parseFrontmatter(markdown: string): { meta: Record<string, string>; body: string } {
  const lines = markdown.split(/\r?\n/);
  if (!lines.length || lines[0]!.trim() !== '---') return { meta: {}, body: markdown };
  let endIndex: number | null = null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === '---') {
      endIndex = i;
      break;
    }
  }
  if (endIndex == null) return { meta: {}, body: markdown };
  const meta: Record<string, string> = {};
  for (let i = 1; i < endIndex; i++) {
    const stripped = lines[i]!.trim();
    if (!stripped || stripped.startsWith('#') || !stripped.includes(':')) continue;
    const idx = stripped.indexOf(':');
    const key = stripped.slice(0, idx).trim();
    const value = stripped.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if ((key === 'name' || key === 'description') && value) meta[key] = value;
  }
  return { meta, body: lines.slice(endIndex + 1).join('\n').trim() };
}

/** 递归列出目录下全部文件（相对路径，/ 分隔，排序）。 */
function listFilesRecursive(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // 悬空软链等不可 stat 的条目跳过
    }
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (st.isDirectory()) out.push(...listFilesRecursive(full, rel));
    else if (st.isFile()) out.push(rel);
  }
  return out;
}

/** 读取单个 skill 目录的元数据（name/description/正文/文件树）。登记目录里的 Bifrost skill 是软链：先 resolve 再列文件树。 */
export function readSkillMeta(skillDir: string): Record<string, unknown> {
  let real = skillDir;
  try {
    if (lstatSync(skillDir).isSymbolicLink()) real = realpathSync(skillDir);
  } catch {
    return { name: path.basename(skillDir), description: '', body: '', files: [] };
  }
  const mdPath = path.join(real, 'SKILL.md');
  if (!existsSync(mdPath)) {
    return { name: path.basename(real), description: '', body: '', files: [] };
  }
  const text = readFileSync(mdPath, 'utf-8');
  const { meta, body } = parseFrontmatter(text);
  return {
    name: meta.name || path.basename(real),
    description: meta.description ?? '',
    body,
    files: listFilesRecursive(real),
  };
}

/** 列出该用户已安装的 skill（含 name/description/文件树）。以用户登记目录为事实来源。 */
export function listInstalledSkills(userId: number): Record<string, unknown>[] {
  const d = userSkillsRoot(userId);
  const items: Record<string, unknown>[] = [];
  for (const child of readdirSync(d).sort()) {
    const full = path.join(d, child);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory(); // 跟随软链
    } catch {
      continue;
    }
    if (!isDir) continue;
    if (!existsSync(path.join(full, 'SKILL.md'))) continue;
    const meta = readSkillMeta(full);
    meta.path = `skills/${child}`;
    items.push(meta);
  }
  return items;
}

/** 校验上传的 skill zip 合法性；非法抛 SkillValidationError（带中文原因）。 */
export function validateSkillZip(zipBytes: Uint8Array): { name: string; description: string; body: string; root: string } {
  let zip: AdmZip;
  try {
    zip = new AdmZip(Buffer.from(zipBytes));
  } catch {
    throw new SkillValidationError('不是有效的 zip 文件');
  }
  const names = zip.getEntries().filter((e) => !e.isDirectory).map((e) => e.entryName);
  if (!names.length) throw new SkillValidationError('zip 为空，未包含任何文件');

  // 顶层目录：取所有条目公共前缀的第一段
  const top = names[0]!.split('/')[0]!;
  if (names.some((n) => !n.startsWith(`${top}/`))) {
    throw new SkillValidationError('skill zip 结构不合法：所有文件应位于同一个顶层目录下（如 skill-name/SKILL.md）');
  }
  const mdRel = `${top}/SKILL.md`;
  const mdEntry = zip.getEntry(mdRel);
  if (!mdEntry) throw new SkillValidationError(`zip 缺少 ${mdRel}：skill 根目录必须包含 SKILL.md`);
  const mdText = mdEntry.getData().toString('utf-8');

  const { meta, body } = parseFrontmatter(mdText);
  if (!meta.name) throw new SkillValidationError('SKILL.md 缺少 name 元数据（YAML frontmatter 必填）');
  if (!meta.description) throw new SkillValidationError('SKILL.md 缺少 description 元数据（YAML frontmatter 必填）');
  const name = meta.name;
  // 名称将作为目录名：拒绝路径分隔符 / 相对跳转 / 控制字符，防 frontmatter name 目录穿越
  if (
    !name.trim() ||
    name.length > MAX_SKILL_NAME_LEN ||
    name.includes('/') ||
    name.includes('\\') ||
    name === '.' ||
    name === '..' ||
    [...name].some((ch) => ch.charCodeAt(0) < 32)
  ) {
    throw new SkillValidationError('SKILL.md 的 name 含非法字符：仅允许字母/数字/中划线/下划线/空格（将作为目录名使用）');
  }
  return { name, description: meta.description, body, root: top };
}

/** 把已校验的 zip 解压到 dest（zip-slip 防护 + 大小/数量上限，失败清理半成品）。 */
function extractSkillZip(zipBytes: Uint8Array, dest: string, info: { root: string }): Record<string, unknown> {
  mkdirSync(dest, { recursive: true });
  const rootPrefix = `${info.root}/`;
  let totalBytes = 0;
  let fileCount = 0;
  try {
    const zip = new AdmZip(Buffer.from(zipBytes));
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !entry.entryName.startsWith(rootPrefix)) continue;
      const rel = entry.entryName.slice(rootPrefix.length);
      const target = path.resolve(dest, rel);
      // zip-slip 防护：解压目标必须落在 skill 目录内
      if (target !== dest && !target.startsWith(dest + path.sep)) {
        throw new SkillValidationError('zip 包含越界路径（路径穿越），已拒绝');
      }
      if (path.dirname(target) !== dest) mkdirSync(path.dirname(target), { recursive: true });
      const data = entry.getData();
      totalBytes += data.length;
      if (totalBytes > MAX_EXTRACT_BYTES) {
        throw new SkillValidationError(`解压总大小超过 ${MAX_EXTRACT_BYTES / (1024 * 1024)}MB 上限（疑似 zip 炸弹），已拒绝`);
      }
      writeFileSync(target, data);
      fileCount += 1;
      if (fileCount > MAX_EXTRACT_FILES) {
        throw new SkillValidationError(`文件数超过 ${MAX_EXTRACT_FILES} 个上限，已拒绝`);
      }
    }
  } catch (err) {
    // 解压失败（含校验失败）：清理半成品目录
    rmSync(dest, { recursive: true, force: true });
    if (err instanceof SkillValidationError) throw err;
    throw new SkillValidationError(`解压失败: ${err instanceof Error ? err.message : String(err)}`);
  }
  return readSkillMeta(dest);
}

/** Bifrost 检索路径：校验并真实解压到共享区，再在该用户登记目录建软链（Windows 失败退化为复制）。 */
export function installSkillZip(userId: number, zipBytes: Uint8Array): Record<string, unknown> {
  const info = validateSkillZip(zipBytes);
  const name = info.name;
  // 共享区：同名 skill 先清空再覆盖（重装 = 更新）。Node 单线程 + 同步操作天然互斥，无需额外锁。
  const dest = path.join(REAL_SKILLS_ROOT, name);
  removePath(dest);
  const meta = extractSkillZip(zipBytes, dest, info);
  // 用户登记：软链 -> 共享真实包（绝对目标路径；Windows 无权限退化为真实复制）
  const registry = path.join(userSkillsRoot(userId), name);
  removePath(registry);
  symlinkOrCopy(dest, registry);
  meta.path = `skills/${name}`;
  return meta;
}

/**
 * 共享区已缓存该 Bifrost skill 时，跳过网络下载，仅在该用户登记目录建软链（对应 Python
 * `register_existing_bifrost_skill`）。命中返回元数据；未命中返回 null，由调用方走网络下载。
 * 用户登记已存在且有效 → 幂等返回，不重复建链。
 */
export function registerExistingBifrostSkill(userId: number, skillName: string): Record<string, unknown> | null {
  const name = (skillName ?? '').trim();
  if (
    !name ||
    name.length > MAX_SKILL_NAME_LEN ||
    name.includes('/') ||
    name.includes('\\') ||
    name === '.' ||
    name === '..' ||
    [...name].some((ch) => ch.charCodeAt(0) < 32)
  ) {
    throw new SkillValidationError('非法 skill 名称');
  }
  const dest = path.join(REAL_SKILLS_ROOT, name);
  try {
    if (!statSync(dest).isDirectory() || !existsSync(path.join(dest, 'SKILL.md'))) return null;
  } catch {
    return null;
  }
  const registry = path.join(userSkillsRoot(userId), name);
  if (existsSync(path.join(registry, 'SKILL.md'))) {
    // 已登记且有效：幂等返回，不重复建链（软链或 Windows 复制退化副本均可）
    const meta = readSkillMeta(registry);
    meta.path = `skills/${name}`;
    return meta;
  }
  removePath(registry);
  symlinkOrCopy(dest, registry);
  const meta = readSkillMeta(registry);
  meta.path = `skills/${name}`;
  return meta;
}

/** 用户上传路径：校验并真实解压到私有登记目录（用户私有数据，不跨用户共享）。 */
export function installUserSkillZip(userId: number, zipBytes: Uint8Array): Record<string, unknown> {
  const info = validateSkillZip(zipBytes);
  const name = info.name;
  const dest = path.join(userSkillsRoot(userId), name);
  removePath(dest);
  const meta = extractSkillZip(zipBytes, dest, info);
  meta.path = `skills/${name}`;
  return meta;
}

/** 从用户登记目录移除一个已安装的 skill。 */
export function removeSkill(userId: number, skillName: string): void {
  if (!skillName || skillName.includes('/') || skillName.includes('\\')) {
    throw new SkillValidationError('非法 skill 名称');
  }
  const d = userSkillsRoot(userId);
  const target = path.join(d, skillName);
  let exists = false;
  try {
    exists = existsSync(target) || lstatSync(target).isSymbolicLink();
  } catch {
    exists = false;
  }
  if (!exists) throw new SkillNotFoundError('skill 不存在');
  removePath(target); // 软链只移除登记条目，不动共享真实包
}

/** 扫描共享区 runtime/.agent/skills/，返回各 skill 元数据 + 目录修改时间（不含残缺目录）。 */
export function listSharedBifrostSkills(): Record<string, unknown>[] {
  if (!existsSync(REAL_SKILLS_ROOT)) return [];
  const items: Record<string, unknown>[] = [];
  for (const child of readdirSync(REAL_SKILLS_ROOT).sort()) {
    const full = path.join(REAL_SKILLS_ROOT, child);
    try {
      if (!statSync(full).isDirectory() || !existsSync(path.join(full, 'SKILL.md'))) continue;
    } catch {
      continue;
    }
    const meta = readSkillMeta(full);
    try {
      meta.updated_at = Math.floor(statSync(full).mtimeMs / 1000);
    } catch {
      meta.updated_at = null;
    }
    items.push(meta);
  }
  return items;
}

/** Admin 同步：校验 zip 并覆盖共享区 runtime/.agent/skills/{name}/（不触碰任何用户登记）。 */
export function updateSharedBifrostSkill(zipBytes: Uint8Array): Record<string, unknown> {
  const info = validateSkillZip(zipBytes);
  const name = info.name;
  const dest = path.join(REAL_SKILLS_ROOT, name);
  removePath(dest);
  return extractSkillZip(zipBytes, dest, info);
}

/** Admin 删除：从共享区彻底删除 skill 包，并清理指向它的用户登记软链；返回清理条数。 */
export function removeSharedBifrostSkill(skillName: string): number {
  const name = (skillName ?? '').trim();
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new SkillValidationError('skill 名称含非法字符');
  }
  removePath(path.join(REAL_SKILLS_ROOT, name));
  let cleaned = 0;
  if (!existsSync(RUNTIME_ROOT)) return cleaned;
  for (const entry of readdirSync(RUNTIME_ROOT)) {
    if (!/^\d+$/.test(entry)) continue;
    const registry = path.join(RUNTIME_ROOT, entry, 'skills', name);
    try {
      if (lstatSync(registry).isSymbolicLink()) {
        unlinkSync(registry);
        cleaned += 1;
      }
    } catch {
      /* 不存在则跳过 */
    }
  }
  return cleaned;
}



/**
 * 把工作区内的相对路径解析为绝对路径；越界（../ 等）返回 null。
 * 两道防线：
 * 1. 词法越界拦截（normpath 后 .. 是否跳出工作区）；
 * 2. 软链放行：realpath 穿透软链后，仅当落点在工作区内或共享/登记前缀内才放行。
 */
export function resolveSkillAbs(userId: number, relPath: string, workspace?: string): string | null {
  const root = path.resolve(workspace ?? workspaceRoot(userId));
  // 1) 词法层
  const lexical = path.normalize(path.join(root, relPath ?? ''));
  if (lexical !== root && !lexical.startsWith(root + path.sep)) return null;
  // 2) 符号层：realpath 穿透软链
  let candidate: string;
  try {
    candidate = realpathSync(lexical);
  } catch {
    return null;
  }
  const realpathSafe = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const allowedRoots = [root, realpathSafe(REAL_SKILLS_ROOT), realpathSafe(REAL_AGENTS_ROOT), realpathSafe(userSkillsRoot(userId))];
  for (const allowed of allowedRoots) {
    if (candidate === allowed || candidate.startsWith(allowed + path.sep)) return candidate;
  }
  return null;
}
