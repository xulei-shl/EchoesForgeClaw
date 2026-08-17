import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Search, X, Layers, Sparkles } from 'lucide-react';
import { CATEGORY_LABELS, NODE_TEMPLATES, NODE_COLORS } from '../nodeTypes';
import type { CanvasNodeType } from '../../../platform/types';

/** 「+」菜单 / 右键菜单中的一个可选项 */
export interface NodePickerItem {
  key: string;
  nodeType: CanvasNodeType;
  label: string;
  description: string;
  /** 绑定的节点配置 id（未绑定则为 undefined，使用默认配置/环境变量） */
  configId?: number;
  /** 可选自定义分组：有值则自成一组展示；空则归入模板分组 */
  group?: string;
  /** 自定义分组排序序号（0 表示未排序，按首见顺序回退） */
  groupOrder?: number;
  mode?: 'llm' | 'agent' | 'skill_agent';
  agentName?: string | null;
  /** 该模板类型下无任何配置，将回退默认配置 */
  fallback?: boolean;
}

interface NodePickerListProps {
  items: NodePickerItem[];
  onPick: (item: NodePickerItem) => void;
  /** 添加进行中的子节点 id（选中后短暂禁用，防止重复点击） */
  pendingChildId?: string | null;
}

interface CategoryNav {
  key: string;
  title: string;
  order?: number;
  count: number;
}

/** 构建所有分类项（含全部） */
function buildCategories(items: NodePickerItem[]): { categories: CategoryNav[]; groupMap: Map<string, NodePickerItem[]> } {
  const groupMap = new Map<string, NodePickerItem[]>();
  const customGroups: { key: string; title: string; order: number }[] = [];
  const customGroupSet = new Set<string>();
  const ungrouped: NodePickerItem[] = [];

  for (const item of items) {
    const g = item.group?.trim();
    if (g) {
      const key = `group:${g}`;
      if (!customGroupSet.has(g)) {
        customGroupSet.add(g);
        customGroups.push({ key, title: g, order: item.groupOrder ?? 0 });
      }
      const list = groupMap.get(key) || [];
      list.push(item);
      groupMap.set(key, list);
    } else {
      ungrouped.push(item);
    }
  }

  // 自定义分组排序
  customGroups.sort((a, b) => {
    const ao = a.order || Number.MAX_SAFE_INTEGER;
    const bo = b.order || Number.MAX_SAFE_INTEGER;
    return ao - bo;
  });

  const categories: CategoryNav[] = [
    { key: 'all', title: '全部节点', count: items.length },
  ];

  // 非可配置（基础）节点按模板类别分组（如「输入」「小工具」），与可配置模板分组口径一致
  const baseGroupMap = new Map<string, { title: string; items: NodePickerItem[] }>();
  for (const t of NODE_TEMPLATES) {
    if (t.configurable) continue;
    const list = ungrouped.filter((i) => i.nodeType === t.type);
    if (list.length === 0) continue;
    const cat = t.category;
    if (!baseGroupMap.has(cat)) {
      baseGroupMap.set(cat, { title: CATEGORY_LABELS[cat], items: [] });
    }
    baseGroupMap.get(cat)!.items.push(...list);
  }
  for (const [cat, g] of baseGroupMap) {
    const key = `base:${cat}`;
    groupMap.set(key, g.items);
    categories.push({ key, title: g.title, count: g.items.length });
  }

  // 自定义分组
  for (const cg of customGroups) {
    const count = groupMap.get(cg.key)?.length || 0;
    categories.push({ key: cg.key, title: cg.title, count });
  }

  // 可配置模板分组
  for (const t of NODE_TEMPLATES.filter((t) => t.configurable)) {
    const list = ungrouped.filter((i) => i.nodeType === t.type);
    if (list.length > 0) {
      const key = `template:${t.type}`;
      groupMap.set(key, list);
      categories.push({
        key,
        title: `${CATEGORY_LABELS[t.category]} · ${t.name}`,
        count: list.length,
      });
    }
  }

  return { categories, groupMap };
}

const NodePickerListInner: React.FC<NodePickerListProps> = ({ items, onPick, pendingChildId }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时自动聚焦搜索输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 搜索过滤
  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query) ||
        item.agentName?.toLowerCase().includes(query)
    );
  }, [items, searchQuery]);

  // 分类与节点归类映射
  const { categories, groupMap } = useMemo(() => buildCategories(items), [items]);

  // 当前右侧显示的节点列表
  const displayedItems = useMemo(() => {
    // 搜索态：平铺展示所有搜索匹配的节点
    if (searchQuery.trim()) {
      return filteredItems;
    }
    // 未搜索态：根据左侧选中的分类展示
    if (activeCategory === 'all') {
      return items;
    }
    return groupMap.get(activeCategory) || [];
  }, [searchQuery, filteredItems, activeCategory, items, groupMap]);

  return (
    <div className="flex flex-col select-none">
      {/* 顶部搜索栏 */}
      <div className="px-3 pt-2.5 pb-2 border-b border-paper-grid/50 bg-paper-grid/5">
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-faint pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索节点名称、描述或 Agent..."
            className="w-full pl-8 pr-7 py-1.5 bg-paper-grid/20 border border-dashed border-paper-grid rounded-md text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          />

          {searchQuery && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSearchQuery('');
                inputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-ink-faint hover:text-ink rounded transition-colors"
              title="清空搜索"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* 主体分栏：左侧分类 + 右侧节点 */}
      <div className="flex h-[340px] divide-x divide-dashed divide-paper-grid/70 overflow-hidden">
        {/* 左侧分类导航 (Master) */}
        <div className="w-[126px] shrink-0 overflow-y-auto p-1.5 space-y-0.5 bg-paper-grid/10 custom-scrollbar">
          {searchQuery.trim() ? (
            <div className="px-2 py-1.5 rounded-md bg-accent-surface text-accent text-xs font-medium flex items-center justify-between">
              <span className="truncate">搜索结果</span>
              <span className="text-[10px] tabular-nums font-sans opacity-80">
                {filteredItems.length}
              </span>
            </div>
          ) : (
            categories.map((cat) => {
              const isActive = activeCategory === cat.key;
              return (
                <button
                  key={cat.key}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveCategory(cat.key);
                  }}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-left text-xs transition-colors group ${
                    isActive
                      ? 'bg-accent-surface text-accent font-medium shadow-xs'
                      : 'text-ink-light hover:bg-paper-grid/30 hover:text-ink'
                  }`}
                  title={cat.title}
                >
                  <span className="truncate flex-1 pr-1">{cat.title}</span>
                  <span
                    className={`text-[10px] tabular-nums font-sans ${
                      isActive ? 'text-accent opacity-90' : 'text-ink-faint group-hover:text-ink-light'
                    }`}
                  >
                    {cat.count}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* 右侧节点列表 (Detail) */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 bg-paper/60 custom-scrollbar">
          {displayedItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-4 text-center">
              <Layers className="w-6 h-6 text-ink-faint/50 mb-1.5" />
              <p className="text-xs text-ink-faint font-sans">
                {searchQuery.trim() ? '未找到匹配的节点' : '该分类下暂无节点'}
              </p>
            </div>
          ) : (
            displayedItems.map((item) => {
              const themeColor = NODE_COLORS[item.nodeType] || '#5B8A5B';
              return (
                <button
                  key={item.key}
                  disabled={!!pendingChildId}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPick(item);
                  }}
                  className="w-full flex items-start px-2.5 py-2 text-left rounded-lg border border-transparent hover:border-paper-grid/80 hover:bg-accent-surface/40 active:scale-[0.98] transition-all disabled:opacity-50 group/node"
                >
                  {/* 节点类型指示圆点 */}
                  <div className="flex items-center justify-center w-4 h-4 shrink-0 mt-0.5">
                    {item.mode === 'agent' ? (
                      <Sparkles className="w-3.5 h-3.5 text-accent animate-pulse" />
                    ) : (
                      <span
                        className="w-2 h-2 rounded-full transition-transform duration-150 group-hover/node:scale-125"
                        style={{
                          backgroundColor: item.fallback ? 'rgba(120, 113, 108, 0.5)' : themeColor,
                        }}
                      />
                    )}
                  </div>

                  {/* 节点文本内容 */}
                  <div className="ml-2 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-sans text-ink font-medium truncate group-hover/node:text-accent transition-colors">
                        {item.label}
                      </span>
                      {item.fallback && (
                        <span className="shrink-0 text-[9px] text-ink-faint border border-dashed border-paper-grid rounded-sm px-1 py-px leading-none">
                          默认
                        </span>
                      )}
                      {item.mode === 'agent' && (
                        <span className="shrink-0 text-[9px] text-accent bg-accent-surface rounded-sm px-1 py-px leading-none font-medium">
                          Agent
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-ink-light/75 font-sans truncate mt-0.5 leading-tight">
                      {item.agentName ? `Agent · ${item.agentName}` : item.description}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export const NodePickerList = React.memo(NodePickerListInner);
NodePickerList.displayName = 'NodePickerList';
export default NodePickerList;
