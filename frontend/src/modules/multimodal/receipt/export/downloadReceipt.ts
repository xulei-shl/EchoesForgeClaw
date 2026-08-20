import type { ReceiptState } from '../types';
import { getReceiptRenderer } from './renderers/registry';
import { ensureFontsReady } from './common/canvasUtils';

export interface DownloadReceiptOptions {
  /** 导出清晰度倍率，默认 2 (高清 2x) */
  scale?: number;
  /** 自定义下载文件名（不含扩展名），默认自动根据店名/题名与时间戳生成 */
  customFilename?: string;
}

/**
 * 格式化安全的文件名
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

/**
 * 统一小票下载公共工具函数 (Download Receipt Image)
 * 采用毫秒级纯 Canvas 离线矢量引擎，即时生成当前最新编辑后的小票并触发浏览器下载
 *
 * @param state 当前小票完整状态 (localState)
 * @param options 下载配置选项
 * @returns 生成的高清 PNG DataURL
 */
export async function downloadReceiptImage(
  state: ReceiptState,
  options?: DownloadReceiptOptions
): Promise<string> {
  await ensureFontsReady();

  const scale = options?.scale || 2;
  const renderer = getReceiptRenderer(state.templateId);
  const dataUrl = await renderer(state, scale);

  const rawName = options?.customFilename || state.storeName || state.subtitle || 'receipt';
  const cleanName = sanitizeFilename(rawName);
  const filename = `${cleanName || 'receipt'}-${Date.now()}.png`;

  // 创建并触发浏览器下载
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  return dataUrl;
}
