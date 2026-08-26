import { mkdirSync, writeFileSync, existsSync, unlinkSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ImageModelConfig } from '../infrastructure/ai/types.js';
import { generateImageBytes } from '../infrastructure/ai/image/generate.js';
import { ImageGenerationError } from '../infrastructure/ai/errors.js';
import { mockImageSvg } from '../infrastructure/ai/mock/image.js';
import { RUNTIME_ROOT } from './skill-agent-service.js';
import { curlFetch, fetchWithProxy } from './http-proxy.js';

/**
 * 图片生成服务（对应 Python `app/services/image_service.py`）。
 *
 * 职责：调用 AI 能力层生成图像字节 → 落盘 `runtime/{userId}/generated` → 返回本地访问 URL。
 * 无 API Key 时返回 Mock 占位 SVG。
 *
 * 对外 URL 沿用 `/static/generated/{userId}/{file}` 前缀（物理文件在根目录 runtime/ 下，
 * 由 server.ts 的白名单公开路由服务；不兼容旧 `/static/generated/{file}` 格式）。
 *
 * 配置优先级：运行时 config（NodeConfig）> 环境变量（OPENAI_IMAGE_API_KEY / OPENAI_API_KEY 回退）。
 */

const STATIC_PREFIX = '/static/generated';

/** 用户图像产出目录：runtime/{userId}/generated/。 */
export function userGeneratedDir(userId: number): string {
  return path.join(RUNTIME_ROOT, String(userId), 'generated');
}

/** 地图海报（多模态工具）产出目录：runtime/{userId}/map-posters/（与 generated 分开，属中间结果）。 */
export function userMapPosterDir(userId: number): string {
  return path.join(RUNTIME_ROOT, String(userId), 'map-posters');
}

const MAP_POSTER_STATIC_PREFIX = '/static/map-posters';

/** 图片检索（多模态工具）选中图片目录：runtime/{userId}/search-images/（中间结果，不写历史记录）。 */
export function userSearchImageDir(userId: number): string {
  return path.join(RUNTIME_ROOT, String(userId), 'search-images');
}

const SEARCH_IMAGE_STATIC_PREFIX = '/static/search-images';

/** 艺术地图（多模态工具）产出目录：runtime/{userId}/map-arts/（属中间结果）。 */
export function userMapArtDir(userId: number): string {
  return path.join(RUNTIME_ROOT, String(userId), 'map-arts');
}

const MAP_ART_STATIC_PREFIX = '/static/map-arts';

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

function writeBytes(userId: number, name: string, content: Uint8Array): void {
  const dir = userGeneratedDir(userId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), content);
}

/**
 * 用户图片目录与 /static 前缀的映射（历史级联删除 / GC 引用扫描共用）。
 * generated 为最终产出（generations 表引用）；search-images / map-posters / map-arts 为中间结果。
 */
const USER_IMAGE_PREFIXES: ReadonlyArray<{ prefix: string; dirOf: (userId: number) => string }> = [
  { prefix: STATIC_PREFIX, dirOf: userGeneratedDir },
  { prefix: MAP_POSTER_STATIC_PREFIX, dirOf: userMapPosterDir },
  { prefix: SEARCH_IMAGE_STATIC_PREFIX, dirOf: userSearchImageDir },
  { prefix: MAP_ART_STATIC_PREFIX, dirOf: userMapArtDir },
];

/** 受管子目录名（由前缀推导，GC 扫描与 URL 抽取共用，保证单一事实来源）。 */
export const RUNTIME_IMAGE_SUBDIRS = USER_IMAGE_PREFIXES.map((p) => p.prefix.replace('/static/', ''));

/** 解析 /static/{generated|search-images|map-posters|map-arts}/{userId}/{file} 为绝对路径（userId 必须为纯数字，防目录穿越）。 */
function resolveUserImagePath(urlPath: string): string | null {
  for (const { prefix, dirOf } of USER_IMAGE_PREFIXES) {
    if (!urlPath.startsWith(`${prefix}/`)) continue;
    const parts = urlPath.slice(prefix.length).split('/').filter(Boolean);
    if (parts.length !== 2 || !/^\d+$/.test(parts[0]!) || !parts[1] || parts[1].includes('..')) return null;
    return path.join(dirOf(Number(parts[0])), parts[1]!);
  }
  return null;
}

/**
 * 从文本/JSON 结构中抽取受管目录的用户图片 URL（去重）。
 * 历史记录级联删除与 GC 引用集合共用：stage_results 为自由 JSON blob，
 * 逐字段挑选会漏（agent_steps / markdown 内嵌等），故对序列化全文做正则抽取。
 */
export function extractRuntimeImageUrls(inputs: unknown[]): string[] {
  const pattern = new RegExp(`/static/(?:${RUNTIME_IMAGE_SUBDIRS.join('|')})/\\d+/[A-Za-z0-9._-]+`, 'g');
  const found = new Set<string>();
  for (const input of inputs) {
    let text: string;
    if (typeof input === 'string') {
      text = input;
    } else if (input == null) {
      continue;
    } else {
      try {
        text = JSON.stringify(input);
      } catch {
        text = String(input);
      }
    }
    for (const match of text.matchAll(pattern)) found.add(match[0]);
  }
  return [...found];
}

export class ImageService {
  /** 生成藏书票图片；返回 `{ image_url, mock }`（落盘 runtime/{userId}/generated）。 */
  async generateImage(
    prompt: string,
    config: ImageModelConfig,
    userId: number,
    isDisconnected?: () => Promise<boolean>
  ): Promise<GenerateImageResult> {
    const apiKey = (config.apiKey || envImageApiKey()).trim();
    if (!apiKey) {
      // Mock 占位图（同步生成，无 API 调用）
      const name = filename('svg');
      writeBytes(userId, name, Buffer.from(mockImageSvg(prompt), 'utf-8'));
      return { image_url: `${STATIC_PREFIX}/${userId}/${name}`, mock: true };
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
      writeBytes(userId, name, bytes);
      return { image_url: `${STATIC_PREFIX}/${userId}/${name}`, mock: false };
    } catch (err) {
      if (err instanceof ImageGenerationError) throw err;
      throw new ImageGenerationError(`图片生成失败: ${messageOf(err)}`, undefined, err);
    }
  }

  /** 下载外部图片 URL（或解码 data URL）并落盘 runtime/{userId}/generated，返回本地访问 URL。 */
  async saveRemoteImage(url: string, userId: number): Promise<string> {
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
    writeBytes(userId, name, bytes);
    return `${STATIC_PREFIX}/${userId}/${name}`;
  }

  /**
   * 保存地图海报图片（多模态工具节点：浏览器端渲染导出的中间结果，不写历史记录）。
   * data URL → runtime/{userId}/map-posters/，返回 /static/map-posters/{userId}/{file}。
   */
  saveMapPosterImage(userId: number, dataUrl: string): string {
    if (!dataUrl.startsWith('data:')) {
      throw new ImageGenerationError('image 必须为 base64 data URL');
    }
    const b64 = dataUrl.split(',')[1] ?? '';
    let bytes: Uint8Array;
    try {
      bytes = Buffer.from(b64, 'base64');
    } catch (err) {
      throw new ImageGenerationError(`地图海报图片 data URL 无效: ${messageOf(err)}`, undefined, err);
    }
    if (!bytes.length) throw new ImageGenerationError('地图海报图片为空');
    const dir = userMapPosterDir(userId);
    mkdirSync(dir, { recursive: true });
    const name = filename('png');
    writeFileSync(path.join(dir, name), bytes);
    return `${MAP_POSTER_STATIC_PREFIX}/${userId}/${name}`;
  }

  /**
   * 保存艺术地图图片（多模态工具节点：服务端 Python prettymaps 生成，不写历史记录）。
   * PNG 字节 → runtime/{userId}/map-arts/，返回 /static/map-arts/{userId}/{file}。
   */
  saveMapArtImage(userId: number, buffer: Buffer): string {
    if (!buffer.length) throw new ImageGenerationError('艺术地图图片为空');
    const dir = userMapArtDir(userId);
    mkdirSync(dir, { recursive: true });
    const ts = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
    const rand = Date.now() % 100000;
    const name = `map_art_${timestamp}_${rand}.png`;
    writeFileSync(path.join(dir, name), buffer);
    return `${MAP_ART_STATIC_PREFIX}/${userId}/${name}`;
  }

  /**
   * 保存图片检索节点选中的图片（远程 URL → runtime/{userId}/search-images/，返回本地访问 URL）。
   * 选中图为中间结果：不写历史记录，仅作为节点输出供下游消费 / 下载。
   * proxy：HTTP 代理（如 http://127.0.0.1:7890），仅对需代理出网的源（如 LoC tile.loc.gov）传入。
   */
  async saveSearchImage(userId: number, url: string, proxy = ''): Promise<string> {
    const bytes = await downloadBytes(url, proxy);
    if (!bytes.length) throw new ImageGenerationError('图片为空');
    // filename() 自动补扩展名点号，这里去掉前导点
    const ext = (extFromUrl(url) || detectExtFromBytes(bytes) || '.jpg').replace(/^\./, '');
    const dir = userSearchImageDir(userId);
    mkdirSync(dir, { recursive: true });
    const name = filename(ext);
    writeFileSync(path.join(dir, name), bytes);
    return `${SEARCH_IMAGE_STATIC_PREFIX}/${userId}/${name}`;
  }

  /** 删除用户图片文件（生成历史级联清理用；支持全部四个受管 /static 前缀）。 */
  deleteFile(urlPath: string): boolean {
    const abs = urlPath ? resolveUserImagePath(urlPath) : null;
    if (!abs) return false;
    if (existsSync(abs)) {
      unlinkSync(abs);
      return true;
    }
    return false;
  }

  /** 读取生成图片字节（测试/内部用）。 */
  readFile(urlPath: string): Uint8Array | null {
    if (!urlPath || !urlPath.startsWith(STATIC_PREFIX)) return null;
    const abs = resolveUserImagePath(urlPath);
    if (!abs) return null;
    if (existsSync(abs)) return new Uint8Array(readFileSync(abs));
    return null;
  }
}

async function downloadBytes(url: string, proxy = ''): Promise<Uint8Array> {
  const resp = await fetchWithProxy(url, { signal: AbortSignal.timeout(60_000) }, proxy);
  if (resp.ok) {
    return new Uint8Array(await resp.arrayBuffer());
  }
  // 疑似 Cloudflare 反爬（403/503 + HTML challenge）：undici 的 TLS 指纹被识别，
  // 回退 curl 传输（curl 指纹可正常通过；CONNECT 代理不改变客户端指纹，代理下同样需要此回退）
  const ct = resp.headers.get('content-type') ?? '';
  if ((resp.status === 403 || resp.status === 503) && ct.includes('text/html')) {
    const cr = await curlFetch(url, { proxy, timeoutMs: 60_000 });
    if (cr.status === 200 && cr.contentType.includes('image')) {
      return cr.body;
    }
  }
  throw new ImageGenerationError(`下载图片失败: HTTP ${resp.status}`);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 从 URL 路径提取图片扩展名（.jpg/.png/.webp…），无法识别返回 null。 */
function extFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const match = /\.(jpe?g|png|gif|webp|svg)$/i.exec(pathname);
    return match ? match[1]!.toLowerCase().replace('jpeg', 'jpg') : null;
  } catch {
    return null;
  }
}

/** 按文件头魔数识别图片扩展名（与路由 detectImageExt 同口径，供下载 URL 无扩展名时兜底）。 */
function detectExtFromBytes(content: Uint8Array): string | null {
  if (!content.length) return null;
  const prefixes: Array<[number[], string]> = [
    [[0xff, 0xd8, 0xff], '.jpg'],
    [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], '.png'],
    [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], '.gif'],
    [[0x47, 0x49, 0x46, 0x38, 0x39, 0x61], '.gif'],
  ];
  for (const [magic, ext] of prefixes) {
    if (magic.every((b, i) => content[i] === b)) return ext;
  }
  if (
    content.length >= 12 &&
    String.fromCharCode(...content.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...content.subarray(8, 12)) === 'WEBP'
  ) {
    return '.webp';
  }
  return null;
}

/** 单例（对应 Python 模块级 `image_service = ImageService()`）。 */
export const imageService = new ImageService();
