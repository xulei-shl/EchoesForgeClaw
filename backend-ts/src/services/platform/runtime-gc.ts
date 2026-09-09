import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { getDb } from '../../config/database.js';
import { generations } from '../../db/schema.js';
import { extractRuntimeImageUrls, RUNTIME_IMAGE_SUBDIRS } from '../multimodal/image-service.js';
import { RUNTIME_ROOT } from '../ai/skill-agent-service.js';

/**
 * 运行时图片 GC（定时任务，无外部 cron 依赖）。
 *
 * - 清扫范围：runtime/{userId}/{generated,search-images,map-posters,map-arts}（仅纯数字用户目录）；
 * - 保护规则：URL 被 generations 表引用（result_url 或 stage_results 任意嵌套位置）的文件一律保留；
 * - TTL 规则：未被引用且 mtime 超过 IMAGE_GC_TTL_MS 的文件删除。TTL 仅用于避开
 *   「图已落盘、历史尚未保存」的在途会话窗口，不代表垃圾文件的保留承诺；
 * - 调度：启动后延迟首跑 + 每 24h 一次；定时器 unref，不阻止进程退出。
 */

/** 未引用图片的存活时长：7 天。 */
export const IMAGE_GC_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const GC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const GC_STARTUP_DELAY_MS = 5 * 60 * 1000;

export interface RuntimeGcResult {
  /** 扫描到的受管目录内文件总数 */
  scanned: number;
  /** 本次删除的文件数 */
  deleted: number;
  /** 删除失败数（单文件失败不中断整轮清扫） */
  failed: number;
}

/**
 * 执行一轮运行时图片清扫（幂等，可重复调用）。
 * @param options.runtimeRoot 覆盖 runtime 根目录（测试注入临时目录用）
 * @param options.nowMs       覆盖当前时间（测试确定性用）
 */
export function runRuntimeGc(options: { runtimeRoot?: string; nowMs?: number } = {}): RuntimeGcResult {
  const runtimeRoot = options.runtimeRoot ?? RUNTIME_ROOT;
  const deadlineMs = (options.nowMs ?? Date.now()) - IMAGE_GC_TTL_MS;

  // 1) 引用集合：generations 表中出现过的全部受管 URL。
  //    引用扫描失败时向上抛出终止本轮（宁可漏删不可误删），由调度方记录日志。
  const referenced = new Set<string>();
  const rows = getDb()
    .select({ resultUrl: generations.resultUrl, stageResults: generations.stageResults })
    .from(generations)
    .all();
  for (const row of rows) {
    for (const url of extractRuntimeImageUrls([row.resultUrl, row.stageResults])) {
      referenced.add(url);
    }
  }

  let scanned = 0;
  let deleted = 0;
  let failed = 0;

  // 2) 遍历纯数字用户目录下的受管子目录
  if (!existsSync(runtimeRoot)) return { scanned: 0, deleted: 0, failed: 0 };
  for (const userEntry of readdirSync(runtimeRoot, { withFileTypes: true })) {
    if (!userEntry.isDirectory() || !/^\d+$/.test(userEntry.name)) continue;
    for (const subdir of RUNTIME_IMAGE_SUBDIRS) {
      const dir = path.join(runtimeRoot, userEntry.name, subdir);
      let files: string[];
      try {
        files = readdirSync(dir);
      } catch {
        continue; // 子目录不存在 = 该用户无此类文件
      }
      for (const file of files) {
        scanned++;
        const abs = path.join(dir, file);
        let mtimeMs: number;
        try {
          mtimeMs = statSync(abs).mtimeMs;
        } catch {
          continue; // 与并发写入/删除的竞态：留待下一轮
        }
        if (mtimeMs > deadlineMs) continue; // 新鲜文件（含在途会话）
        // 受管子目录名与 /static 段一致（单一事实来源：USER_IMAGE_PREFIXES）
        if (referenced.has(`/static/${subdir}/${userEntry.name}/${file}`)) continue;
        try {
          unlinkSync(abs);
          deleted++;
        } catch {
          failed++;
        }
      }
    }
  }
  return { scanned, deleted, failed };
}

/** 注册定时 GC（进程启动入口调用一次；测试 buildApp 不注册，避免触碰真实 runtime）。 */
export function scheduleRuntimeGc(): void {
  const runOnce = (): void => {
    try {
      const result = runRuntimeGc();
      if (result.deleted > 0 || result.failed > 0) {
        console.warn(`[gc] 运行时图片清扫完成：扫描 ${result.scanned}，删除 ${result.deleted}，失败 ${result.failed}`);
      }
    } catch (err) {
      console.error(`[gc] 运行时图片清扫失败: ${messageOf(err)}`);
    }
  };
  setTimeout(runOnce, GC_STARTUP_DELAY_MS).unref();
  setInterval(runOnce, GC_INTERVAL_MS).unref();
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
