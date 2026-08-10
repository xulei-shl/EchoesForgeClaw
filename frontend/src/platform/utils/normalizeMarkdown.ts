/**
 * 预处理 markdown 文本，确保块级语法元素前有换行符。
 *
 * AI 生成的 markdown 可能缺少必要的换行，导致标题、代码围栏等
 * 块级元素紧跟在其他文本后面，无法被 CommonMark 解析器正确识别。
 */
export function normalizeMarkdown(text: string): string {
  if (!text) return text;

  return text
    // ATX 标题（# ~ ######）：若前面紧跟非换行字符，插入空行
    .replace(/([^\n])(#{1,6} )/g, '$1\n\n$2')
    // 围栏代码块（``` 或 ~~~）：若前面紧跟非换行字符，插入空行
    .replace(/([^\n])(```|~~~)/g, '$1\n\n$2');
}
