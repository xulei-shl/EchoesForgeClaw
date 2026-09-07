import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  lstatSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REAL_AGENTS_ROOT,
  REAL_SKILLS_ROOT,
  symlinkOrCopy,
  userSkillsRoot,
} from '../../src/services/skill-agent-service.js';
import {
  buildWebSearchConfig,
  clearPiSession,
  listWorkspaceArtifacts,
  preparePiWorkspace,
  resolveImageGenExtension,
  resolvePiBin,
  resolvePiExtensions,
  resolveThinkingArgs,
  saveInputImages,
} from '../../src/services/pi-agent-service.js';
import { isDiffExcluded } from '../../src/services/pi/snapshot.js';
import { isSecretFileRel } from '../../src/services/file-utils.js';

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

    const agentDir = path.join(REAL_AGENTS_ROOT, '90012345');
    rmSync(agentDir, { recursive: true, force: true });

    const r1 = preparePiWorkspace(UID, WS_ID, {
      // 用测试专用 agentId（先确保其提示词目录不存在）：agentId=1 可能是真实环境已配置提示词的 Agent
      agentId: 90012345,
      chatModel: CHAT_MODEL,
      imageModel: null,
      skillNames: [],
    });
    expect(r1.hasPrompt).toBe(false);
    expect(existsSync(path.join(wsPath(), 'AGENTS.md'))).toBe(false);

    // 物化真实提示词后再装配
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

  it('空 skills 不创建 .pi-agent/skills；选中的 Bifrost 软链登记与上传真实目录均可装配', () => {
    const r0 = preparePiWorkspace(UID, WS_ID, {
      agentId: 1,
      chatModel: CHAT_MODEL,
      imageModel: null,
      skillNames: [],
    });
    expect(r0.mountedSkills).toEqual([]);
    expect(existsSync(path.join(wsPath(), '.pi-agent', 'skills'))).toBe(false);

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
      const mountedShared = path.join(wsPath(), '.pi-agent', 'skills', 'pi-demo-shared');
      const mountedUpload = path.join(wsPath(), '.pi-agent', 'skills', 'pi-demo-upload');
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
      expect(provider.models[0].reasoning).toBe(true); // 兜底声明支持推理，让「启用思考」真正传给 provider
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
    expect(models.providers.bookforge.models[0].reasoning).toBe(true);
    const settings = JSON.parse(
      readFileSync(path.join(wsPath(), '.pi-agent', 'settings.json'), 'utf-8')
    );
    expect(settings['pi-image-gen']).toBeUndefined();
  });

  it('绘图模型 API Key 与模型名相同（退化配置）：不写 pi-image-gen 段并用警告说明', () => {
    const r = preparePiWorkspace(UID, WS_ID, {
      agentId: 1,
      chatModel: CHAT_MODEL,
      imageModel: { baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'agnes-image-2.1-flash', modelName: 'agnes-image-2.1-flash' },
      skillNames: [],
    });
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings[0]).toMatch(/模型名/);
    const settings = JSON.parse(
      readFileSync(path.join(wsPath(), '.pi-agent', 'settings.json'), 'utf-8')
    );
    expect(settings['pi-image-gen']).toBeUndefined();
    // 正常 Key 不受影响（已有核心装配用例覆盖 pi-image-gen 段写入）
  });

  it('绘图模型缺 API Key / 缺模型名：同样拒绝装配并给出可操作警告', () => {
    const missingKey = preparePiWorkspace(UID, WS_ID, {
      agentId: 1,
      chatModel: CHAT_MODEL,
      imageModel: { baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', modelName: 'img-model' },
      skillNames: [],
    });
    expect(missingKey.warnings[0]).toMatch(/API Key/);
    const missingName = preparePiWorkspace(UID, WS_ID, {
      agentId: 1,
      chatModel: CHAT_MODEL,
      imageModel: { baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'img-key', modelName: '  ' },
      skillNames: [],
    });
    expect(missingName.warnings[0]).toMatch(/模型名称/);
    const settings = JSON.parse(
      readFileSync(path.join(wsPath(), '.pi-agent', 'settings.json'), 'utf-8')
    );
    expect(settings['pi-image-gen']).toBeUndefined();
  });

  it('api_format / thinking_format：OpenAI 兼容 + deepseek wire 格式 → api + compat.thinkingFormat', () => {
    preparePiWorkspace(UID, WS_ID, {
      agentId: 1,
      chatModel: { ...CHAT_MODEL, apiFormat: 'openai', thinkingFormat: 'deepseek' },
      imageModel: null,
      skillNames: [],
    });
    const provider = JSON.parse(
      readFileSync(path.join(wsPath(), '.pi-agent', 'models.json'), 'utf-8')
    ).providers.bookforge;
    expect(provider.api).toBe('openai-completions');
    expect(provider.models[0].reasoning).toBe(true);
    expect(provider.models[0].compat).toEqual({ thinkingFormat: 'deepseek' });
  });

  it('api_format=anthropic → api=anthropic-messages 且不注入 OpenAI 兼容 thinkingFormat', () => {
    preparePiWorkspace(UID, WS_ID, {
      agentId: 1,
      chatModel: { ...CHAT_MODEL, apiFormat: 'anthropic', thinkingFormat: 'deepseek' },
      imageModel: null,
      skillNames: [],
    });
    const provider = JSON.parse(
      readFileSync(path.join(wsPath(), '.pi-agent', 'models.json'), 'utf-8')
    ).providers.bookforge;
    expect(provider.api).toBe('anthropic-messages');
    expect(provider.models[0].reasoning).toBe(true);
    expect(provider.models[0].compat).toBeUndefined();
  });

  it('thinkingFormat 未配置：不注入 compat（pi 默认 reasoning_effort）', () => {
    preparePiWorkspace(UID, WS_ID, {
      agentId: 1,
      chatModel: CHAT_MODEL,
      imageModel: null,
      skillNames: [],
    });
    const provider = JSON.parse(
      readFileSync(path.join(wsPath(), '.pi-agent', 'models.json'), 'utf-8')
    ).providers.bookforge;
    expect(provider.api).toBe('openai-completions');
    expect(provider.models[0].compat).toBeUndefined();
  });

  it('web-search.json 装配：受支持 key + workflow=auto-summary；保留未知键；幂等；不支持源不写入', () => {
    const agentDir = path.join(wsPath(), '.pi-agent');
    mkdirSync(agentDir, { recursive: true });
    // 预置一个带未知键（如 curator 运行时写入）的旧文件
    writeFileSync(
      path.join(agentDir, 'web-search.json'),
      JSON.stringify({ curatorTimeoutSeconds: 5, exaApiKey: 'stale' }),
      'utf-8'
    );

    const webSearchConfig = { exaApiKey: 'exa-1', anysearchApiKey: 'any-2' };
    for (let i = 0; i < 2; i++) {
      preparePiWorkspace(UID, WS_ID, {
        agentId: 1,
        chatModel: CHAT_MODEL,
        imageModel: null,
        skillNames: [],
        webSearchConfig,
      });
      const wsCfg = JSON.parse(readFileSync(path.join(agentDir, 'web-search.json'), 'utf-8'));
      expect(wsCfg.exaApiKey).toBe('exa-1');
      expect(wsCfg.anysearchApiKey).toBe('any-2');
      expect(wsCfg.workflow).toBe('auto-summary');
      expect(wsCfg.curatorTimeoutSeconds).toBe(5); // 未知键保留
      expect(wsCfg.tavilyApiKey).toBeUndefined();
      expect(wsCfg.doubaoApiKey).toBeUndefined(); // 扩展不支持，绝不写入
      expect(wsCfg.zhihuAccessSecret).toBeUndefined();
    }

    // 配置变化（Key 清空）：受管键被清理，不残留旧值；workflow 仍为后端权威值
    preparePiWorkspace(UID, WS_ID, {
      agentId: 1,
      chatModel: CHAT_MODEL,
      imageModel: null,
      skillNames: [],
      webSearchConfig: {},
    });
    const wsCfg2 = JSON.parse(readFileSync(path.join(agentDir, 'web-search.json'), 'utf-8'));
    expect(wsCfg2.exaApiKey).toBeUndefined();
    expect(wsCfg2.anysearchApiKey).toBeUndefined();
    expect(wsCfg2.workflow).toBe('auto-summary');
  });
});

describe('buildWebSearchConfig（DB app_settings → pi-web-access 配置映射）', () => {
  it('只映射非空且扩展支持的字段，trim 后写入', () => {
    const cfg = buildWebSearchConfig({
      'tavily.api_key': 'tvly-x',
      'exa.api_key': '  exa-y  ',
      'anysearch.api_key': 'as-z',
      'doubao.api_key': 'db-key',
      'zhihu.access_secret': 'zh-secret',
    });
    expect(cfg).toEqual({ tavilyApiKey: 'tvly-x', exaApiKey: 'exa-y', anysearchApiKey: 'as-z' });
  });

  it('空值 / 缺失键不写入；全部为空返回 {}', () => {
    expect(buildWebSearchConfig({})).toEqual({});
    expect(buildWebSearchConfig({ 'exa.api_key': '', 'tavily.api_key': '   ' })).toEqual({});
  });
});

/** 临时设置 pi 扩展相关 env，运行后还原（防止污染其它用例）。 */
function withPiExtensionsEnv(home: string, whitelist: string, fn: () => void): void {
  const prevAgent = process.env.PI_CODING_AGENT_DIR;
  const prevExt = process.env.PI_EXTENSIONS;
  try {
    process.env.PI_CODING_AGENT_DIR = home;
    process.env.PI_EXTENSIONS = whitelist;
    fn();
  } finally {
    if (prevAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevAgent;
    if (prevExt === undefined) delete process.env.PI_EXTENSIONS;
    else process.env.PI_EXTENSIONS = prevExt;
  }
}

/** 在临时 pi 全局 npm 目录造一个最小扩展包（scoped：@juicesharp/rpiv-todo）。 */
function makePiNpmPkg(home: string, name: string, version = '1.0.0'): string {
  const segs = name.split('/').filter(Boolean);
  const dir = path.join(home, 'npm', 'node_modules', ...segs);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, version, pi: { extensions: ['./index.ts'] } }),
    'utf-8'
  );
  writeFileSync(path.join(dir, 'index.ts'), 'export default function () {}', 'utf-8');
  return dir;
}

describe('resolvePiExtensions（PI_EXTENSIONS 白名单 → pi install 全局 npm 目录发现）', () => {
  it('pi install 装到 {agentDir}/npm/node_modules 的包可被发现（依赖树中缺失也不跳过）', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'pi-agent-'));
    try {
      const pkgDir = makePiNpmPkg(home, '@juicesharp/rpiv-todo', '2.7.1');
      withPiExtensionsEnv(home, '@juicesharp/rpiv-todo', () => {
        expect(resolvePiExtensions()).toEqual([{ name: '@juicesharp/rpiv-todo', dir: pkgDir }]);
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('白名单内未安装的包与空白项静默跳过', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'pi-agent-'));
    try {
      withPiExtensionsEnv(home, '@juicesharp/rpiv-todo, ,not-installed', () => {
        expect(resolvePiExtensions()).toEqual([]);
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('preparePiWorkspace 把白名单扩展挂载到 {ws}/.pi-agent/extensions/{name} 并回报 mountedExtensions', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'pi-agent-'));
    try {
      const pkgDir = makePiNpmPkg(home, '@juicesharp/rpiv-todo');
      withPiExtensionsEnv(home, '@juicesharp/rpiv-todo', () => {
        const r = preparePiWorkspace(UID, WS_ID, {
          agentId: 1,
          chatModel: CHAT_MODEL,
          imageModel: null,
          skillNames: [],
        });
        const dest = path.join(wsPath(), '.pi-agent', 'extensions', 'rpiv-todo');
        expect(r.mountedExtensions).toEqual([dest]);
        expect(existsSync(path.join(dest, 'package.json'))).toBe(true);
        expect(lstatSync(dest).isSymbolicLink() || existsSync(path.join(dest, 'index.ts'))).toBe(true);
        expect(pkgDir).not.toBe(dest); // 工作区是独立挂载，不原地装配
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('resolveThinkingArgs（节点思考开关 → pi CLI 参数）', () => {
  it("'on' → --thinking high（启用思考取高推理档）", () => {
    expect(resolveThinkingArgs('on')).toEqual(['--thinking', 'high']);
  });

  it("'off' → --thinking off（显式关闭思考）", () => {
    expect(resolveThinkingArgs('off')).toEqual(['--thinking', 'off']);
  });

  it('历史遗留档位原样透传（兼容旧节点已保存设置）', () => {
    expect(resolveThinkingArgs('minimal')).toEqual(['--thinking', 'minimal']);
    expect(resolveThinkingArgs('high')).toEqual(['--thinking', 'high']);
    expect(resolveThinkingArgs('max')).toEqual(['--thinking', 'max']);
  });

  it('空/非法值不传参（跟随 pi 默认）', () => {
    expect(resolveThinkingArgs(undefined)).toEqual([]);
    expect(resolveThinkingArgs(null)).toEqual([]);
    expect(resolveThinkingArgs('')).toEqual([]);
    expect(resolveThinkingArgs('ultra')).toEqual([]);
  });
});

describe('clearPiSession（清空对话语义）', () => {
  it('清除 run/、根级残留 chat.jsonl 与 sessions/，保留装配物与产物；幂等', async () => {
    preparePiWorkspace(UID, WS_ID, {
      agentId: 1,
      chatModel: CHAT_MODEL,
      imageModel: null,
      skillNames: [],
    });
    const agentDir = path.join(wsPath(), '.pi-agent');
    // 三处会话历史：当前落点 + 历史版本根级文件 + pi 迁移/自管目录
    mkdirSync(path.join(agentDir, 'run'), { recursive: true });
    writeFileSync(path.join(agentDir, 'run', 'chat.jsonl'), '{"type":"session"}\n');
    writeFileSync(path.join(agentDir, 'chat.jsonl'), '{"type":"session"}\n');
    mkdirSync(path.join(agentDir, 'sessions', '--opt-enc--'), { recursive: true });
    writeFileSync(path.join(agentDir, 'sessions', '--opt-enc--', 'chat.jsonl'), '{"type":"session"}\n');
    // 装配物与产物必须保留
    mkdirSync(path.join(wsPath(), 'outputs'), { recursive: true });
    writeFileSync(path.join(wsPath(), 'outputs', 'art.txt'), 'x');

    expect(await clearPiSession(UID, WS_ID)).toBe(true);
    expect(existsSync(path.join(agentDir, 'run'))).toBe(false);
    expect(existsSync(path.join(agentDir, 'chat.jsonl'))).toBe(false);
    expect(existsSync(path.join(agentDir, 'sessions'))).toBe(false);
    expect(existsSync(path.join(wsPath(), '.pi-agent', 'models.json'))).toBe(true);
    expect(existsSync(path.join(wsPath(), 'outputs', 'art.txt'))).toBe(true);

    // 幂等：无残留时返回 false
    expect(await clearPiSession(UID, WS_ID)).toBe(false);
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

describe('listWorkspaceArtifacts 排除口径（.env* 密钥文件任意深度）', () => {
  beforeEach(() => {
    const ws = wsPath();
    mkdirSync(path.join(ws, 'outputs', 'sub'), { recursive: true });
    mkdirSync(path.join(ws, 'inputs'), { recursive: true });
    mkdirSync(path.join(ws, '.pi-agent'), { recursive: true });
    writeFileSync(path.join(ws, 'outputs', 'art.png'), 'png');
    writeFileSync(path.join(ws, 'outputs', 'sub', 'deep.txt'), 'deep');
    writeFileSync(path.join(ws, '.env'), 'ROOT_KEY=1');
    writeFileSync(path.join(ws, 'outputs', '.env.local'), 'NESTED_KEY=1');
    writeFileSync(path.join(ws, '.pi-agent', 'models.json'), '{"providers":{}}');
    writeFileSync(path.join(ws, 'inputs', 'up.txt'), 'up');
    writeFileSync(path.join(ws, 'inputs', '.env'), 'INPUT_KEY=1');
  });

  it('默认列表：产物与子目录文件保留，.env* 与 .pi-agent 密钥排除', () => {
    const rels = listWorkspaceArtifacts(wsPath(), WS_ID).map((f) => f.path).sort();
    expect(rels).toEqual(['outputs/art.png', 'outputs/sub/deep.txt']);
  });

  it('includeInputs=1：inputs/ 文件列出，但 inputs/.env 仍排除', () => {
    const rels = listWorkspaceArtifacts(wsPath(), WS_ID, { includeInputs: true })
      .map((f) => f.path)
      .sort();
    expect(rels).toContain('inputs/up.txt');
    expect(rels).toContain('outputs/art.png');
    expect(rels).not.toContain('inputs/.env');
  });

  it('isDiffExcluded / isSecretFileRel：任意深度 .env* 命中，正常产物不误伤', () => {
    expect(isDiffExcluded('.env')).toBe(true);
    expect(isDiffExcluded('outputs/.env.local')).toBe(true);
    expect(isDiffExcluded('deep/sub/.env.production')).toBe(true);
    expect(isDiffExcluded('.pi-agent/models.json')).toBe(true);
    expect(isDiffExcluded('outputs/art.png')).toBe(false);
    expect(isSecretFileRel('.env')).toBe(true);
    expect(isSecretFileRel('a/b/.env.example')).toBe(true);
    expect(isSecretFileRel('a/b/notes.env')).toBe(false);
  });
});

describe('listWorkspaceArtifacts includeAgentRuntime（「全部文件」完整清单 + previewable 标记）', () => {
  beforeEach(() => {
    const ws = wsPath();
    mkdirSync(path.join(ws, 'outputs'), { recursive: true });
    mkdirSync(path.join(ws, 'inputs'), { recursive: true });
    mkdirSync(path.join(ws, '.pi-agent', 'skills'), { recursive: true });
    mkdirSync(path.join(ws, '.pi-agent', 'run'), { recursive: true });
    writeFileSync(path.join(ws, 'outputs', 'art.png'), 'png');
    writeFileSync(path.join(ws, '.env'), 'ROOT_KEY=1');
    writeFileSync(path.join(ws, 'outputs', '.env.local'), 'NESTED=1');
    writeFileSync(path.join(ws, '.pi-agent', 'models.json'), '{"apiKey":"x"}');
    writeFileSync(path.join(ws, '.pi-agent', 'settings.json'), '{"apiKey":"y"}');
    writeFileSync(path.join(ws, '.pi-agent', 'snapshot.json'), '{}');
    writeFileSync(path.join(ws, '.pi-agent', 'skills', 'sk.txt'), 'res');
    writeFileSync(path.join(ws, '.pi-agent', 'run', 'chat.jsonl'), '{}');
    writeFileSync(path.join(ws, 'inputs', 'up.txt'), 'up');
    writeFileSync(path.join(ws, 'inputs', '.env'), 'INPUT_KEY=1');
  });

  it('完整清单：含 .pi-agent 配置名与任意深度 .env* 名字；敏感文件标 previewable=false', () => {
    const files = listWorkspaceArtifacts(wsPath(), WS_ID, {
      includeInputs: true,
      includeAgentRuntime: true,
    });
    const byPath = new Map(files.map((f) => [f.path, f]));
    // 密钥文件：名字与目录结构可见，previewable=false
    expect(byPath.has('.pi-agent/models.json')).toBe(true);
    expect(byPath.get('.pi-agent/models.json')!.previewable).toBe(false);
    expect(byPath.get('.pi-agent/settings.json')!.previewable).toBe(false);
    expect(byPath.get('.env')!.previewable).toBe(false);
    expect(byPath.get('outputs/.env.local')!.previewable).toBe(false);
    expect(byPath.get('inputs/.env')!.previewable).toBe(false);
    // 非敏感文件：可预览（字段缺省 = true）
    expect(byPath.get('outputs/art.png')!.previewable).toBeUndefined();
    expect(byPath.get('.pi-agent/snapshot.json')!.previewable).toBeUndefined();
    expect(byPath.get('.pi-agent/skills/sk.txt')!.previewable).toBeUndefined();
    expect(byPath.get('inputs/up.txt')!.previewable).toBeUndefined();
    // 运行态会话 jsonl（run/）不进入「全部文件」清单
    expect(byPath.has('.pi-agent/run/chat.jsonl')).toBe(false);
  });

  it('默认模式（不传 includeAgentRuntime）：.pi-agent 与 .env* 仍整体隐藏（AI 产物 / 我的上传 视图不变）', () => {
    const files = listWorkspaceArtifacts(wsPath(), WS_ID, { includeInputs: true });
    const rels = files.map((f) => f.path);
    expect(rels.some((r) => r.startsWith('.pi-agent/'))).toBe(false);
    expect(rels).not.toContain('.env');
    expect(rels).not.toContain('outputs/.env.local');
    expect(rels).toContain('inputs/up.txt');
  });

  it('完整清单识别符号链接：文件软链/目录软链占位/悬空软链（无软链权限时降级仅断言名字可见）', () => {
    const ws = wsPath();
    const ext = mkdtempSync(path.join(tmpdir(), 'pi-link-'));
    let madeLinks = false;
    try {
      writeFileSync(path.join(ext, 'notes.txt'), 'outside');
      mkdirSync(path.join(ext, 'd'), { recursive: true });
      writeFileSync(path.join(ext, 'd', 'x.txt'), 'x');
      symlinkSync(path.join(ext, 'notes.txt'), path.join(ws, 'link-out.txt'), 'file');
      symlinkSync(path.join(ext, 'd'), path.join(ws, 'link-dir'), 'dir');
      symlinkSync(path.join(ws, 'missing.txt'), path.join(ws, 'link-dangling.txt'), 'file');
      madeLinks = true;
    } catch {
      // Windows 无软链权限：用真实文件兜底，仅断言名字可见
      writeFileSync(path.join(ws, 'link-out.txt'), 'outside');
    }
    try {
      const files = listWorkspaceArtifacts(ws, WS_ID, { includeInputs: true, includeAgentRuntime: true });
      const byPath = new Map(files.map((f) => [f.path, f]));
      if (madeLinks) {
        // 文件软链指向工作区外：名字可见、不可预览
        expect(byPath.get('link-out.txt')).toMatchObject({ link: true, previewable: false });
        // 目录软链：占位节点，不穿透目标内容
        expect(byPath.get('link-dir')).toMatchObject({ isDir: true, link: true, previewable: false });
        expect(byPath.has('link-dir/x.txt')).toBe(false);
        // 悬空软链：名字可见、不可预览
        expect(byPath.get('link-dangling.txt')).toMatchObject({ link: true, previewable: false });
      } else {
        expect(byPath.has('link-out.txt')).toBe(true);
      }
      // 常规文件不误标
      expect(byPath.get('outputs/art.png')!.link).toBeUndefined();
      expect(byPath.get('outputs/art.png')!.previewable).toBeUndefined();
    } finally {
      rmSync(ext, { recursive: true, force: true });
    }
  });
});
