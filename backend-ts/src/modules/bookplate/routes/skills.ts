import type { FastifyInstance } from 'fastify';
import { getDb } from '../../../config/database.js';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  RESOURCE_TYPE_BIFROST_SKILL,
  getUserAnnotation,
} from '../../../services/annotation-service.js';
import {
  BifrostError,
  BifrostNotConfiguredError,
  BifrostNotFoundError,
  downloadBifrostSkillZip,
  getMergedBifrostSkills,
} from '../../../services/bifrost-service.js';
import {
  SkillNotFoundError,
  SkillValidationError,
  installSkillZip,
  registerExistingBifrostSkill,
  installUserSkillZip,
  listInstalledSkills,
  nodeWorkspace,
  removeSkill,
  resolveSkillAbs,
} from '../../../services/skill-agent-service.js';
import { isWorkspaceFileServable, mimeOf } from '../../../services/file-utils.js';

export async function register(app: FastifyInstance): Promise<void> {
  // ---- Skill 工作区（Skill Agent 的 skill 来源） ----

  // 列出当前用户已安装的 skill
  app.get(
    '/api/modules/bookplate/skills',
    { preHandler: app.authenticate },
    async (request) => {
      return { skills: listInstalledSkills(request.authUser!.id) };
    }
  );

  // 检索 Bifrost Skills 仓库（共享区本地缓存优先 + 远端合并浏览，普通用户可用）
  app.get(
    '/api/modules/bookplate/skills/bifrost-search',
    { preHandler: app.authenticate },
    async (request) => {
      const q = (request.query ?? {}) as { q?: string; limit?: string };
      // 默认 200：列表已瘦身（无 body/files），支持数百 skill 目录浏览
      const limit = Number(q.limit ?? 200) || 200;
      return getMergedBifrostSkills({
        db: getDb(),
        userId: request.authUser!.id,
        q: q.q,
        limit,
      });
    }
  );

  // 从 Bifrost 安装 skill（按 name 下载 zip 并安装到当前用户工作区）
  app.post(
    '/api/modules/bookplate/skills/install',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as { name?: string };
      const name = (payload.name ?? '').trim();
      if (!name) return reply.code(400).send({ detail: 'skill 名称不能为空' });
      try {
        // 本地共享缓存优先：runtime/.agent/skills/{name} 已存在则跳过网络下载直接登记（毫秒级）
        let meta: Record<string, unknown>;
        const cached = registerExistingBifrostSkill(request.authUser!.id, name);
        if (cached) {
          meta = cached;
        } else {
          const zipBytes = await downloadBifrostSkillZip(getDb(), name);
          if (!zipBytes.length || zipBytes.length > 20 * 1024 * 1024) {
            return reply.code(400).send({ detail: 'skill 压缩包为空或超过 20MB 上限' });
          }
          meta = installSkillZip(request.authUser!.id, zipBytes);
        }
        const ann = getUserAnnotation(getDb(), request.authUser!.id, RESOURCE_TYPE_BIFROST_SKILL, String(meta.name ?? ''));
        meta.user_rating = ann.rating;
        meta.user_note = ann.note;
        meta.note = ann.note;
        return meta;
      } catch (err) {
        if (err instanceof BifrostNotConfiguredError) return reply.code(503).send({ detail: err.message });
        if (err instanceof BifrostNotFoundError) return reply.code(404).send({ detail: err.message });
        if (err instanceof BifrostError) return reply.code(502).send({ detail: err.message });
        if (err instanceof SkillValidationError) return reply.code(400).send({ detail: err.message });
        return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // 上传本地 skill zip 并安装到当前用户工作区（私有登记目录，真实解压）
  app.post(
    '/api/modules/bookplate/skills/upload',
    { preHandler: app.authenticate },
    async (request, reply) => {
      try {
        const data = await request.file();
        if (!data) return reply.code(400).send({ detail: '缺少上传文件（字段名 file）' });
        const bytes = new Uint8Array(await data.toBuffer());
        if (!bytes.length || bytes.length > 20 * 1024 * 1024) {
          return reply.code(400).send({ detail: '文件为空或超过 20MB 上限' });
        }
        const meta = installUserSkillZip(request.authUser!.id, bytes);
        const ann = getUserAnnotation(getDb(), request.authUser!.id, RESOURCE_TYPE_BIFROST_SKILL, String(meta.name ?? ''));
        meta.user_rating = ann.rating;
        meta.user_note = ann.note;
        meta.note = ann.note;
        return meta;
      } catch (err) {
        if (err instanceof SkillValidationError) return reply.code(400).send({ detail: err.message });
        return reply.code(400).send({ detail: `读取上传文件失败: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  );

  // 从用户工作区移除一个已安装的 skill
  app.delete(
    '/api/modules/bookplate/skills/:skill_name',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const skillName = (request.params as { skill_name: string }).skill_name;
      if (!skillName || skillName.includes('/') || skillName.includes('\\')) {
        return reply.code(400).send({ detail: '非法 skill 名称' });
      }
      try {
        removeSkill(request.authUser!.id, skillName);
        return { message: `已移除 skill：${skillName}` };
      } catch (err) {
        if (err instanceof SkillNotFoundError) return reply.code(404).send({ detail: err.message });
        return reply.code(400).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // 下载 skill 执行产生的文件（工作区内相对路径；workspace_id 可选，缺省回退工作区根）
  app.get(
    '/api/modules/bookplate/skill-files',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const q = (request.query ?? {}) as { path?: string; workspace_id?: string };
      const workspaceId = q.workspace_id ?? '';
      // 下载层守卫（与 /chat/files 列表同口径的纵深防御）：密钥文件（.env*）与
      // .pi-agent/ 非白名单子树（models.json / settings.json / web-search.json 等真实密钥）直连 URL 一律 404。
      const relPath = String(q.path ?? '');
      if (!isWorkspaceFileServable(relPath)) {
        return reply.code(404).send({ detail: '文件不存在' });
      }
      const workspace = workspaceId ? nodeWorkspace(request.authUser!.id, workspaceId) : undefined;
      const target = resolveSkillAbs(request.authUser!.id, relPath, workspace);
      if (!target || !existsSync(target) || !statSync(target).isFile()) {
        return reply.code(404).send({ detail: '文件不存在' });
      }
      const fileName = path.basename(target);
      // 按扩展名返回真实 Content-Type（前端 blob 预览 / 未来内嵌 PDF 等依赖准确类型）
      reply.type(mimeOf(fileName));
      // RFC 6266/5987：非 ASCII 文件名（如中文产物）用 filename* 携带，ASCII 兜底防旧客户端乱码
      const asciiFallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
      reply.header(
        'Content-Disposition',
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
      );
      // 流式发送：避免大文件整读进内存并阻塞事件循环
      return reply.send(createReadStream(target));
    }
  );
}
