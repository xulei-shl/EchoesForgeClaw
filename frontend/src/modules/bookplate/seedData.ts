import { AGGREGATE_DEFAULT_TEMPLATE } from './textTemplate';
import { MAP_POSTER_DEFAULTS } from '../multimodal/map/defaults';
import type { NodeType, NodeData } from './graphTypes';
import type { NodeRunSettings } from '../../platform/types';

/** 新节点的初始数据（按模板类型；孤立节点（无连线创建）时 includeBook 默认关闭，有任何上级连线时默认开启） */
export function seedDataFor(type: NodeType, parent?: NodeData): any {
  const runSettings = (): NodeRunSettings => ({
    includeBook: !!parent,
  });
  switch (type) {
    case 'book_info':
      return { isbn: '', isGenerating: false, error: null };
    case 'image_analysis':
      return {
        analysis: undefined,
        isGenerating: false,
        error: null,
        agentSteps: [],
        settings: runSettings(),
      };
    case 'text_generation':
      return {
        content: '',
        isGenerating: false,
        error: null,
        agentSteps: [],
        settings: runSettings(),
      };
    case 'image_generation':
      return {
        prompt: '',
        imageUrl: null,
        isGenerating: false,
        error: null,
        agentSteps: [],
        settings: runSettings(),
      };
    case 'text':
      return { content: '', error: null };
    case 'image_upload':
      return { imageUrl: null, imageName: '', error: null };
    case 'chat':
      return {
        messages: [],
        output: '',
        isGenerating: false,
        error: null,
        agentSteps: [],
        settings: { includeBook: !!parent, includeUpstream: true, includeUpstreamImages: true, includeBookCover: true },
        epoch: 0,
      };
    case 'text_aggregate':
      return {
        template: AGGREGATE_DEFAULT_TEMPLATE,
        placeholders: {},
        output: '',
        error: null,
      };
    case 'prompt_search':
      return { promptId: null, promptName: '', content: '', promptImage: null, error: null };
    case 'skill_search':
      return {
        skillSelections: [],
        error: null,
      };
    case 'calendar':
      return { output: '', date: '', isGenerating: false, error: null };
    case 'weather':
      return { output: '', city: '', isGenerating: false, error: null };
    case 'zhihu_search':
      return {
        mode: 'zhihu',
        query: '',
        tabData: {
          zhihu: { output: '', error: null, isGenerating: false, count: 5 },
          global: { output: '', error: null, isGenerating: false, count: 5, filter: '', search_db: 'all' },
          zhida: { output: '', error: null, isGenerating: false, model: 'zhida-fast-1p5' },
        },
        output: '',
        isGenerating: false,
        error: null,
      };
    case 'wikipedia_search':
      return {
        language: 'zh',
        query: '',
        limit: 10,
        results: [],
        articleTitle: '',
        summaryMode: false,
        output: '',
        isGenerating: false,
        error: null,
      };
    case 'text_translation':
      return {
        from: 'auto',
        to: 'en',
        source: 'random',
        tabData: {
          random: { output: '', usedSource: '', error: null, isGenerating: false },
          google: { output: '', usedSource: '', error: null, isGenerating: false },
          deeplx: { output: '', usedSource: '', error: null, isGenerating: false },
        },
        output: '',
        isGenerating: false,
        error: null,
      };
    case 'map_poster':
      return { imageUrl: null, error: null, ...MAP_POSTER_DEFAULTS };
    case 'image_search':
      return {
        provider: 'unsplash',
        imageUrl: null,
        selectedImage: null,
        error: null,
      };
    case 'art_image_search':
      return {
        provider: 'met',
        imageUrl: null,
        selectedImage: null,
        error: null,
      };
  }
}
