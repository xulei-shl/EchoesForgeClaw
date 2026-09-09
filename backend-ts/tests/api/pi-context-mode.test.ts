import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import {
  killPiProcess,
  preparePiWorkspace,
  runPiAgent,
} from '../../src/services/ai/pi-agent-service.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as new (p: string, opts?: { readonly?: boolean }) => {
  prepare(sql: string): { get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] };
  close(): void;
};

// runtime/ 在仓库根目录下，测试文件位于 backend-ts/tests/api/，向上三层
const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../runtime');

const UID = 990003;
const WS_ID = `pi-cm_${Date.now()}`;
const RULE_MARKER = 'CM-RULE-SMOKE-9f2a';

/** 进程内 mock：openai-completions SSE。
 *  - 用户文本含 `read-file: <path>` → 返回 read 工具调用（验证文件内容捕获，§5.1）；
 *  - 否则首个非工具回合返回 bash echo 工具调用。
 *  工具回合一律回 'done'。 */
async function startMock(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      const msgs = Array.isArray(parsed.messages) ? parsed.messages : [];
      const last = msgs[msgs.length - 1];
      const isToolTurn = last && last.role === 'tool';

      // 扫描全部消息文本（context-mode 会在末尾注入 user 引导消息，不能只看最后一条 user）
      const allText = msgs
        .map((m: { content?: unknown }) =>
          Array.isArray(m.content)
            ? (m.content as { type?: string; text?: string }[])
                .filter((c) => c.type === 'text' && typeof c.text === 'string')
                .map((c) => c.text!)
                .join('\n')
            : typeof m.content === 'string'
              ? m.content
              : ''
        )
        .join('\n');
      const readMatch = /read-file:\s*(\S+)/.exec(allText);

      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta: unknown, finish?: string) =>
        `data: ${JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'test-model',
          choices: [{ index: 0, delta, finish_reason: finish ?? null }],
        })}\n\n`;
      if (isToolTurn) {
        res.write(chunk({ role: 'assistant', content: 'done' }));
        res.write(chunk({}, 'stop'));
      } else if (readMatch) {
        res.write(
          chunk({
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                index: 0,
                id: 'call_read',
                type: 'function',
                function: { name: 'read', arguments: JSON.stringify({ path: readMatch[1] }) },
              },
            ],
          })
        );
        res.write(chunk({}, 'tool_calls'));
      } else {
        res.write(
          chunk({
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                index: 0,
                id: 'call_bash',
                type: 'function',
                function: {
                  name: 'bash',
                  arguments: JSON.stringify({ command: 'echo context-mode-smoke' }),
                },
              },
            ],
          })
        );
        res.write(chunk({}, 'tool_calls'));
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  return { server, port };
}

/** taskkill 是 fire-and-forget：杀树后子进程句柄释放需一点时间，rmSync 需带重试。 */
async function waitRm(target: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      rmSync(target, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  rmSync(target, { recursive: true, force: true });
}

/**
 * 本次运行的 context-mode 会话 DB。
 * BaseAdapter 的存储根由 CONTEXT_MODE_DATA_DIR 覆盖 → <dir>/context-mode/sessions/<hash>.db。
 * 每次运行 cmDir 全新，按 mtime 取最新即可（避免跨运行文件串扰）。
 */
function findSessionDb(cmDir: string): string | null {
  const dir = path.join(cmDir, 'context-mode', 'sessions');
  if (!existsSync(dir)) return null;
  const dbs = readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => path.join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return dbs[0] ?? null;
}

function countWhere(dbPath: string, type: string | null, like: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    const where = [];
    const params: unknown[] = [];
    if (type) {
      where.push('type = ?');
      params.push(type);
    }
    if (like) {
      where.push('data LIKE ?');
      params.push(`%${like}%`);
    }
    const sql = `SELECT COUNT(*) AS cnt FROM session_events${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
    const row = db.prepare(sql).get(...params) as { cnt: number };
    return row.cnt;
  } finally {
    db.close();
  }
}

describe('runPiAgent + context-mode 扩展（L0 自动加载 / L1 会话捕获，含 §5.1 content[] 映射）', () => {
  let mock: { server: Server; port: number };
  let cmDir: string;
  const prev = { piExt: process.env.PI_EXTENSIONS, dataDir: process.env.CONTEXT_MODE_DATA_DIR };

  beforeEach(async () => {
    await killPiProcess(UID, WS_ID);
    await waitRm(path.join(RUNTIME_ROOT, String(UID), 'workspace', WS_ID));
    cmDir = path.join(RUNTIME_ROOT, String(UID), 'cm-smoke');
    rmSync(cmDir, { recursive: true, force: true });
    mkdirSync(cmDir, { recursive: true });
    // 仅本测试装配 context-mode；会话存储用 CONTEXT_MODE_DATA_DIR 隔离到 cmDir
    process.env.PI_EXTENSIONS = 'context-mode';
    process.env.CONTEXT_MODE_DATA_DIR = cmDir;
    mock = await startMock();
  });

  afterEach(async () => {
    await killPiProcess(UID, WS_ID);
    mock.server.close();
    await waitRm(path.join(RUNTIME_ROOT, String(UID), 'workspace', WS_ID));
    await waitRm(cmDir);
    if (prev.piExt === undefined) delete process.env.PI_EXTENSIONS;
    else process.env.PI_EXTENSIONS = prev.piExt;
    if (prev.dataDir === undefined) delete process.env.CONTEXT_MODE_DATA_DIR;
    else process.env.CONTEXT_MODE_DATA_DIR = prev.dataDir;
  });

  it(
    '自动装配加载、bash/read 工具轮正常落定，规则文件内容经 §5.1 映射入库',
    async () => {
      const prepared = preparePiWorkspace(UID, WS_ID, {
        agentId: 1,
        chatModel: {
          baseUrl: `http://127.0.0.1:${mock.port}/v1`,
          apiKey: 'k',
          modelName: 'test-model',
          multimodal: false,
        },
        imageModel: null,
        skillNames: [],
      });

      // L0：白名单扩展已挂载到工作区（软链/junction 或目录）
      const mount = path.join(prepared.ws, '.pi-agent', 'extensions', 'context-mode');
      expect(existsSync(path.join(mount, 'package.json'))).toBe(true);

      // 规则文件（.claude/ 下）——extractor 对规则文件内容做 rule_content 入库
      const notesDir = path.join(prepared.ws, '.claude');
      mkdirSync(notesDir, { recursive: true });
      const notesPath = path.join(notesDir, 'notes.md');
      writeFileSync(notesPath, `# smoke notes\n\n${RULE_MARKER}\nbody line\n`, 'utf-8');

      // 第 1 轮：bash 工具回合
      const round1 = [];
      for await (const evt of runPiAgent({
        userId: UID,
        workspaceId: WS_ID,
        ws: prepared.ws,
        hasPrompt: false,
        chatModelName: 'test-model',
        imageGenEnabled: false,
        message: 'trigger one tool call please',
      })) {
        round1.push(evt);
      }
      expect(round1.some((e) => e.type === 'tool_call' && e.name === 'bash')).toBe(true);
      expect(round1.some((e) => e.type === 'tool_result' && e.name === 'bash')).toBe(true);
      expect(round1.some((e) => e.type === 'error')).toBe(false);

      // 第 2 轮：read 规则文件 → 验证 content[] → tool_response → rule_content 入库
      const round2 = [];
      for await (const evt of runPiAgent({
        userId: UID,
        workspaceId: WS_ID,
        ws: prepared.ws,
        hasPrompt: false,
        chatModelName: 'test-model',
        imageGenEnabled: false,
        message: `read-file: ${notesPath}`,
      })) {
        round2.push(evt);
      }
      expect(round2.some((e) => e.type === 'tool_call' && e.name === 'read')).toBe(true);
      expect(round2.some((e) => e.type === 'tool_result' && e.name === 'read')).toBe(true);
      expect(round2.some((e) => e.type === 'error')).toBe(false);

      // L1：会话事件入库；读规则文件时：file_read + rule + rule_content(含文件正文)
      const dbPath = findSessionDb(cmDir);
      expect(dbPath).not.toBeNull();
      expect(countWhere(dbPath!, 'file_read', 'notes.md')).toBeGreaterThan(0);
      expect(countWhere(dbPath!, 'rule', 'notes.md')).toBeGreaterThan(0);
      const contentRows = countWhere(dbPath!, 'rule_content', RULE_MARKER);
      // §5.1 映射生效：工具输出（content[]）进入 tool_response，规则正文才能入库
      expect(contentRows).toBeGreaterThan(0);
      // bash 工具回合也被捕获（generic/params）
      expect(countWhere(dbPath!, 'tool_call', 'context-mode-smoke')).toBeGreaterThan(0);
    },
    200_000
  );
});
