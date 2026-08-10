/**
 * 前端网络请求超时集中配置。
 *
 * ⚠️ 前后端超时存在耦合：调整任一侧时必须同步核对另一侧，否则会出现
 * 「前端已放弃、后端仍在执行」或「后端先报错、前端还在等」的失配。
 *
 * 后端对应常量（backend/app/services/）：
 * - llm_service.py:      LLM_REQUEST_TIMEOUT = 60.0  封面分析 / 流式读超时（按 chunk 计）
 * - image_service.py:    IMAGE_REQUEST_TIMEOUT = 120.0  图片生成；_download = 60.0（URL 下载）
 * - douban_client.py:    ClientConfig.timeout = 15.0  豆瓣单次请求
 *
 * 前端约束：
 * - 提示词 SSE 空闲超时（120s）必须 > 后端开流前静默期（封面下载 15s + 分析 60s ≈ 75s），
 *   同时 > 后端流式读超时（60s），保证健康后端总会先产出数据刷新计时。
 * - 图片生成超时（240s）必须 > 后端最坏耗时（LLM 120s + URL 下载 60s ≈ 180s）。
 * - ISBN 查询超时（60s）必须覆盖后端完整重试链（随机延迟 + 15s×3 重试 + 退避 ≈ 67s）。
 */

/** 豆瓣 ISBN 查询超时（ms）。覆盖常见重试路径（前两次尝试 ≈ 44s 内完成）；
 *  极端全失败场景（最坏 ≈ 71s：随机延迟 + 15s×3 超时 + 退避 2/5/10s）会被截断，
 *  此时豆瓣本身不可用，提前失败比干等更符合体验；后端单次请求超时为 15s。 */
export const ISBN_FETCH_TIMEOUT_MS = 60_000;

/** 提示词 SSE 空闲超时（ms）：收到任何数据即重置计时，仅「无数据」才触发 */
export const PROMPT_SSE_IDLE_TIMEOUT_MS = 120_000;

/** 图片生成超时（ms）。后端最坏 ≈ 180s（120s LLM + 60s URL 下载），留出余量 */
export const IMAGE_GENERATION_TIMEOUT_MS = 240_000;
