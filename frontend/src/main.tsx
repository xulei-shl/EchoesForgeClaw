import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import './index.css';
import { installClipboardFallback } from './shared/utils/clipboard';

// 非安全上下文下补上 navigator.clipboard，保证 Streamdown 等只认 Clipboard API 的组件可用
installClipboardFallback();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
