import type { FastifyInstance } from 'fastify';
import { getDb } from '../../config/database.js';
import {
  BifrostError,
  BifrostNotConfiguredError,
  BifrostNotFoundError,
  downloadBifrostSkillZip,
  searchBifrostSkills,
} from '../../services/bifrost-service.js';
import {
  SkillValidationError,
  listSharedBifrostSkills,
  readSkillNotes,
  removeSharedBifrostSkill,
  setSkillNote,
  updateSharedBifrostSkill,
} from '../../services/skill-agent-service.js';

/**
 * Admin 端 Bifrost Skills 管理（对应 Python `app/api/admin/bifrost_skills.py`）：
 * - GET /api/admin/bifrost-skills（共享区缓存列表 + 远端未缓存 skill 合并浏览；force=1 绕过 TTL）
 * - POST /api/admin/bifrost-skills/:name/sync（强制拉取最新 zip 覆盖共享区，不动用户登记）
 * - PUT /api/admin/bifrost-skills/:name/note（写入/更新共享 skill 的全局备注，空串清除；独立于 skill 包）
 * - DELETE /api/admin/bifrost-skills/:name（删除共享包并清理指向它的用户登记软链）
 *
 * 与画布侧（bookplate router 的 /skills/*）互补：画布按需下载安装（共享区缓存命中），
 * 此处集中管理共享区 runtime/.agent/skills/ 的真实 skill 包。
 */
const MAX_SKILL_ZIP_BYTES = 20 * 1024 * 1024;

function bifrostErrorHttp(err: unknown): { code: number; body: { detail: string } } {
  if (err instanceof BifrostNotFoundError) return { code: 404, body: { detail: err.message } };
  if (err instanceof BifrostNotConfiguredError) return { code: 503, body: { detail: err.message } };
  if (err instanceof BifrostError) return { code: 502, body: { detail: err.message } };
  return { code: 502, body: { detail: err instanceof Error ? err.message : String(err) } };
}

/** URL 路径参数卫生检查（服务层删除有同套校验，此处提前给出友好错误）。 */
function checkSkillName(raw: string): string {
  const name = (raw ?? '').trim();
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new SkillValidationError('非法 skill 名称');
  }
  return name;
}

export async function registerBifrostSkillsAdminRouter(app: FastifyInstance): Promise<void> {
  const admin = { preHandler: app.requireAdmin };

  // 共享区缓存的 Bifrost Skills 列表（本地为事实来源；Bifrost 可达时用检索接口做富化，
  // 并追加「远端有、本地未缓存」的 skill 供仓库浏览）。force=1 绕过 TTL 缓存强制拉取远端。
  app.get('/api/admin/bifrost-skills', admin, async (request) => {
    const q = (request.query ?? {}) as { q?: string; force?: string; limit?: string };
    const force = q.force === '1' || q.force === 'true';
    const limit = Number(q.limit ?? 100) || 100;
    const skills = listSharedBifrostSkills();
    const localNames = new Set<string>();
    for (const s of skills) localNames.add(String(s.name ?? ''));
    let remoteAvailable = false;
    let remote: Record<string, any>[] = [];
    try {
      remote = await searchBifrostSkills(getDb(), q.q ?? '', limit, force);
      remoteAvailable = true;
    } catch {
      /* Bifrost 不可达：仅返回本地信息，不影响页面使用 */
    }
    const remoteMap = new Map<string, Record<string, any>>();
    for (const r of remote) {
      if (r?.name) remoteMap.set(String(r.name), r);
    }
    const merged: Record<string, unknown>[] = [];
    for (const s of skills) {
      const r = remoteMap.get(String(s.name ?? ''));
      if (r) {
        s.latest_version = r.latest_version ?? '';
        s.license = r.license ?? '';
        s.compatibility = r.compatibility ?? '';
        s.file_count = r.file_count ?? 0;
        s.remote_updated_at = r.updated_at ?? null;
      }
      s.cached = true;
      merged.push(s);
    }
    // 追加远端有、本地未缓存的 skill（页面点「同步最新」即可一键下载并缓存）
    for (const r of remote) {
      const name = String(r.name ?? '');
      if (!name || localNames.has(name)) continue;
      merged.push({
        cached: false,
        name,
        description: r.description ?? '',
        body: r.skill_md_body ?? '',
        files: [],
        latest_version: r.latest_version ?? '',
        license: r.license ?? '',
        compatibility: r.compatibility ?? '',
        file_count: r.file_count ?? 0,
        remote_updated_at: r.updated_at ?? null,
      });
    }
    // 合并管理员全局备注（侧车 JSON，独立于 skill 包：同步/删除不触碰备注）
    const notes = readSkillNotes();
    for (const s of merged) {
      const note = notes[String(s.name ?? '')];
      if (note) s.note = note;
    }
    return { skills: merged, remote_available: remoteAvailable };
  });

  // 强制从 Bifrost 拉取最新 zip 覆盖共享区（不触碰用户登记）
  app.post('/api/admin/bifrost-skills/:name/sync', admin, async (request, reply) => {
    try {
      const skillName = checkSkillName((request.params as { name: string }).name);
      const zipBytes = await downloadBifrostSkillZip(getDb(), skillName);
      if (!zipBytes.length || zipBytes.length > MAX_SKILL_ZIP_BYTES) {
        return reply.code(400).send({ detail: 'skill 压缩包为空或超过 20MB 上限' });
      }
      const meta = updateSharedBifrostSkill(zipBytes);
      // 防御性校验：Bifrost 按 name 分发 zip，zip 内 SKILL.md 的 name 应一致，
      // 否则会出现「同步的是 A、落盘的是 B」的困惑状态
      if (meta.name !== skillName) {
        removeSharedBifrostSkill(String(meta.name ?? ''));
        return reply.code(400).send({
          detail: `zip 内 SKILL.md 的 name（${meta.name}）与请求的 skill 名称（${skillName}）不一致，已中止`,
        });
      }
      return { skill: meta };
    } catch (err) {
      if (err instanceof SkillValidationError) return reply.code(400).send({ detail: err.message });
      const e = bifrostErrorHttp(err);
      return reply.code(e.code).send(e.body);
    }
  });

  // 写入/更新共享 skill 的全局备注（空串清除；不触碰 skill 包本身）
  app.put('/api/admin/bifrost-skills/:name/note', admin, async (request, reply) => {
    try {
      const skillName = checkSkillName((request.params as { name: string }).name);
      const body = (request.body ?? {}) as { note?: string };
      const note = setSkillNote(skillName, body.note ?? '');
      return { name: skillName, note };
    } catch (err) {
      if (err instanceof SkillValidationError) return reply.code(400).send({ detail: err.message });
      return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
    }
  });

  // 从共享区删除 skill 包（并清理指向它的用户登记软链）
  app.delete('/api/admin/bifrost-skills/:name', admin, async (request, reply) => {
    try {
      const skillName = checkSkillName((request.params as { name: string }).name);
      const cleaned = removeSharedBifrostSkill(skillName);
      return { message: `已删除 skill：${skillName}`, cleaned_registries: cleaned };
    } catch (err) {
      if (err instanceof SkillValidationError) return reply.code(400).send({ detail: err.message });
      return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
    }
  });
}