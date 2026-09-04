import {
  bookCoverImage,
  bookMetadataText,
  getNodeTitle,
  nodeOutputImages,
  nodeOutputText,
} from './nodeTypes';
import { collectNodeInputs, isBookCoverEnabled, resolveNodeRunInputs, type PortTypesLookup } from './execution';
import type { EdgeData, NodeData } from './graphTypes';
import type { CanvasNodeType, ChatNodeSettings, InjectedContextBlock } from '../../platform/types';

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
  /**
   * 是否展示直连 Skill 检索上级的已选 skill（仅 chat 节点开启）：
   * skills 不走文本/图片输出通道（skill_search 输出端口为 document），
   * 由 collectSkillNames 单独收集并随 /chat 请求体下发，故独立成块。
   */
  includeSkills?: boolean;
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

  // 1. 图书元数据与图书封面（拆分为独立条目注入；两个开关独立——「包含图书元数据」控文本、
  //    「加载图书封面图片」控封面，任一开启即解析图书：直接连线的 book_info 优先，
  //    无则连线上游，再兜底画布根节点）
  let injectedBookId: string | null = null;
  if (opts.includeBook || opts.includeBookCover) {
    const book = resolveNodeRunInputs(node, nodes, edges, portTypesOf).book;
    if (book) {
      injectedBookId = book.id;
      const rawTitle = getNodeTitle(book);
      const titleSuffix = rawTitle && rawTitle !== '图书元数据' ? ` · ${rawTitle}` : '';

      // (1) 图书封面图条目：仅受「加载图书封面图片」控制（独立于文本元数据开关）
      const cover = opts.includeBookCover ? bookCoverImage(book.data) : '';
      if (cover) {
        blocks.push({
          id: `book_cover_${book.id}`,
          title: `图书封面图${titleSuffix}`,
          nodeType: 'book_info',
          images: [cover],
        });
      }

      // (2) 图书元数据条目：仅受「包含图书元数据」控制（结构化文本内容）
      if (opts.includeBook) {
        const metaText = bookMetadataText(book.data).trim();
        blocks.push({
          id: `book_meta_${book.id}`,
          title: `图书元数据${titleSuffix}`,
          nodeType: 'book_info',
          text: metaText || undefined,
        });
      }
    }
  }

  // 2. 直接父节点：按「输出端口类型」分类（collectNodeInputs 统一分组，画线连上即输入）。
  //    文本上级走 nodeOutputText、图片上级走 nodeOutputImages，受各自开关控制；
  //    后续新增输出类型（音频等）接入时在下方补对应的提取与开关即可。
  const { parents, text: textOutputs, images: imageOutputs } = collectNodeInputs(
    node,
    nodes,
    edges,
    portTypesOf
  );

  // 2.0 直连 Skill 检索上级：已选 skill 随 /chat 请求体 skills 字段注入 Skill Agent
  //     （不受文本/图片开关控制），独立成块展示清单
  if (opts.includeSkills) {
    for (const p of parents) {
      if (p.type !== 'skill_search') continue;
      const skillText = nodeOutputText(p).trim();
      if (!skillText) continue;
      blocks.push({
        id: `skills_${p.id}`,
        title: getNodeTitle(p),
        nodeType: p.type,
        text: skillText,
      });
    }
  }

  const includeText = opts.includeUpstreamText;
  const includeImages = opts.includeUpstreamImages;

  if (includeText || includeImages) {
    for (const p of parents) {
      if (opts.parentFilter && !opts.parentFilter(p.type)) continue;
      // 图书元数据节点只经图书通道注入（includeBook / includeBookCover 开关注入）：
      // 两个开关都关闭时不允许其文本/封面经父节点通道绕过开关再次注入，
      // 避免出现「关闭包含图书元数据后上下文仍显示图书元数据」的假象。
      if (p.type === 'book_info' && !opts.includeBook && !opts.includeBookCover) continue;
      // 若该直连父节点已作为图书元数据/封面注入，跳过以避免重复注入
      if (injectedBookId && p.id === injectedBookId) continue;
      const isText = textOutputs.includes(p);
      const isImage = imageOutputs.includes(p);
      if (!((includeText && isText) || (includeImages && isImage))) continue;

      const text = includeText && isText ? nodeOutputText(p).trim() : '';
      const rawImages = includeImages && isImage ? nodeOutputImages(p) : [];
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

/**
 * 按 chat 节点运行设置推导上下文注入开关（ChatNodeHost / PiChatNodeHost 两宿主共用，
 * 消除各调用点重复构造同一组开关）。封面开关默认值跟随 book_info 连通性（见 isBookCoverEnabled）。
 */
export function contextOptionsOf(
  node: NodeData,
  settings: ChatNodeSettings,
  nodes: NodeData[],
  edges: EdgeData[]
): ContextBlocksOptions {
  return {
    includeBook: settings.includeBook,
    includeBookCover: isBookCoverEnabled(node, nodes, edges),
    includeUpstreamText: settings.includeUpstream !== false,
    includeUpstreamImages: settings.includeUpstreamImages !== false,
    includeSkills: true,
  };
}

/**
 * 收集 chat 节点的注入上下文块（开关由节点运行设置推导）。
 * ChatNodeHost / PiChatNodeHost 两宿主共用，行为与旧调用点完全一致。
 */
export function buildContextBlocks(
  node: NodeData,
  settings: ChatNodeSettings,
  nodes: NodeData[],
  edges: EdgeData[],
  portTypesOf: PortTypesLookup
): InjectedContextBlock[] {
  return buildInjectedContextBlocks(
    node,
    contextOptionsOf(node, settings, nodes, edges),
    nodes,
    edges,
    portTypesOf
  );
}
