import { AGGREGATE_DEFAULT_TEMPLATE } from './textTemplate';
import { MAP_POSTER_DEFAULTS } from '../multimodal/map/defaults';
import { JOURNAL_DEFAULTS } from '../multimodal/journal/types';
import { TEXT_IMAGE_DEFAULTS } from '../multimodal/textimage';
import { DEFAULT_BOOK_CARD_TEMPLATE_ID } from '../multimodal/bookcard';

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
        // 封面开关不写显式值：默认跟随 book_info 连通性（无连线时默认关闭，见 execution.ts isBookCoverEnabled）
        settings: { includeBook: !!parent, includeUpstream: true, includeUpstreamImages: true },
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
    case 'web_search':
      return {
        source: 'random',
        tabData: {
          random: { output: '', usedSource: '', error: null, isGenerating: false, count: 5 },
          zhihu_global: { output: '', usedSource: 'zhihu_global', error: null, isGenerating: false, count: 5 },
          tavily: { output: '', usedSource: 'tavily', error: null, isGenerating: false, count: 5 },
          exa: { output: '', usedSource: 'exa', error: null, isGenerating: false, count: 5 },
          anysearch: { output: '', usedSource: 'anysearch', error: null, isGenerating: false, count: 5 },
          doubao: { output: '', usedSource: 'doubao', error: null, isGenerating: false, count: 5 },
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
        provider: 'all',
        imageUrl: null,
        selectedImage: null,
        error: null,
      };
    case 'receipt_printer':
      return {
        templateId: 'book_recommend',
        themeId: 'white',
        ditherEnabled: true,
        error: null,
      };
    case 'book_card':
      return {
        templateId: DEFAULT_BOOK_CARD_TEMPLATE_ID,
        decorIndex: null,
        imageUrl: null,
        error: null,
        coverImageIndex: null,
        decorImageIndex: null,
      };
    case 'stamp_cutter':
      return {
        withMargin: true,
        aspectRatio: '3:4',
        cropBox: null,
        imageUrl: null,
        uploadedImage: null,
        error: null,
      };
    case 'sticker_maker':
      return {
        removeBackground: true,
        outlineWidth: 18,
        outlineColor: '#ffffff',
        shadowEnabled: true,
        imageUrl: null,
        uploadedImage: null,
        error: null,
      };
    case 'journal_maker':
      return {
        items: [],
        background: JOURNAL_DEFAULTS.background,
        pageSize: JOURNAL_DEFAULTS.pageSize,
        removeBackground: false,
        imageUrl: null,
        uploadedImages: [],
        dismissedSources: [],
        error: null,
      };
    case 'text_image':
      return {
        ...TEXT_IMAGE_DEFAULTS,
        imageUrl: null,
        error: null,
      };
    case 'map_art':
      return { imageUrl: null, error: null, preset: 'default', radius: 0.75, circle: false, query: '', lat: 48.8566, lon: 2.3522 };
    case 'pattern_search':
      return {
        category: '',
        imageUrl: null,
        selectedPattern: null,
        output: '',
        error: null,
      };
    case 'color_search':
      return {
        category: '',
        temperature: '',
        activeTab: 'search',
        imageUrl: null,
        selectedColor: null,
        palette: [],
        paletteMethod: 'auto',
        output: '',
        error: null,
      };
    case 'oil_paint':
      return {
        strokeSize: 1,
        strokeCountK: 14,
        dryness: 0.69,
        style: 'brush',
        imageUrl: null,
        uploadedImage: null,
        error: null,
      };
    case 'image_process':
      return {
        effectId: 'grain',
        fxParams: {},
        imageUrl: null,
        uploadedImage: null,
        isSaved: false,
        error: null,
      };
    case 'emboss_foil':
      return {
        presetId: 'topography',
        reliefStyle: 'topography',
        shimmerType: 'matte_silver',
        depth: 65,
        brightness: 70,
        radius: 45,
        lightAngle: 135,
        withPerforation: true,
        withMargin: true,
        imageUrl: null,
        uploadedImage: null,
        isSaved: false,
        error: null,
      };
    case 'glass_refract':
      return {
        presetId: 'vintage_cross',
        pattern: 'cross',
        scale: 26,
        relief: 1.07,
        thickness: 91,
        angle: 0,
        dispersion: 0.01,
        specular: 0.32,
        gap: 0.06,
        seed: 7,
        imageUrl: null,
        uploadedImage: null,
        isSaved: false,
        error: null,
      };
    case 'editorial_layout':
      return {
        presetId: 'cover_ribbon',
        pageSize: '3:4',
        article: {
          masthead: 'ECHOES FORGE CLAW · ISSUE 08',
          headline: 'MAGAZINE',
          deck: 'PROFESSIONAL MAGAZINE EDITORIAL SYSTEM FOR CREATIVE DESIGNS',
          author: 'ECHOES FORGE STUDIO',
          body: '现代排版设计的本质是构建清晰的视觉秩序与呼吸感。通过精确的网格系统、张弛有度的字符间距以及图文穿插的动态绕排，版面不再是静态的图文堆砌，而是一个充满节奏与韵律的视觉有机体。每一次文本的流动与避让，都在向读者传递着深邃而优雅的美学力量。',
          folio: 'VOL. 08 · NO. 2026',
          issueDate: '01 - 07 - 2026',
        },
        images: [],
        typography: {
          headlineFont: 'MiSans, "Helvetica Neue", sans-serif',
          bodyFont: 'MiSans, "Helvetica Neue", sans-serif',
          textColor: '#1a1a1a',
          accentColor: '#000000',
          bodyFontSize: 20,
          bodyLineHeight: 32,
          dropCap: true,
          dropCapLines: 3,
          colGap: 40,
        },
        background: {
          type: 'color',
          color: '#f8f8f6',
        },
        dismissedSources: [],
        imageUrl: null,
        error: null,
      };
    case 'watercolor_brush':
      return {
        mode: 'wave_strips',
        paletteId: 'traditional_oriental',
        customColors: [],
        brushType: 'watercolor',
        wiggle: 1.2,
        bleedStrength: 0.35,
        textureStrength: 0.6,
        borderStrength: 0.5,
        hatchDist: 8,
        fieldMode: 'hand',
        grain: 0.7,
        seed: 42,
        imageUrl: null,
        uploadedImage: null,
        isSaved: false,
        error: null,
      };
    case 'ink_wash':
      return {
        mode: 'zen_splash',
        toolMode: 'pen',
        size: 0.5,
        flow: 0.6,
        bleed: 0.55,
        dry: 0.45,
        color: 0.5,
        bink: 0.0,
        inkColor: '#16161e',
        paperStyle: 'raw_xuan',
        aspectRatio: '1:1',
        resolution: 1024,
        seed: 2026,
        imageUrl: null,
        uploadedImage: null,
        isSaved: false,
        error: null,
      };
    case 'vufind_call_number':
      return {
        isbn: '',
        callNumber: '',
        bibliographic: null,
        recordUrl: '',
        holdings: [],
        output: '',
        isGenerating: false,
        error: null,
      };
  }
}
