import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { CATEGORY_LABELS, NODE_TEMPLATES } from '../nodeTypes';
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
  mode?: 'llm' | 'agent';
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

interface PickerGroup {
  /** 分组 key（自定义分组用 group 名，模板分组用模板类型） */
  key: string;
  /** 分组标题 */
  title: string;
  /** 自定义分组排序序号（模板分组不使用） */
  order?: number;
  items: NodePickerItem[];
}

/** 分组优先：有自定义分组的项按 group 分组（按 group_order 排序，未排序按首见顺序），
 *  无分组的项按模板分组（保持 NODE_TEMPLATES 顺序） */
function groupItems(items: NodePickerItem[]): PickerGroup[] {
  const groups: PickerGroup[] = [];
  const groupMap = new Map<string, PickerGroup>();
  const ungrouped: NodePickerItem[] = [];

  for (const item of items) {
    const g = item.group?.trim();
    if (g) {
      let grp = groupMap.get(g);
      if (!grp) {
        grp = { key: `group:${g}`, title: g, order: item.groupOrder ?? 0, items: [] };
        groupMap.set(g, grp);
        groups.push(grp);
      }
      grp.items.push(item);
    } else {
      ungrouped.push(item);
    }
  }

  // 自定义组排序：group_order 升序（0 的排最后、保持首见顺序）；同组首个 item 的 groupOrder 为准
  groups.sort((a, b) => {
    const ao = a.order || Number.MAX_SAFE_INTEGER;
    const bo = b.order || Number.MAX_SAFE_INTEGER;
    return ao - bo;
  });

  // 无分组的项按模板分组追加到末尾（保持 NODE_TEMPLATES 顺序）
  for (const t of NODE_TEMPLATES) {
    const list = ungrouped.filter((i) => i.nodeType === t.type);
    if (list.length > 0) {
      groups.push({ key: `template:${t.type}`, title: `${CATEGORY_LABELS[t.category]} · ${t.name}`, items: list });
    }
  }
  return groups;
}

const NodePickerListInner: React.FC<NodePickerListProps> = ({ items, onPick, pendingChildId }) => {
  const groups = groupItems(items);
  // 折叠的分组 key 集合（默认全部展开）
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="p-1.5 space-y-1">
      {groups.length === 0 && (
        <p className="px-3 py-4 text-xs text-ink-faint font-sans text-center">暂无可添加的节点</p>
      )}
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.key);
        return (
        <div key={group.key}>
          <button
            type="button"
            onClick={() => toggleGroup(group.key)}
            title={isCollapsed ? '展开分组' : '折叠分组'}
            className="w-full flex items-center px-1.5 py-1.5 text-left group hover:bg-paper-grid/40 active:bg-paper-grid/60 transition-colors focus-visible:outline-none rounded-md"
          >
            <div className="flex items-center justify-center w-4 h-4 shrink-0 text-ink-faint group-hover:text-ink-light transition-colors">
              {isCollapsed ? (
                <ChevronRight size={14} strokeWidth={2} />
              ) : (
                <ChevronDown size={14} strokeWidth={2} />
              )}
            </div>
            <span className="ml-1.5 flex-1 min-w-0 truncate text-[11px] font-medium text-ink-light tracking-wide">
              {group.title}
            </span>
            <span className="ml-2 text-[10px] text-ink-faint font-sans tabular-nums">
              {group.items.length}
            </span>
          </button>
          {!isCollapsed && (
            <div className="pt-0.5 pb-1 space-y-0.5">
              {group.items.map((item) => (
                <button
                  key={item.key}
                  disabled={!!pendingChildId}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPick(item);
                  }}
                  className="w-full flex items-start px-2 py-2 text-left hover:bg-accent-surface/60 active:scale-[0.96] transition-all disabled:opacity-50 rounded-lg group/item"
                >
                  <div className="flex items-center justify-center w-4 h-4 shrink-0 mt-[1px]">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ring-2 ring-transparent group-hover/item:ring-current/10 transition-all duration-200 group-hover/item:scale-125 ${
                        item.mode === 'agent'
                          ? 'bg-accent text-accent'
                          : item.fallback
                            ? 'bg-ink-faint/50 text-ink-faint'
                            : 'bg-[#5B8A5B] text-[#5B8A5B]'
                      }`}
                    />
                  </div>
                  <span className="ml-2 min-w-0 flex-1">
                    <span className="block text-sm font-sans text-ink font-medium truncate group-hover/item:text-accent transition-colors">
                      {item.label}
                      {item.fallback && (
                        <span className="ml-1.5 text-[10px] text-ink-faint border border-dashed border-paper-grid rounded-full px-1.5 py-px align-middle">
                          默认配置
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-ink-light/80 font-sans truncate mt-0.5">
                      {item.agentName ? `Agent · ${item.agentName}` : item.description}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
};

export const NodePickerList = React.memo(NodePickerListInner);
NodePickerList.displayName = 'NodePickerList';
export default NodePickerList;
