/**
 * 图书卡片二维码生成（移植自 docs/多模态工具/书目推广卡片/card_generator/qrcode_generator.py）
 *
 * 把字段值（当前为索书号 CALL_NUMBER）编码为 vufind OPAC 检索链接并生成
 * 透明背景 PNG data URL，替换模板中的 pic/qrcode.png 引用——扫码即可打开检索页。
 * 字段值为空时不出码（模板引用回退透明像素占位，保持布局）。
 */

import QRCode from 'qrcode';

/** vufind 检索 URL 模板（与原 card_generator 默认配置一致） */
const VUFIND_URL_TEMPLATE =
  'https://vufind.library.sh.cn/Search/Results?searchtype=vague&lookfor={call_number}&type=CallNumber';

/** 由字段值构建检索链接（URL 编码后填充模板） */
export function buildVufindSearchUrl(fieldValue: string): string {
  return VUFIND_URL_TEMPLATE.replace('{call_number}', encodeURIComponent(fieldValue.trim()));
}

export interface CardQrOptions {
  /** 纠错级别（移植原默认 'H'） */
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  /** 输出边长 px */
  width?: number;
}

/** 生成透明背景二维码 data URL（白色背景 → 全透明，同原 PIL 像素处理） */
export async function generateCardQrDataUrl(
  fieldValue: string,
  options?: CardQrOptions
): Promise<string> {
  const value = fieldValue.trim();
  if (!value) throw new Error('字段值为空，无法生成二维码');
  const dataUrl = await QRCode.toDataURL(buildVufindSearchUrl(value), {
    errorCorrectionLevel: options?.errorCorrectionLevel ?? 'H',
    width: options?.width ?? 256,
    margin: 1,
    color: { dark: '#000000ff', light: '#ffffff00' },
  });
  if (!dataUrl.startsWith('data:image/png')) {
    throw new Error('二维码生成失败：输出为空');
  }
  return dataUrl;
}
