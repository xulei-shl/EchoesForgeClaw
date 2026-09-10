import { nodesRef, edgesRef } from '../../../../shared/stores/useCanvasState';
import { urlToDataUrl } from '../../../core/imageUpload';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type {
  ChatMessage,
  ChatNodeSettings,
  InjectedContextBlock,
  SkillSelection,
} from '../../../../shared/types';
import type { NodeData } from '../../../core/graphTypes';
import type { PortTypesLookup } from '../../../core/execution';

/**
 * AI 对话节点宿主共享的发送辅助（ChatNodeHost 与 PiChatNodeHost 共用）：
 * 上下文拼接 / 图片收集 / skill 收集 / wire 消息截断，与具体后端模式无关。
 */

/** AI 对话单轮携带的图片上限（附件 + 上下文图片合计）：防止超大 base64 请求体拖垮传输 */
export const MAX_CHAT_IMAGES = 4;

/**
 * 运行设置兜底（旧节点持久化的 settings 缺少 includeUpstreamImages / includeBookCover / includeBook：
 * includeUpstreamImages undefined 视为开启；includeBook / includeBookCover undefined 视为按 book_info
 * 连通性默认——有连通开启、无连通（仅根节点兜底）关闭，见 execution.ts isBookMetadataEnabled / isBookCoverEnabled）
 */
export const DEFAULT_CHAT_SETTINGS: ChatNodeSettings = {
  includeUpstream: true,
  includeUpstreamImages: true,
};

/** ChatHost 依赖（画布注入：state setter + 端口类型查找；nodesRef/edgesRef 为模块级单例） */
export interface ChatHostDeps {
  setNodes: Dispatch<SetStateAction<NodeData[]>>;
  portTypesRef: RefObject<PortTypesLookup>;
}

/**
 * 会话上下文注入基线：判定「哪些上下文块已进入会话历史」。
 *
 * 背景：上下文只在会话首轮注入一次（pi 的 contextSentRef / ChatNodeHost 的
 * hasContextInStore 门控），复用历史会话后新接入/变更的上级节点（prompt_search、
 * 图片节点等）内容不会进入后续 LLM 调用。本基线以「原始（未剥离）用户消息内容」
 * 为真相做差集，把仍未注入的块增量补进当前轮次，避免重复注入既有块。
 *
 * 不依赖服务端新增存储：rawUserContents 在宿主水合时从 fetchPiSession 响应
 * 收集（chat.jsonl / conversation.jsonl 已含注入文本），recorded* 只覆盖
 * 「本次挂载注入但服务端尚未持久化」的窗口期。
 */
export interface ContextBaseline {
  /** 水合响应的原始用户消息正文（含注入上下文，剥离之前收集） */
  rawUserContents: string[];
  /** 水合响应的原始用户消息图片 URL（data URL / http） */
  rawUserImages: string[];
  /** 本次挂载期间已记录注入的文本块装配标记（防持久化前重复注入） */
  recordedMarkers: string[];
  /** 本次挂载期间已记录注入的图片 URL */
  recordedImages: string[];
}

export function emptyContextBaseline(): ContextBaseline {
  return { rawUserContents: [], rawUserImages: [], recordedMarkers: [], recordedImages: [] };
}

/** 从水合原始消息收集基线（调用方须在剥离注入上下文之前、用未清洗的 user 消息调用）。 */
export function collectContextBaseline(msgs: ChatMessage[]): ContextBaseline {
  const rawUserContents: string[] = [];
  const rawUserImages: string[] = [];
  for (const m of msgs) {
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string' && m.content) rawUserContents.push(m.content);
    for (const img of m.images ?? []) {
      if (typeof img === 'string' && img && !rawUserImages.includes(img)) rawUserImages.push(img);
    }
  }
  return {
    rawUserContents,
    rawUserImages,
    recordedMarkers: [],
    recordedImages: [],
  };
}

/** 单个上下文块的装配标记（与 buildChatContext 的 `【title】\ntext` 单块格式一致）。 */
export function blockMarker(b: InjectedContextBlock): string {
  return `【${b.title}】\n${b.text}`;
}

/** 记录一次已注入的上下文块（文本标记 + 图片 URL，供后续差集跳过）。 */
export function recordInjectedContext(
  baseline: ContextBaseline,
  blocks: InjectedContextBlock[]
): void {
  for (const b of blocks) {
    if (b.text) {
      const marker = blockMarker(b);
      if (!baseline.recordedMarkers.includes(marker)) baseline.recordedMarkers.push(marker);
    }
    for (const img of b.images ?? []) {
      if (img && !baseline.recordedImages.includes(img)) baseline.recordedImages.push(img);
    }
  }
}

/** 块正文是否已注入会话（原始历史全文包含装配标记，或本次挂载已记录）。 */
function blockTextInjected(b: InjectedContextBlock, baseline: ContextBaseline): boolean {
  if (!b.text) return false;
  const marker = blockMarker(b);
  return (
    baseline.rawUserContents.some((raw) => raw.includes(marker)) ||
    baseline.recordedMarkers.includes(marker)
  );
}

/**
 * 对比基线，返回仍需注入的上下文块。判定口径：
 * - 文本块：`【title】\ntext` 装配标记未在原始历史/挂载记录中出现 → 视为新增/变更，保留 text；
 * - 图片块：仅保留未在原始历史/挂载记录中出现的图片 URL（已注入的图不重复下发）；
 * - 正文已注入、且无新图片的块整体跳过（不重复注入）。
 */
export function diffContextBlocks(
  blocks: InjectedContextBlock[],
  baseline: ContextBaseline
): InjectedContextBlock[] {
  const out: InjectedContextBlock[] = [];
  for (const b of blocks) {
    const textInjected = blockTextInjected(b, baseline);
    const freshImages = (b.images ?? []).filter(
      (u) => u && !baseline.rawUserImages.includes(u) && !baseline.recordedImages.includes(u)
    );
    if (textInjected && !freshImages.length) continue;
    const outBlock: InjectedContextBlock = { id: b.id, title: b.title, nodeType: b.nodeType };
    if (!textInjected && b.text) outBlock.text = b.text;
    if (freshImages.length) outBlock.images = freshImages;
    out.push(outBlock);
  }
  return out;
}

/** 从上下文块拼接送给模型的文本上下文。 */
export function buildChatContext(blocks: InjectedContextBlock[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const b of blocks) {
    if (!b.text || seen.has(b.text)) continue;
    seen.add(b.text);
    parts.push(`【${b.title}】\n${b.text}`);
  }
  return parts.join('\n\n');
}

/** 收集上下文块中的图片引用（原始 URL / data URL，去重、上限内）。 */
export function collectBlockImageUrls(blocks: InjectedContextBlock[]): string[] {
  const urls: string[] = [];
  for (const b of blocks) {
    for (const u of b.images ?? []) {
      if (u && !urls.includes(u)) urls.push(u);
    }
  }
  return urls;
}

/** 收集对话上下文图片：直接父节点的图片输出（受设置开关控制），本地静态路径转 data URL。 */
export async function buildChatImagesFromBlocks(blocks: InjectedContextBlock[]): Promise<string[]> {
  const result: string[] = [];
  for (const u of collectBlockImageUrls(blocks)) {
    if (result.length >= MAX_CHAT_IMAGES) break;
    if (u.startsWith('data:')) {
      result.push(u);
      continue;
    }
    try {
      const dataUrl = await urlToDataUrl(u);
      if (dataUrl && result.length < MAX_CHAT_IMAGES) result.push(dataUrl);
    } catch {
      // 无法访问 / 非图片的 URL 直接跳过，不阻断对话
    }
  }
  return result;
}

/** 收集连线上游「Skill 检索」节点选中的 skill 名（Skill Agent 模式按需加载；空 = 全部已装 skill）。 */
export function collectSkillNames(node: NodeData): string[] {
  const names: string[] = [];
  for (const p of nodesRef.current) {
    if (
      p.type === 'skill_search' &&
      edgesRef.current.some((e) => e.target === node.id && e.source === p.id)
    ) {
      const selections: SkillSelection[] = Array.isArray(p.data?.skillSelections)
        ? p.data.skillSelections
        : [];
      for (const s of selections) {
        if (s && typeof s.name === 'string' && s.name && !names.includes(s.name)) {
          names.push(s.name);
        }
      }
    }
  }
  return names;
}

/** 单条消息图片数截断到上限（上下文与附件合计）。 */
export const capWireImages = (msgs: ChatMessage[]): ChatMessage[] =>
  msgs.map((m) =>
    m.images && m.images.length > MAX_CHAT_IMAGES
      ? { ...m, images: m.images.slice(0, MAX_CHAT_IMAGES) }
      : m
  );

/**
 * 剥离用户消息开头的注入上下文（形如 `【标题】\n正文\n\n...`），
 * 使得聊天气泡内只展示用户输入的纯文本，避免与顶部的 ContextInjectionBlock 折叠卡片重复。
 */
export function stripInjectedContext(
  text: string,
  contextBlocks?: InjectedContextBlock[]
): string {
  if (!text) return '';

  // 1. 若提供了 contextBlocks，优先尝试精确匹配 buildChatContext 生成的前缀
  if (contextBlocks && contextBlocks.length > 0) {
    const fullContext = buildChatContext(contextBlocks);
    if (fullContext && text.startsWith(fullContext)) {
      const rest = text.slice(fullContext.length);
      return rest.startsWith('\n\n') ? rest.slice(2) : rest.trimStart();
    }
    // 逐个 block 尝试前缀剥离
    let temp = text;
    let stripped = false;
    for (const b of contextBlocks) {
      if (!b.text) continue;
      const blockHeader = `【${b.title}】\n${b.text}`;
      if (temp.startsWith(blockHeader)) {
        temp = temp.slice(blockHeader.length);
        if (temp.startsWith('\n\n')) temp = temp.slice(2);
        else temp = temp.trimStart();
        stripped = true;
      }
    }
    if (stripped) return temp;
  }

  // 2. 通用结构化前缀剥离：识别以【...】开头的注入段落，提取尾部的用户输入文本
  if (text.startsWith('【')) {
    const lastDoubleNewline = text.lastIndexOf('\n\n');
    if (lastDoubleNewline !== -1) {
      const prefix = text.slice(0, lastDoubleNewline);
      const userText = text.slice(lastDoubleNewline + 2).trim();
      // 确认前缀以【开头且包含】
      if (prefix.startsWith('【') && prefix.includes('】')) {
        return userText;
      }
    }
  }

  return text;
}

