import type { ChatMessage } from '../../../platform/types';

/**
 * 把对话历史序列化为 Markdown 导出文本：
 * - 用户消息附带图片以 data URL 内嵌（base64 不含括号/换行，可直接进图片语法），
 *   随对话一并导出：本地 Markdown 查看器（VS Code / Typora / Obsidian 等）可直接渲染。
 * 纯函数，供 ChatNode 导出按钮与单元测试使用。
 */
export function buildChatMarkdown(title: string | undefined, messages: ChatMessage[]): string {
  let md = `# ${title || 'AI 对话记录'}\n\n`;
  messages.forEach((msg) => {
    if (msg.role === 'user') {
      md += `**You**:\n${msg.content}\n`;
      if (msg.images && msg.images.length > 0) {
        md += `${msg.images
          .map((img, j) => `![附带图片 ${j + 1}](${img})`)
          .join('\n')}\n`;
      }
      md += '\n';
    } else {
      md += `**AI**:\n${msg.content}\n\n`;
    }
  });
  return md;
}