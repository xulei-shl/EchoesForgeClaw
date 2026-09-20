/**
 * Pi-Agent Canvas Tools Extension
 *
 * 注册画布操作工具，通过 extension_ui_request 机制与前端通信。
 * 所有需要用户数据的工具均通过 ctx.ui.select 桥接到前端执行：画布读写由前端画布状态
 * 承接，检索类由前端已登录凭据调后端（pi 子进程内 fetch 无凭据，直连已鉴权路由会 401）。
 * 仅反馈工具直连后端（POST /api/feedback 为公开路由）。
 */
import type { AgentToolResult, ExtensionAPI } from '@earendil-works/pi-coding-agent';
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
      '【参数格式】必传 type；data 为扁平键值对象，键名以 canvas-node-catalog 速查表为准（如 book_info: { isbn: "978..." }、text: { content: "正文" }、weather: { city: "北京" }）。',
      '【文本键名】文本类节点（text / text_generation）的正文键是 content（不是 text）；传错键会被归一并在回执 warnings 里提示，但仍请直接用 content。',
      '【节点参考】33 种内置节点类型与 data 键名速查见 canvas-node-catalog 技能（按系统提示 available_skills 中的路径用 read 读取）。',
      '【自动连线】可选传入 parent_id（已存在的父节点 ID）自动建立数据流连线。',
      '【现状核对】创建前先用 canvas_list_nodes 看画布现状，避免重复创建同类节点。',
      '【改优先于建】画布上已有同类节点且用户只是想调整时，用 canvas_update_node 就地修改，不要重复创建。',
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
      '不确定节点 ID 时，先用 canvas_list_nodes 获取最新清单再连线，不要凭记忆引用可能已删除的 ID。',
      '要取消一条已有连线用 canvas_disconnect_nodes（可撤销），不要靠新建节点绕过。',
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

  // ==================== 画布只读工具（通过 UI 桥接读取前端画布状态） ====================

  pi.registerTool({
    name: 'canvas_list_nodes',
    label: '列出画布节点',
    description: '只读列出画布上全部节点（id/类型/标题/坐标/是否已产生输出），不返回输出正文。',
    promptSnippet: '列出画布上的全部节点',
    promptGuidelines: [
      '本工具只返回节点清单（不含输出正文）；要读取某节点的内容请接着用 canvas_read_node_output。',
      '为用户找「画布上已有什么」时先调本工具，再按需读取个别节点，避免一次拉取全部正文。',
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const result = await canvasOp(ctx, 'list_nodes', {});
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
    },
  });

  pi.registerTool({
    name: 'canvas_read_node_output',
    label: '读取节点输出',
    description: '只读读取画布上指定节点的当前输出内容（文本 / 图片引用列表 / 无输出状态）。',
    promptSnippet: '读取画布上指定节点的输出内容',
    promptGuidelines: [
      'node_id 必须是画布上已存在的节点 ID；不确定 ID 时先用 canvas_list_nodes 查清单。',
      '节点尚未运行或输出为空时返回 has_output=false，请提示用户先运行该节点，不要凭空编造内容。',
    ],
    parameters: Type.Object({
      node_id: Type.String({ description: '要读取的节点 ID（canvas_list_nodes 返回的 id）' }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await canvasOp(ctx, 'read_node_output', params as Record<string, unknown>);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
    },
  });

  // ==================== 就地修正类工具（改内容 / 调参 / 断线 / 删节点） ====================

  /**
   * 写操作工具的 details 统一形状（`AgentToolResult` 要求所有 return 分支同形状，
   * 见 pi-canvas-tools 维护手册 §2.3）。
   */
  interface NodeWriteDetails {
    success: boolean;
    node_id: string | null;
    error: string | null;
  }

  pi.registerTool({
    name: 'canvas_update_node',
    label: '修改画布节点',
    description: '就地修改已有画布节点的 data 字段（浅合并），如写入文本正文、切换多模态预设/参数。',
    promptSnippet: '就地修改已有画布节点的字段',
    promptGuidelines: [
      '【先读再改】动手前先用 canvas_get_node_details 读该节点当前字段名与值，不要凭记忆猜键名；不确定某类型该改哪些字段时用 canvas_get_node_params 查默认字段。',
      '【就地修正优先】用户要求「改一下 / 换成 / 补上」已有节点时优先用本工具原地修改，不要新建节点绕过（新建会留下重复的旧节点）。',
      '【不可写字段】isGenerating / error / output / imageUrl 由节点运行产生，禁止写入；受管节点（image_analysis / text_generation / image_generation / chat）的 configId 也不可改，需要调整请用 canvas_send_feedback 提交需求。',
      '【文本键名】文本类节点（text / text_generation）的正文键是 content。',
      '【可撤销】写入会进入画布撤销栈，改错了用户可以 Ctrl+Z 回退。',
    ],
    parameters: Type.Object({
      node_id: Type.String({ description: '要修改的节点 ID（canvas_list_nodes 返回的 id）' }),
      data: Type.Record(Type.String(), Type.Unknown(), {
        description:
          '要写入的扁平键值对象（浅合并）。如 text: { content: "正文" }、glass_refract: { presetId: "vintage_cross" }、weather: { city: "北京" }',
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<NodeWriteDetails>> {
      const result = await canvasOp(ctx, 'update_node', params as Record<string, unknown>);
      if (result.success === false) {
        const errMsg = String(result.error ?? result.message ?? '未知错误');
        return {
          content: [{ type: 'text' as const, text: `修改节点失败：${errMsg}` }],
          details: { success: false, node_id: params.node_id ?? null, error: errMsg },
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: { success: true, node_id: String(result.node_id ?? params.node_id), error: null },
      };
    },
  });

  pi.registerTool({
    name: 'canvas_get_node_params',
    label: '查询节点参数',
    description: '只读查询某类型节点的可配置字段与默认值，用于确认 canvas_update_node / canvas_create_node 该写哪些键。',
    promptSnippet: '查询某类节点的可配置字段与默认值',
    promptGuidelines: [
      '返回该类型的字段名与默认值（数据源与节点初始值一致）；不确定字段名时先查再写，不要猜键名。',
      '多模态视觉/排版类节点的预设 ID（presetId / mode / effectId / templateId 等）用 canvas_get_presets 查询取值域。',
    ],
    parameters: Type.Object({
      node_type: Type.String({ description: '节点类型（如 text / weather / glass_refract）' }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await canvasOp(ctx, 'get_node_params', { node_type: params.node_type });
      if (result.success === false) {
        return {
          content: [{ type: 'text' as const, text: `查询节点参数失败：${result.error ?? '未知错误'}` }],
          details: { success: false, node_type: params.node_type, count: 0, error: String(result.error ?? '') },
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: {
          success: true,
          node_type: params.node_type,
          count: Array.isArray(result.fields) ? result.fields.length : 0,
          error: null,
        },
      };
    },
  });

  pi.registerTool({
    name: 'canvas_get_node_details',
    label: '读取节点详情',
    description: '只读读取指定节点的完整字段现状（长文本截断）+ 端口声明 + 是否已有产出，供修改前核对。',
    promptSnippet: '读取指定节点的字段现状与端口',
    promptGuidelines: [
      '调用 canvas_update_node 前先用本工具读现状，避免猜错字段名或覆盖已有内容。',
      '本工具回执中的 data 是节点当前实际值；要读节点对外输出正文用 canvas_read_node_output。',
    ],
    parameters: Type.Object({
      node_id: Type.String({ description: '要读取的节点 ID（canvas_list_nodes 返回的 id）' }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await canvasOp(ctx, 'get_node_details', { node_id: params.node_id });
      if (result.success === false) {
        return {
          content: [{ type: 'text' as const, text: `读取节点详情失败：${result.error ?? '未知错误'}` }],
          details: { success: false, node_id: params.node_id, error: String(result.error ?? '') },
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: { success: true, node_id: params.node_id, error: null },
      };
    },
  });

  pi.registerTool({
    name: 'canvas_disconnect_nodes',
    label: '断开画布连线',
    description: '断开画布上一条已有连线（按 edge_id，或 source_id + target_id 定位），可撤销。',
    promptSnippet: '断开画布节点之间的一条连线',
    promptGuidelines: [
      '断线是非破坏且可撤销的操作，无需事先向用户确认；但必须定位到真实存在的连线——不确定节点 ID 时先用 canvas_list_nodes 查清单。',
      '只断开用户明确要去掉的那一条连线；若要调整上下游关系，建议随后用 canvas_connect_nodes 补上正确的连线。',
    ],
    parameters: Type.Object({
      edge_id: Type.Optional(Type.String({ description: '连线 ID（优先使用）' })),
      source_id: Type.Optional(Type.String({ description: '源节点 ID（未给 edge_id 时与 target_id 配合定位）' })),
      target_id: Type.Optional(Type.String({ description: '目标节点 ID' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<{ success: boolean; edge_id: string | null; error: string | null }>> {
      const result = await canvasOp(ctx, 'disconnect_nodes', params as Record<string, unknown>);
      if (result.success === false) {
        const errMsg = String(result.error ?? result.message ?? '未知错误');
        return {
          content: [{ type: 'text' as const, text: `断开连线失败：${errMsg}` }],
          details: { success: false, edge_id: params.edge_id ?? null, error: errMsg },
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: { success: true, edge_id: String(result.edge_id ?? ''), error: null },
      };
    },
  });

  /** 删除工具的 details 统一形状：删/取消/失败三态都可表达 */
  interface DeleteNodeDetails {
    success: boolean;
    deleted: boolean;
    cancelled: boolean;
    deleted_count: number;
    error: string | null;
  }

  pi.registerTool({
    name: 'canvas_delete_node',
    label: '删除画布节点',
    description:
      '删除画布上的节点（默认级联删除其全部下游子孙节点）。调用后会先弹确认框，用户确认后才真正删除，可撤销。',
    promptSnippet: '删除画布节点（含级联，需用户确认）',
    promptGuidelines: [
      '【改优先于删】用户说「换成 / 改成」时先用 canvas_update_node 就地修改；只有用户明确要求删除、或节点确实多余时才删除。',
      '【确认通道】本工具会自行弹出确认框（含节点名与级联数量）；不要为了删除先去调用 canvas_send_feedback 或反复向用户追问，也不要向用户宣称「已删除」——以用户是否确认与工具回执为准。',
      '【级联语义】cascade 默认 true（与画布 UI 一致，连同全部下游一起删）；cascade=false 只删该节点，下游节点会保留但失去输入，此时需向用户说明这一后果。',
      '【定位】node_id 必须来自 canvas_list_nodes 返回的清单，不要凭记忆引用可能已删除的 ID。',
    ],
    parameters: Type.Object({
      node_id: Type.String({ description: '要删除的节点 ID（canvas_list_nodes 返回的 id）' }),
      cascade: Type.Optional(
        Type.Boolean({ description: '是否级联删除其全部下游子孙节点，默认 true（与画布 UI 一致）' })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<DeleteNodeDetails>> {
      const nodeId = params.node_id;
      const cascade = params.cascade !== false;

      // 1) 先向前端取「删除影响范围」（前端不产生任何变更），用于组织可读的确认文案
      const preview = await canvasOp(ctx, 'delete_node', { node_id: nodeId, cascade, confirmed: false });
      if (preview.success === false) {
        const errMsg = String(preview.error ?? preview.message ?? '未知错误');
        return {
          content: [{ type: 'text' as const, text: `删除节点失败：${errMsg}` }],
          details: { success: false, deleted: false, cancelled: false, deleted_count: 0, error: errMsg },
        };
      }

      const title = String(preview.title ?? nodeId);
      const descendants = Array.isArray(preview.descendants) ? preview.descendants : [];
      const count = Number(preview.descendant_count ?? 0) || 0;
      const names = descendants
        .map((d) => String((d as { title?: unknown }).title ?? ''))
        .filter((name) => name.length > 0);

      const lines = [`节点：「${title}」（id: ${nodeId}）`];
      if (count > 0) {
        lines.push(
          `级联删除：其下游 ${count} 个节点将一并删除（${names.slice(0, 10).join('、')}${names.length > 10 ? ' 等' : ''}）`
        );
      } else if (!cascade) {
        lines.push('仅删除该节点自身：下游节点会保留，但将失去此上游输入。');
      } else {
        lines.push('该节点没有下游子节点，仅删除自身。');
      }
      lines.push('删除后可在画布上撤销（Ctrl+Z）恢复。确定要删除吗？');

      if (!ctx?.ui?.confirm) {
        const errMsg = '当前环境缺少 ctx.ui.confirm 支持，删除已取消（画布未发生任何变更）';
        return {
          content: [{ type: 'text' as const, text: errMsg }],
          details: { success: false, deleted: false, cancelled: true, deleted_count: 0, error: errMsg },
        };
      }

      let confirmed = false;
      try {
        confirmed = await ctx.ui.confirm('删除画布节点', lines.join('\n'));
      } catch (err: any) {
        const errMsg = `确认请求失败：${err?.message || String(err)}`;
        return {
          content: [{ type: 'text' as const, text: `删除节点失败：${errMsg}` }],
          details: { success: false, deleted: false, cancelled: true, deleted_count: 0, error: errMsg },
        };
      }

      if (!confirmed) {
        return {
          content: [{ type: 'text' as const, text: `已取消删除节点「${title}」，画布未发生任何变更。` }],
          details: { success: true, deleted: false, cancelled: true, deleted_count: 0, error: null },
        };
      }

      // 2) 用户已确认：执行删除（前端跳过自家确认框，避免双重弹窗）
      const result = await canvasOp(ctx, 'delete_node', { node_id: nodeId, cascade, confirmed: true });
      if (result.success === false) {
        const errMsg = String(result.error ?? result.message ?? '未知错误');
        return {
          content: [{ type: 'text' as const, text: `删除节点失败：${errMsg}` }],
          details: { success: false, deleted: false, cancelled: false, deleted_count: 0, error: errMsg },
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: {
          success: true,
          deleted: true,
          cancelled: false,
          deleted_count: Number(result.deleted_count ?? 0) || 0,
          error: null,
        },
      };
    },
  });

  // ==================== 检索类工具（经 UI 桥接，由前端携带用户凭据调后端） ====================

  pi.registerTool({
    name: 'canvas_search_prompts',
    label: '搜索提示词',
    description: '从 Bifrost 提示词库搜索提示词，返回提示词列表供选择。',
    promptSnippet: '搜索 Bifrost 提示词库',
    promptGuidelines: [
      '使用 canvas_search_prompts 搜索提示词时，用简洁的中文关键词效果最好。',
      '返回的是提示词清单（名称与正文）供用户挑选，不是你自己的创作内容；检索失败会返回明确错误，如实转述即可，不要编造结果。',
    ],
    parameters: Type.Object({
      query: Type.String({ description: '搜索关键词' }),
      limit: Type.Optional(Type.Number({ description: '返回数量，默认 10' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { query, limit = 10 } = params;
      const result = await canvasOp(ctx, 'search_prompts', { query, limit });
      if (result.success === false) {
        return {
          content: [{ type: 'text' as const, text: `提示词检索失败: ${result.error ?? '前端未响应'}` }],
          details: { count: 0 },
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: { count: Number(result.count) || 0 },
      };
    },
  });

  pi.registerTool({
    name: 'canvas_search_skills',
    label: '搜索 Skill',
    description: '从 Bifrost Skill 库搜索 Skill，返回 Skill 列表供选择。',
    promptSnippet: '搜索 Bifrost Skill 库',
    promptGuidelines: [
      '使用 canvas_search_skills 搜索 Skill 时，用简洁的中文关键词效果最好。',
      '返回的是技能元数据清单（名称/描述/版本），不含 SKILL.md 正文——引用技能时以返回的 name 为准，不要凭印象补全技能内容。',
    ],
    parameters: Type.Object({
      query: Type.String({ description: '搜索关键词' }),
      limit: Type.Optional(Type.Number({ description: '返回数量，默认 10' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { query, limit = 10 } = params;
      const result = await canvasOp(ctx, 'search_skills', { query, limit });
      if (result.success === false) {
        return {
          content: [{ type: 'text' as const, text: `Skill 检索失败: ${result.error ?? '前端未响应'}` }],
          details: { count: 0 },
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: { count: Number(result.count) || 0 },
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
      if (!resp.ok)
        return {
          content: [{ type: 'text' as const, text: `获取配置失败: HTTP ${resp.status}` }],
          details: { node_type: params.node_type, count: 0 },
        };
      const data = await resp.json();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        details: { node_type: params.node_type, count: Array.isArray(data) ? data.length : 0 },
      };
    },
  });

  // ==================== 全场景反馈直达企业微信 ====================

  /**
   * 反馈工具 details 的统一形状：`AgentToolResult` 要求所有 return 分支同形状
   * （见 pi-canvas-tools 维护手册 §2.3），故显式标注而不依赖分支推断。
   */
  interface FeedbackDetails {
    success: boolean;
    delivered: boolean;
    errcode: number | null;
    error: string | null;
  }

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
      '回执分两档：delivered=true 才是「已送达管理员企业微信」；delivered=false 表示未送达（返回内容含原因），必须如实告知用户未送达并转述原因，不得声称已推送。',
      'content 上限 4000 字符，写足上下文即可，不必自行截断：后端会在超过企业微信单条上限时自动分多条推送。',
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
    async execute(_toolCallId, params, signal): Promise<AgentToolResult<FeedbackDetails>> {
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
            details: {
              success: false,
              delivered: false,
              errcode: resp.status,
              error: `HTTP ${resp.status}`,
            },
          };
        }

        // 后端回执区分「请求已受理（success）」与「真实送达（delivered）」：
        // 企业微信 webhook 无论成败都返回 HTTP 200，只有 delivered=true 才算送达。
        const data = (await resp.json().catch(() => null)) as {
          delivered?: boolean;
          errcode?: number | null;
          message?: string;
        } | null;

        if (data?.delivered !== true) {
          const reason = data?.message || `HTTP ${resp.status}`;
          return {
            content: [
              {
                type: 'text' as const,
                text: `反馈未送达企业微信：${reason}。请如实告知用户未送达，不要声称已推送。`,
              },
            ],
            details: {
              success: false,
              delivered: false,
              errcode: data?.errcode ?? resp.status,
              error: reason,
            },
          };
        }

        return {
          content: [{ type: 'text' as const, text: '反馈已成功推送至管理员企业微信！管理员将尽快查看与处理。' }],
          details: { success: true, delivered: true, errcode: 0, error: null },
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `发送反馈异常（未送达）: ${err.message}。请如实告知用户未送达，不要声称已推送。`,
            },
          ],
          details: { success: false, delivered: false, errcode: null, error: err.message },
        };
      }
    },
  });
}

