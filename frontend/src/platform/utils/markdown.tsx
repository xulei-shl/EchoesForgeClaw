import { Streamdown } from 'streamdown';
import { cjk } from '@streamdown/cjk';
import { createCodePlugin } from '@streamdown/code';

// 强制深浅色模式均使用 github-light，避免在暗色系统下浅色背景+暗色浅字导致对比度极低
const code = createCodePlugin({ themes: ['github-light', 'github-light'] });

export { Streamdown, cjk, code };