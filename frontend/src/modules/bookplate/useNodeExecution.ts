import type { Dispatch, RefObject, SetStateAction } from 'react';
import { postSSEStream } from '../../platform/services/sse';
import api from '../../platform/services/api';
import {
  PROMPT_SSE_IDLE_TIMEOUT_MS,
  IMAGE_GENERATION_TIMEOUT_MS,
} from '../../platform/utils/timeouts';
import {
  collectMismatchParents,
  resolveNodeRunInputs,
  withMismatchHint,
  type PortTypesLookup,
} from './execution';
import type { EdgeData, NodeData } from './graphTypes';
import { handleAgentSseMessage } from './agentSteps';
import { makeIdleTimeout } from './idleTimeout';
import type { RegistryNodeConfig } from '../../platform/types';

/** 执行引擎依赖（由画布注入：全部为 ref / 稳定 setter，保证闭包不过期） */
export interface NodeExecutionContext {
  nodesRef: RefObject<NodeData[]>;
  edgesRef: RefObject<EdgeData[]>;
  portTypesRef: RefObject<PortTypesLookup>;
  streamControllers: RefObject<Map<string, AbortController>>;
  analysisUploads: RefObject<Map<string, string>>;
  registryConfigsRef: RefObject<RegistryNodeConfig[]>;
  updateNodeData: (id: string, patch: Record<string, any>) => void;
  setNodes: Dispatch<SetStateAction<NodeData[]>>;
  setSelectedImageId: Dispatch<SetStateAction<string | null>>;
  setFavoritedState: Dispatch<SetStateAction<Record<string, boolean>>>;
  setPublishedState: Dispatch<SetStateAction<Record<string, boolean>>>;
  generationIds: RefObject<Record<string, number>>;
  autoSaveGeneration: (imageNodeId: string, imageUrl: string) => Promise<number | null>;
}

export interface NodeExecution {
  runNode: (node: NodeData) => string;
  runImageGeneration: (node: NodeData, prompt: string, image?: string) => Promise<void>;
}

export function useNodeExecution(ctx: NodeExecutionContext): NodeExecution {
  const { streamControllers, analysisUploads } = ctx;

  /** 图片分析节点：SSE 流式执行（LLM 一次性返回 analysis 事件；Agent 透传中间步骤 + 最终 analysis） */
  const runImageAnalysis = (node: NodeData, opts: { image?: string; coverUrl?: string }) => {
    if (streamControllers.current.has(node.id)) return;
    const controller = new AbortController();
    streamControllers.current.set(node.id, controller);
    ctx.updateNodeData(node.id, {
      isGenerating: true,
      error: null,
      agentSteps: [],
      analysis: undefined,
    });

    const idle = makeIdleTimeout(controller, PROMPT_SSE_IDLE_TIMEOUT_MS);
    idle.arm();

    postSSEStream({
      url: '/api/modules/bookplate/analyze-image',
      body: {
        image: opts.image,
        cover_url: opts.coverUrl,
        config_id: node.configId ?? null,
        node_id: node.id,
      },
      signal: controller.signal,
      onMessage: (event, data) => {
        idle.arm(); // 收到数据，重置空闲计时
        if (
          event === 'agent_tool_call' ||
          event === 'agent_tool_result' ||
          event === 'agent_status'
        ) {
          handleAgentSseMessage(ctx.setNodes, node.id, event, data);
          return;
        }
        if (event === 'analysis') {
          ctx.updateNodeData(node.id, { analysis: data, isGenerating: false, error: null });
          return;
        }
        if (event === 'error') {
          ctx.updateNodeData(node.id, { isGenerating: false, error: data });
          return;
        }
      },
    })
      .then(() => {
        ctx.updateNodeData(node.id, { isGenerating: false });
      })
      .catch((err) => {
        if (!idle.isTimedOut() && err?.name === 'AbortError') return; // 节点被删除 / 画布清空
        console.error('SSE stream error:', err);
        ctx.updateNodeData(node.id, {
          isGenerating: false,
          error: idle.isTimedOut() ? '图片分析超时，请重试' : '图片分析失败，请重试',
        });
      })
      .finally(() => {
        idle.clear();
        streamControllers.current.delete(node.id);
      });
  };

  /** 提示词生成节点：基于上游数据流式生成（LLM 流式 / Agent 透传中间步骤） */
  const runPromptGeneration = (
    node: NodeData,
    inputs: { metadata: any; analysis: string; text?: string }
  ) => {
    // 重试防抖：该节点已有进行中的流时直接忽略（防止快速连点开启并发流导致内容重复）
    if (streamControllers.current.has(node.id)) return;
    const controller = new AbortController();
    streamControllers.current.set(node.id, controller);
    ctx.updateNodeData(node.id, { content: '', isGenerating: true, error: null, agentSteps: [] });

    const idle = makeIdleTimeout(controller, PROMPT_SSE_IDLE_TIMEOUT_MS);
    idle.arm();

    postSSEStream({
      url: '/api/modules/bookplate/generate-prompt',
      body: {
        metadata: inputs.metadata,
        analysis: inputs.analysis,
        text: inputs.text ?? '',
        config_id: node.configId ?? null,
        node_id: node.id,
      },
      signal: controller.signal,
      onMessage: (event, data) => {
        idle.arm(); // 收到数据，重置空闲计时
        // Agent 模式中间步骤（工具调用 / 思考状态）单独处理，不注入提示词内容
        if (
          event === 'agent_tool_call' ||
          event === 'agent_tool_result' ||
          event === 'agent_status'
        ) {
          handleAgentSseMessage(ctx.setNodes, node.id, event, data);
          return;
        }
        ctx.setNodes((prev) =>
          prev.map((n) => {
            if (n.id !== node.id) return n;
            if (event === 'error') {
              // 后端流式生成失败：切换为错误态（复用错误横幅 + 重试），不注入文本到内容
              return { ...n, data: { ...n.data, isGenerating: false, error: data } };
            }
            return { ...n, data: { ...n.data, content: (n.data.content || '') + data } };
          })
        );
      },
    })
      .then(() => {
        ctx.updateNodeData(node.id, { isGenerating: false });
      })
      .catch((err) => {
        if (!idle.isTimedOut() && err?.name === 'AbortError') return; // 节点被删除 / 画布清空
        console.error('SSE stream error:', err);
        ctx.updateNodeData(node.id, {
          isGenerating: false,
          error: idle.isTimedOut() ? '提示词生成超时，请重试' : '提示词生成失败',
        });
      })
      .finally(() => {
        idle.clear();
        streamControllers.current.delete(node.id);
      });
  };

  // ---------- 图像生成 ----------
  /** Agent 模式图片生成：SSE 流式透传中间步骤，最终 image_url 事件落图 */
  const runImageGenerationAgent = async (
    nodeId: string,
    prompt: string,
    controller: AbortController,
    configId?: number,
    image?: string
  ) => {
    const idle = makeIdleTimeout(controller, IMAGE_GENERATION_TIMEOUT_MS);
    idle.arm();

    try {
      await postSSEStream({
        url: '/api/modules/bookplate/generate-image',
        body: {
          prompt,
          image: image ? [image] : undefined,
          config_id: configId ?? null,
          node_id: nodeId,
        },
        signal: controller.signal,
        onMessage: (event, data) => {
          idle.arm(); // 收到数据，重置空闲计时
          if (
            event === 'agent_tool_call' ||
            event === 'agent_tool_result' ||
            event === 'agent_status'
          ) {
            handleAgentSseMessage(ctx.setNodes, nodeId, event, data);
            return;
          }
          if (event === 'image_url') {
            let payload: any = {};
            try {
              payload = JSON.parse(data);
            } catch {
              /* 忽略 */
            }
            const url = payload?.image_url;
            if (url) {
              ctx.updateNodeData(nodeId, {
                imageUrl: url,
                isGenerating: false,
                error: payload?.mock ? 'API 配置缺失，当前为演示占位图' : null,
                isMock: payload?.mock,
              });
              ctx.setSelectedImageId(nodeId);
              if (!payload?.mock) {
                void ctx.autoSaveGeneration(nodeId, url).catch(() => undefined);
              }
            }
            return;
          }
          if (event === 'error') {
            ctx.updateNodeData(nodeId, { isGenerating: false, error: data });
            return;
          }
        },
      });
    } catch (err: any) {
      if (!idle.isTimedOut() && err?.name === 'AbortError') return; // 节点被删除 / 画布清空
      console.error('Agent image SSE error:', err);
      ctx.updateNodeData(nodeId, {
        isGenerating: false,
        error: idle.isTimedOut() ? '图片生成超时，请重试' : '图片生成失败，请重试',
      });
    } finally {
      idle.clear();
    }
  };

  const runImageGeneration = async (node: NodeData, prompt: string, image?: string) => {
    // 重试防抖：该节点已有进行中的生成时直接忽略（防止快速连点开启并发请求，
    // 导致孤儿流 + 历史记录重复保存）
    if (streamControllers.current.has(node.id)) return;
    // 记录本次实际使用的提示词：供分支重试（branchImageNode）与历史记录 stage3.prompt 使用
    ctx.updateNodeData(node.id, {
      prompt,
      isGenerating: true,
      imageUrl: null,
      error: null,
      agentSteps: [],
    });
    // 重新生成后，旧的保存快照/收藏状态失效
    delete ctx.generationIds.current[node.id];
    ctx.setFavoritedState((prev) => ({ ...prev, [node.id]: false }));
    ctx.setPublishedState((prev) => ({ ...prev, [node.id]: false }));
    const controller = new AbortController();
    streamControllers.current.set(node.id, controller);

    try {
      // 执行模式由该节点绑定的配置决定（agent 走 SSE 流式，否则走 LLM 图像 API）
      const cfg =
        node.configId != null
          ? ctx.registryConfigsRef.current.find((c) => c.id === node.configId)
          : undefined;
      if (cfg?.mode === 'agent') {
        await runImageGenerationAgent(node.id, prompt, controller, node.configId, image);
        return;
      }
      // 图片生成耗时较长（可达 30-120s+），超时须覆盖后端最坏耗时（见 timeouts.ts）
      const res: any = await api.post(
        '/modules/bookplate/generate-image',
        { prompt, image: image ? [image] : undefined, config_id: node.configId ?? null, node_id: node.id },
        {
          timeout: IMAGE_GENERATION_TIMEOUT_MS,
          signal: controller.signal,
        }
      );
      ctx.updateNodeData(node.id, {
        imageUrl: res.image_url,
        isGenerating: false,
        error: res.mock ? 'API 配置缺失，当前为演示占位图' : null,
        isMock: res.mock,
      });
      // 新图生成成功：自动选中，使全局操作栏作用于本节点
      ctx.setSelectedImageId(node.id);
      // 成功即自动保存一条历史记录（失败不保存），重试会新建而非覆盖
      if (!res.mock) {
        await ctx.autoSaveGeneration(node.id, res.image_url).catch(() => undefined);
      }
    } catch (error: any) {
      if (error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED') return;
      console.error('Failed to generate image:', error);
      // 超时与普通失败分开提示（拦截器保留 isTimeout 标记）；后端 502 detail 兜底展示
      ctx.updateNodeData(node.id, {
        isGenerating: false,
        error: error?.isTimeout
          ? '图片生成超时，请重试'
          : error?.detail || '图片生成失败，请重试',
      });
    } finally {
      streamControllers.current.delete(node.id);
    }
  };

  /** 待运行原因：附加上游类型不匹配提示（红色连线已给出视觉标注，这里补充文字说明） */
  const pendingReason = (node: NodeData, base: string): string => {
    const mismatch = collectMismatchParents(
      node,
      ctx.nodesRef.current,
      ctx.edgesRef.current,
      ctx.portTypesRef.current
    );
    return withMismatchHint(base, mismatch);
  };

  /**
   * 节点执行分发：按类型收集直接上级输入并执行（输入不足时返回待运行原因字符串）。
   * 返回非空字符串表示本次未执行的原因（供手动「运行」按钮 toast 提示）；执行成功返回 ''。
   */
  const runNode = (node: NodeData): string => {
    switch (node.type) {
      case 'book_info':
        return ''; // 需用户输入 ISBN
      case 'image_analysis': {
        const inputs = resolveNodeRunInputs(
          node,
          ctx.nodesRef.current,
          ctx.edgesRef.current,
          ctx.portTypesRef.current
        );
        const { book, uploadNode, refImage } = inputs;
        // 注意：必须传豆瓣原始 URL（cover_image），而非本地代理 URL（cover_image_local）——
        // 后端仅接受 doubanio.com 域名做封面抓取/分析
        const coverUrl =
          book?.data?.cover_image || book?.data?.coverUrl || book?.data?.cover_image_local;
        const uploaded = analysisUploads.current.get(node.id);
        // 图片来源优先级：节点内直接上传的参考图 > 上游图片上传节点 > 图书封面。
        // 显式连接了「图片上传」节点时以该节点为准：尚未上传图片则保持待运行态，不回退封面
        const image = uploaded || refImage;
        if (!image && (uploadNode || !coverUrl)) {
          return pendingReason(
            node,
            '缺少可分析的图片（上传参考图，或连线「图片上传」节点 / 开启「包含图书元数据」）'
          );
        }
        // 后端同样优先解析 image 字段，cover_url 仅作兜底
        runImageAnalysis(node, { image, coverUrl: coverUrl || undefined });
        return '';
      }
      case 'prompt_generation': {
        const inputs = resolveNodeRunInputs(
          node,
          ctx.nodesRef.current,
          ctx.edgesRef.current,
          ctx.portTypesRef.current
        );
        if (!inputs.book?.data?.isbn && !inputs.analysis && !inputs.text) {
          return pendingReason(
            node,
            '缺少上游输入（连线 图片分析 / 文本 / AI对话 节点，或开启「包含图书元数据」）'
          );
        }
        runPromptGeneration(node, {
          metadata: inputs.book?.data ?? {},
          analysis: inputs.analysis,
          text: inputs.text,
        });
        return '';
      }
      case 'image_generation': {
        const inputs = resolveNodeRunInputs(
          node,
          ctx.nodesRef.current,
          ctx.edgesRef.current,
          ctx.portTypesRef.current
        );
        if (inputs.promptNodes.some((p) => p.data?.isGenerating)) return '提示词生成中，请稍候';
        if (!inputs.imagePrompt.trim()) {
          return pendingReason(
            node,
            '缺少提示词（连线「提示词生成」节点，或开启「包含图书元数据」）'
          );
        }
        if (inputs.uploadNode && !inputs.refImage) return '「图片上传」节点尚未上传图片';
        runImageGeneration(node, inputs.imagePrompt, inputs.refImage);
        return '';
      }
      case 'chat':
      case 'text':
      case 'image_upload':
        return ''; // 用户手动输入 / 上传，无需自动执行
      case 'text_aggregate':
        return ''; // 纯文本变换：输出随上级内容/连线变化自动重算，无需手动运行
    }
  };

  return {
    runNode,
    runImageGeneration,
  };
}
