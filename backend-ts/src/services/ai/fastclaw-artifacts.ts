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
import { createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { env } from '../../config/env.js';
import { mimeOf } from '../platform/file-utils.js';
import { readArtifactManifest } from './pi/snapshot.js';

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

// ---------------------------------------------------------------------------
// 跨 Agent 产物继承（签名 URL 附件）
// ---------------------------------------------------------------------------
//
// FastClaw 会话按 (agent, sessionKey) 隔离：同 workspaceId 换 Agent = FastClaw 新会话，
// 新 Agent 的工具只能读自己会话 /workspace，读不到历史产物（本端 outputs/ 或旧 Agent
// 的会话目录都超出其 sandbox 边界）。跨 Agent 首轮把历史产物作为 chat attachments
// （http(s) URL）传给 FastClaw，由其官方物化逻辑写入新会话 /workspace（宿主 + Store +
// 沙箱三写一致）——B 工具用相对路径即可读取、文件面板自动列出、LLM 只见一行
// [Attached: /workspace/<name>] breadcrumb（不占上下文窗口）。
//
// URL 用 HMAC 签名 + 短 TTL（无鉴权端点，FastClaw fetch 不带调用方凭据；签名即鉴权），
// 仅放行本工作区 outputs/ 下的普通文件。

/** 跨 Agent 继承附件：单文件上限（远低于 FastClaw 端 25MB 硬上限，防大文件拖垮请求/下载）。 */
const INHERIT_MAX_BYTES_PER_FILE = 8 * 1024 * 1024;
/** 跨 Agent 继承附件：单轮数量上限（对齐收割上限，防一次折叠塞入大量文件）。 */
const INHERIT_MAX_FILES = 12;
/** 签名 URL 有效期（秒）：FastClaw 下载超时 30s，留足余量。 */
const INHERIT_URL_TTL_SECONDS = 90;

/** 生成继承文件下载 URL（HMAC 签名，无鉴权端点的鉴权凭证；uid 绑定防跨用户）。 */
export function inheritFileUrl(
  rel: string,
  workspaceId: string,
  uid: number,
  now = Date.now()
): string {
  const exp = Math.floor(now / 1000) + INHERIT_URL_TTL_SECONDS;
  const sig = createHmac('sha256', env.secretKey)
    .update(`${uid}|${workspaceId}|${rel}|${exp}`)
    .digest('hex');
  const qs = new URLSearchParams({
    uid: String(uid),
    ws: workspaceId,
    rel,
    exp: String(exp),
    sig,
  });
  return `${env.inheritAttachBaseUrl.replace(/\/+$/, '')}/api/modules/bookplate/chat/inherit-file?${qs.toString()}`;
}

/** 校验继承文件下载 URL（HMAC + 过期 + outputs/ 前缀与词法越界）。 */
export function verifyInheritFileRequest(params: {
  uid?: string;
  ws?: string;
  rel?: string;
  exp?: string;
  sig?: string;
}): { uid: number; workspaceId: string; rel: string } | null {
  const uid = Number(params.uid);
  const ws = String(params.ws ?? '');
  const rel = String(params.rel ?? '');
  const exp = Number(params.exp);
  const sig = String(params.sig ?? '');
  if (!Number.isInteger(uid) || uid <= 0 || !ws || !rel || !Number.isFinite(exp) || !sig) return null;
  if (exp <= Math.floor(Date.now() / 1000)) return null; // 过期
  const expect = createHmac('sha256', env.secretKey)
    .update(`${uid}|${ws}|${rel}|${exp}`)
    .digest('hex');
  if (!/^[0-9a-f]+$/.test(sig) || sig.length !== expect.length) return null;
  // 常量时间比较，防时序侧信道
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expect, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  // 仅放行本工作区 outputs/ 下的普通文件（词法越界拒绝）
  const clean = path.normalize(rel).replace(/\\/g, '/');
  if (!clean.startsWith('outputs/')) return null;
  return { uid, workspaceId: ws, rel: clean };
}

/**
 * 跨 Agent 产物继承：读产物清单 → 过滤仍存在、尺寸/数量在限内的 outputs/ 文件 →
 * 生成签名 URL 附件列表（供 runAgent 的 attachments 字段）。超限 / 已删文件不进附件，
 * 返回文件名清单（调用方拼进折叠文本，至少告知新 Agent 存在哪些历史产物）。
 */
export function buildInheritAttachments(
  ws: string,
  workspaceId: string,
  uid: number
): { attachments: Array<{ url: string; name: string }>; skipped: string[] } {
  const attachments: Array<{ url: string; name: string }> = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  // manifest append-only 且同名按覆盖语义多次记录：按 rel 取最新（列表按写入序，尾部即最新）
  const byRel = new Map<string, { rel: string; size: number }>();
  for (const rec of readArtifactManifest(ws)) {
    if (!rec.rel || !rec.rel.startsWith('outputs/')) continue;
    byRel.set(rec.rel, { rel: rec.rel, size: rec.size });
  }
  for (const { rel, size } of byRel.values()) {
    if (attachments.length >= INHERIT_MAX_FILES) {
      if (!seen.has(rel)) {
        seen.add(rel);
        skipped.push(path.basename(rel));
      }
      continue;
    }
    const full = path.join(ws, rel);
    let st;
    try {
      st = statSync(full);
    } catch {
      if (!seen.has(rel)) {
        seen.add(rel);
        skipped.push(path.basename(rel)); // 已删除/不存在：仅留文件名
      }
      continue;
    }
    if (!st.isFile()) continue;
    if (st.size > INHERIT_MAX_BYTES_PER_FILE) {
      if (!seen.has(rel)) {
        seen.add(rel);
        skipped.push(path.basename(rel));
      }
      continue;
    }
    attachments.push({ url: inheritFileUrl(rel, workspaceId, uid), name: path.basename(rel) });
  }
  return { attachments, skipped };
}

/** 继承文件在磁盘上的绝对路径（调用方已过签名校验；越界由 verifyInheritFileRequest 拦截）。 */
export function inheritFilePath(ws: string, rel: string): string {
  return path.join(ws, rel);
}
