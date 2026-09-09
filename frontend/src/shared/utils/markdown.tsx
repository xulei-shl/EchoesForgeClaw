import { Streamdown } from 'streamdown';
import { cjk } from '@streamdown/cjk';
import { createCodePlugin } from '@streamdown/code';

// 强制深浅色模式均使用 github-light，避免在暗色系统下浅色背景+暗色浅字导致对比度极低
const code = createCodePlugin({ themes: ['github-light', 'github-light'] });

// 组件与渲染插件同文件导出，便于 chat 渲染处一次引入（fast refresh 提示忽略）
// eslint-disable-next-line react-refresh/only-export-components
export { Streamdown, cjk, code };