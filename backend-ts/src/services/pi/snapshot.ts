import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mimeOf, skillFileDownloadUrl } from '../file-utils.js';

/**
 * 工作区快照差分（产物探测）与产物清单（manifest）。
 *
 * - snapshotWorkspace / walkWorkspace：递归盘点工作区文件（size + mtimeMs）；
 * - isDiffExcluded：装配物/会话配置排除（.agents/ .pi/ .pi-agent/ inputs/ AGENTS.md）；
 * - appendArtifactManifest：本轮差分产物追加进 append-only JSONL 清单；
 * - listWorkspaceArtifacts：当前快照与 manifest 历史合并（已删文件保留 exists=false）。
 */

// ---------------------------------------------------------------------------
// 快照差分（产物探测）
// ---------------------------------------------------------------------------

interface FileStamp {
  size: number;
  mtimeMs: number;
}

/** 差分排除前缀/文件：装配物与会话配置不算「agent 产物」。 */
const DIFF_EXCLUDED_PREFIXES = ['.agents/', '.pi/', '.pi-agent/', 'inputs/'];
const DIFF_EXCLUDED_FILES = new Set(['AGENTS.md']);

export function isDiffExcluded(rel: string): boolean {
  if (DIFF_EXCLUDED_FILES.has(rel)) return true;
  return DIFF_EXCLUDED_PREFIXES.some((p) => rel.startsWith(p));
}

function walkWorkspace(root: string, out: Map<string, FileStamp>, dir = root, prefix = ''): void {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    let st;
    try {
      st = statSync(full); // 跟随软链不穿透目标内容统计（skills 已被前缀排除）
    } catch {
      continue;
    }
    if (st.isDirectory()) walkWorkspace(root, out, full, rel);
    else if (st.isFile()) out.set(rel, { size: st.size, mtimeMs: st.mtimeMs });
  }
}

/** 递归盘点工作区文件的 size + mtimeMs（供差分探测与产物清单共用）。 */
export function snapshotWorkspace(ws: string): Map<string, FileStamp> {
  const map = new Map<string, FileStamp>();
  walkWorkspace(ws, map);
  return map;
}

// ---------------------------------------------------------------------------
// 产物清单（manifest）与工作区产物列表
// ---------------------------------------------------------------------------

/**
 * 工作区产物清单落点（相对工作区根）。放 .pi-agent/ 下可复用差分排除前缀，
 * 清单不会自报自录；append-only JSONL，读取端按 rel 去重取最新。
 */
export const PI_ARTIFACTS_REL = path.join('.pi-agent', 'artifacts.jsonl');

export interface ArtifactRecord {
  rel: string;
  mime: string;
  size: number;
  mtimeMs: number;
}

/** 把本轮差分出的产物追加进 manifest（best-effort：失败不影响对话流）。 */
export function appendArtifactManifest(ws: string, records: ArtifactRecord[]): void {
  if (!records.length) return;
  const file = path.join(ws, PI_ARTIFACTS_REL);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const lines = records
      .map((r) => JSON.stringify({ ...r, ts: Date.now() }))
      .join('\n');
    writeFileSync(file, `${lines}\n`, { flag: 'a', encoding: 'utf-8' });
  } catch {
    /* 磁盘异常等：清单是可再生的辅助索引，静默跳过 */
  }
}

export interface WorkspaceArtifact extends Omit<ArtifactRecord, 'rel'> {
  /** 工作区相对路径（正斜杠口径，与 agent_file 事件的 path 字段一致） */
  path: string;
  name: string;
  url: string;
  exists: boolean;
}

/**
 * 列出工作区当前产物（差分同口径排除装配物/会话/inputs），并与 manifest 历史
 * 条目合并（文件已被删除的历史产物保留并标 exists=false，维持可追溯）。
 */
export function listWorkspaceArtifacts(ws: string, workspaceId: string): WorkspaceArtifact[] {
  const byRel = new Map<string, WorkspaceArtifact>();
  for (const [rel, stamp] of snapshotWorkspace(ws)) {
    if (isDiffExcluded(rel)) continue;
    byRel.set(rel, {
      path: rel,
      mime: mimeOf(rel),
      size: stamp.size,
      mtimeMs: stamp.mtimeMs,
      name: path.basename(rel),
      url: skillFileDownloadUrl(rel, workspaceId),
      exists: true,
    });
  }
  const manifestFile = path.join(ws, PI_ARTIFACTS_REL);
  try {
    const raw = readFileSync(manifestFile, 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      let rec: Partial<ArtifactRecord>;
      try {
        rec = JSON.parse(trimmed) as Partial<ArtifactRecord>;
      } catch {
        continue;
      }
      if (typeof rec.rel !== 'string' || !rec.rel || byRel.has(rec.rel)) continue;
      byRel.set(rec.rel, {
        path: rec.rel,
        mime: rec.mime ?? mimeOf(rec.rel),
        size: rec.size ?? 0,
        mtimeMs: rec.mtimeMs ?? 0,
        name: path.basename(rec.rel),
        url: skillFileDownloadUrl(rec.rel, workspaceId),
        exists: false,
      });
    }
  } catch {
    /* 无 manifest 或不可读：仅返回当前快照 */
  }
  return [...byRel.values()].sort((a, b) => a.path.localeCompare(b.path));
}