import { afterEach, describe, expect, it } from 'vitest';
import { imageService } from '../../src/services/multimodal/image-service.js';
import { ImageGenerationError } from '../../src/infrastructure/ai/errors.js';
import { startMockOpenAIServer, type MockOpenAIServer } from '../helpers/mock-openai-server.js';
import type { ImageModelConfig } from '../../src/infrastructure/ai/types.js';

/**
 * 契约测试：文生图（对应 Python 图片生成流程）。
 *
 * mock `/v1/images/generations` 返回 b64_json → AI SDK generateImage →
 * 落盘 static/generated → 返回本地 URL；同时验证请求体携带 model/prompt/size。
 */

const openServers: MockOpenAIServer[] = [];

// 与 skills.test.ts 的专用用户 id（99999，afterAll 会整体清理）错开，避免测试产物互相删除
const TEST_UID = 88888;

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((s) => s.close()));
});

// 1x1 红色 PNG（固定字节，避免依赖具体编码器）
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('图像生成（文生图）', () => {
  it('请求携带 model/prompt/size，响应 b64 落盘并返回本地 URL', async () => {
    const srv = await startMockOpenAIServer((req, send) => {
      expect(req.path).toBe('/v1/images/generations');
      expect(req.body.model).toBe('mock-image-model');
      expect(req.body.prompt).toContain('藏书票');
      // 请求体中应包含尺寸参数（透传 config.size）
      expect(JSON.stringify(req.body)).toContain('1024');
      // Agnes 契约：文生图必须顶层 return_base64 才会返回 b64_json（否则 "Invalid JSON response"）
      expect(req.body.return_base64).toBe(true);
      return JSON.stringify({
        created: 0,
        data: [{ b64_json: PNG_BYTES.toString('base64') }],
      });
    });
    openServers.push(srv);

    const config: ImageModelConfig = {
      apiKey: 'sk-mock',
      base_url: srv.baseURL,
      model_name: 'mock-image-model',
      size: '1024x1024',
    };
    const result = await imageService.generateImage('一张藏书票，复古文艺', config, TEST_UID);

    expect(result.mock).toBe(false);
    expect(result.image_url.startsWith(`/static/generated/${TEST_UID}/`)).toBe(true);
    // 落盘内容与 mock 返回一致
    const saved = imageService.readFile(result.image_url);
    expect(saved).not.toBeNull();
    expect(Buffer.from(saved!).equals(PNG_BYTES)).toBe(true);
  });

  it('图生图：请求体带 extra_body.image/response_format，响应 b64 落盘', async () => {
    const srv = await startMockOpenAIServer((req, send) => {
      expect(req.path).toBe('/v1/images/generations');
      expect(req.body.model).toBe('mock-image-model');
      // Agnes 契约：参考图数组必须在 JSON 顶层 extra_body.image，不得放顶层
      expect(req.body.extra_body?.image).toEqual(['https://example.com/ref.png']);
      expect(req.body.extra_body?.response_format).toBe('b64_json');
      expect(req.body.image).toBeUndefined();
      // 尺寸/宽高比透传
      expect(req.body.size).toBe('2K');
      expect(req.body.ratio).toBe('16:9');
      return JSON.stringify({
        created: 0,
        data: [{ url: null, b64_json: PNG_BYTES.toString('base64'), revised_prompt: null }],
      });
    });
    openServers.push(srv);

    const config: ImageModelConfig = {
      apiKey: 'sk-mock',
      base_url: srv.baseURL,
      model_name: 'mock-image-model',
      size: '2K',
      ratio: '16:9',
      image: ['https://example.com/ref.png'],
    };
    const result = await imageService.generateImage('把场景改成赛博朋克夜景', config, TEST_UID);
    expect(result.mock).toBe(false);
    expect(result.image_url.startsWith(`/static/generated/${TEST_UID}/`)).toBe(true);
    const saved = imageService.readFile(result.image_url);
    expect(saved).not.toBeNull();
    expect(Buffer.from(saved!).equals(PNG_BYTES)).toBe(true);
  });

  it('文生图：提供方忽略 return_base64 返回 URL 格式（b64_json 为 null）时，兜底下载并落盘', async () => {
    // 复现 Agnes 实测行为：HTTP 200 + data[0].url（b64_json 为 null）→ AI SDK 抛解析错误
    let outUrl = '';
    const srv = await startMockOpenAIServer((req) => {
      if (req.path === '/v1/images/generations') {
        return JSON.stringify({
          created: 0,
          data: [{ b64_json: null, revised_prompt: null, url: outUrl }],
        });
      }
      if (req.path === '/out.png') {
        return { raw: PNG_BYTES, contentType: 'image/png' };
      }
      return { raw: 'not found', status: 404 };
    });
    openServers.push(srv);
    outUrl = `${srv.rootURL}/out.png`;

    const config: ImageModelConfig = {
      apiKey: 'sk-mock',
      base_url: srv.baseURL,
      model_name: 'mock-image-model',
    };
    const result = await imageService.generateImage('藏书票', config, TEST_UID);
    expect(result.mock).toBe(false);
    expect(result.image_url.startsWith(`/static/generated/${TEST_UID}/`)).toBe(true);
    const saved = imageService.readFile(result.image_url);
    expect(saved).not.toBeNull();
    expect(Buffer.from(saved!).equals(PNG_BYTES)).toBe(true);
  });

  it('提供方返回非 JSON 响应时，错误消息包含状态码与响应体片段（定位 Invalid JSON response）', async () => {
    // 复现用户场景：图像端点返回 HTTP 200 但响应体为 HTML（代理/网关报错页）
    const srv = await startMockOpenAIServer(() => ({
      raw: '<html><body>Bad Gateway from upstream proxy</body></html>',
      contentType: 'text/html',
      status: 200,
    }));
    openServers.push(srv);

    const config: ImageModelConfig = {
      apiKey: 'sk-mock',
      base_url: srv.baseURL,
      model_name: 'mock-image-model',
    };
    const err = await imageService.generateImage('藏书票', config, TEST_UID).catch((e) => e);
    expect(err).toBeInstanceOf(ImageGenerationError);
    // AI SDK 原始报错 + 我们补充的状态码/响应体片段都应出现在消息里
    expect(err.message).toContain('Invalid JSON response');
    expect(err.message).toContain('HTTP 200');
    expect(err.message).toContain('Bad Gateway from upstream proxy');
  });

  it('无 API Key 时返回 Mock SVG 占位图', async () => {
    const result = await imageService.generateImage(
      '藏书票',
      {
        apiKey: '',
        base_url: '',
        model_name: '',
      },
      TEST_UID
    );
    expect(result.mock).toBe(true);
    expect(result.image_url.startsWith(`/static/generated/${TEST_UID}/`)).toBe(true);
    const saved = imageService.readFile(result.image_url);
    expect(saved).not.toBeNull();
    const text = Buffer.from(saved!).toString('utf-8');
    expect(text).toContain('<svg');
    expect(text).toContain('藏书票');
  });
});
