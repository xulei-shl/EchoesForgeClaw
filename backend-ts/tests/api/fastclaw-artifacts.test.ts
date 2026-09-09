/** FastClaw 产物桥接单测：路径识别 / 安全解析 / 收割拷贝。 */
import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  extractFastclawPathCandidates,
  fastclawDataRoot,
  harvestFastclawArtifacts,
  resolveFastclawArtifact,
} from '../../src/services/ai/fastclaw-artifacts.js';

let root: string;
let dest: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'fc-root-'));
  dest = mkdtempSync(path.join(os.tmpdir(), 'fc-dest-'));
  mkdirSync(`${root}/workspaces/agt_x/sessions/s1`, { recursive: true });
  writeFileSync(`${root}/workspaces/agt_x/image_a_0.png`, Buffer.from('89504e47', 'hex'));
  writeFileSync(`${root}/workspaces/agt_x/sessions/s1/image_b_0.jpg`, Buffer.from('abcd', 'hex'));
  writeFileSync(`${root}/workspaces/agt_x/report.md`, '# 报告');
  writeFileSync(`${root}/secret.png`, 'root-level');
  mkdirSync(`${root}/workspaces/agt_y`, { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(dest, { recursive: true, force: true });
});

describe('extractFastclawPathCandidates', () => {
  it('识别反引号 / markdown / 裸绝对路径，拒绝 URL、相对路径与未知扩展名', () => {
    const text = [
      '生成完成 ![图](/var/lib/fastclaw/workspaces/agt_x/image_a_0.png)',
      '报告见 `/var/lib/fastclaw/workspaces/agt_x/report.md`',
      '裸路径 /var/lib/fastclaw/workspaces/agt_x/sessions/s1/image_b_0.jpg。',
      '网页 https://cdn.example.com/a.png 不收',
      '相对 outputs/x.png 不收',
      '未知扩展名 /var/lib/fastclaw/workspaces/agt_x/data.xyz 不收',
    ].join('\n');
    const got = extractFastclawPathCandidates(text);
    expect(got).toHaveLength(3);
    expect(got).toContain('/var/lib/fastclaw/workspaces/agt_x/image_a_0.png');
    expect(got).toContain('/var/lib/fastclaw/workspaces/agt_x/report.md');
    expect(got).toContain('/var/lib/fastclaw/workspaces/agt_x/sessions/s1/image_b_0.jpg');
  });

  it('空文本安全', () => {
    expect(extractFastclawPathCandidates('')).toEqual([]);
  });
});

describe('resolveFastclawArtifact', () => {
  it('根内真实文件放行', () => {
    expect(resolveFastclawArtifact(root, `${root}/workspaces/agt_x/image_a_0.png`)).toBe(
      `${root}/workspaces/agt_x/image_a_0.png`
    );
  });

  it('越界（../）与根外文件拒绝', () => {
    expect(resolveFastclawArtifact(root, `${root}/workspaces/../../etc/passwd.png`)).toBeNull();
    expect(resolveFastclawArtifact(root, '/etc/passwd.png')).toBeNull();
  });

  it('软链穿透到根外拒绝；目录与非存在文件拒绝', () => {
    symlinkSync('/etc/hosts.png', `${root}/workspaces/agt_x/evil.png`);
    expect(resolveFastclawArtifact(root, `${root}/workspaces/agt_x/evil.png`)).toBeNull();
    expect(resolveFastclawArtifact(root, `${root}/workspaces`)).toBeNull();
    expect(resolveFastclawArtifact(root, `${root}/nope.png`)).toBeNull();
  });
});

describe('harvestFastclawArtifacts', () => {
  it('拷贝进 destDir 并返回 outputs/ 相对路径与大小', () => {
    const arts = harvestFastclawArtifacts({
      root,
      texts: [
        `![a](${root}/workspaces/agt_x/image_a_0.png)`,
        `见 ${root}/workspaces/agt_x/report.md`,
      ],
      destDir: `${dest}/outputs`,
    });
    const rels = arts.map((a) => a.rel).sort();
    expect(rels).toEqual(['outputs/image_a_0.png', 'outputs/report.md']);
    expect(arts.find((a) => a.rel.endsWith('.png'))?.size).toBe(4);
    // 幂等重跑：同名覆盖，结果稳定
    const again = harvestFastclawArtifacts({ root, texts: [`![a](${root}/workspaces/agt_x/image_a_0.png)`], destDir: `${dest}/outputs` });
    expect(again.map((a) => a.rel)).toEqual(['outputs/image_a_0.png']);
  });

  it('同名不同来源自动加序号；单轮数量上限生效', () => {
    writeFileSync(`${root}/workspaces/agt_y/image_a_0.png`, 'other-source-same-name');
    const arts = harvestFastclawArtifacts({
      root,
      texts: [`${root}/workspaces/agt_x/image_a_0.png 和 ${root}/workspaces/agt_y/image_a_0.png`],
      destDir: `${dest}/outputs2`,
    });
    expect(arts.map((a) => a.rel).sort()).toEqual(['outputs/image_a_0.png', 'outputs/image_a_0_2.png']);

    const many = Array.from({ length: 20 }, (_, i) => {
      writeFileSync(`${root}/workspaces/agt_x/f${i}.md`, String(i));
      return `${root}/workspaces/agt_x/f${i}.md`;
    }).join('\n');
    const capped = harvestFastclawArtifacts({ root, texts: [many], destDir: `${dest}/outputs3` });
    expect(capped.length).toBeLessThanOrEqual(12);
  });

  it('引用不存在的路径静默跳过', () => {
    const arts = harvestFastclawArtifacts({ root, texts: [`${root}/ghost.png`], destDir: `${dest}/outputs4` });
    expect(arts).toEqual([]);
  });
});

describe('fastclawDataRoot', () => {
  it('env 覆盖生效；无效路径返回 null', () => {
    process.env.FASTCLAW_DATA_ROOT = root;
    expect(fastclawDataRoot()).toBe(root);
    process.env.FASTCLAW_DATA_ROOT = '/nonexistent-fastclaw-xyz';
    expect(fastclawDataRoot()).toBeNull();
    delete process.env.FASTCLAW_DATA_ROOT;
  });
});
