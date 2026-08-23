import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  lstatSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REAL_AGENTS_ROOT,
  REAL_SKILLS_ROOT,
  symlinkOrCopy,
  userSkillsRoot,
} from '../../src/services/skill-agent-service.js';
import {
  preparePiWorkspace,
  resolveImageGenExtension,
  resolvePiBin,
  saveInputImages,
} from '../../src/services/pi-agent-service.js';

// runtime/ 在仓库根目录下（与 skill-agent-service.ts 的 RUNTIME_ROOT 口径一致），测试文件位于 backend-ts/tests/api/，向上三层
const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../runtime');

const UID = 990001;
const WS_ID = `pi-test_${Date.now()}`;
const CHAT_MODEL = {
  baseUrl: 'http://127.0.0.1:9/v1',
  apiKey: 'test-key',
  modelName: 'test-model',
  multimodal: true,
};
const IMAGE_MODEL = { baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'img-key', modelName: 'img-model' };

function wsPath(): string {
  return path.join(RUNTIME_ROOT, String(UID), 'workspace', WS_ID);
}

/** 写一个最小合法 skill 目录。 */
function makeSkill(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'SKILL.md'),
    '---\nname: demo\ndescription: demo skill\n---\n\n# Demo\n'
  );
}

beforeEach(() => {
  rmSync(path.join(RUNTIME_ROOT, String(UID), 'workspace', WS_ID), { recursive: true, force: true });
});

afterEach(() => {
  rmSync(path.join(RUNTIME_ROOT, String(UID), 'workspace', WS_ID), { recursive: true, force: true });
});

describe('resolvePiBin / resolveImageGenExtension', () => {
  it('从依赖树解析 pi cli 与扩展入口（依赖已随 backend-ts 安装）', () => {
    const bin = resolvePiBin();
    expect(bin.cmd).toBe(process.execPath);
    expect(bin.args[0]).toMatch(/pi-coding-agent[\\/]dist[\\/]cli\.js$/);
    expect(existsSync(bin.args[0]!)).toBe(true);

    const ext = resolveImageGenExtension();
    expect(ext).toBeTruthy();
    expect(ext!).toMatch(/pi-image-gen[\\/]dist[\\/]index\.js$/);
  });
});

describe('preparePiWorkspace 装配', () => {
  it('未配置提示词：不生成 AGENTS.md 且清理残留软链；配置后软链真实文件', () => {
    // 预置一个残留 AGENTS.md（模拟上一轮配置过提示词）
    mkdirSync(wsPath(), { recursive: true });
    writeFileSync(path.join(wsPath(), 'AGENTS.md'), 'stale');

    const r1 = preparePiWorkspace(UID, WS_ID, {
      agentId: 1,
      chatModel: CHAT_MODEL,
      imageModel: null,
      skillNames: [],
    });
    expect(r1.hasPrompt).toBe(false);
    expect(existsSync(path.join(wsPath(), 'AGENTS.md'))).toBe(false);

    // 物化真实提示词后再装配
    const agentDir = path.join(REAL_AGENTS_ROOT, '90012345');
    mkdirSync(agentDir, { recursive: true });
    try {
      writeFileSync(path.join(agentDir, 'AGENTS.md'), '# 测试提示词');
      const r2 = preparePiWorkspace(UID, WS_ID, {
        agentId: 90012345,
        chatModel: CHAT_MODEL,
        imageModel: null,
        skillNames: [],
      });
      expect(r2.hasPrompt).toBe(true);
      expect(readFileSync(path.join(wsPath(), 'AGENTS.md'), 'utf-8')).toContain('测试提示词');
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it('空 skills 不创建 .agents/skills；选中的 Bifrost 软链登记与上传真实目录均可装配', () => {
    const r0 = preparePiWorkspace(UID, WS_ID, {
      agentId: 1,
      chatModel: CHAT_MODEL,
      imageModel: null,
      skillNames: [],
    });
    expect(r0.mountedSkills).toEqual([]);
    expect(existsSync(path.join(wsPath(), '.agents'))).toBe(false);

    // 共享区 + 用户登记软链（Bifrost 语义）
    const shared = path.join(REAL_SKILLS_ROOT, 'pi-demo-shared');
    makeSkill(shared);
    const registry = path.join(userSkillsRoot(UID), 'pi-demo-shared');
    rmSync(registry, { recursive: true, force: true });
    symlinkOrCopy(shared, registry);

    // 上传语义：登记目录为真实目录
    const uploaded = path.join(userSkillsRoot(UID), 'pi-demo-upload');
    rmSync(uploaded, { recursive: true, force: true });
    makeSkill(uploaded);

    try {
      const r = preparePiWorkspace(UID, WS_ID, {
        agentId: 1,
        chatModel: CHAT_MODEL,
        imageModel: null,
        skillNames: ['pi-demo-shared', 'pi-demo-upload'],
      });
      expect(r.mountedSkills.sort()).toEqual(['pi-demo-shared', 'pi-demo-upload']);
      expect(r.skippedSkills).toEqual([]);
      const mountedShared = path.join(wsPath(), '.agents', 'skills', 'pi-demo-shared');
      const mountedUpload = path.join(wsPath(), '.agents', 'skills', 'pi-demo-upload');
      expect(existsSync(path.join(mountedShared, 'SKILL.md'))).toBe(true);
      expect(existsSync(path.join(mountedUpload, 'SKILL.md'))).toBe(true);
      // 上传件保持「工作区内真实目录」语义
      expect(lstatSync(mountedUpload).isSymbolicLink()).toBe(false);
    } finally {
      rmSync(shared, { recursive: true, force: true });
      rmSync(registry, { recursive: true, force: true });
      rmSync(uploaded, { recursive: true, force: true });
    }
  });

  it('非法与未安装的 skill 名进 skippedSkills，不阻断其余装配', () => {
    const r = preparePiWorkspace(UID, WS_ID, {
      agentId: 1,
      chatModel: CHAT_MODEL,
      imageModel: null,
      skillNames: ['../escape', 'not-installed'],
    });
    expect(r.skippedSkills).toEqual(['../escape', 'not-installed']);
    expect(r.mountedSkills).toEqual([]);
    expect(existsSync(path.join(wsPath(), '..', '..'))).toBe(true); // 未发生目录穿越
  });

  it('models.json / settings.json 物化形状正确且幂等', () => {
    for (let i = 0; i < 2; i++) {
      const r = preparePiWorkspace(UID, WS_ID, {
        agentId: 1,
        chatModel: CHAT_MODEL,
        imageModel: IMAGE_MODEL,
        skillNames: [],
      });
      expect(r.ws).toBe(wsPath());

      const models = JSON.parse(readFileSync(path.join(wsPath(), '.pi-agent', 'models.json'), 'utf-8'));
      const provider = models.providers.bookforge;
      expect(provider.baseUrl).toBe(CHAT_MODEL.baseUrl);
      expect(provider.apiKey).toBe(CHAT_MODEL.apiKey);
      expect(provider.api).toBe('openai-completions');
      expect(provider.models[0].id).toBe(CHAT_MODEL.modelName);
      expect(provider.models[0].input).toEqual(['text', 'image']);

      const settings = JSON.parse(
        readFileSync(path.join(wsPath(), '.pi-agent', 'settings.json'), 'utf-8')
      );
      const section = settings['pi-image-gen'];
      expect(section.defaultModel).toBe(IMAGE_MODEL.modelName);
      expect(section.outputDir).toBe('outputs');
      expect(section.customProviders.bookforge.api).toBe('openai');
      expect(section.customProviders.bookforge.models[0].id).toBe(IMAGE_MODEL.modelName);
    }

    // 无绘图模型：pi-image-gen 段不写入
    preparePiWorkspace(UID, WS_ID, {
      agentId: 1,
      chatModel: { ...CHAT_MODEL, multimodal: false },
      imageModel: null,
      skillNames: [],
    });
    const models = JSON.parse(readFileSync(path.join(wsPath(), '.pi-agent', 'models.json'), 'utf-8'));
    expect(models.providers.bookforge.models[0].input).toEqual(['text']);
    const settings = JSON.parse(
      readFileSync(path.join(wsPath(), '.pi-agent', 'settings.json'), 'utf-8')
    );
    expect(settings['pi-image-gen']).toBeUndefined();
  });
});

describe('saveInputImages', () => {
  it('解析 data URL 落盘 inputs/，非法项跳过，最多 4 张', () => {
    const ws = preparePiWorkspace(UID, WS_ID, {
      agentId: 1,
      chatModel: CHAT_MODEL,
      imageModel: null,
      skillNames: [],
    }).ws;
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDA==';
    const rels = saveInputImages(ws, [png, 'not-a-data-url', 'data:text/plain;base64,aGk=', jpg]);
    expect(rels).toEqual(['inputs/img-1.png', 'inputs/img-2.jpg']);
    expect(existsSync(path.join(ws, 'inputs', 'img-1.png'))).toBe(true);
    expect(existsSync(path.join(ws, 'inputs', 'img-2.jpg'))).toBe(true);
  });
});
