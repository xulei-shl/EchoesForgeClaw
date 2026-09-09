import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * pi CLI / 扩展包定位（零业务耦合的解析器）。
 *
 * 负责：
 * - resolvePiBin：解析 pi CLI 启动命令（PI_BIN 优先，否则依赖树解析）
 * - resolveImageGenExtension：解析绘图扩展入口（未安装返回 null）
 * - resolvePiExtensions：管理员白名单扩展解析（§4.3 白名单 + 版本锁定）
 */

// 仓库根 = 本文件（src/services/pi/）向上四层；后端根 = 仓库根/backend-ts
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const BACKEND_ROOT = path.join(REPO_ROOT, 'backend-ts');

export interface PiCommand {
  cmd: string;
  args: string[];
}

const PI_PKG_CANDIDATES = [
  path.join(BACKEND_ROOT, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js'),
  path.join(REPO_ROOT, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js'),
];
const IMAGE_GEN_EXT_CANDIDATES = [
  path.join(BACKEND_ROOT, 'node_modules', '@amaster.ai', 'pi-image-gen', 'dist', 'index.js'),
  path.join(REPO_ROOT, 'node_modules', '@amaster.ai', 'pi-image-gen', 'dist', 'index.js'),
];

function firstExisting(candidates: string[]): string | null {
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch {
      /* 忽略不可访问候选 */
    }
  }
  return null;
}

/**
 * 解析 pi CLI 启动命令：PI_BIN 环境变量优先（直接作为可执行命令），
 * 否则从 backend-ts 依赖树解析包内 bin 入口用当前 node 运行。缺失抛中文错误。
 */
export function resolvePiBin(): PiCommand {
  const override = process.env.PI_BIN?.trim();
  if (override) return { cmd: override, args: [] };
  const cliJs = firstExisting(PI_PKG_CANDIDATES);
  if (cliJs) return { cmd: process.execPath, args: [cliJs] };
  throw new Error(
    '未找到 pi CLI：请在 backend-ts 安装 @earendil-works/pi-coding-agent，或通过 PI_BIN 指定可执行的 pi 命令'
  );
}

/** 解析 pi-image-gen 扩展入口（未安装返回 null = 不加载绘图工具）。 */
export function resolveImageGenExtension(): string | null {
  return firstExisting(IMAGE_GEN_EXT_CANDIDATES);
}

// ---------------------------------------------------------------------------
// 扩展包白名单装配（§4.3：管理员白名单 + 版本锁定 + 显式 -e 加载）
// ---------------------------------------------------------------------------

/**
 * pi 全局 agent 目录（同 pi-coding-agent 的 getAgentDir 口径）：
 * PI_CODING_AGENT_DIR 显式指定时优先，否则 ~/.pi/agent。
 * 注意：这是「后端发现管理员已装扩展」用的宿主目录，与 runPiAgent 给子进程
 * 注入的 {ws}/.pi-agent（每工作区 agentDir）不同。
 */
function piAgentHomeDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR?.trim();
  return envDir ? path.resolve(envDir) : path.join(homedir(), '.pi', 'agent');
}

/**
 * `pi install npm:<pkg>` 的全局落点（同 pi-coding-agent package-manager 的
 * resolveManagedPath 口径）：{agentDir}/npm/node_modules。作为白名单扩展的
 * 候选解析位置之一，使「管理员用 pi install 装包 + PI_EXTENSIONS 白名单」
 * 即可接入，无需再手动复制进 backend-ts 依赖树。
 */
function piNpmPackagesDir(): string {
  return path.join(piAgentHomeDir(), 'npm', 'node_modules');
}

export interface PiExtensionSpec {
  /** 包名（如 "@juicesharp/rpiv-todo"）。 */
  name: string;
  /** 已安装包目录（backend-ts/node_modules、仓库根 node_modules 或 pi 全局 npm 目录）。 */
  dir: string;
}

/**
 * 解析白名单内已安装的扩展包（未安装的静默跳过；返回按白名单顺序）。
 * 白名单 = 管理员批准的服务端代码扩展（多租户最高风险），运行期从
 * PI_EXTENSIONS 读取（逗号分隔的 npm 包名）；用户技能（纯提示词/工具声明）
 * 继续走 skills 流程，二者互不混用。
 * 版本锁定：升级 = 固定包版本（pi install / npm 安装锁定版本） + 回归验证。
 * 解析顺序：backend-ts 依赖树 → 仓库根依赖树 → pi 全局 npm 目录（首个命中生效）。
 */
export function resolvePiExtensions(): PiExtensionSpec[] {
  const whitelist = (process.env.PI_EXTENSIONS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const specs: PiExtensionSpec[] = [];
  for (const raw of whitelist) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    // 按 node_modules 布局展开 scoped 包名（@scope/pkg → @scope/pkg）
    const segs = name.split('/').filter(Boolean);
    const rel = path.join('node_modules', ...segs);
    const dir = firstExisting([
      path.join(BACKEND_ROOT, rel),
      path.join(REPO_ROOT, rel),
      path.join(piNpmPackagesDir(), ...segs),
    ]);
    if (dir) specs.push({ name, dir });
  }
  return specs;
}

/**
 * 扩展在工作区 .pi-agent/extensions/ 下的扁平目录名：
 * scoped 包展平为包名（@juicesharp/rpiv-todo → rpiv-todo），
 * 避免嵌套目录（pi 自动发现仅一层，且显式 -e 解析 package.json 入口不依赖目录层级）。
 */
export function extensionDirName(pkgName: string): string {
  return pkgName
    .replace(/^@[^/]+\//, '')
    .replace(/[/\\]/g, '_')
    .slice(0, 100);
}