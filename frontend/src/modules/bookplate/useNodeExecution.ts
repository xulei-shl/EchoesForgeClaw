import type { Dispatch, RefObject, SetStateAction } from 'react';
import { postUIStream } from './uiStream';
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
import { bookCoverImage } from './nodeTypes';
import { urlToDataUrl } from './imageUpload';
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

  /** 图片分析节点：UI Message Stream 流式执行（LLM 一次性返回文本；Agent 透传中间步骤 + 最终文本） */
  const runImageAnalysis = async (node: NodeData, opts: { image?: string; coverUrl?: string }) => {
    if (streamControllers.current.has(node.id)) return;
    const controller = new AbortController();
    streamControllers.current.set(node.id, controller);
    ctx.updateNodeData(node.id, {
      isGenerating: true,
      error: null,
      agentSteps: [],
      analysis: undefined,
    });

    // 参考图可能是「图像生成」上级节点的本地路径（/static/generated/...），后端分析接口
    // 只接受 base64 data URL：先转换；读取失败则置空（回退封面，与封面抓取失败同语义）
    let image = opts.image;
    if (image && !image.startsWith('data:')) {
      try {
        image = await urlToDataUrl(image);
      } catch {
        image = undefined;
      }
    }

    const idle = makeIdleTimeout(controller, PROMPT_SSE_IDLE_TIMEOUT_MS);
    idle.arm();

    postUIStream({
      url: '/api/modules/bookplate/analyze-image',
      body: {
        image,
        cover_url: opts.coverUrl,
        config_id: node.configId ?? null,
        node_id: node.id,
        // 节点内手动选择的模型名（仅 LLM 模式生效；空 = 跟随节点配置的默认模型）
        model_name: node.data?.settings?.modelOverride ?? null,
      },
      signal: controller.signal,
      onData: (event, data) => {
        idle.arm(); // 收到数据，重置空闲计时
        if (
          event === 'agent_tool_call' ||
          event === 'agent_tool_result' ||
          event === 'agent_status'
        ) {
          handleAgentSseMessage(ctx.setNodes, node.id, event, JSON.stringify(data));
          return;
        }
        // 其余 data part（agent_file / agent_image 等）本节点不需要
      },
      onStreamEnd: (analysis) => {
        idle.arm();
        if (analysis.trim()) {
          ctx.updateNodeData(node.id, { analysis, isGenerating: false, error: null });
        }
      },
      onError: (message) => {
        ctx.updateNodeData(node.id, { isGenerating: false, error: message });
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

    let pendingDelta = '';
    let throttleTimer: ReturnType<typeof setTimeout> | null = null;

    const flushDelta = () => {
      if (throttleTimer !== null) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      if (!pendingDelta) return;
      const toApply = pendingDelta;
      pendingDelta = '';
      ctx.setNodes((prev) =>
        prev.map((n) =>
          n.id === node.id
            ? { ...n, data: { ...n.data, content: (n.data.content || '') + toApply } }
            : n
        )
      );
    };

    postUIStream({
      url: '/api/modules/bookplate/generate-prompt',
      body: {
        metadata: inputs.metadata,
        analysis: inputs.analysis,
        text: inputs.text ?? '',
        config_id: node.configId ?? null,
        node_id: node.id,
        // 节点内手动选择的模型名（仅 LLM 模式生效；空 = 跟随节点配置的默认模型）
        model_name: node.data?.settings?.modelOverride ?? null,
      },
      signal: controller.signal,
      onTextDelta: (delta) => {
        idle.arm(); // 收到数据，重置空闲计时
        pendingDelta += delta;
        if (throttleTimer === null) {
          throttleTimer = setTimeout(() => {
            throttleTimer = null;
            flushDelta();
          }, 60);
        }
      },
      onData: (event, data) => {
        idle.arm();
        // Agent 模式中间步骤（工具调用 / 思考状态）单独处理，不注入提示词内容
        if (
          event === 'agent_tool_call' ||
          event === 'agent_tool_result' ||
          event === 'agent_status'
        ) {
          handleAgentSseMessage(ctx.setNodes, node.id, event, JSON.stringify(data));
        }
      },
      onError: (message) => {
        flushDelta();
        // 后端流式生成失败：切换为错误态（复用错误横幅 + 重试），不注入文本到内容
        ctx.updateNodeData(node.id, { isGenerating: false, error: message });
      },
    })
      .then(() => {
        flushDelta();
        ctx.updateNodeData(node.id, { isGenerating: false });
      })
      .catch((err) => {
        flushDelta();
        if (!idle.isTimedOut() && err?.name === 'AbortError') return; // 节点被删除 / 画布清空
        console.error('SSE stream error:', err);
        ctx.updateNodeData(node.id, {
          isGenerating: false,
          error: idle.isTimedOut() ? '提示词生成超时，请重试' : '提示词生成失败',
        });
      })
      .finally(() => {
        flushDelta();
        idle.clear();
        streamControllers.current.delete(node.id);
      });
  };

  // ---------- 图像生成 ----------
  /** Agent 模式图片生成：UI Message Stream 透传中间步骤，最终 agent_image part 落图 */
  const runImageGenerationAgent = async (
    nodeId: string,
    prompt: string,
    controller: AbortController,
    configId?: number,
    images?: string[]
  ) => {
    const idle = makeIdleTimeout(controller, IMAGE_GENERATION_TIMEOUT_MS);
    idle.arm();

    try {
      await postUIStream({
        url: '/api/modules/bookplate/generate-image',
        body: {
          prompt,
          image: images?.length ? images : undefined,
          config_id: configId ?? null,
          node_id: nodeId,
        },
        signal: controller.signal,
        onData: (event, data) => {
          idle.arm(); // 收到数据，重置空闲计时
          if (
            event === 'agent_tool_call' ||
            event === 'agent_tool_result' ||
            event === 'agent_status'
          ) {
            handleAgentSseMessage(ctx.setNodes, nodeId, event, JSON.stringify(data));
            return;
          }
          if (event === 'agent_image') {
            const payload = (data ?? {}) as { url?: string; image_url?: string; mock?: boolean };
            const url = payload?.url || payload?.image_url;
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
          // 其余 data part（agent_file 等）本节点不需要
        },
        onError: (message) => {
          ctx.updateNodeData(nodeId, { isGenerating: false, error: message });
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

  const runImageGeneration = async (
    node: NodeData,
    prompt: string,
    image?: string,
    coverUrl?: string
  ) => {
    // 重试防抖：该节点已有进行中的生成时直接忽略（防止快速连点开启并发请求，
    // 导致孤儿流 + 历史记录重复保存）
    if (streamControllers.current.has(node.id)) return;
    // 图书封面图（图生图参考，与 AI 对话节点同口径）：includeBookCover 开启且封面可用时，
    // 与参考图一并作为多图参考（Agnes 多图合成契约）；跨域/代理失败跳过不阻断。
    const images: string[] = [];
    if (image) {
      if (image.startsWith('data:')) {
        // 「图片上传」节点参考图：已是 data URL，直接使用
        images.push(image);
      } else {
        // 「图像生成」上级节点的本地图片（/static/generated/...）：转 data URL 后再随请求发出。
        // 图生图契约要求 base64 图片（相对路径外部模型无法访问）；读取失败跳过不阻断生成
        try {
          const dataUrl = await urlToDataUrl(image);
          if (dataUrl) images.push(dataUrl);
        } catch {
          // 本地图片读取失败（跨域 / 文件缺失）跳过，不阻断生成
        }
      }
    }
    if (coverUrl) {
      try {
        const coverDataUrl = await urlToDataUrl(coverUrl);
        if (coverDataUrl) images.push(coverDataUrl);
      } catch {
        // 封面抓取失败（跨域 / 代理 502）跳过，不阻断生成
      }
    }
    const wireImages = images.length ? images : undefined;
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
        await runImageGenerationAgent(node.id, prompt, controller, node.configId, wireImages);
        return;
      }
      // 图片生成耗时较长（可达 30-120s+），超时须覆盖后端最坏耗时（见 timeouts.ts）
      const runSettings = node.data?.settings;
      const body: Record<string, unknown> = {
        prompt,
        image: wireImages,
        config_id: node.configId ?? null,
        node_id: node.id,
      };
      // 运行设置里的尺寸/宽高比按次透传（后端覆盖配置默认值）
      if (runSettings?.imageSize) body.size = runSettings.imageSize;
      if (runSettings?.imageRatio) body.ratio = runSettings.imageRatio;
      // 节点内手动选择的模型名（仅 LLM 模式生效；空 = 跟随节点配置的默认模型）
      if (runSettings?.modelOverride) body.model_name = runSettings.modelOverride;
      const res: any = await api.post('/modules/bookplate/generate-image', body, {
        timeout: IMAGE_GENERATION_TIMEOUT_MS,
        signal: controller.signal,
      });
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
        const { book, imageNodes, refImage } = inputs;
        // 注意：必须传豆瓣原始 URL（cover_image），而非本地代理 URL（cover_image_local）——
        // 后端仅接受 doubanio.com 域名做封面抓取/分析
        const coverUrl =
          book?.data?.cover_image || book?.data?.coverUrl || book?.data?.cover_image_local;
        const uploaded = analysisUploads.current.get(node.id);
        // 图片来源优先级：节点内直接上传的参考图 > 上游图片输出节点 > 图书封面。
        // 显式连接了图片类节点时以该节点为准：暂无图片则保持待运行态，不回退封面
        const image = uploaded || refImage;
        if (!image && (imageNodes.length || !coverUrl)) {
          return pendingReason(
            node,
            '缺少可分析的图片（上传参考图，或连线图片类节点 / 开启「包含图书元数据」）'
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
            '缺少提示词（连线「提示词生成」/「图片分析」/文本节点，或开启「包含图书元数据」）'
          );
        }
        if (inputs.imageNodes.length && !inputs.refImage) {
          return '图片类上级暂无可用图片（等待上传或生成完成）';
        }
        // 图书封面图：与 AI 对话节点同口径（穿透 + 兜底均由 includeBook 解析的 book 承载），
        // includeBookCover 默认开启（旧节点 undefined 视为开启）
        const includeCover = node.data?.settings?.includeBookCover !== false;
        const coverUrl =
          includeCover && inputs.book ? bookCoverImage(inputs.book.data) : '';
        runImageGeneration(node, inputs.imagePrompt, inputs.refImage, coverUrl);
        return '';
      }
      case 'chat':
      case 'text':
      case 'image_upload':
        return ''; // 用户手动输入 / 上传，无需自动执行
      case 'text_aggregate':
        return ''; // 纯文本变换：输出随上级内容/连线变化自动重算，无需手动运行
      case 'prompt_search':
        return ''; // 手动选用提示词，无需自动执行
      case 'skill_search':
        return ''; // 手动检索 / 安装 skill，无需自动执行
      case 'calendar':
      case 'weather':
        return ''; // 手动输入参数（日期 / 城市）后点查询，无需自动执行
      case 'map_poster':
        return ''; // 客户端渲染导出（导出按钮触发），无需自动执行
      case 'image_search':
      case 'art_image_search':
        return ''; // 手动检索 / 选择图片，无需自动执行
    }
  };

  return {
    runNode,
    runImageGeneration,
  };
}
