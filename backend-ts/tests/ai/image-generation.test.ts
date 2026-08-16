import { afterEach, describe, expect, it } from 'vitest';
import { imageService } from '../../src/services/image-service.js';
import { startMockOpenAIServer, sseChunk, type MockOpenAIServer } from '../helpers/mock-openai-server.js';
import type { ImageModelConfig } from '../../src/infrastructure/ai/types.js';

/**
 * 契约测试：文生图（对应 Python 图片生成流程）。
 *
 * mock `/v1/images/generations` 返回 b64_json → AI SDK generateImage →
 * 落盘 static/generated → 返回本地 URL；同时验证请求体携带 model/prompt/size。
 */

const openServers: MockOpenAIServer[] = [];

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
    const result = await imageService.generateImage('一张藏书票，复古文艺', config);

    expect(result.mock).toBe(false);
    expect(result.image_url.startsWith('/static/generated/')).toBe(true);
    // 落盘内容与 mock 返回一致
    const saved = imageService.readFile(result.image_url);
    expect(saved).not.toBeNull();
    expect(Buffer.from(saved!).equals(PNG_BYTES)).toBe(true);
  });

  it('无 API Key 时返回 Mock SVG 占位图', async () => {
    const result = await imageService.generateImage('藏书票', {
      apiKey: '',
      base_url: '',
      model_name: '',
    });
    expect(result.mock).toBe(true);
    expect(result.image_url.startsWith('/static/generated/')).toBe(true);
    const saved = imageService.readFile(result.image_url);
    expect(saved).not.toBeNull();
    const text = Buffer.from(saved!).toString('utf-8');
    expect(text).toContain('<svg');
    expect(text).toContain('藏书票');
  });
});
