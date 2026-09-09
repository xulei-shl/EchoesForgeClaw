/**
 * 图书卡片模板静态资源解析
 *
 * 模板中的装饰图 / Logo 引用（pic/b.png、pic/logo_shl.png 等）改写为本目录
 * src/assets/card-decor/ 下的打包资产（构建期 import.meta.glob 枚举，支持离线）。
 *
 * 约定：
 * - 文件名以 logo 开头 → 固定映射（logo_shl.png / logozi_shl.jpg）；
 * - 其余图片文件 → 装饰性背景图池（对应原 card_generator「从文件夹随机选 b-*.png」），
 *   节点侧随机选一张并在「换一张」时重掷；
 * - 图池为空或某 Logo 缺失时回退透明像素（优雅降级，不阻断截图）。
 */

/** 1×1 透明 PNG：缺失资源的统一兜底（保留占位布局，避免破图图标进入截图） */
export const TRANSPARENT_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** 装饰性背景图池（b-1.png ~ b-46.png） */
export const DECOR_IMAGES: string[] = Array.from(
  { length: 46 },
  (_, i) => `/card-decor/b-${i + 1}.png`
);

/** 图书馆主 Logo（pic/logo_shl.png） */
export const LOGO_SHL = '/card-decor/logo_shl.png';

/** 图书馆子 Logo（pic/logozi_shl.jpg） */
export const LOGO_ZI = '/card-decor/logozi_shl.jpg';

/** 模板内置背景图映射（同源 public 静态资源，彻底消除跨域与破图） */
export const TPL_BG_MAP: Record<string, string> = {
  'wmremove-transformed.png': '/card-decor/tpl-cat.png',
  'backup.png': '/card-decor/tpl-handbook.png',
  '%e5%9b%be%e7%89%87%e5%a4%84%e7%90%86.png': '/card-decor/tpl-lines.png',
  '图片处理.png': '/card-decor/tpl-lines.png',
  'bg-circuit.png': '/card-decor/tpl-circuit.png',
  '%e5%be%ae%e4%bf%a1%e5%9b%be%e7%89%87_20251205192936.jpg': '/card-decor/tpl-sky.jpg',
  '微信图片_20251205192936.jpg': '/card-decor/tpl-sky.jpg',
};

/** 装饰图是否可用（决定「换一张」按钮可用性） */
export const hasDecorImages = (): boolean => DECOR_IMAGES.length > 0;

/** 随机选一个装饰图下标（排除当前值以便「换一张」必有变化）；无图池时返回 null */
export function randomDecorIndex(exclude?: number | null): number | null {
  const total = DECOR_IMAGES.length;
  if (total === 0) return null;
  if (total === 1) return 0;
  let next = Math.floor(Math.random() * total);
  if (exclude != null && next === ((exclude % total) + total) % total) {
    next = (next + 1 + Math.floor(Math.random() * (total - 1))) % total;
  }
  return next;
}
