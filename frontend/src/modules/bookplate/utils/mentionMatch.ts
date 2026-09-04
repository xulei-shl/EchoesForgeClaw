import type { AgentFile } from '../../../platform/types';

/**
 * @ 文件引用模糊匹配得分（子序列匹配：连续/前缀加分；不匹配返回 -1）。
 * 纯函数，供 ChatNodeComposer 的候选排序与单元测试使用。
 */
export function scoreMentionPath(path: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = path.toLowerCase();
  let qi = 0;
  let score = 0;
  let last = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += last !== -1 && ti - last === 1 ? 3 : 1;
      if (ti === 0) score += 5;
      last = ti;
      qi += 1;
    }
  }
  if (qi < q.length) return -1;
  return score - last * 0.01;
}

/**
 * 按模糊匹配得分排序后的 @ 候选文件列表（query 为空时全部保留、按路径字典序）。
 */
export function rankMentionFiles(files: AgentFile[], query: string): AgentFile[] {
  return files
    .map((f) => ({ f, s: scoreMentionPath(f.path, query) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.f.path.localeCompare(b.f.path))
    .map((x) => x.f);
}