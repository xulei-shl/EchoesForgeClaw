import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GlamSearchError,
  availableGlamProviders,
  searchGlamImages,
} from '../../src/services/multimodal/glam-search-service.js';

/**
 * 「全部来源」(provider='all') 聚合行为回归：
 * - 结果按源**轮转交错**合并（不再是各源整块拼接，否则候选清单前几条永远被第一个来源占满）；
 * - 全部来源都失败时抛 GlamSearchError（不再伪装成「没有结果」的空列表）。
 *
 * 免凭据来源里只让 artsmia / wellcome 两个返回数据，其余（met / rijks / ai-chicago / cleveland / smk / loc）
 * 的请求全部失败——既覆盖“部分失败不影响其余”，也让顺序断言与来源数量无关。
 */

/** 明尼阿波利斯美术馆（Elasticsearch 接口）最小可用响应 */
const ARTSMIA_BODY = {
  hits: {
    hits: [
      { _id: '101', _score: 1, _source: { title: 'Artsmia 1' } },
      { _id: '102', _score: 1, _source: { title: 'Artsmia 2' } },
    ],
    total: { value: 2 },
  },
};

/** Wellcome 收藏最小可用响应 */
const WELLCOME_BODY = {
  results: [
    {
      thumbnail: { url: 'https://iiif.wellcomecollection.org/image/w1/info.json' },
      source: { title: 'Wellcome 1', id: 'w1' },
    },
    {
      thumbnail: { url: 'https://iiif.wellcomecollection.org/image/w2/info.json' },
      source: { title: 'Wellcome 2', id: 'w2' },
    },
  ],
  totalResults: 2,
};

/** 按域名返回固定响应；其余域名一律网络失败 */
function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const host = new URL(String(url)).hostname;
      if (host === 'search.artsmia.org') {
        return { ok: true, status: 200, json: async () => ARTSMIA_BODY };
      }
      if (host === 'api.wellcomecollection.org') {
        return { ok: true, status: 200, json: async () => WELLCOME_BODY };
      }
      throw new TypeError('fetch failed');
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 与路由一致：未配置任何 Key / 代理的凭据（字段齐全，只是空串） */
const NO_CREDS = {
  harvardApiKey: '',
  nyplApiKey: '',
  smithsonianApiKey: '',
  parisApiKey: '',
  europeanaApiKey: '',
  locProxy: '',
};

describe('GLAM 聚合检索（provider=all）', () => {
  it('多个来源均成功时按源轮转交错返回', async () => {
    stubFetch();
    // 前置条件：无凭据时这两个源确实在可用清单里（否则断言会失去意义）
    const included = availableGlamProviders(NO_CREDS);
    expect(included).toContain('artsmia');
    expect(included).toContain('wellcome');

    const result = await searchGlamImages('all', NO_CREDS, { query: '水彩', limit: 8 });

    // 交错顺序：各源第 1 条 → 各源第 2 条（整块拼接会是 artsmia, artsmia, wellcome, wellcome）
    expect(result.items.map((i) => i.source)).toEqual([
      'artsmia',
      'wellcome',
      'artsmia',
      'wellcome',
    ]);
    // 失败来源不进结果，也不出现在 perSource 里
    expect(Object.keys(result.perSource ?? {})).toContain('artsmia');
    expect(Object.keys(result.perSource ?? {})).toContain('wellcome');
    expect(Object.keys(result.perSource ?? {})).not.toContain('cleveland');
    // 部分来源失败要回传失败清单（带来源名与原因），供前端提示 / Agent 回执
    const failed = result.failedSources ?? [];
    expect(failed.map((f) => f.provider)).toContain('cleveland');
    expect(failed.every((f) => f.label.length > 0 && f.reason.length > 0)).toBe(true);
  });

  it('全部来源都失败时抛出 GlamSearchError（不返回空结果）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      })
    );

    const failure: any = await searchGlamImages('all', NO_CREDS, { query: '水彩' }).catch(
      (e) => e
    );
    expect(failure).toBeInstanceOf(GlamSearchError);
    // 报错文案要带上失败原因（不是一句笼统的「失败」）
    expect(failure.message).toMatch(/失败/);
    expect(failure.message).toMatch(/MET|明尼阿波利斯|Wellcome|克利夫兰/);
  });
});
