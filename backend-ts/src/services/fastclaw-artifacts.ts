/**
 * FastClaw 产物文件桥接（同机部署）。
 *
 * FastClaw Agent 的产物落在其自身数据目录 /var/lib/fastclaw/workspaces/{agentId}/
 * （会话产物在其 sessions/{sessionKey} 会话子目录），回复正文 / tool_result 里引用的是
 * 本机绝对路径，浏览器无法访问。本模块在流结束后把这些路径安全地拷贝进当前节点的
 * 工作区 outputs/，由调用方以 skill-files URL 发 agent_file 事件——前端预览/下载
 * 链路与 Skill Agent 模式完全同构，零改动。
 *
 * 安全面：仅接受「配置根目录内、真实存在、扩展名可识别」的普通文件；
 * 词法越界与软链穿透双重校验；单文件 / 单轮数量上限防滥用。
 */

import { copyFileSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { mimeOf } from './file-utils.js';

/** FastClaw 数据根目录：env 可覆盖，默认官方安装布局（gateway cwd）。 */
const FASTCLAW_DATA_ROOT_ENV = 'FASTCLAW_DATA_ROOT';
const DEFAULT_FASTCLAW_DATA_ROOT = '/var/lib/fastclaw';

/** 单文件拷贝上限；单轮收割上限（防一次回复引用大量历史文件）。 */
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;
const MAX_ARTIFACTS_PER_TURN = 12;

/** FastClaw 数据根目录；目录不存在返回 null（未部署 / 路径配置错误时不启用桥接）。 */
export function fastclawDataRoot(): string | null {
  const root = path.resolve(process.env[FASTCLAW_DATA_ROOT_ENV]?.trim() || DEFAULT_FASTCLAW_DATA_ROOT);
  try {
    return statSync(root).isDirectory() ? root : null;
  } catch {
    return null;
  }
}

/**
 * 从文本（tool_result / 回复正文）中提取候选产物路径：
 * 仅认「以 / 开头、无空白、扩展名可识别」的绝对 POSIX 路径（反引号/markdown/裸路径均可）。
 * 相对路径不收——FastClaw 的相对引用无法安全定位到其工作区。
 */
export function extractFastclawPathCandidates(text: string): string[] {
  if (!text || !text.includes('/')) return [];
  const out = new Set<string>();
  // 前后边界含中英文常用标点，兼容「路径。」、「（路径）」等中文行文
  for (const m of text.matchAll(
    /(?:^|[\s(`"'>\]【（「『，。；：])((?:\/[A-Za-z0-9_@.+-]+)+\.[A-Za-z0-9]+)(?=$|[\s)`"'<\],.;!?、。，；：！？】》）」』])/gm
  )) {
    const candidate = m[1]!; // 捕获组 1 在整体命中时必存在
    if (mimeOf(candidate) !== 'application/octet-stream') out.add(candidate);
  }
  return [...out];
}

/** 把一个候选路径解析为根目录内的真实文件绝对路径；越界 / 不存在 / 非文件返回 null。 */
export function resolveFastclawArtifact(root: string, rawPath: string): string | null {
  let p = String(rawPath).trim().replace(/^[`'"<]|[`'">]$/g, '');
  if (!p.startsWith('/')) return null;
  // 词法层：normalize 后必须仍落在根内
  const lexical = path.normalize(p);
  if (lexical !== root && !lexical.startsWith(root + path.sep)) return null;
  // 符号层：realpath 穿透软链后必须仍在根内（防根外软链逃逸）
  let real: string;
  try {
    real = realpathSync(lexical);
  } catch {
    return null;
  }
  const realRoot = realpathSync(root);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
  try {
    const st = statSync(real);
    if (!st.isFile() || st.size > MAX_ARTIFACT_BYTES) return null;
  } catch {
    return null;
  }
  return real;
}

export interface HarvestedArtifact {
  /** 拷入节点工作区后的相对路径（outputs/<name>），用于拼 skill-files URL */
  rel: string;
  size: number;
}

/**
 * 收割本轮文本中引用的 FastClaw 产物 → 拷贝进节点工作区 destDir（outputs/）。
 * 同名冲突（不同来源）自动加序号后缀；同名新内容直接覆盖（最新胜出，
 * 与AI 产物「按名寻址」语义一致）。任何单个文件的失败只跳过该项，不中断整体。
 */
export function harvestFastclawArtifacts(opts: {
  root: string;
  texts: Array<string | undefined | null>;
  destDir: string;
}): HarvestedArtifact[] {
  const candidates = new Set<string>(); // 解析通过的源绝对路径
  for (const text of opts.texts) {
    for (const raw of extractFastclawPathCandidates(text ?? '')) {
      const resolved = resolveFastclawArtifact(opts.root, raw);
      if (resolved) candidates.add(resolved);
    }
  }

  mkdirSync(opts.destDir, { recursive: true });
  const harvested: HarvestedArtifact[] = [];
  const takenNames = new Set<string>();

  for (const source of candidates) {
    if (harvested.length >= MAX_ARTIFACTS_PER_TURN) break;
    try {
      const base = path.basename(source);
      let destName = base;
      for (let i = 2; takenNames.has(destName); i++) {
        const ext = path.extname(base);
        destName = `${base.slice(0, base.length - ext.length)}_${i}${ext}`;
      }
      copyFileSync(source, path.join(opts.destDir, destName));
      takenNames.add(destName);
      harvested.push({ rel: `outputs/${destName}`, size: statSync(source).size });
    } catch {
      /* 单个文件失败（权限/消失等）：跳过，不影响其余产物与其余对话 */
    }
  }
  return harvested;
}
