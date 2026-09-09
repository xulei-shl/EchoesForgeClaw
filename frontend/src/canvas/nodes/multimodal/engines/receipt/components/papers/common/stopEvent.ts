import React from 'react';

/**
 * 阻止画板事件冒泡（防止输入和点击误触发画布缩放/拖拽）
 */
export const stopEvent = (e: React.SyntheticEvent) => e.stopPropagation();
