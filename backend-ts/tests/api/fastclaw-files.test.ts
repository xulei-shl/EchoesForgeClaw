/**
 * FastClaw 会话工作区文件单测：列表过滤（仅当前会话）/ 路径越界守卫 / 下载代理 URL 构造。
 *
 * 覆盖 fastclaw-service.listSessionFiles / fetchSessionFile / sessionFilePath：
 * - 列表只透传 sessions/<sessionId>/ 子前缀（防跨会话/agent 根文件混入）
 * - sessionFilePath 拒绝其它会话前缀与 .. 跳转
 * - fetchSessionFile 逐段编码路径并转发 end_user 头；上游非 2xx 返回 null
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  FastClawAgentError,
  FastClawAgentService,
  type FastClawRuntimeConfig,
} from '../../src/services/fastclaw-service.js';

const cfg: FastClawRuntimeConfig = {
  base_url: 'http://fc:18953',
  api_key: 'k-test',
  agent_id: 'agt_x',
  end_user: 'bookplate-1',
};

const makeResponse = (body: unknown, ok = true, status = 200, headers?: Record<string, string>) => {
  const h = new Headers(headers);
  return {
    ok,
    status,
    headers: h,
    json: () => Promise.resolve(body),
    body: new Blob(['hello']).stream(),
  } as unknown as Response;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sessionFilePath', () => {
  it('接受归属当前会话的路径', () => {
    expect(
      FastClawAgentService.sessionFilePath('bookplate-1-a-0', 'sessions/bookplate-1-a-0/report.md')
    ).toBe('sessions/bookplate-1-a-0/report.md');
  });
  it('拒绝其它会话前缀', () => {
    expect(
      FastClawAgentService.sessionFilePath('bookplate-1-a-0', 'sessions/other/secret.png')
    ).toBeNull();
    expect(FastClawAgentService.sessionFilePath('bookplate-1-a-0', 'secret.png')).toBeNull();
  });
  it('拒绝 .. 目录穿越', () => {
    expect(
      FastClawAgentService.sessionFilePath('bookplate-1-a-0', 'sessions/bookplate-1-a-0/../../x.png')
    ).toBeNull();
  });
});

describe('listSessionFiles', () => {
  it('仅返回当前会话子前缀的文件，并映射 size/modTime', async () => {
    const fetchMock = vi.fn((_url, init) => {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer k-test' });
      expect(init?.headers?.['X-Fastclaw-End-User']).toBe('bookplate-1');
      return Promise.resolve(
        makeResponse({
          files: [
            { path: 'sessions/bookplate-1-a-0/report.md', size: 12, modTime: 1700000000 },
            { path: 'sessions/bookplate-1-a-0/img_0.png', size: 34, modTime: 1700000001 },
            // 其它会话/agent 根文件不应透传
            { path: 'sessions/other/leak.png', size: 99, modTime: 0 },
            { path: 'notes.md', size: 5, modTime: 0 },
          ],
        })
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const got = await new FastClawAgentService().listSessionFiles(cfg, 'bookplate-1-a-0');
    expect(got.map((f) => f.path)).toEqual([
      'sessions/bookplate-1-a-0/report.md',
      'sessions/bookplate-1-a-0/img_0.png',
    ]);
    expect(got[0]).toMatchObject({ size: 12, mtimeMs: 1700000000000 });
  });

  it('空配置/空会话返回空数组', async () => {
    const s = new FastClawAgentService();
    expect(await s.listSessionFiles({ ...cfg, agent_id: '' }, 'bookplate-1-a-0')).toEqual([]);
    expect(await s.listSessionFiles(cfg, '')).toEqual([]);
  });

  it('上游非 2xx 抛 FastClawAgentError', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(makeResponse({}, false, 500)));
    await expect(
      new FastClawAgentService().listSessionFiles(cfg, 'bookplate-1-a-0')
    ).rejects.toBeInstanceOf(FastClawAgentError);
  });
});

describe('fetchSessionFile', () => {
  it('构造逐段编码的下游 URL 并返回上游 Response', async () => {
    let calledUrl = '';
    vi.stubGlobal('fetch', (url: string, init: { headers?: Record<string, string> }) => {
      calledUrl = String(url);
      expect(init?.headers?.['X-Fastclaw-End-User']).toBe('bookplate-1');
      return Promise.resolve(makeResponse(undefined, true, 200, { 'content-type': 'image/png' }));
    });
    const resp = await new FastClawAgentService().fetchSessionFile(
      cfg,
      'bookplate-1-a-0',
      'sessions/bookplate-1-a-0/图 片.png'
    );
    expect(calledUrl).toContain('/api/agents/agt_x/files/');
    expect(calledUrl).toContain(encodeURIComponent('图') + encodeURIComponent(' '));
    expect(resp).not.toBeNull();
  });

  it('越界路径返回 null，不发起请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const s = new FastClawAgentService();
    expect(await s.fetchSessionFile(cfg, 'bookplate-1-a-0', '../secret.png')).toBeNull();
    expect(await s.fetchSessionFile(cfg, 'bookplate-1-a-0', 'sessions/other/x.png')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('连接失败抛 FastClawAgentError', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')));
    await expect(
      new FastClawAgentService().fetchSessionFile(
        cfg,
        'bookplate-1-a-0',
        'sessions/bookplate-1-a-0/report.md'
      )
    ).rejects.toBeInstanceOf(FastClawAgentError);
  });
});