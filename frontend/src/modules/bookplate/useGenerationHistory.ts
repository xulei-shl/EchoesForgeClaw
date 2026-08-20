import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import generationsService from '../../platform/services/generations';
import { flushSnapshot } from '../../platform/stores/useCanvasState';
import type { GenerationStageResults } from '../../platform/types';
import { findConnectedBookInfoUpstream, findRootBookInfo, resolveDirectParents } from './nodeTypes';
import type { EdgeData, NodeData } from './graphTypes';

/** 历史记录组装依赖（由画布注入） */
export interface GenerationHistoryContext {
  nodesRef: RefObject<NodeData[]>;
  edgesRef: RefObject<EdgeData[]>;
  generationIds: RefObject<Record<string, number>>;
  setFavoritedState?: Dispatch<SetStateAction<Record<string, boolean>>>;
  setPublishedState?: Dispatch<SetStateAction<Record<string, boolean>>>;
}

export interface GenerationHistory {
  /** 生成成功后自动保存到历史记录（每次成功新建一条，失败不保存） */
  autoSaveGeneration: (imageNodeId: string, imageUrl: string) => Promise<number | null>;
  /** 确保该图片节点已有 Generation 记录，返回其 id（收藏/公开用） */
  ensureGeneration: (imageNodeId: string) => Promise<number>;
}

/** 历史记录（stage_results）组装与保存：沿直接连线取各阶段数据（与「连线即输入」模型一致）。 */
export function useGenerationHistory(ctx: GenerationHistoryContext): GenerationHistory {
  /** 由图片节点沿直接连线组装三阶段结果（含 Agent 中间步骤，持久化到历史记录） */
  const buildStageResults = useCallback(
    (imageNodeId: string): GenerationStageResults | null => {
      const imageNode = ctx.nodesRef.current.find((n) => n.id === imageNodeId);
      if (!imageNode) return null;

      const parents = resolveDirectParents(imageNodeId, ctx.nodesRef.current, ctx.edgesRef.current);
      // 图书元数据：优先沿入边向上追溯真正参与生成的 book_info（画布可存在多个互不连通的
      // 图书元数据节点，不能写死取根节点）；无连通 book_info 时回退画布根节点兜底——
      // 与 AI 对话节点图书元数据的兜底口径一致（连线上游优先、无连通取根节点），
      // 保证保存到 db 的历史记录始终携带图书元数据。提示词/分析为直接上级。
      const bookNode =
        findConnectedBookInfoUpstream(
          imageNodeId,
          ctx.nodesRef.current,
          ctx.edgesRef.current
        ) ?? findRootBookInfo(ctx.nodesRef.current, ctx.edgesRef.current);
      const promptNode = parents.find((p) => p.type === 'text_generation');
      const analysisNode = parents.find((p) => p.type === 'image_analysis');

      // Agent 中间步骤随记录持久化：历史/收藏/画廊页与刷新后仍可见
      const promptSteps = Array.isArray(promptNode?.data?.agentSteps)
        ? promptNode.data.agentSteps
        : [];
      const imageSteps = Array.isArray(imageNode.data?.agentSteps) ? imageNode.data.agentSteps : [];

      const promptText =
        imageNode.type === 'receipt_printer'
          ? (imageNode.data?.storeName ? `${imageNode.data.storeName} - ${imageNode.data?.subtitle || '图书小票'}` : '图书小票生成')
          : imageNode.type === 'stamp_cutter'
            ? '邮票截图'
            : typeof imageNode.data?.prompt === 'string'
              ? imageNode.data.prompt
              : '';

      return {
        stage1: bookNode
          ? {
              isbn: bookNode.data?.isbn || '',
              metadata: bookNode.data || {},
            }
          : undefined,
        stage2: promptNode
          ? {
              // 优先直接上级提示词节点内容；非标准链路上回退本次生成实际使用的提示词
              prompt:
                typeof promptNode.data?.content === 'string' && promptNode.data.content
                  ? promptNode.data.content
                  : promptText,
              analysis:
                typeof analysisNode?.data?.analysis === 'string'
                  ? analysisNode.data.analysis
                  : undefined,
              agent_steps: promptSteps.length > 0 ? promptSteps : undefined,
            }
          : (imageNode.type === 'receipt_printer' || imageNode.type === 'stamp_cutter')
            ? { prompt: promptText }
            : undefined,
        stage3: {
          image_url:
            typeof imageNode.data?.imageUrl === 'string' ? imageNode.data.imageUrl : '',
          prompt: promptText,
          agent_steps: imageSteps.length > 0 ? imageSteps : undefined,
        },
      };
    },
    // nodesRef / edgesRef 为模块级单例（useCanvasState），身份恒定，加入不会改变稳定性
    [ctx.nodesRef, ctx.edgesRef]
  );

  /** 生成成功后自动保存到历史记录（每次成功新建一条，失败不保存）。 */
  const autoSaveGeneration = useCallback(
    async (imageNodeId: string, imageUrl: string): Promise<number | null> => {
      const stageResults = buildStageResults(imageNodeId);
      if (!stageResults) return null;
      // 覆盖 stage3 时保留 buildStageResults 已收集的 Agent 中间步骤
      const agentSteps = Array.isArray(stageResults.stage3?.agent_steps)
        ? stageResults.stage3.agent_steps
        : undefined;
      stageResults.stage3 = {
        image_url: imageUrl,
        prompt:
          typeof stageResults.stage3?.prompt === 'string' ? stageResults.stage3.prompt : '',
        agent_steps: agentSteps,
      };
      try {
        const imageNode = ctx.nodesRef.current.find((n) => n.id === imageNodeId);
        const gen = await generationsService.create({
          // 记录产出该结果的节点类型（当前为图像生成；后续音频等节点接入后沿用）
          node_type: imageNode?.type || 'image_generation',
          stage_results: stageResults,
          result_url: imageUrl,
          status: 'completed',
        });
        ctx.generationIds.current[imageNodeId] = gen.id;
        flushSnapshot(); // 映射写入后立即落盘：后台完成 / 刷新后不丢映射，避免 ensureGeneration 重复建记录
        // 新记录默认 is_favorited=false, is_public=false，重置 UI 态避免旧记录残留
        ctx.setFavoritedState?.((prev) => ({ ...prev, [imageNodeId]: false }));
        ctx.setPublishedState?.((prev) => ({ ...prev, [imageNodeId]: false }));
        return gen.id;
      } catch (e) {
        console.error('自动保存历史记录失败:', e);
        return null;
      }
    },
    [buildStageResults, ctx.nodesRef, ctx.generationIds]
  );

  /** 确保该图片节点已有 Generation 记录，返回其 id */
  const ensureGeneration = useCallback(
    async (imageNodeId: string): Promise<number> => {
      const existing = ctx.generationIds.current[imageNodeId];
      if (existing) return existing;

      const imageNode = ctx.nodesRef.current.find((n) => n.id === imageNodeId);
      if (imageNode?.data?.isMock) {
        throw new Error('占位图片不能保存到历史记录');
      }

      const stageResults = buildStageResults(imageNodeId) ?? {};
      const imageUrl = stageResults.stage3?.image_url || '';
      const gen = await generationsService.create({
        // 记录产出该结果的节点类型（当前为图像生成；后续音频等节点接入后沿用）
        node_type: imageNode?.type || 'image_generation',
        stage_results: stageResults,
        result_url: imageUrl,
        status: 'completed',
      });
      ctx.generationIds.current[imageNodeId] = gen.id;
      flushSnapshot(); // 同上：确保刷新后映射仍在，收藏/公开不会重复建记录
      return gen.id;
    },
    [buildStageResults, ctx.nodesRef, ctx.generationIds]
  );

  return { autoSaveGeneration, ensureGeneration };
}
