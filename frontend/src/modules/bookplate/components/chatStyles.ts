/** ChatNode 注入的全局动画 / 滚动样式（keyframes + 工具类），由 ChatNode 渲染进 <style> 标签。 */
export const CHAT_STYLE_INJECTIONS = `
@keyframes msg-enter {
  0% { opacity: 0; transform: translateY(4px); }
  100% { opacity: 1; transform: translateY(0); }
}
.msg-enter-anim { animation: msg-enter 0.2s cubic-bezier(0.2, 0, 0, 1) forwards; }
@keyframes pop-enter {
  0% { opacity: 0; transform: scale(0.96); transform-origin: bottom right; }
  100% { opacity: 1; transform: scale(1); transform-origin: bottom right; }
}
.pop-enter-anim { animation: pop-enter 0.2s cubic-bezier(0.2, 0, 0, 1) forwards; }
@keyframes thinking-wave {
  0%, 100% { transform: translateY(0); opacity: 0.35; }
  50% { transform: translateY(-2px); opacity: 1; }
}
@keyframes thinking-glow {
  0%, 100% { opacity: 0.65; }
  50% { opacity: 1; }
}
.animate-thinking-wave { 
  animation: thinking-wave 1.2s cubic-bezier(0.2, 0, 0, 1) infinite; 
  will-change: transform, opacity;
}
.animate-thinking-glow { 
  animation: thinking-glow 1.8s ease-in-out infinite; 
  will-change: opacity;
}
.chat-scroll-container {
  contain: content;
}
@media (prefers-reduced-motion: reduce) {
  .animate-thinking-wave {
    animation: thinking-glow 1.3s ease-in-out infinite;
    transform: none !important;
  }
  .msg-enter-anim, .pop-enter-anim {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
}
`;