import { useCallback, type RefObject } from 'react';
import generationsService from '../../platform/services/generations';
import { flushSnapshot } from '../../platform/stores/useCanvasState';
import type { GenerationStageResults } from '../../platform/types';
import { findRootBookInfo, resolveDirectParents } from './nodeTypes';
import type { EdgeData, NodeData } from './graphTypes';

/** 历史记录组装依赖（由画布注入） */
export interface GenerationHistoryContext {
  nodesRef: RefObject<NodeData[]>;
  edgesRef: RefObject<EdgeData[]>;
  generationIds: RefObject<Record<string, number>>;
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
      // 根图书元数据（上下文配置注入的来源，与是否直接连线无关）；提示词/分析为直接上级
      const bookNode = findRootBookInfo(ctx.nodesRef.current, ctx.edgesRef.current);
      const promptNode = parents.find((p) => p.type === 'prompt_generation');
      const analysisNode = parents.find((p) => p.type === 'image_analysis');

      // Agent 中间步骤随记录持久化：历史/收藏/画廊页与刷新后仍可见
      const promptSteps = Array.isArray(promptNode?.data?.agentSteps)
        ? promptNode.data.agentSteps
        : [];
      const imageSteps = Array.isArray(imageNode.data?.agentSteps) ? imageNode.data.agentSteps : [];

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
                  : typeof imageNode.data?.prompt === 'string'
                    ? imageNode.data.prompt
                    : '',
              analysis:
                typeof analysisNode?.data?.analysis === 'string'
                  ? analysisNode.data.analysis
                  : undefined,
              agent_steps: promptSteps.length > 0 ? promptSteps : undefined,
            }
          : undefined,
        stage3: {
          image_url:
            typeof imageNode.data?.imageUrl === 'string' ? imageNode.data.imageUrl : '',
          prompt: typeof imageNode.data?.prompt === 'string' ? imageNode.data.prompt : '',
          agent_steps: imageSteps.length > 0 ? imageSteps : undefined,
        },
      };
    },
    []
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
        const gen = await generationsService.create({
          module: 'bookplate',
          stage_results: stageResults,
          final_image_url: imageUrl,
          status: 'completed',
        });
        ctx.generationIds.current[imageNodeId] = gen.id;
        flushSnapshot(); // 映射写入后立即落盘：后台完成 / 刷新后不丢映射，避免 ensureGeneration 重复建记录
        return gen.id;
      } catch (e) {
        console.error('自动保存历史记录失败:', e);
        return null;
      }
    },
    [buildStageResults]
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
        module: 'bookplate',
        stage_results: stageResults,
        final_image_url: imageUrl,
        status: 'completed',
      });
      ctx.generationIds.current[imageNodeId] = gen.id;
      flushSnapshot(); // 同上：确保刷新后映射仍在，收藏/公开不会重复建记录
      return gen.id;
    },
    [buildStageResults]
  );

  return { autoSaveGeneration, ensureGeneration };
}
