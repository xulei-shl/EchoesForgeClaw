/**
 * 公共图像抠图（Matting）核心类型定义
 */

/** 抠图进度状态 */
export interface MattingProgress {
  /** 当前阶段：loading（下载/加载模型权重）、processing（正在计算推理） */
  phase: 'loading' | 'processing';
  /** 加载进度百分比（0 ~ 100） */
  progress?: number;
}

/** 抠图执行选项 */
export interface MattingOptions {
  /**
   * 填充背景颜色：
   * - 空字符串 '' 或 undefined 表示透明背景（PNG）
   * - 支持十六进制颜色（如 '#ffffff'、'#000000'）或合法的 CSS 颜色名
   */
  bgColor?: string;
  /** 预处理工作画布最大边长，默认 4096 */
  maxEdge?: number;
}

/** 抠图结果产物 */
export interface MattingResult {
  /** 最终图片的 Data URL（PNG 格式） */
  dataUrl: string;
  /** 图片宽度 */
  width: number;
  /** 图片高度 */
  height: number;
  /** 二进制 Blob 对象 */
  blob: Blob;
}

/** Worker 通信请求 */
export interface MattingWorkerRequest {
  id: number;
  type: 'remove';
  image: ArrayBuffer;
  mimeType: string;
}

/** Worker 通信响应 */
export type MattingWorkerResponse =
  | {
      type: 'progress';
      id: number;
      phase: MattingProgress['phase'];
      progress?: number;
    }
  | {
      type: 'result';
      id: number;
      pixels: ArrayBuffer;
      width: number;
      height: number;
    }
  | {
      type: 'error';
      id: number;
      message: string;
    };
