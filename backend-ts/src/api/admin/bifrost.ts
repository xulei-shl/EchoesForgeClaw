import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb } from '../../config/database.js';
import { now } from '../../shared/datetime.js';
import { promptMetadata } from '../../db/schema.js';
import {
  RESOURCE_TYPE_BIFROST_PROMPT,
  getUserAnnotation,
  getUserAnnotationMap,
} from '../../services/annotation-service.js';
import {
  BifrostError,
  BifrostNotConfiguredError,
  BifrostNotFoundError,
  PREVIEW_DIR,
  PREVIEW_MAX_BYTES,
  PREVIEW_PREFIX,
  detectImageExt,
  getPrompt,
  getPromptRaw,
  listFolders,
  listPrompts,
  listPromptsRaw,
  sanitizePromptId,
} from '../../services/bifrost-service.js';

/**
 * Bifrost 管理（对应 Python `app/api/admin/bifrost.py`）：
 * - GET /api/admin/bifrost/folders?all=（文件夹列表，白名单过滤）
 * - GET /api/admin/bifrost/prompts?folder_id&q&raw（提示词列表，富化当前用户的 user_rating 与 user_note）
 * - GET /api/admin/bifrost/prompts/:prompt_id?raw（提示词详情，富化当前用户的 user_rating 与 user_note）
 * - POST/DELETE /api/admin/bifrost/prompts/:prompt_id/preview（预览图上传/删除）
 */

function bifrostErrorHttp(err: unknown): { code: number; body: { detail: string } } {
  if (err instanceof BifrostNotFoundError) return { code: 404, body: { detail: err.message } };
  if (err instanceof BifrostNotConfiguredError) return { code: 503, body: { detail: err.message } };
  if (err instanceof BifrostError) return { code: 502, body: { detail: err.message } };
  return { code: 502, body: { detail: err instanceof Error ? err.message : String(err) } };
}

export async function registerBifrostAdminRouter(app: FastifyInstance): Promise<void> {
  const admin = { preHandler: app.requireAdmin };

  // 文件夹列表（支持 force=1 绕过 TTL 缓存）
  app.get('/api/admin/bifrost/folders', admin, async (request, reply) => {
    const q = (request.query ?? {}) as { all?: string; force?: string };
    try {
      const folders = await listFolders(getDb(), q.all === 'true', q.force === '1' || q.force === 'true');
      return { folders };
    } catch (err) {
      const e = bifrostErrorHttp(err);
      return reply.code(e.code).send(e.body);
    }
  });

  // 提示词列表（force=1 绕过 TTL 缓存强制拉取 Bifrost，供管理页「刷新」使用）
  app.get('/api/admin/bifrost/prompts', admin, async (request, reply) => {
    const q = (request.query ?? {}) as { folder_id?: string; q?: string; raw?: string; force?: string };
    try {
      if (q.raw === 'true') {
        return await listPromptsRaw(getDb(), q.folder_id || null);
      }
      const prompts = await listPrompts(getDb(), q.folder_id || null, q.q ?? '', q.force === '1' || q.force === 'true');
      const userId = request.authUser?.id;
      if (userId && prompts.length) {
        const pids = prompts.map((p) => String(p.id ?? '')).filter(Boolean);
        const annotations = getUserAnnotationMap(getDb(), userId, RESOURCE_TYPE_BIFROST_PROMPT, pids);
        for (const p of prompts) {
          const ann = annotations.get(String(p.id ?? ''));
          p.user_rating = ann?.rating ?? 0;
          p.user_note = ann?.note ?? '';
        }
      }
      return { prompts };
    } catch (err) {
      const e = bifrostErrorHttp(err);
      return reply.code(e.code).send(e.body);
    }
  });

  // 提示词详情
  app.get('/api/admin/bifrost/prompts/:prompt_id', admin, async (request, reply) => {
    const promptId = (request.params as { prompt_id: string }).prompt_id;
    const q = (request.query ?? {}) as { raw?: string };
    try {
      if (q.raw === 'true') {
        return await getPromptRaw(getDb(), promptId);
      }
      const prompt = await getPrompt(getDb(), promptId);
      const userId = request.authUser?.id;
      if (userId) {
        const ann = getUserAnnotation(getDb(), userId, RESOURCE_TYPE_BIFROST_PROMPT, promptId);
        prompt.user_rating = ann.rating;
        prompt.user_note = ann.note;
      } else {
        prompt.user_rating = 0;
        prompt.user_note = '';
      }
      return prompt;
    } catch (err) {
      const e = bifrostErrorHttp(err);
      return reply.code(e.code).send(e.body);
    }
  });

  // 上传 / 更换预览图（multipart，字段名 file；魔数校验确为图片）
  app.post('/api/admin/bifrost/prompts/:prompt_id/preview', admin, async (request, reply) => {
    const promptId = (request.params as { prompt_id: string }).prompt_id;
    try {
      const data = await request.file();
      if (!data) return reply.code(400).send({ detail: '缺少上传文件（字段名 file）' });
      const bytes = new Uint8Array(await data.toBuffer());
      const ext = detectImageExt(bytes);
      if (!ext) return reply.code(400).send({ detail: '仅支持 JPG / PNG / GIF / WebP 图片' });
      if (bytes.length > PREVIEW_MAX_BYTES) {
        return reply.code(400).send({ detail: '图片大小不能超过 5MB' });
      }
      const safe = sanitizePromptId(promptId);
      mkdirSync(PREVIEW_DIR, { recursive: true });
      // 覆盖同 prompt_id 的旧图（扩展名可能变化，按基名清掉所有历史扩展）
      for (const old of readdirSync(PREVIEW_DIR)) {
        const base = old.split('.')[0];
        if (base === safe) unlinkSync(path.join(PREVIEW_DIR, old));
      }
      const filename = `${safe}${ext}`;
      writeFileSync(path.join(PREVIEW_DIR, filename), bytes);
      const previewImage = `${PREVIEW_PREFIX}/${filename}`;

      const db = getDb();
      const row = db.select().from(promptMetadata).where(eq(promptMetadata.promptId, promptId)).get();
      if (row) {
        db.update(promptMetadata).set({ previewImage, updatedAt: now() }).where(eq(promptMetadata.promptId, promptId)).run();
      } else {
        db.insert(promptMetadata).values({ promptId, previewImage, createdAt: now(), updatedAt: now() }).run();
      }
      return { preview_image: previewImage };
    } catch (err) {
      const e = bifrostErrorHttp(err);
      return reply.code(e.code).send(e.body);
    }
  });

  // 删除预览图
  app.delete('/api/admin/bifrost/prompts/:prompt_id/preview', admin, async (request) => {
    const promptId = (request.params as { prompt_id: string }).prompt_id;
    const db = getDb();
    const row = db.select().from(promptMetadata).where(eq(promptMetadata.promptId, promptId)).get();
    if (row) {
      if (row.previewImage?.startsWith(PREVIEW_PREFIX)) {
        const filename = row.previewImage.split('/').pop();
        if (filename) unlinkSync(path.join(PREVIEW_DIR, filename));
      }
      db.delete(promptMetadata).where(eq(promptMetadata.promptId, promptId)).run();
    }
    return { preview_image: null };
  });
}
