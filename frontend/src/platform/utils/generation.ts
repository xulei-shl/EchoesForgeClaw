import type { AgentStep, Generation } from '../types';

/** 从生成记录中提取卡片/详情面板所需的展示字段 */
export function generationMeta(gen: Generation) {
  const meta = gen.stage_results?.stage1?.metadata ?? {};
  const isbn =
    gen.stage_results?.stage1?.isbn ||
    (typeof meta.isbn === 'string' ? meta.isbn : '') ||
    '';
  const title =
    (typeof meta.title === 'string' && meta.title ? meta.title : null) ||
    (isbn ? `ISBN ${isbn}` : '未命名藏书票');
  const author =
    (typeof meta.author === 'string' && meta.author ? meta.author : null) ||
    (typeof meta.publisher === 'string' && meta.publisher ? meta.publisher : '') ||
    '佚名作者';
  const publisher = typeof meta.publisher === 'string' ? meta.publisher : '';
  // 优先本地缓存地址（无防盗链/鉴权问题），回退到豆瓣原始 URL 或历史代理 URL
  const cover =
    (typeof meta.cover_image_local === 'string' && meta.cover_image_local
      ? meta.cover_image_local
      : '') ||
    (typeof meta.cover_image === 'string' ? meta.cover_image : '') ||
    '';
  const prompt =
    (typeof gen.stage_results?.stage2?.prompt === 'string' && gen.stage_results.stage2.prompt
      ? gen.stage_results.stage2.prompt
      : '') ||
    (typeof gen.stage_results?.stage3?.prompt === 'string' ? gen.stage_results.stage3.prompt : '') ||
    '';
  const imageUrl =
    (typeof gen.result_url === 'string' && gen.result_url ? gen.result_url : '') ||
    (typeof gen.stage_results?.stage3?.image_url === 'string'
      ? gen.stage_results.stage3.image_url
      : '') ||
    '';
  // Agent 模式中间步骤：stage2（提示词生成）在前，stage3（图像生成）在后，按时间序合并
  const agentSteps: AgentStep[] = [
    ...(Array.isArray(gen.stage_results?.stage2?.agent_steps)
      ? gen.stage_results.stage2.agent_steps
      : []),
    ...(Array.isArray(gen.stage_results?.stage3?.agent_steps)
      ? gen.stage_results.stage3.agent_steps
      : []),
  ];

  const pub_year = typeof meta.pub_year === 'string' ? meta.pub_year : '';
  const rating = typeof meta.rating === 'number' ? meta.rating : (typeof meta.rating === 'string' ? parseFloat(meta.rating) || 0 : 0);
  const producer = typeof meta.producer === 'string' ? meta.producer : '';
  const translator = typeof meta.translator === 'string' ? meta.translator : '';
  const url = typeof meta.url === 'string' ? meta.url : '';
  const summary = typeof meta.summary === 'string' ? meta.summary : '';
  const subtitle = typeof meta.subtitle === 'string' ? meta.subtitle : '';
  const series = typeof meta.series === 'string' ? meta.series : '';

  return { title, author, publisher, isbn, cover, prompt, imageUrl, agentSteps, pub_year, rating, producer, translator, url, summary, subtitle, series };
}

/** 节点类型 → 展示名（历史/画廊详情展示用；未识别时回退原值）。与画板模板名保持一致 */
export function generationNodeTypeLabel(nodeType?: string | null): string {
  const labels: Record<string, string> = {
    book_info: '图书元数据',
    image_analysis: '图片分析',
    prompt_generation: '提示词生成',
    image_generation: '图像生成',
    text: '文本',
    image_upload: '图片上传',
    chat: 'AI 对话',
    text_aggregate: '文本聚合',
    prompt_search: '提示词检索',
  };
  return (nodeType && labels[nodeType]) || nodeType || '未知类型';
}
