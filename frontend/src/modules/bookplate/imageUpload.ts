/**
 * 图片上传/处理公共工具（图片上传节点与 AI 对话节点附件共用）。
 * 校验规则与后端（router.py MAX_UPLOAD_IMAGE_BYTES / 魔数校验）保持一致。
 */

// 允许上传的位图格式（与图片分析节点 / 后端魔数校验一致）
export const RASTER_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
// 上传体积上限（与后端 MAX_UPLOAD_IMAGE_BYTES 保持一致）
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
// 超过该体积的原始图片在持久化前会被缩放/压缩（画布快照存于 sessionStorage，空间有限）
export const MAX_STORE_BYTES = 1.5 * 1024 * 1024;
// 持久化图片的最长边像素上限
export const MAX_STORE_DIM = 1600;

/** 读取 File → base64 data URL */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解析失败'));
    img.src = dataUrl;
  });
}

/**
 * 处理待持久化的图片：
 * - 小图（尺寸与体积均未超限）原样保留，保留原格式与透明度；
 * - 大图经 canvas 缩放（最长边 ≤ MAX_STORE_DIM）并压缩为 JPEG，避免撑爆 sessionStorage。
 *   PNG 透明度会先铺白底再压缩，防止透明区域在 JPEG 下变成黑色；GIF 动画退化为静态帧。
 */
export async function optimizeDataUrl(dataUrl: string, rawSize: number): Promise<string> {
  const img = await loadImage(dataUrl);
  if (img.width <= MAX_STORE_DIM && img.height <= MAX_STORE_DIM && rawSize <= MAX_STORE_BYTES) {
    return dataUrl;
  }
  const scale = Math.min(1, MAX_STORE_DIM / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  // 先铺白底，避免透明图片（如 PNG）压缩为 JPEG 时透明区域变黑
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * 把图片 URL（同源静态路径 / 可公开访问的 URL）读取为 base64 data URL。
 * 用于把「图像生成节点」等上游节点的本地图片（如 /static/generated/xxx.png）
 * 转换为多模态模型 / FastClaw 可直接消费的 data URL。失败时 reject。
 */
export async function urlToDataUrl(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`图片获取失败: HTTP ${resp.status}`);
  const blob = await resp.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('图片转换失败'));
    reader.readAsDataURL(blob);
  });
}
