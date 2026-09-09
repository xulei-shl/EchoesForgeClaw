/**
 * 手账页图片下载工具
 */

export function downloadJournalImage(dataUrl: string, filename?: string) {
  if (!dataUrl) return;
  const name = filename || `journal-${Date.now()}.png`;
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
