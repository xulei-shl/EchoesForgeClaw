import type { CanvasNodeType } from '../../platform/types';
import { getNodeDynamicTitle, getNodeTitle, nodeOutputText, type GraphNode, type PortTypesLookup } from './nodeTypes';

/**
 * 该节点是否产出可被占位符引用的文本输出：由端口类型声明推导（output ∈ text / any）。
 * 端口声明来自后端 node_types.py（唯一权威，经 node-registry 下发）+ 前端 NODE_PORT_TYPES 兜底，
 * 因此新增文本输出节点类型时**无需改动此处**——只要模板声明了文本/任意输出即自动支持占位符。
 */
export function isTextOutputNode(
  node: GraphNode,
  portTypesOf: PortTypesLookup
): boolean {
  const outputs = portTypesOf(node.type).outputs;
  return outputs.includes('text') || outputs.includes('any');
}

/**
 * 文本聚合节点：占位符模板引擎
 *
 * 模板中可用 `{别名}` 引用上级节点的对外输出文本（如 `## 标题\n\n{我是节点1的占位符}`），
 * 运行时把占位符替换为对应上级节点的 nodeOutputText。占位符别名默认取上级节点的
 * 动态标题（如提示词检索的已选提示词名，回退变体名 / 模板名），同名自动加「· 2」后缀；
 * 用户可在聚合节点内重命名。
 * 未匹配到上级的占位符保留原文（不静默吞掉，方便用户发现模板写错）。
 */

/** 占位符面板的来源行（由 toPlaceholderSources 从画布上级节点映射，供 PlaceholderPanel 渲染） */
export interface PlaceholderSource {
  id: string;
  type: CanvasNodeType;
  title: string;
  alias: string;
}

/**
 * 把节点的直接上级映射为占位符来源列表：
 * - 仅保留文本输出上级（按端口类型声明推导，图片上传等不生成占位符）；
 * - 别名取占位符映射中的用户别名，缺失时回退节点标题。
 * 供 PlaceholderPanel 使用：任何带占位符模板的节点传入 parents + placeholders + portTypesOf 即可复用。
 */
export function toPlaceholderSources(
  parents: GraphNode[],
  placeholders: Record<string, string>,
  portTypesOf: PortTypesLookup
): PlaceholderSource[] {
  return parents
    .filter((p) => isTextOutputNode(p, portTypesOf))
    .map((p) => {
      const title = getNodeDynamicTitle(p);
      return { id: p.id, type: p.type, title, alias: placeholders[p.id] ?? title };
    });
}

/** 新建聚合节点的默认模板（与用户示例一致，直观展示功能） */
export const AGGREGATE_DEFAULT_TEMPLATE = `## 我是自定义标题

{我是上级节点1的占位符}

---

## 我是另一个自定义标题

{我是上级节点2的占位符}`;

/** 占位符匹配：{...} 内不含花括号与换行；两端空白忽略（匹配时 trim） */
const PLACEHOLDER_RE = /\{([^{}\n]+)\}/g;

/** 提取模板中出现的占位符名（去重、保序） */
export function extractPlaceholderNames(template: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  if (template) {
    for (const m of template.matchAll(PLACEHOLDER_RE)) {
      const name = m[1].trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names;
}

/**
 * 为上级节点生成默认别名：动态标题 + 去重后缀（「翻译助手」「翻译助手 · 2」…）。
 * 动态标题优先取随使用变化的名称（如提示词检索的已选提示词名），回退 getNodeTitle。
 * @param used 已占用的别名集合（写入新别名后同步更新）
 */
export function uniqueDefaultAlias(
  parent: GraphNode,
  used: Set<string>
): string {
  const base = getNodeDynamicTitle(parent) || parent.type;
  let alias = base;
  let n = 2;
  while (used.has(alias)) {
    alias = `${base} · ${n}`;
    n += 1;
  }
  used.add(alias);
  return alias;
}

/**
 * 同步聚合节点的占位符映射 { 上级节点 id: 别名 }：
 * - 仍在连线的文本输出上级（按端口类型声明判断）：保留用户改过的别名；未配置过的补默认别名（动态标题）；
 * - 无文本输出的上级（类型不匹配连线）不生成占位符；
 * - 已断开的上级：从映射中移除。
 * 存量数据兼容：与静态标题（getNodeTitle 及其历史去重后缀）相同的别名视为旧默认值，
 * 重算为动态默认别名；用户改过的其他别名原样保留。
 * 返回全新对象；调用方比对后仅在变化时写回节点数据。
 */
export function syncAggregatePlaceholders(
  node: { data?: any },
  parents: GraphNode[],
  portTypesOf: PortTypesLookup
): Record<string, string> {
  const existing: Record<string, string> = node.data?.placeholders ?? {};
  const result: Record<string, string> = {};
  const used = new Set<string>();
  for (const p of parents) {
    if (!isTextOutputNode(p, portTypesOf)) continue;
    const custom = existing[p.id];
    if (
      typeof custom === 'string' &&
      custom.trim() &&
      !isStaticDefaultAlias(custom.trim(), p) &&
      !used.has(custom.trim())
    ) {
      result[p.id] = custom.trim();
      used.add(custom.trim());
      continue;
    }
    result[p.id] = uniqueDefaultAlias(p, used);
  }
  return result;
}

/** 是否为旧版静态默认别名：getNodeTitle 本身或其「 · N」去重后缀形式 */
function isStaticDefaultAlias(alias: string, parent: GraphNode): boolean {
  const base = getNodeTitle(parent);
  if (alias === base) return true;
  return alias.startsWith(base) && /^(?: · \d+)+$/.test(alias.slice(base.length));
}

/**
 * 渲染聚合模板：把 `{别名}` 替换为对应上级节点的文本输出。
 * 未匹配任何上级的占位符原样保留（便于用户发现模板写错）。
 */
export function renderAggregateTemplate(
  template: string,
  parents: GraphNode[],
  placeholders: Record<string, string>
): string {
  if (!template) return '';
  const aliasToParent = new Map<string, GraphNode>();
  for (const p of parents) {
    const alias = placeholders[p.id];
    if (alias && !aliasToParent.has(alias)) aliasToParent.set(alias, p);
  }
  return template.replace(PLACEHOLDER_RE, (whole, name: string) => {
    const parent = aliasToParent.get(name.trim());
    if (!parent) return whole;
    return nodeOutputText(parent) ?? '';
  });
}
