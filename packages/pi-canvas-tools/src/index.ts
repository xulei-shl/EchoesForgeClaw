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
  if (!ctx?.ui?.select) {
    return { success: false, error: '当前环境缺少 ctx.ui.select 支持，无法执行画布操作' };
  }
  const payload = JSON.stringify(params);
  try {
    const result = await ctx.ui.select(`CANVAS_OP:${op}`, [payload], `执行画布操作: ${op}`);
    if (!result) return { success: false, error: '操作被取消或前端未响应' };
    try {
      return JSON.parse(result);
    } catch {
      return { success: true, raw: result };
    }
  } catch (err: any) {
    return { success: false, error: `画布桥接执行异常: ${err?.message || String(err)}` };
  }
}

export default function (pi: ExtensionAPI) {
  // ==================== 画布操作工具（通过 UI 桥接到前端） ====================

  pi.registerTool({
    name: 'canvas_create_node',
    label: '创建画布节点',
    description: '在画布上创建新节点。支持所有33种内置节点类型，可指定父节点自动连线。',
    promptSnippet: '在画布上创建指定类型的节点',
    promptGuidelines: [
      '【图书录入】录入图书或按 ISBN 取元数据：type 用 "book_info"，data 为 { isbn: "..." }；"book_card" 是末端排版节点，只接在已有上游图文之后。',
      '【参数格式】必传 type；data 为扁平键值对象（如 { isbn: "978..." }、{ text: "..." }、{ city: "北京" }）。',
      '【节点参考】33 种内置节点类型与 data 键名速查见 canvas-node-catalog 技能（按系统提示 available_skills 中的路径用 read 读取）。',
      '【自动连线】可选传入 parent_id（已存在的父节点 ID）自动建立数据流连线。',
    ],
    parameters: Type.Object({
      type: Type.String({
        description: '节点类型。常用：book_info(图书元数据)、text(文本)、image_search(图片检索)、weather(天气)、glass_refract(玻璃折射) 等。完整列表见 canvas-node-catalog',
      }),
      parent_id: Type.Optional(Type.String({ description: '父节点 ID（指定后自动连线）' })),
      data: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description:
            '节点配置数据扁平对象。如 book_info: { isbn: "978..." }, text: { text: "..." }, weather: { city: "北京" }, glass_refract: { presetId: "vintage_cross" }',
        })
      ),
      config_id: Type.Optional(Type.Number({ description: '受管节点的后台配置 ID' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await canvasOp(ctx, 'create_node', params as Record<string, unknown>);
      if (result.success === false) {
        const errMsg = result.error || result.message || '未知错误';
        return {
          content: [
            {
              type: 'text' as const,
              text: `创建节点失败: ${errMsg}。请根据 canvas-node-catalog 确认 type 是否合法，并检查 data 参数结构。`,
            },
          ],
          details: result,
        };
      }
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
    description: '获取多模态视觉特效与排版类节点（玻璃折射、微浮雕、水彩、水墨、图片处理、图书卡片、小票）的可用预设列表。',
    promptSnippet: '获取多模态视觉节点的可用预设列表',
    promptGuidelines: [
      '返回多模态视觉特效与排版模板（水彩笔触、滤镜、卡片/小票模板）的预设 ID，供填入 canvas_create_node 的 data。',
      '录入图书或查询书籍信息用 book_info 节点；book_card 模板只用于把已有上游图文排成卡片。',
    ],
    parameters: Type.Object({
      node_type: Type.String({ description: '多模态节点类型（如 glass_refract, emboss_foil, watercolor_brush, ink_wash, image_process, book_card, receipt_printer）' }),
    }),
    async execute(_toolCallId, params) {
      const presets: Record<string, Array<{ id: string; name: string }>> = {
        glass_refract: [
          { id: 'classic_fluted', name: '经典长虹' },
          { id: 'vintage_cross', name: '法式十字格' },
          { id: 'retro_block', name: '复古玻璃砖' },
          { id: 'rainy_window', name: '雨夜车窗' },
          { id: 'water_ripple', name: '水波倒影' },
          { id: 'dynamic_wave', name: '律动波浪' },
          { id: 'hammered_facet', name: '欧式锤纹' },
          { id: 'flemish_flow', name: '佛兰芒流动曲面' },
          { id: 'frosted_blur', name: '冰霜磨砂' },
        ],
        emboss_foil: [
          { id: 'topography_opal', name: '欧泊等高线' },
          { id: 'cyber_neon', name: '赛博霓虹卡' },
          { id: 'rose_emboss', name: '玫瑰香槟浮雕' },
          { id: 'nebula_grain', name: '星云幻夜磨砂' },
          { id: 'rainbow_foil', name: '全息彩虹闪卡' },
          { id: 'warm_gold', name: '经典烫金浮雕' },
          { id: 'platinum_minimal', name: '珠光铂金冷光' },
          { id: 'obsidian_metal', name: '黑曜黑金卡' },
        ],
        watercolor_brush: [
          { id: 'spiral_vortex', name: '螺线律动' },
          { id: 'woven_grid', name: '浮水织锦' },
          { id: 'watercolor_clouds', name: '云阶水彩' },
          { id: 'topographic_strata', name: '山川层峦' },
          { id: 'matisse_cutouts', name: '剪纸留白' },
          { id: 'botanical_bloom', name: '绽放花轮' },
          { id: 'bauhaus_grid', name: '包豪斯版画' },
          { id: 'zen_splash', name: '破墨飞白' },
          { id: 'abstract_sketch', name: '表现手绘' },
          { id: 'ukiyo_wave', name: '浮世浪涌' },
          { id: 'aerosol_spray', name: '气溶胶喷绘' },
          { id: 'mineral_rubbing', name: '拓印岩彩' },
        ],
        ink_wash: [
          { id: 'zen_splash', name: '破墨飞白' },
          { id: 'mountain_mist', name: '远山烟岚' },
          { id: 'misty_rain', name: '烟雨江南' },
          { id: 'plum_branch', name: '疏影横斜' },
          { id: 'lone_boat', name: '寒江独钓' },
          { id: 'scorched_bamboo', name: '焦墨劲竹' },
          { id: 'splashing_waves', name: '惊涛骇浪' },
          { id: 'image_trace', name: '底图拓印' },
        ],
        image_process: [
          { id: 'crt', name: 'CRT扫描线' },
          { id: 'texture', name: '纹理质感' },
          { id: 'grain', name: '胶片颗粒' },
          { id: 'halftone', name: '网点半色调' },
          { id: 'dither', name: '复古像素抖动' },
          { id: 'ascii', name: '字符画' },
        ],
        book_card: [
          { id: '默认', name: '默认经典' },
          { id: '2026黑色', name: '2026黑色' },
          { id: 'claude背景色极简', name: 'Claude极简' },
          { id: '做旧卡片', name: '做旧复古' },
          { id: '可爱猫咪', name: '可爱猫咪' },
          { id: '圆盘做旧', name: '圆盘做旧' },
          { id: '学术手账', name: '学术手账' },
          { id: '封面图白色蒙版极简', name: '白蒙版极简' },
          { id: '左红线条简洁', name: '左红线条' },
          { id: '打字机', name: '打字机' },
          { id: '杂乱线条', name: '杂乱线条' },
          { id: '点阵', name: '点阵' },
          { id: '瑞士灰色网格风格', name: '瑞士灰网格' },
          { id: '电路板', name: '电路板' },
          { id: '绿色大字', name: '绿色大字' },
          { id: '色子', name: '色子' },
          { id: '蓝天白墙', name: '蓝天白墙' },
          { id: '蓝色档案', name: '蓝色档案' },
          { id: '黄色电光', name: '黄色电光' },
          { id: '黑灰极简', name: '黑灰极简' },
        ],
        receipt_printer: [
          { id: 'book_recommend', name: '图书推荐小票' },
          { id: 'reading_log', name: '借阅记录卡' },
          { id: 'itemized', name: '消费/书单清单' },
          { id: 'book_excerpt', name: '摘录折页' },
          { id: 'retro_menu', name: '复古单据' },
          { id: 'ancient_bookmark', name: '古籍仿宣书签' },
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
    description:
      '把用户诉求整理成一张工单，实时推送到管理员企业微信群。适用：定制图片分析/AI文本生成/图像生成/AI对话这 4 类受管节点；现有 33 个默认节点覆盖不到的新功能、新节点、新数据源；Bug 与报错；产品建议；以及用户直接说「帮我推送给管理员」。',
    promptSnippet: '整理诉求为工单并推送至管理员企业微信',
    promptGuidelines: [
      '本工具就是完整通道：组好 content 直接调用即可，不需要先去读技能文件或翻工作区文件——「这个消息」指的就是当前对话里已有的内容。',
      '一句话请求（如「帮我把这个消息推送微信」「帮我提个建议」）直接用对话中已有内容组稿并调用，不再发确认问卷；只在内容确实无从获取时追问一句。',
      'category 四选一：custom_ai_node（4类受管 AI 节点定制申请）| feature_request（新功能/新节点/新数据源）| bug_report（报错与故障）| user_suggestion（体验建议）。',
      'title 用「[类别前缀] 一句话概要」，如 [节点定制申请] 七言绝句生成器；content 用 Markdown 分四段：概述 / 背景与场景 / 建议方案（模型、提示词、输入输出端口）/ 用户原话。',
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

