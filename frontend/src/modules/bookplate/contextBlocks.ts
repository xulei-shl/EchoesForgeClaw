import {
  bookCoverImage,
  bookMetadataText,
  getNodeTitle,
  nodeOutputImages,
  nodeOutputText,
} from './nodeTypes';
import { resolveNodeRunInputs, type PortTypesLookup } from './execution';
import type { EdgeData, NodeData } from './graphTypes';
import type { CanvasNodeType, InjectedContextBlock } from '../../platform/types';

/** 上下文块构建选项：chat 与图像生成等节点按各自运行设置传入 */
export interface ContextBlocksOptions {
  /** 是否注入图书元数据（文本） */
  includeBook: boolean;
  /** 是否注入图书封面图（仅 chat 节点开启） */
  includeBookCover: boolean;
  /** 是否注入直连父节点文本 */
  includeUpstreamText: boolean;
  /** 是否注入直连父节点图片 */
  includeUpstreamImages: boolean;
  /**
   * 需要展示的直接父节点类型（默认全部）。图像生成节点用于排除未并入
   * 提示词的图片分析等节点，避免展示实际未使用的上下文。
   */
  parentFilter?: (type: CanvasNodeType) => boolean;
}

/**
 * 收集注入上下文块（按图书元数据与每个直接父节点拆分，用于顶部折叠卡片展示）。
 * chat 与图像生成节点共用：行为差异（各注入开关 / 父节点类型过滤）由 opts 控制。
 */
export function buildInjectedContextBlocks(
  node: NodeData,
  opts: ContextBlocksOptions,
  nodes: NodeData[],
  edges: EdgeData[],
  portTypesOf: PortTypesLookup
): InjectedContextBlock[] {
  const blocks: InjectedContextBlock[] = [];

  // 1. 图书元数据与图书封面（拆分为独立条目注入）
  let injectedBookId: string | null = null;
  if (opts.includeBook) {
    const book = resolveNodeRunInputs(node, nodes, edges, portTypesOf).book;
    if (book) {
      injectedBookId = book.id;
      const rawTitle = getNodeTitle(book);
      const titleSuffix = rawTitle && rawTitle !== '图书元数据' ? ` · ${rawTitle}` : '';

      // (1) 图书封面图条目：开启「加载图书封面图片」且封面可用时注入
      const cover = opts.includeBookCover ? bookCoverImage(book.data) : '';
      if (cover) {
        blocks.push({
          id: `book_cover_${book.id}`,
          title: `图书封面图${titleSuffix}`,
          nodeType: 'book_info',
          images: [cover],
        });
      }

      // (2) 图书元数据条目：结构化文本内容
      const metaText = bookMetadataText(book.data).trim();
      blocks.push({
        id: `book_meta_${book.id}`,
        title: `图书元数据${titleSuffix}`,
        nodeType: 'book_info',
        text: metaText || undefined,
      });
    }
  }

  // 2. 直接父节点（只要连线且开启配置，均生成对应的注入组件，不受类型与输出状态限制）
  const includeText = opts.includeUpstreamText;
  const includeImages = opts.includeUpstreamImages;

  if (includeText || includeImages) {
    const parents = nodes.filter((n) =>
      edges.some((e) => e.target === node.id && e.source === n.id)
    );
    for (const p of parents) {
      if (opts.parentFilter && !opts.parentFilter(p.type)) continue;
      // 若该直连父节点已作为图书元数据/封面注入，跳过以避免重复注入
      if (injectedBookId && p.id === injectedBookId) continue;

      const text = includeText ? nodeOutputText(p).trim() : '';
      const rawImages = includeImages ? nodeOutputImages(p) : [];
      const images: string[] = [];
      for (const img of rawImages) {
        if (img && !images.includes(img)) images.push(img);
      }

      blocks.push({
        id: `parent_${p.id}`,
        title: getNodeTitle(p),
        nodeType: p.type,
        text: text || undefined,
        images: images.length > 0 ? images : undefined,
      });
    }
  }

  return blocks;
}
