import { mkdirSync, writeFileSync, existsSync, unlinkSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ImageModelConfig } from '../infrastructure/ai/types.js';
import { generateImageBytes } from '../infrastructure/ai/image/generate.js';
import { ImageGenerationError } from '../infrastructure/ai/errors.js';
import { mockImageSvg } from '../infrastructure/ai/mock/image.js';

/**
 * 图片生成服务（对应 Python `app/services/image_service.py`）。
 *
 * 职责：调用 AI 能力层生成图像字节 → 落盘 `static/generated` → 返回本地访问 URL。
 * 无 API Key 时返回 Mock 占位 SVG。
 *
 * 配置优先级：运行时 config（NodeConfig）> 环境变量（OPENAI_IMAGE_API_KEY / OPENAI_API_KEY 回退）。
 */

const STATIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../static');
const GENERATED_DIR = path.join(STATIC_DIR, 'generated');
const STATIC_PREFIX = '/static/generated';

const envImageApiKey = () =>
  process.env.OPENAI_IMAGE_API_KEY || process.env.OPENAI_API_KEY || '';

export interface GenerateImageResult {
  image_url: string;
  mock: boolean;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function filename(ext: string): string {
  const rand = Date.now() % 100000;
  return `bookplate_${timestamp()}_${rand}.${ext}`;
}

function writeBytes(name: string, content: Uint8Array): void {
  mkdirSync(GENERATED_DIR, { recursive: true });
  writeFileSync(path.join(GENERATED_DIR, name), content);
}

export class ImageService {
  /** 生成藏书票图片；返回 `{ image_url, mock }`。 */
  async generateImage(
    prompt: string,
    config: ImageModelConfig,
    isDisconnected?: () => Promise<boolean>
  ): Promise<GenerateImageResult> {
    const apiKey = (config.apiKey || envImageApiKey()).trim();
    if (!apiKey) {
      // Mock 占位图（同步生成，无 API 调用）
      const name = filename('svg');
      writeBytes(name, Buffer.from(mockImageSvg(prompt), 'utf-8'));
      return { image_url: `${STATIC_PREFIX}/${name}`, mock: true };
    }

    // 客户端已断开：不发起图像 API 调用，直接放弃（与 Python 语义一致）
    if (isDisconnected && (await isDisconnected())) {
      throw new ImageGenerationError('客户端已断开连接');
    }

    const effective: ImageModelConfig = {
      apiKey,
      base_url: config.base_url || '',
      model_name: config.model_name,
      size: config.size ?? null,
      ratio: config.ratio ?? null,
      image: config.image ?? null,
    };
    if (!effective.model_name) throw new ImageGenerationError('未配置图像模型名称（model_name）');

    try {
      const { bytes } = await generateImageBytes(prompt, effective);
      // 客户端已断开（API 调用期间）：跳过落盘，避免生成无人使用的图片文件
      if (isDisconnected && (await isDisconnected())) {
        throw new ImageGenerationError('客户端已断开，生成结果已丢弃');
      }
      const name = filename('png');
      writeBytes(name, bytes);
      return { image_url: `${STATIC_PREFIX}/${name}`, mock: false };
    } catch (err) {
      if (err instanceof ImageGenerationError) throw err;
      throw new ImageGenerationError(`图片生成失败: ${messageOf(err)}`, undefined, err);
    }
  }

  /** 下载外部图片 URL（或解码 data URL）并落盘，返回本地访问 URL。 */
  async saveRemoteImage(url: string): Promise<string> {
    let bytes: Uint8Array;
    if (url.startsWith('data:')) {
      const b64 = url.split(',')[1] ?? '';
      try {
        bytes = Buffer.from(b64, 'base64');
      } catch (err) {
        throw new ImageGenerationError(`Agent 返回的图片 data URL 无效: ${messageOf(err)}`, undefined, err);
      }
    } else {
      bytes = await downloadBytes(url);
    }
    if (!bytes.length) throw new ImageGenerationError('Agent 返回的图片为空');
    const name = filename('png');
    writeBytes(name, bytes);
    return `${STATIC_PREFIX}/${name}`;
  }

  /** 删除静态文件（生成历史清理用，仅允许 /static/generated 下）。 */
  deleteFile(urlPath: string): boolean {
    if (!urlPath || !urlPath.startsWith(STATIC_PREFIX)) return false;
    const name = urlPath.slice(STATIC_PREFIX.length).replace(/^\/+/, '');
    if (!name || name.includes('..')) return false;
    const full = path.join(GENERATED_DIR, name);
    if (existsSync(full)) {
      unlinkSync(full);
      return true;
    }
    return false;
  }

  /** 读取静态文件字节（测试/内部用）。 */
  readFile(urlPath: string): Uint8Array | null {
    if (!urlPath || !urlPath.startsWith(STATIC_PREFIX)) return null;
    const name = urlPath.slice(STATIC_PREFIX.length).replace(/^\/+/, '');
    const full = path.join(GENERATED_DIR, name);
    if (existsSync(full)) return new Uint8Array(readFileSync(full));
    return null;
  }
}

async function downloadBytes(url: string): Promise<Uint8Array> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!resp.ok) throw new ImageGenerationError(`下载图片失败: HTTP ${resp.status}`);
  const buf = await resp.arrayBuffer();
  return new Uint8Array(buf);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 单例（对应 Python 模块级 `image_service = ImageService()`）。 */
export const imageService = new ImageService();
