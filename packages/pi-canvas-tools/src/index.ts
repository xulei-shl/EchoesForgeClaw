/**
 * Pi-Agent Canvas Tools Extension
 *
 * 注册画布操作工具，通过 extension_ui_request 机制与前端通信。
 * 画布操作类工具通过 ctx.ui.select 桥接到前端执行；
 * 搜索/查询类工具直接 HTTP 调用后端 API。
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

/** 后端地址（通过环境变量注入 pi-agent 子进程） */
const BACKEND_URL = process.env.PI_BACKEND_URL || 'http://localhost:3000';

/**
 * 画布操作桥接：通过 ctx.ui.select 将操作指令发送到前端执行。
 * 前端识别 title 前缀 "CANVAS_OP:" 后自动执行画布操作并返回结果。
 */
async function canvasOp(
  ctx: any,
  op: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const payload = JSON.stringify({ op, params });
  const result = await ctx.ui.select(`CANVAS_OP:${op}`, [payload], `执行画布操作: ${op}`);
  if (!result) return { success: false, error: '操作被取消或前端未响应' };
  try {
    return JSON.parse(result);
  } catch {
    return { success: true, raw: result };
  }
}

export default function (pi: ExtensionAPI) {
  // ==================== 画布操作工具（通过 UI 桥接到前端） ====================

  pi.registerTool({
    name: 'canvas_create_node',
    label: '创建画布节点',
    description: '在画布上创建新节点。支持所有节点类型，可指定父节点自动连线。',
    promptSnippet: '在画布上创建指定类型的节点',
    promptGuidelines: [
      '使用 canvas_create_node 创建节点前，先阅读 canvas-node-catalog skill 了解可用节点类型。',
      '使用 canvas_create_node 时必须指定 type 参数，可选 parent_id 实现自动连线。',
    ],
    parameters: Type.Object({
      type: Type.String({ description: '节点类型（如 book_info, text, image_generation 等）' }),
      parent_id: Type.Optional(Type.String({ description: '父节点 ID（指定后自动连线）' })),
      data: Type.Optional(Type.Unknown({ description: '节点配置数据（JSON 对象）' })),
      config_id: Type.Optional(Type.Number({ description: '节点配置 ID' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await canvasOp(ctx, 'create_node', params as Record<string, unknown>);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
    },
  });

  pi.registerTool({
    name: 'canvas_connect_nodes',
    label: '连接画布节点',
    description: '连接两个已有节点，创建数据流连线。',
    promptSnippet: '连接两个画布节点创建数据流',
    promptGuidelines: [
      '使用 canvas_connect_nodes 时必须提供 source_id 和 target_id，确保两个节点已创建。',
    ],
    parameters: Type.Object({
      source_id: Type.String({ description: '源节点 ID' }),
      target_id: Type.String({ description: '目标节点 ID' }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await canvasOp(ctx, 'connect_nodes', params as Record<string, unknown>);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
    },
  });

  // ==================== 搜索/查询工具（直接 HTTP 调用后端 API） ====================

  pi.registerTool({
    name: 'canvas_search_prompts',
    label: '搜索提示词',
    description: '从 Bifrost 提示词库搜索提示词，返回提示词列表供选择。',
    promptSnippet: '搜索 Bifrost 提示词库',
    promptGuidelines: ['使用 canvas_search_prompts 搜索提示词时，用简洁的中文关键词效果最好。'],
    parameters: Type.Object({
      query: Type.String({ description: '搜索关键词' }),
      limit: Type.Optional(Type.Number({ description: '返回数量，默认 10' })),
    }),
    async execute(_toolCallId, params, signal) {
      const { query, limit = 10 } = params;
      const url = `${BACKEND_URL}/api/modules/bookplate/bifrost/prompts?q=${encodeURIComponent(query)}&limit=${limit}`;
      const resp = await fetch(url, { signal });
      if (!resp.ok) return { content: [{ type: 'text' as const, text: `搜索失败: HTTP ${resp.status}` }] };
      const data = await resp.json();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data.prompts ?? data, null, 2) }],
        details: { count: Array.isArray(data.prompts) ? data.prompts.length : 0 },
      };
    },
  });

  pi.registerTool({
    name: 'canvas_search_skills',
    label: '搜索 Skill',
    description: '从 Bifrost Skill 库搜索 Skill，返回 Skill 列表供选择。',
    promptSnippet: '搜索 Bifrost Skill 库',
    promptGuidelines: ['使用 canvas_search_skills 搜索 Skill 时，用简洁的中文关键词效果最好。'],
    parameters: Type.Object({
      query: Type.String({ description: '搜索关键词' }),
      limit: Type.Optional(Type.Number({ description: '返回数量，默认 10' })),
    }),
    async execute(_toolCallId, params, signal) {
      const { query, limit = 10 } = params;
      const url = `${BACKEND_URL}/api/modules/bookplate/skills/bifrost-search?q=${encodeURIComponent(query)}&limit=${limit}`;
      const resp = await fetch(url, { signal });
      if (!resp.ok) return { content: [{ type: 'text' as const, text: `搜索失败: HTTP ${resp.status}` }] };
      const data = await resp.json();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data.skills ?? data, null, 2) }],
        details: { count: Array.isArray(data.skills) ? data.skills.length : 0 },
      };
    },
  });

  pi.registerTool({
    name: 'canvas_get_presets',
    label: '获取节点预设',
    description: '获取多模态节点的预设配置列表。',
    promptSnippet: '获取多模态节点的可用预设列表',
    promptGuidelines: ['使用 canvas_get_presets 前先确认节点类型是多模态节点。'],
    parameters: Type.Object({
      node_type: Type.String({ description: '节点类型' }),
    }),
    async execute(_toolCallId, params) {
      const presets: Record<string, Array<{ id: string; name: string }>> = {
        glass_refract: [
          { id: 'classic_fluted', name: '经典长虹' }, { id: 'french_cross', name: '法式十字格' },
          { id: 'retro_brick', name: '复古玻璃砖' }, { id: 'rainy_window', name: '雨夜车窗' },
          { id: 'water_ripple', name: '水波倒影' }, { id: 'wave_rhythm', name: '律动波浪' },
          { id: 'euro_hammered', name: '欧式锤纹' }, { id: 'flemish_curve', name: '佛兰芒流动曲面' },
          { id: 'frost_matte', name: '冰霜磨砂' },
        ],
        emboss_foil: [
          { id: 'opal_contour', name: '欧泊等高线' }, { id: 'cyber_neon', name: '赛博霓虹卡' },
          { id: 'rose_champagne', name: '玫瑰香槟浮雕' }, { id: 'nebula_matte', name: '星云幻夜磨砂' },
          { id: 'holographic', name: '全息彩虹闪卡' }, { id: 'classic_gold', name: '经典烫金浮雕' },
          { id: 'pearl_platinum', name: '珠光铂金冷光' }, { id: 'obsidian_gold', name: '黑曜黑金卡' },
        ],
        watercolor_brush: [
          { id: 'vortex', name: '旋涡' }, { id: 'grid', name: '网格' }, { id: 'cloud', name: '云朵' },
          { id: 'contour', name: '等高线' }, { id: 'paper_cut', name: '剪纸' }, { id: 'floral', name: '花卉' },
          { id: 'bauhaus', name: '包豪斯' }, { id: 'splash', name: '飞溅' }, { id: 'sketch', name: '素描' },
          { id: 'ukiyo', name: '浮世绘' }, { id: 'spray', name: '喷雾' }, { id: 'mineral', name: '矿物' },
        ],
        ink_wash: [
          { id: 'zen_splash', name: '禅意飞溅' }, { id: 'mountain_mist', name: '山间薄雾' },
          { id: 'misty_rain', name: '烟雨' }, { id: 'plum_branch', name: '梅枝' },
          { id: 'lone_boat', name: '孤舟' }, { id: 'charred_bamboo', name: '焦竹' },
          { id: 'waves', name: '波浪' },
        ],
        image_process: [
          { id: 'crt', name: 'CRT' }, { id: 'texture', name: '纹理' }, { id: 'noise', name: '噪点' },
          { id: 'halftone', name: '半色调' }, { id: 'dither', name: '抖动' }, { id: 'ascii', name: 'ASCII' },
        ],
      };
      const list = presets[params.node_type] ?? [];
      return {
        content: [{ type: 'text' as const, text: list.length ? JSON.stringify(list, null, 2) : `节点类型 ${params.node_type} 无预设` }],
        details: { node_type: params.node_type, count: list.length },
      };
    },
  });

  pi.registerTool({
    name: 'canvas_get_node_configs',
    label: '获取节点配置',
    description: '获取指定节点类型的可用配置（模型、提示词绑定等）。',
    promptSnippet: '获取节点类型的可用配置列表',
    promptGuidelines: ['使用 canvas_get_node_configs 获取节点配置后，可在 canvas_create_node 的 config_id 参数中引用。'],
    parameters: Type.Object({
      node_type: Type.String({ description: '节点类型' }),
    }),
    async execute(_toolCallId, params, signal) {
      const url = `${BACKEND_URL}/api/admin/node-configs?node_type=${encodeURIComponent(params.node_type)}&is_active=true`;
      const resp = await fetch(url, { signal });
      if (!resp.ok) return { content: [{ type: 'text' as const, text: `获取配置失败: HTTP ${resp.status}` }] };
      const data = await resp.json();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        details: { node_type: params.node_type, count: Array.isArray(data) ? data.length : 0 },
      };
    },
  });

  // ==================== 全场景反馈直达企业微信 ====================

  pi.registerTool({
    name: 'canvas_send_feedback',
    label: '发送反馈与需求直达企业微信',
    description: '将用户的诉求、新功能/节点建议、4类自定义AI节点定制申请、Bug报告或体验建议整理后发送至企业微信群通知管理员。',
    promptSnippet: '发送需求建议或问题反馈至管理员企业微信',
    promptGuidelines: [
      '当用户提出需要定制4类AI节点（图片分析/AI文本生成/图像生成/AI对话）时，协助整理参数后调用此工具提交；',
      '当用户提出系统暂未支持的新节点、新数据源、新功能、或遇到操作Bug、或主动要求反馈时，均应调用此工具；',
      '调用前确保向用户确认反馈要点，并将内容整理成清晰的 Markdown 结构。',
    ],
    parameters: Type.Object({
      category: Type.String({
        description: "反馈分类: 'custom_ai_node'(自定义AI节点定制) | 'feature_request'(新功能建议) | 'bug_report'(问题报告) | 'user_suggestion'(用户意见)",
      }),
      title: Type.String({ description: '反馈概要标题' }),
      content: Type.String({ description: '结构化的详细反馈或需求参数描述（支持 Markdown）' }),
      user_name: Type.Optional(Type.String({ description: '用户昵称或标识' })),
      user_email: Type.Optional(Type.String({ description: '联系邮箱（可选）' })),
    }),
    async execute(_toolCallId, params, signal) {
      const { category, title, content, user_name, user_email } = params;
      const formattedContent = `【${title}】\n类别: ${category}\n\n${content}`;
      const payload = {
        name: user_name?.trim() || '画板助手用户',
        email: user_email?.trim() || 'canvas-agent@echoes.forge',
        module: `画板Agent[${category}]`,
        content: formattedContent,
      };

      try {
        const resp = await fetch(`${BACKEND_URL}/api/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal,
        });

        if (!resp.ok) {
          const errText = await resp.text();
          return {
            content: [{ type: 'text' as const, text: `反馈提交失败(HTTP ${resp.status}): ${errText}` }],
            details: { success: false, status: resp.status },
          };
        }

        const data = await resp.json();
        return {
          content: [{ type: 'text' as const, text: '反馈已成功推送至管理员企业微信！管理员将尽快查看与处理。' }],
          details: { success: true, response: data },
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `发送反馈异常: ${err.message}` }],
          details: { success: false, error: err.message },
        };
      }
    },
  });
}

