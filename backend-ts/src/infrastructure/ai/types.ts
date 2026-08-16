/**
 * AI 能力层的模型运行时配置（由 NodeConfig / 环境变量解析而来），
 * 对应 Python `app/services/llm_service.py::TextModelConfig/VisionModelConfig`
 * 与 `app/services/image_service.py::ImageModelConfig`。
 *
 * 业务层只持有这三要素 + 生成参数，不接触 Provider 类型。
 */

/** 文本 / 多模态模型的一次调用配置。 */
export interface TextModelConfig {
  apiKey: string;
  base_url: string;
  model_name: string;
  /** 系统提示词（节点绑定的提示词模板），未绑定则为空串（不注入）。 */
  system_prompt?: string;
}

/** 多模态（视觉）模型配置，字段与文本模型一致。 */
export type VisionModelConfig = TextModelConfig;

/** 图像生成模型的一次调用配置。 */
export interface ImageModelConfig {
  apiKey: string;
  base_url: string;
  model_name: string;
  /** 图像尺寸（如 "1K" / "2K" / "1024x1024"），可空。 */
  size?: string | null;
  /** 宽高比（如 "1:1" / "16:9"），可空。 */
  ratio?: string | null;
  /** 图生图参考图 URL 列表（传入即走图生图），可空。 */
  image?: string[] | null;
}

/** LLM 调用超时（秒），对应 Python LLM_REQUEST_TIMEOUT = 60。 */
export const LLM_REQUEST_TIMEOUT_MS = 60_000;
/** 图像生成超时（秒），对应 Python IMAGE_REQUEST_TIMEOUT = 120。 */
export const IMAGE_REQUEST_TIMEOUT_MS = 120_000;
