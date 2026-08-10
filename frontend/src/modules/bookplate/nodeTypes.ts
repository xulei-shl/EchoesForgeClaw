import type { CanvasNodeType } from '../../platform/types';

/** 节点模板的默认尺寸（画布布局用，与各节点组件 defaultSize 一致） */
export const NODE_DEFAULT_SIZES: Record<CanvasNodeType, { width: number; height: number }> = {
  book_info: { width: 440, height: 540 },
  image_analysis: { width: 420, height: 460 },
  prompt_generation: { width: 420, height: 500 },
  image_generation: { width: 420, height: 540 },
};

export interface NodeTemplateDef {
  type: CanvasNodeType;
  name: string;
  description: string;
  category: 'input' | 'analysis' | 'generate' | 'output';
  configurable: boolean;
  defaultSize: { width: number; height: number };
}

/** 节点模板元数据（与后端 node_types.py 保持一致） */
export const NODE_TEMPLATES: NodeTemplateDef[] = [
  {
    type: 'book_info',
    name: '图书元数据',
    description: '通过豆瓣 API 获取 ISBN 对应的图书元数据',
    category: 'input',
    configurable: false,
    defaultSize: NODE_DEFAULT_SIZES.book_info,
  },
  {
    type: 'image_analysis',
    name: '图片分析',
    description: '多模态模型分析封面 / 参考图，输出艺术风格与主题色分析',
    category: 'analysis',
    configurable: true,
    defaultSize: NODE_DEFAULT_SIZES.image_analysis,
  },
  {
    type: 'prompt_generation',
    name: '提示词生成',
    description: '基于图书元数据与图片分析流式生成图像提示词',
    category: 'generate',
    configurable: true,
    defaultSize: NODE_DEFAULT_SIZES.prompt_generation,
  },
  {
    type: 'image_generation',
    name: '图像生成',
    description: '根据提示词生成藏书票图片',
    category: 'output',
    configurable: true,
    defaultSize: NODE_DEFAULT_SIZES.image_generation,
  },
];

export const NODE_TEMPLATE_MAP: Record<CanvasNodeType, NodeTemplateDef> = Object.fromEntries(
  NODE_TEMPLATES.map((t) => [t.type, t])
) as Record<CanvasNodeType, NodeTemplateDef>;

/** 模板类别中文标签（「+」菜单分组标题） */
export const CATEGORY_LABELS: Record<NodeTemplateDef['category'], string> = {
  input: '输入',
  analysis: '分析',
  generate: '生成',
  output: '输出',
};
