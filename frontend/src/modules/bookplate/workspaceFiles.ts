/**
 * Skill Agent 产物文件的正文提取与展示辅助。
 *
 * pi（skill agent）的回复正文会以内联 markdown 图片 / 路径引用AI 产物
 * （如 `![x](/opt/…/runtime/1/workspace/{wsId}/outputs/x.png)`），这些是服务器本地路径，
 * 浏览器无法直接加载。这里把正文中的文件引用换算为 skill-files 鉴权接口 URL，
 * 交由 ChatNode 的文件卡片组件（fetch→blob）渲染预览与下载；同时提供剔除
 * 气泡内不可加载图片语法的清洗函数，避免裂图。
 *
 * 提取在渲染时进行（纯函数、不写状态）：不依赖流式事件链，刷新后仍可从持久化正文重建。
 */

import type { AgentFile } from '../../platform/types';

/** 与后端 pi-agent-service MIME_BY_EXT 同口径：可识别为「产物文件」的扩展名 */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  html: 'text/html',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

const KNOWN_EXTS = Object.keys(MIME_BY_EXT);
const EXT_ALT = KNOWN_EXTS.map((e) => e.replace(/[.+]/g, '\\$&')).join('|');

/** workspace_id 允许字符（与后端 sanitizeWorkspaceId 清洗后口径一致） */
const WS_ID_SAFE = /^[A-Za-z0-9_-]+$/;

/** 文件名 → mime（未知扩展名按二进制下载处理）。 */
export function mimeOfFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export interface WorkspaceRef {
  /** 工作区相对路径（skill-files 接口的 path 参数） */
  rel: string;
  /** 归属工作区 id（显式传入优先，否则取绝对路径中内嵌的 id） */
  wsId: string;
}

/**
 * 把一个文件引用换算为工作区相对路径 + 归属工作区：
 * - 绝对路径：…/runtime/{uid}/workspace/{wsId}/<rel>（wsId 以路径内嵌为准，可与显式传入比对）
 * - 相对路径：<dir>[/<dir>…]/<file>.<已知扩展名>（如 outputs/foo.png；拒绝 .. 跳转）
 * 其余（网页 URL / data URL / 无关文本）返回 null。
 */
export function resolveWorkspaceRef(
  raw: string,
  workspaceId?: string | null
): WorkspaceRef | null {
  if (!raw) return null;
  let p = String(raw).trim().replace(/^file:\/\//, '').replace(/\\/g, '/');
  if (p.startsWith('<') && p.endsWith('>')) p = p.slice(1, -1);
  const dot = p.lastIndexOf('.');
  const ext = dot >= 0 ? p.slice(dot + 1).toLowerCase() : '';
  if (!KNOWN_EXTS.includes(ext) || ext === '') return null;

  if (p.startsWith('/')) {
    // 绝对路径：定位 runtime/<uid>/workspace/<wsId>/ 前缀
    const m = /\/runtime\/\d+\/workspace\/([^/]+)\//.exec(p);
    if (!m || !WS_ID_SAFE.test(m[1])) return null;
    const embeddedWsId = m[1];
    if (workspaceId && embeddedWsId !== workspaceId) return null; // 非本节点工作区的历史产物
    return { rel: p.slice(m.index + m[0].length), wsId: embeddedWsId };
  }

  // 相对路径：至少一层目录，且无相对跳转
  p = p.replace(/^\.\//, '');
  if (p.includes('../') || !/^[^/]+(?:\/[^/]+)+$/.test(p)) return null;
  if (!workspaceId || !WS_ID_SAFE.test(workspaceId)) return null;
  return { rel: p, wsId: workspaceId };
}

/** 构造 skill-files 鉴权下载 URL（与后端 agent_file 事件的 url 口径一致）。 */
export function skillFileUrl(ref: WorkspaceRef): string {
  return `/api/modules/bookplate/skill-files?path=${encodeURIComponent(ref.rel)}&workspace_id=${encodeURIComponent(ref.wsId)}`;
}

/**
 * 从助手正文中提取AI 产物文件（去重）：
 * - markdown 图片 / 链接引用（模型被指示原样内联图片语法）
 * - 反引号包裹或裸露的工作区路径（如 「文件保存于 `outputs/foo.md`」）
 * 返回可直接交给文件卡片渲染的 AgentFile[]（size 未知记 0，卡片自动隐藏大小）。
 */
export function extractWorkspaceFiles(
  content: string,
  workspaceId?: string | null
): AgentFile[] {
  if (!content || !content.includes('/')) return [];
  const found = new Map<string, AgentFile>();
  const consider = (rawPath: string): void => {
    const ref = resolveWorkspaceRef(rawPath, workspaceId);
    if (!ref) return;
    if (found.has(ref.rel)) return;
    found.set(ref.rel, {
      url: skillFileUrl(ref),
      name: ref.rel.slice(ref.rel.lastIndexOf('/') + 1),
      mime: mimeOfFileName(ref.rel),
      size: 0,
      path: ref.rel,
    });
  };

  // 1) markdown 图片 / 链接：![alt](target) / [text](target)
  for (const m of content.matchAll(/!?\[[^\]]*\]\(\s*(\S+?)(?:\s+"[^"]*)?\)/g)) {
    consider(m[1]);
  }
  // 2) 反引号或裸路径：…/x.png、outputs/x.pdf 等（前后边界防误截 token）
  for (const m of content.matchAll(new RegExp(`[\\w@./\\\\-]+\\.(?:${EXT_ALT})`, 'gi'))) {
    consider(m[0]);
  }
  return [...found.values()];
}

/**
 * 剔除正文中无法在浏览器加载的图片语法：
 * - 本AI 产物路径（绝对 / 相对，见 resolveWorkspaceRef）
 * - 其它本机绝对路径（如 FastClaw 等外部 agent 引用的服务器路径，/api/、/static/ 除外）
 * 保留网页图片与 data URL；随后收敛多余空行。文件本体由消息下方的文件卡片展示。
 */
export function stripUnrenderableImages(content: string, workspaceId?: string | null): string {
  if (!content) return content;
  const cleaned = content.replace(/!\[[^\]]*\]\(\s*(\S+?)(?:\s+"[^"]*)?\)/g, (full, target) => {
    const t = String(target).replace(/^<|>$/g, '');
    if (resolveWorkspaceRef(t, workspaceId)) return '';
    // 外部 agent 的本机绝对路径：以 / 开头、已知扩展名、且非本站接口/静态资源
    const dot = t.lastIndexOf('.');
    const ext = dot >= 0 ? t.slice(dot + 1).toLowerCase() : '';
    if (t.startsWith('/') && !t.startsWith('/api/') && !t.startsWith('/static/') && KNOWN_EXTS.includes(ext)) {
      return '';
    }
    return full;
  });
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

/** 合并两组文件卡片数据并按 url 去重（保持原有顺序在前）。 */
export function mergeAgentFiles(a?: AgentFile[], b?: AgentFile[]): AgentFile[] {
  const out = new Map<string, AgentFile>();
  for (const f of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    if (!f || typeof f.url !== 'string' || !f.url) continue;
    out.set(f.url, f);
  }
  return [...out.values()];
}

/**
 * 工作区文件类别（侧边抽屉 tab 的注册表数据源）：
 * - 各类别 matches 判定需互斥（每个文件恰好命中一个类别），注册表顺序即抽屉 Tab 顺序；
 *   「AI 产物」为兜底（承接所有非 inputs/ 文件）；
 * - 未来新增类别（如输出快照 / 共享素材等）= 在此追加一条描述 + 互斥判定即可，
 *   抽屉 Tab 与列表会自动扩展，无需改动组件逻辑。
 */
export interface WorkspaceFileCategory<ID extends string = string> {
  /** 类别唯一标识（tab 切换 key；默认选中第一个类别） */
  id: ID;
  /** tab 展示名 */
  label: string;
  /** 文件归属判定（inputs/ = 我的上传；其余兜底 = AI 产物） */
  matches: (file: AgentFile) => boolean;
}

/** 工作区相对路径是否属于用户上传（inputs/ 前缀；上传文件不是 agent 产物）。 */
function isUploadedPath(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith('inputs/');
}

/** 当前内置类别：AI 产物 / 我的上传（顺序即抽屉 Tab 默认顺序）。 */
export const WORKSPACE_FILE_CATEGORIES: WorkspaceFileCategory<'artifacts' | 'uploads'>[] = [
  {
    id: 'artifacts',
    label: 'AI 产物',
    matches: (f) => !isUploadedPath(f.path),
  },
  {
    id: 'uploads',
    label: '我的上传',
    matches: (f) => isUploadedPath(f.path),
  },
];

/**
 * 按文件修改时间倒序（最新在前）：时间戳缺失（agent_file 事件 / FastClaw 列表）时
 * 落到 0 并保持传入相对顺序（Array.prototype.sort 稳定），不改变既有无时间戳行为。
 */
export function sortWorkspaceFilesByTime<T extends AgentFile>(files: T[]): T[] {
  return [...files].sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0));
}

/**
 * 用户消息中的上传文件引用：inputs/ 前缀的相对路径 token（已知扩展名，可带反引号包裹）。
 * 文件名含空格/中文标点时不匹配（与正文提取口径一致，属已知边界）。
 */
const INPUTS_PATH_RE = new RegExp(
  `(\`?inputs\\/[^\\s<>"'，。；：、！？\\u3000]+\\.(?:${EXT_ALT})\`?)`,
  'gi'
);

/**
 * 从用户消息正文提取上传文件（inputs/ 相对路径）→ 卡片数据，并返回剔除这些路径后的展示文本。
 * 发送给模型的原文不变（路径仍随正文送达 pi）；仅展示层把路径替换为可预览/下载的卡片，
 * 与 assistant 侧的产物卡片对称。
 */
export function extractUserUploadRefs(
  content: string,
  workspaceId?: string | null
): { files: AgentFile[]; display: string } {
  if (!content || !workspaceId) return { files: [], display: content };
  const files: AgentFile[] = [];
  const display = content.replace(INPUTS_PATH_RE, (full, token: string) => {
    const clean = String(token).replace(/^`|`$/g, '');
    const ref = resolveWorkspaceRef(clean, workspaceId);
    if (!ref || !ref.rel.startsWith('inputs/')) return full;
    if (!files.some((f) => f.path === ref.rel)) {
      files.push({
        url: skillFileUrl(ref),
        name: ref.rel.slice(ref.rel.lastIndexOf('/') + 1),
        mime: mimeOfFileName(ref.rel),
        size: 0,
        path: ref.rel,
      });
    }
    return '';
  });
  // 路径被替换后留下的连续空格收敛（「请分析 inputs/a.pdf 与 …」→「请分析 与 …」）
  return { files, display: display.replace(/ {2,}/g, ' ').trim() };
}
