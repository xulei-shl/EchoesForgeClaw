import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  Search,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-react';

/** 树节点类型定义 */
export interface SkillTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  fileCount: number; // 该目录下包含的文件总数
  children: SkillTreeNode[];
}

export interface SkillFileTreeProps {
  /** 文件列表数据（支持纯字符串路径或含 path 字段的对象） */
  files?: (string | { path: string })[];
  /** 自定义外层样式 */
  className?: string;
  /** 最大高度样式类，默认 max-h-[420px] */
  maxHeightClass?: string;
}

/**
 * 递归构建目录树纯函数
 * @param filePaths 规范化后的路径列表
 * @returns 树根节点列表、所有目录路径集合、有效文件总数
 */
function buildSkillTree(filePaths: string[]): {
  tree: SkillTreeNode[];
  allDirPaths: Set<string>;
} {
  const root: SkillTreeNode[] = [];
  const dirMap = new Map<string, SkillTreeNode>();
  const allDirPaths = new Set<string>();

  // 排序保持路径结构一致
  const sortedPaths = [...filePaths].sort();

  for (const rawPath of sortedPaths) {
    const normPath = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normPath) continue;

    const segments = normPath.split('/');
    let currentChildren = root;
    let accumulatedPath = '';

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${seg}` : seg;
      const isLast = i === segments.length - 1;

      if (isLast) {
        // 叶子文件节点
        currentChildren.push({
          name: seg,
          path: accumulatedPath,
          isDir: false,
          fileCount: 1,
          children: [],
        });
      } else {
        // 目录节点
        allDirPaths.add(accumulatedPath);
        let dirNode = dirMap.get(accumulatedPath);
        if (!dirNode) {
          dirNode = {
            name: seg,
            path: accumulatedPath,
            isDir: true,
            fileCount: 0,
            children: [],
          };
          dirMap.set(accumulatedPath, dirNode);
          currentChildren.push(dirNode);
        }
        currentChildren = dirNode.children;
      }
    }
  }

  // 递归统计各级目录文件总数并对子项排序（目录在前，文件在后，同类按字母序）
  function postProcess(nodes: SkillTreeNode[]): number {
    let count = 0;
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });

    for (const node of nodes) {
      if (node.isDir) {
        node.fileCount = postProcess(node.children);
        count += node.fileCount;
      } else {
        count += 1;
      }
    }
    return count;
  }

  postProcess(root);

  return { tree: root, allDirPaths };
}

/**
 * 递归过滤匹配搜索关键词的节点树
 */
function filterSkillTree(
  nodes: SkillTreeNode[],
  keyword: string
): { filteredNodes: SkillTreeNode[]; matchedAncestors: Set<string> } {
  const q = keyword.toLowerCase();
  const matchedAncestors = new Set<string>();

  function walk(list: SkillTreeNode[]): SkillTreeNode[] {
    const result: SkillTreeNode[] = [];

    for (const node of list) {
      if (node.isDir) {
        const matchingChildren = walk(node.children);
        if (matchingChildren.length > 0) {
          matchedAncestors.add(node.path);
          result.push({
            ...node,
            fileCount: matchingChildren.reduce((acc, c) => acc + (c.isDir ? c.fileCount : 1), 0),
            children: matchingChildren,
          });
        }
      } else {
        if (node.name.toLowerCase().includes(q) || node.path.toLowerCase().includes(q)) {
          result.push(node);
        }
      }
    }

    return result;
  }

  const filteredNodes = walk(nodes);
  return { filteredNodes, matchedAncestors };
}

/**
 * 目录树行渲染组件
 */
const SkillTreeNodeItem: React.FC<{
  node: SkillTreeNode;
  depth: number;
  isCollapsed: boolean;
  filterKeyword: string;
  onToggle: (path: string) => void;
  collapsedPaths: Set<string>;
}> = ({ node, depth, isCollapsed, filterKeyword, onToggle, collapsedPaths }) => {
  const padLeft = depth * 14 + 6;

  // 目录节点渲染
  if (node.isDir) {
    return (
      <div className="flex flex-col select-none">
        <button
          type="button"
          onClick={() => onToggle(node.path)}
          aria-expanded={!isCollapsed}
          title={`${isCollapsed ? '展开' : '收起'} ${node.name}`}
          className="flex items-center gap-1.5 w-full py-1 pr-2 rounded-md text-xs font-sans text-ink-light hover:text-ink hover:bg-paper-grid/40 transition-colors text-left group"
          style={{ paddingLeft: `${padLeft}px` }}
        >
          {isCollapsed ? (
            <ChevronRight size={12} className="shrink-0 text-ink-faint group-hover:text-ink transition-transform" />
          ) : (
            <ChevronDown size={12} className="shrink-0 text-ink-faint group-hover:text-ink transition-transform" />
          )}

          {isCollapsed ? (
            <Folder size={13} className="shrink-0 text-amber-500/80" />
          ) : (
            <FolderOpen size={13} className="shrink-0 text-amber-500" />
          )}

          <span className="font-medium truncate">{node.name}</span>
          <span className="text-[10px] text-ink-faint ml-1 font-mono">({node.fileCount})</span>
        </button>

        {/* 展开子项 */}
        {!isCollapsed && (
          <div className="flex flex-col">
            {node.children.map((child) => (
              <SkillTreeNodeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                isCollapsed={collapsedPaths.has(child.path)}
                filterKeyword={filterKeyword}
                onToggle={onToggle}
                collapsedPaths={collapsedPaths}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // 文件叶子节点渲染
  const highlightMatch = (text: string, q: string) => {
    if (!q.trim()) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    const before = text.substring(0, idx);
    const match = text.substring(idx, idx + q.length);
    const after = text.substring(idx + q.length);
    return (
      <>
        {before}
        <span className="text-accent font-semibold underline underline-offset-2">{match}</span>
        {after}
      </>
    );
  };

  return (
    <div
      className="flex items-center gap-1.5 py-0.5 pr-2 rounded-md text-xs font-mono text-ink-light hover:text-ink hover:bg-paper-grid/30 transition-colors"
      style={{ paddingLeft: `${padLeft + 16}px` }}
      title={node.path}
    >
      <FileText size={12} className="shrink-0 text-ink-faint" />
      <span className="truncate">{highlightMatch(node.name, filterKeyword)}</span>
    </div>
  );
};

/**
 * 通用 Skill 目录树组件
 * - 纯路径自动构建多级目录树
 * - 默认所有文件夹均处于折叠收起状态
 * - 支持即时检索并自动级联展开命中路径
 * - 支持一键「全部展开 / 全部收起」
 */
export const SkillFileTree: React.FC<SkillFileTreeProps> = ({
  files,
  className = '',
  maxHeightClass = 'max-h-[420px]',
}) => {
  const [filter, setFilter] = useState('');

  // 规范化文件路径数组
  const filePaths = useMemo(() => {
    if (!Array.isArray(files)) return [];
    return files
      .map((f) => (typeof f === 'string' ? f : f?.path))
      .filter((p): p is string => Boolean(p && typeof p === 'string'));
  }, [files]);

  // 构建目录树结构
  const { tree, allDirPaths } = useMemo(() => {
    return buildSkillTree(filePaths);
  }, [filePaths]);

  // 已收起目录路径集合：【核心需求】默认全折叠，所有目录路径均放入收起集合
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set(allDirPaths));

  // 当文件源数据变化时，重新重置为全折叠
  useEffect(() => {
    setCollapsedPaths(new Set(allDirPaths));
    setFilter('');
  }, [allDirPaths]);

  // 搜索过滤与祖先自动展开处理
  const { displayTree, activeCollapsedPaths } = useMemo(() => {
    const trimmed = filter.trim();
    if (!trimmed) {
      return { displayTree: tree, activeCollapsedPaths: collapsedPaths };
    }

    const { filteredNodes, matchedAncestors } = filterSkillTree(tree, trimmed);
    // 搜索态下：被命中的祖先目录必须强制展开
    const nextCollapsed = new Set(collapsedPaths);
    for (const ancestor of matchedAncestors) {
      nextCollapsed.delete(ancestor);
    }
    return { displayTree: filteredNodes, activeCollapsedPaths: nextCollapsed };
  }, [tree, filter, collapsedPaths]);

  // 单个目录切换展开/收起
  const handleToggle = useCallback((dirPath: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }, []);

  // 全部展开
  const handleExpandAll = useCallback(() => {
    setCollapsedPaths(new Set());
  }, []);

  // 全部收起
  const handleCollapseAll = useCallback(() => {
    setCollapsedPaths(new Set(allDirPaths));
  }, [allDirPaths]);

  if (filePaths.length === 0) {
    return <p className="text-xs text-ink-faint py-6 text-center">暂无文件列表信息</p>;
  }

  const isAllCollapsed = allDirPaths.size > 0 && collapsedPaths.size === allDirPaths.size;

  return (
    <div className={`space-y-2 ${className}`}>
      {/* 顶部工具栏（文件较多时展示搜索框与折叠工具） */}
      <div className="flex items-center gap-2">
        {filePaths.length > 12 && (
          <div className="relative flex-1">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
            />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`搜索 ${filePaths.length} 个文件...`}
              className="w-full h-7 pl-7 pr-2.5 text-xs rounded-lg border border-paper-grid bg-paper/60 text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent"
            />
          </div>
        )}

        {/* 一键全部展开 / 全部收起按钮（有目录时展示） */}
        {allDirPaths.size > 0 && (
          <button
            type="button"
            onClick={isAllCollapsed ? handleExpandAll : handleCollapseAll}
            title={isAllCollapsed ? '全部展开所有文件夹' : '全部折叠所有文件夹'}
            className="h-7 px-2 flex items-center gap-1 text-[11px] text-ink-light hover:text-ink bg-paper/60 border border-paper-grid rounded-lg hover:bg-paper-grid/40 active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out shrink-0 ms-auto"
          >
            {isAllCollapsed ? (
              <>
                <ChevronsUpDown size={12} className="text-ink-faint" />
                <span>全部展开</span>
              </>
            ) : (
              <>
                <ChevronsDownUp size={12} className="text-ink-faint" />
                <span>全部折叠</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* 目录树展示区 */}
      <div
        className={`p-2.5 rounded-xl border border-paper-grid bg-paper/60 ${maxHeightClass} overflow-y-auto custom-scrollbar space-y-0.5`}
      >
        {displayTree.length > 0 ? (
          displayTree.map((node) => (
            <SkillTreeNodeItem
              key={node.path}
              node={node}
              depth={0}
              isCollapsed={activeCollapsedPaths.has(node.path)}
              filterKeyword={filter}
              onToggle={handleToggle}
              collapsedPaths={activeCollapsedPaths}
            />
          ))
        ) : (
          <p className="text-xs text-ink-faint py-4 text-center">未找到匹配的文件</p>
        )}
      </div>
    </div>
  );
};
