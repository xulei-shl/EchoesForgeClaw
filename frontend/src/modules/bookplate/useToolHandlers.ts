import { useCallback } from 'react';
import api from '../../platform/services/api';
import { SMALL_TOOL_TIMEOUT_MS } from '../../platform/utils/timeouts';
import type { EdgeData, NodeData, NodeType } from './graphTypes';
import { firstUpstreamText, type PortTypesLookup } from './execution';
import type { ZhihuSearchRequest } from './components/ZhihuSearchNode';
import type { WikipediaSearchRequest } from './components/WikipediaSearchNode';
import type { TranslationRequest } from './components/TextTranslationNode';
import type { WebSearchRequest } from './components/WebSearchNode';

/** 工具类 fetch handler 所需的共享依赖（均为 ref / 稳定 setter，闭包不会过期） */
export interface ToolRequestCtx {
  nodesRef: React.MutableRefObject<NodeData[]>;
  edgesRef: React.MutableRefObject<EdgeData[]>;
  portTypesRef: React.MutableRefObject<PortTypesLookup>;
  updateNodeData: (id: string, patch: Record<string, any>) => void;
}

/* ===================================================================== */
/* 简单 fetch 工具工厂（万年历 / 天气 / Wikipedia 检索与全文）            */
/* ===================================================================== */

export interface SimpleToolConfig<P = any> {
  nodeType: NodeType;
  endpoint: string;
  /** 请求开始时写入 node.data 的额外字段（isGenerating/error 由骨架补） */
  startExtras: (payload: P, node: NodeData) => Record<string, any>;
  /** 组装请求 body（input 为最终输入） */
  buildBody: (payload: P, input: string, node: NodeData) => Record<string, any>;
  /** 成功时写入 node.data 的额外字段（isGenerating:false/error:null 自动补） */
  okExtras: (res: any) => Record<string, any>;
  /** 最终输入：线上级文本（连线即输入）优先，其次手动输入；空串 = 无可提交输入 */
  resolveInput: (payload: P, upstream: string, node: NodeData) => string;
  /** 是否取「第一个线上级文本」作为输入 */
  upstream?: boolean;
  /** 空输入是否跳过请求（默认 true） */
  checkEmpty?: boolean;
  /** 失败文案（统一补「超时，请重试」/「失败，请重试」后缀） */
  errLabel: string;
}

/** 生成本工具节点的「查询」稳定回调：发起请求并统一处理 isGenerating/错误态 */
export function useSimpleToolHandler<P>(
  ctx: ToolRequestCtx,
  config: SimpleToolConfig<P>
): (id: string, payload: P) => void {
  return useCallback(
    (id: string, payload: P) => {
      const node = ctx.nodesRef.current.find((n) => n.id === id);
      if (!node || node.type !== config.nodeType || node.data?.isGenerating) return;
      const upstream = config.upstream
        ? firstUpstreamText(node, ctx.nodesRef.current, ctx.edgesRef.current, ctx.portTypesRef.current)
        : '';
      const input = config.resolveInput(payload, upstream, node);
      if (config.checkEmpty !== false && !input.trim()) return;

      ctx.updateNodeData(id, {
        isGenerating: true,
        error: null,
        ...config.startExtras(payload, node),
      });
      api
        .post(config.endpoint, config.buildBody(payload, input, node), {
          timeout: SMALL_TOOL_TIMEOUT_MS,
        })
        .then((res: any) => {
          ctx.updateNodeData(id, {
            ...config.okExtras(res),
            isGenerating: false,
            error: null,
          });
        })
        .catch((error: any) => {
          console.error(`Tool fetch failed [${config.endpoint}]:`, error);
          ctx.updateNodeData(id, {
            isGenerating: false,
            error: error?.isTimeout
              ? `${config.errLabel}超时，请重试`
              : error?.detail || `${config.errLabel}失败，请重试`,
          });
        });
    },
    // 稳定回调：仅读取 refs / 稳定 setter，闭包不会过期
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
}

/* ===================================================================== */
/* tabData 隔离 fetch 工厂（知乎 / 翻译 / 网络搜索）                      */
/* 按目标 tab 隔离 isGenerating/output/error；对外输出仅当前激活 tab。    */
/* ===================================================================== */

export interface TabbedToolConfig<P = any> {
  nodeType: NodeType;
  endpoint: string;
  /** payload 中标识目标 tab 的字段（zhihu=mode、translation/web=source） */
  tabKeyField: keyof P & string;
  /** node.data 激活字段的默认值（zhihu=zhihu、translation/web=random） */
  activeDefault: string;
  /** 最终输入（空 = 跳过请求） */
  resolveInput: (payload: P, upstream: string) => string;
  /** 请求开始时写入目标 tab 的额外字段（isGenerating/error 自动补） */
  startTabExtras: (payload: P) => Record<string, any>;
  /** 请求开始时写回顶层 node.data 的额外字段（如 zhihu 的 query、translation 的 from/to） */
  topExtras: (payload: P) => Record<string, any>;
  /** 组装请求 body */
  buildBody: (payload: P, input: string) => Record<string, any>;
  /** 成功时并入目标 tab 的额外字段（output 自动写入；isGenerating:false/error:null 自动） */
  okTabExtras: (res: any) => Record<string, any>;
  /** 从响应提取对外文本 */
  outputOf: (res: any) => string;
  /** 失败文案 */
  errLabel: string;
}

/** 生成本工具节点的「按模式/按源检索」稳定回调（目标 tab 状态由组件驱动、tabData 隔离） */
export function useTabbedToolHandler<P>(
  ctx: ToolRequestCtx,
  config: TabbedToolConfig<P>
): (id: string, payload: P) => void {
  return useCallback(
    (id: string, payload: P) => {
      const node = ctx.nodesRef.current.find((n) => n.id === id);
      if (!node || node.type !== config.nodeType) return;
      const curData = node.data ?? {};
      const curTabData = curData.tabData ?? {};
      const targetKey = payload[config.tabKeyField] as unknown as string;
      if (curTabData[targetKey]?.isGenerating) return;

      const upstream = firstUpstreamText(
        node,
        ctx.nodesRef.current,
        ctx.edgesRef.current,
        ctx.portTypesRef.current
      );
      const input = config.resolveInput(payload, upstream);
      if (!input) return;

      const newTargetTabData = {
        ...(curTabData[targetKey] || {}),
        ...config.startTabExtras(payload),
        isGenerating: true,
        error: null,
      };
      const nextTabData = { ...curTabData, [targetKey]: newTargetTabData };
      const isCurrentActive = (curData[config.tabKeyField] ?? config.activeDefault) === targetKey;

      ctx.updateNodeData(id, {
        ...config.topExtras(payload),
        tabData: nextTabData,
        ...(isCurrentActive ? { isGenerating: true, error: null } : {}),
      });

      api
        .post(config.endpoint, config.buildBody(payload, input), { timeout: SMALL_TOOL_TIMEOUT_MS })
        .then((res: any) => {
          const latestNode = ctx.nodesRef.current.find((n) => n.id === id);
          const latestData = latestNode?.data ?? {};
          const latestTabData = latestData.tabData ?? nextTabData;
          const outputText = config.outputOf(res);

          const finishedTargetTabData = {
            ...(latestTabData[targetKey] || {}),
            output: outputText,
            ...config.okTabExtras(res),
            isGenerating: false,
            error: null,
          };
          const updatedTabData = { ...latestTabData, [targetKey]: finishedTargetTabData };
          const isStillActive = (latestData[config.tabKeyField] ?? config.activeDefault) === targetKey;

          ctx.updateNodeData(id, {
            tabData: updatedTabData,
            ...(isStillActive
              ? { output: outputText, isGenerating: false, error: null }
              : {}),
          });
        })
        .catch((error: any) => {
          console.error(`Tabbed tool fetch failed [${config.endpoint}]:`, error);
          const latestNode = ctx.nodesRef.current.find((n) => n.id === id);
          const latestData = latestNode?.data ?? {};
          const latestTabData = latestData.tabData ?? nextTabData;
          const errDetail = error?.isTimeout
            ? `${config.errLabel}超时，请重试`
            : error?.detail || `${config.errLabel}失败，请重试`;

          const erroredTargetTabData = {
            ...(latestTabData[targetKey] || {}),
            isGenerating: false,
            error: errDetail,
          };
          const updatedTabData = { ...latestTabData, [targetKey]: erroredTargetTabData };
          const isStillActive = (latestData[config.tabKeyField] ?? config.activeDefault) === targetKey;

          ctx.updateNodeData(id, {
            tabData: updatedTabData,
            ...(isStillActive
              ? { isGenerating: false, error: errDetail }
              : {}),
          });
        });
    },
    // 稳定回调：仅读取 refs / 稳定 setter，闭包不会过期
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
}

/* ===================================================================== */
/* 各工具节点 handler 组装（新增工具类节点：加一个 config + 一行工厂调用） */
/* ===================================================================== */

const CALENDAR_CONFIG: SimpleToolConfig<string> = {
  nodeType: 'calendar',
  endpoint: '/modules/bookplate/calendar',
  resolveInput: (date) => (typeof date === 'string' ? date : ''),
  startExtras: (date) => ({ date }),
  buildBody: (date) => ({ date }),
  okExtras: (res) => ({ output: typeof res?.output === 'string' ? res.output : '' }),
  checkEmpty: false,
  errLabel: '万年历查询',
};

const WEATHER_CONFIG: SimpleToolConfig<string> = {
  nodeType: 'weather',
  endpoint: '/modules/bookplate/weather',
  upstream: true,
  resolveInput: (city, upstream) => upstream || city,
  startExtras: (city) => ({ city }),
  buildBody: (_city: string, input: string) => ({ city: input }),
  okExtras: (res) => ({ output: typeof res?.output === 'string' ? res.output : '' }),
  checkEmpty: false,
  errLabel: '天气查询',
};

const WIKIPEDIA_SEARCH_CONFIG: SimpleToolConfig<WikipediaSearchRequest> = {
  nodeType: 'wikipedia_search',
  endpoint: '/modules/bookplate/wikipedia-search',
  upstream: true,
  resolveInput: (payload, upstream) => upstream || payload.query.trim(),
  startExtras: (payload) => ({
    language: payload.language,
    query: payload.query,
    limit: payload.limit,
    // 新检索使旧文章全文失效
    articleTitle: '',
    output: '',
    results: [],
  }),
  buildBody: (payload, input) => ({ ...payload, query: input }),
  okExtras: (res) => ({ results: Array.isArray(res?.results) ? res.results : [] }),
  errLabel: 'Wikipedia 检索',
};

const WIKIPEDIA_ARTICLE_CONFIG: SimpleToolConfig<{ title: string; summary: boolean }> = {
  nodeType: 'wikipedia_search',
  endpoint: '/modules/bookplate/wikipedia-article',
  resolveInput: (article) => article.title,
  startExtras: (article) => ({ articleTitle: article.title }),
  buildBody: (article, input, node) => ({
    title: input,
    language: typeof node.data?.language === 'string' ? node.data.language : 'zh',
    summary: article.summary,
  }),
  okExtras: (res) => ({ output: typeof res?.content === 'string' ? res.content : '' }),
  checkEmpty: false,
  errLabel: 'Wikipedia 全文获取',
};

const ZHIHU_CONFIG: TabbedToolConfig<ZhihuSearchRequest> = {
  nodeType: 'zhihu_search',
  endpoint: '/modules/bookplate/zhihu-search',
  tabKeyField: 'mode',
  activeDefault: 'zhihu',
  resolveInput: (payload, upstream) => upstream || payload.query.trim(),
  startTabExtras: (payload) => ({ count: payload.count, model: payload.model }),
  topExtras: (payload) => ({ query: payload.query }),
  buildBody: (payload, input) => ({ ...payload, query: input }),
  okTabExtras: () => ({}),
  outputOf: (res) => (typeof res?.output === 'string' ? res.output : ''),
  errLabel: '知乎检索',
};

const TRANSLATION_CONFIG: TabbedToolConfig<TranslationRequest> = {
  nodeType: 'text_translation',
  endpoint: '/modules/bookplate/translate',
  tabKeyField: 'source',
  activeDefault: 'random',
  // 翻译输入以节点输入框实际文本为准（继承后可手动编辑），上游文本仅作兜底
  resolveInput: (payload, upstream) => payload.text.trim() || upstream,
  startTabExtras: () => ({}),
  topExtras: (payload) => ({ from: payload.from, to: payload.to }),
  buildBody: (payload, input) => ({
    text: input,
    from: payload.from,
    to: payload.to,
    source: payload.source,
  }),
  okTabExtras: (res) => ({ usedSource: typeof res?.source === 'string' ? res.source : '' }),
  outputOf: (res) => (typeof res?.output === 'string' ? res.output : ''),
  errLabel: '翻译',
};

const VUFIND_CALL_NUMBER_CONFIG: SimpleToolConfig<string> = {
  nodeType: 'vufind_call_number',
  endpoint: '/modules/bookplate/vufind-call-number',
  // ISBN 由组件/画布层解析（连线图书元数据优先 → 根图书元数据兜底 → 线上级纯 ISBN 文本兜底），
  // 传入的 payload 即最终有效 ISBN，无需再经 firstUpstreamText 重推（book_info 的文本是整段元数据）。
  upstream: false,
  resolveInput: (isbn) => (typeof isbn === 'string' ? isbn.trim() : ''),
  startExtras: (isbn) => ({
    isbn,
    callNumber: '',
    bibliographic: null,
    recordUrl: '',
    holdings: [],
    output: '',
  }),
  buildBody: (_isbn: string, input: string) => ({ isbn: input }),
  okExtras: (res) => {
    const callNumber = typeof res?.call_number === 'string' ? res.call_number : '';
    const biblio = res?.bibliographic && typeof res.bibliographic === 'object' ? res.bibliographic : null;
    const bibliographic = biblio
      ? {
          title: typeof biblio.title === 'string' ? biblio.title : '',
          author: typeof biblio.author === 'string' ? biblio.author : '',
          contributor: typeof biblio.contributor === 'string' ? biblio.contributor : '',
          pubVuFind 馆藏peof biblio.publisher === 'string' ? biblio.publisher : '',
          pubYear: typeof biblio.pubYear === 'string' ? biblio.pubYear : '',
        }
      : null;
    const recordUrl = typeof res?.record_url === 'string' ? res.record_url : '';
    const holdings = Array.isArray(res?.holdings)
      ? res.holdings.filter(
          (g: any) => g && typeof g.location === 'string' && Array.isArray(g.items)
        )
      : [];
    // output JSON：CALL_NUMBER 保持首键（小票/图书卡现有继承逻辑只读该键），新字段供后续按需提取
    const output = callNumber
      ? JSON.stringify({
          CALL_NUMBER: callNumber,
          RECORD_URL: recordUrl,
          ...(bibliographic ? { BIBLIOGRAPHIC: bibliographic } : {}),
          HOLDINGS: holdings,
        })
      : '';
    return { callNumber, bibliographic, recordUrl, holdings, output };
  },
  checkEmpty: false,
  errLabel: 'VuFind 索书号获取',
};

const WEB_SEARCH_CONFIG: TabbedToolConfig<WebSearchRequest> = {
  nodeType: 'web_search',
  endpoint: '/modules/bookplate/web-search',
  tabKeyField: 'source',
  activeDefault: 'random',
  resolveInput: (payload, upstream) => upstream || payload.query.trim(),
  startTabExtras: () => ({}),
  topExtras: () => ({}),
  buildBody: (payload, input) => ({
    query: input,
    count: payload.count,
    source: payload.source,
  }),
  okTabExtras: (res) => ({ usedSource: typeof res?.source === 'string' ? res.source : '' }),
  outputOf: (res) => (typeof res?.output === 'string' ? res.output : ''),
  errLabel: '网络搜索',
};

export interface ToolHandlers {
  handleFetchCalendarFor: (id: string, date: string) => void;
  handleFetchWeatherFor: (id: string, city: string) => void;
  handleSearchWikipediaFor: (id: string, payload: WikipediaSearchRequest) => void;
  handleOpenWikipediaArticleFor: (id: string, title: string, summary?: boolean) => void;
  handleFetchZhihuFor: (id: string, payload: ZhihuSearchRequest) => void;
  handleFetchTranslationFor: (id: string, payload: TranslationRequest) => void;
  handleFetchWebSearchFor: (id: string, payload: WebSearchRequest) => void;
  handleFetchVuFindCallNumberFor: (id: string, isbn: string) => void;
}

export function useToolHandlers(ctx: ToolRequestCtx): ToolHandlers {
  const handleFetchCalendarFor = useSimpleToolHandler(ctx, CALENDAR_CONFIG);
  const handleFetchWeatherFor = useSimpleToolHandler(ctx, WEATHER_CONFIG);
  const handleSearchWikipediaFor = useSimpleToolHandler(ctx, WIKIPEDIA_SEARCH_CONFIG);
  const runWikiArticle = useSimpleToolHandler(ctx, WIKIPEDIA_ARTICLE_CONFIG);
  const handleFetchZhihuFor = useTabbedToolHandler(ctx, ZHIHU_CONFIG);
  const handleFetchTranslationFor = useTabbedToolHandler(ctx, TRANSLATION_CONFIG);
  const handleFetchWebSearchFor = useTabbedToolHandler(ctx, WEB_SEARCH_CONFIG);
  const handleFetchVuFindCallNumberFor = useSimpleToolHandler(ctx, VUFIND_CALL_NUMBER_CONFIG);

  const handleOpenWikipediaArticleFor = useCallback(
    (id: string, title: string, summary?: boolean) => {
      runWikiArticle(id, { title, summary: !!summary });
    },
    [runWikiArticle]
  );

  return {
    handleFetchCalendarFor,
    handleFetchWeatherFor,
    handleSearchWikipediaFor,
    handleOpenWikipediaArticleFor,
    handleFetchZhihuFor,
    handleFetchTranslationFor,
    handleFetchWebSearchFor,
    handleFetchVuFindCallNumberFor,
  };
}