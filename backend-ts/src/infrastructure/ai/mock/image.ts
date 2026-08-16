/**
 * Mock：无 API Key 时生成一张「纸面文具风」藏书票占位 SVG（与 Python
 * `image_service._mock_image` 逐字一致，保证无配置环境演示行为不变）。
 */

// Mock SVG 中使用的字体（CSS font-family 逗号列表，无需内嵌引号）
const FONT_SERIF = "LXGW WenKai, Noto Serif SC, serif";
const FONT_LATIN = "Georgia, 'Times New Roman', serif";
const FONT_MONO = "Consolas, Menlo, monospace";

/** 按字符宽度折行（SVG 无原生自动换行）。 */
function wrapText(text: string, width = 18): string[] {
  const lines: string[] = [];
  for (const raw of (text.split(/\r?\n/) as string[]).length ? text.split(/\r?\n/) : ['']) {
    let para = (raw || ' ').trim();
    if (!para) para = ' ';
    while (para.length > width) {
      lines.push(para.slice(0, width));
      para = para.slice(width);
    }
    lines.push(para);
  }
  return lines;
}

function svgEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 生成占位 SVG 文本内容。 */
export function mockImageSvg(prompt: string): string {
  const allLines = wrapText(prompt, 20);
  const lines = allLines.slice(0, 8);

  const promptLines = lines
    .map(
      (line, i) =>
        `    <text x="400" y="${600 + i * 34}" text-anchor="middle" ` +
        `font-family="${FONT_SERIF}" font-size="21" fill="#2B2926">` +
        `${svgEscape(line)}</text>\n`
    )
    .join('');
  const ellipsis =
    allLines.length > 8
      ? `    <text x="400" y="878" text-anchor="middle" ` +
        `font-family="${FONT_SERIF}" font-size="21" fill="#6B665E">…</text>\n`
      : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
  <rect width="800" height="1000" fill="#F8F6F1"/>
  <!-- 外框：赭石虚线 -->
  <rect x="44" y="44" width="712" height="912" fill="none" stroke="#A0622B" stroke-width="2" stroke-dasharray="9 7"/>
  <!-- 内框：浅灰细线 -->
  <rect x="60" y="60" width="680" height="880" fill="none" stroke="#E4E1DA" stroke-width="1.5"/>
  <!-- 四角装饰 -->
  <path d="M 44 74 L 44 44 L 74 44" fill="none" stroke="#8A4F1D" stroke-width="3"/>
  <path d="M 756 74 L 756 44 L 726 44" fill="none" stroke="#8A4F1D" stroke-width="3"/>
  <path d="M 44 926 L 44 956 L 74 956" fill="none" stroke="#8A4F1D" stroke-width="3"/>
  <path d="M 756 926 L 756 956 L 726 956" fill="none" stroke="#8A4F1D" stroke-width="3"/>
  <!-- 标题 -->
  <text x="400" y="150" text-anchor="middle" font-family="${FONT_SERIF}" font-size="52" fill="#2B2926">藏书票</text>
  <text x="400" y="196" text-anchor="middle" font-family="${FONT_LATIN}" font-size="19" letter-spacing="8" fill="#6B665E">BOOKPLATE · EX LIBRIS</text>
  <!-- 分隔线 -->
  <line x1="240" y1="228" x2="560" y2="228" stroke="#E4E1DA" stroke-width="1.5" stroke-dasharray="4 4"/>
  <!-- 翻开的书本线描 -->
  <path d="M 400 320 C 350 302 290 300 250 308 L 250 452 C 290 444 350 446 400 464 Z" fill="none" stroke="#A0622B" stroke-width="2"/>
  <path d="M 400 320 C 450 302 510 300 550 308 L 550 452 C 510 444 450 446 400 464 Z" fill="none" stroke="#A0622B" stroke-width="2"/>
  <line x1="400" y1="318" x2="400" y2="466" stroke="#E4E1DA" stroke-width="1.5"/>
  <line x1="336" y1="330" x2="282" y2="344" stroke="#D3CFC7" stroke-width="1.2"/>
  <line x1="336" y1="350" x2="282" y2="364" stroke="#D3CFC7" stroke-width="1.2"/>
  <line x1="464" y1="330" x2="518" y2="344" stroke="#D3CFC7" stroke-width="1.2"/>
  <line x1="464" y1="350" x2="518" y2="364" stroke="#D3CFC7" stroke-width="1.2"/>
  <text x="400" y="510" text-anchor="middle" font-family="${FONT_SERIF}" font-size="22" fill="#6B665E">提示词节选</text>
  <!-- 提示词折行文本 -->
${promptLines}${ellipsis}  <!-- 底部标记 -->
  <text x="400" y="952" text-anchor="middle" font-family="${FONT_MONO}" font-size="15" letter-spacing="4" fill="#A19D96">MOCK · NO IMAGE API KEY</text>
</svg>
`;
}
