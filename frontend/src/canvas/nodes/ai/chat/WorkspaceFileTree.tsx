import { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Lock,
  Trash2,
} from 'lucide-react';
import type { AgentFile } from '../../../../shared/types';

/**
 * 工作区文件树（侧边抽屉文件 Tab 主体）：
 * - 输入 AgentFile[]（path 为工作区相对路径，正斜杠口径），按路径段构建目录树；
 * - 目录行可展开/收起（默认全展开；defaultCollapsed = 初始收起全部目录）；排序：目录在前、文件在后，同级按名称字典序（zh-CN），
 *  无 mtime 来源（FastClaw）同样稳定；
 * - 叶子行点击 → FilePreviewModal 预览；可选项：
 *   - onDelete：行内删除按钮（stopPropagation，不触发行点击）；批量选择态/删除中隐藏
 *   - selectable + selectedKeys + onToggleSelect：批量选择态，行点击 = 勾选切换，暂停预览/删除
 *   - previewable=false 的叶子（密钥文件 .env* / .pi-agent 配置 / 指向工作区外的软链）：锁图标 + 禁点提示
 *   - isDir=true 的条目（目录软链占位）：显示为「链接」文件夹节点，不穿透目标内容
 * - 「全部文件」Tab 不传 onDelete 且禁止进入选择态 ⇒ 只读（含不可预览叶子与符号链接）；
 *   「AI 产物 / 我的上传」Tab 传 onDelete + 选择态，且数据源已过滤 previewable=false ⇒ 全可预览。
 */

/** 图片扩展名（行首图标区分；预览统一走 FilePreviewModal） */
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

/** 文件大小人类可读格式（B / KB / MB） */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 文件修改时间展示（本年省略年份：MM-DD HH:mm；跨年带年份），无时间戳返回空 */
function formatFileTime(mtimeMs?: number): string {
  if (!mtimeMs || !(mtimeMs > 0) || !Number.isFinite(mtimeMs)) return '';
  const d = new Date(mtimeMs);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date =
    d.getFullYear() === now.getFullYear()
      ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 文件行元信息：大小 · 时间（任一缺失时只展示另一项） */
function fileMetaLine(file: AgentFile): string {
  const parts: string[] = [];
  if (file.size > 0) parts.push(formatFileSize(file.size));
  const time = formatFileTime(file.mtimeMs);
  if (time) parts.push(time);
  return parts.join(' · ');
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
  file?: AgentFile;
  /** 条目本身是符号链接（目录软链占位 / 文件软链） */
  isLink?: boolean;
}

/** 由相对路径列表构建目录树（目录在前、文件在后，同级按名称字典序）。
 *  支持「目录软链占位」条目（file.isDir=true）：该条目自身成为目录节点（无子项），
 *  让符号链接目录名在树中可见而不穿透目标内容。 */
function buildTree(files: AgentFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const index = new Map<string, TreeNode>();
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of sorted) {
    const segs = f.path.split('/');
    let parent = root;
    let acc = '';
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]!;
      acc = acc ? `${acc}/${seg}` : seg;
      const isLast = i === segs.length - 1;
      const dirEntry = isLast && f.isDir === true;
      const needsDir = !isLast || dirEntry;
      let node = index.get(acc);
      if (!node) {
        node = {
          name: seg,
          path: acc,
          isDir: needsDir,
          children: needsDir ? [] : undefined,
          ...(isLast && f.link ? { isLink: true } : {}),
        };
        index.set(acc, node);
        parent.push(node);
      }
      if (isLast) {
        if (dirEntry) {
          node.isDir = true;
          node.children = node.children ?? [];
          node.isLink = !!f.link;
        } else {
          node.file = f;
          node.isDir = false;
          node.children = undefined;
          node.isLink = !!f.link;
        }
      } else {
        parent = node.children!;
      }
    }
  }
  const sortNodes = (nodes: TreeNode[]): void => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
    for (const n of nodes) if (n.children) sortNodes(n.children);
  };
  sortNodes(root);
  return root;
}

export const WorkspaceFileTree: React.FC<{
  files: AgentFile[];
  onPreview: (file: AgentFile) => void;
  /** 行内删除（缺省 = 只读，不展示删除按钮） */
  onDelete?: (file: AgentFile) => void;
  /** 批量选择态：行点击 = 勾选切换，暂停预览 / 行内删除，行首展示勾选框 */
  selectable?: boolean;
  selectedKeys?: ReadonlySet<string>;
  /** 批量删除进行中 / 单删中禁点 */
  busy?: boolean;
  /** 单个文件删除进行中（path 命中时行内删除按钮转加载态） */
  deletingPath?: string | null;
  /** 初始全折叠：初始收起全部目录（「全部文件」Tab 只读总览用；缺省 = 全展开） */
  defaultCollapsed?: boolean;
  onToggleSelect?: (file: AgentFile) => void;
}> = ({
  files,
  onPreview,
  onDelete,
  selectable = false,
  selectedKeys,
  busy = false,
  deletingPath = null,
  defaultCollapsed = false,
  onToggleSelect,
}) => {
  /** 已收起的目录路径集合；defaultCollapsed = 初始收起全部目录（「全部文件」总览），否则默认全展开 */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (!defaultCollapsed) return new Set();
    const all = new Set<string>();
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (!n.isDir) continue;
        all.add(n.path);
        if (n.children) walk(n.children);
      }
    };
    walk(buildTree(files));
    return all;
  });
  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderDir = (node: TreeNode, depth: number) => {
    const isCollapsed = collapsed.has(node.path);
    const pad = { paddingLeft: `${depth * 14 + 6}px` };
    return (
      <div key={node.path} className="flex flex-col">
        <button
          type="button"
          onClick={() => toggle(node.path)}
          aria-expanded={!isCollapsed}
          title={
            node.isLink
              ? `符号链接目录「${node.name}」：仅展示目录名，不穿透目标内容`
              : isCollapsed
                ? `展开 ${node.name}`
                : `收起 ${node.name}`
          }
          className="group flex items-center gap-1 w-full py-1 pr-2 rounded-md text-[11px] font-sans transition-[background-color,color] duration-150 ease-out motion-reduce:transition-none select-none cursor-pointer hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          style={pad}
        >
          {isCollapsed ? (
            <ChevronRight size={11} strokeWidth={2.25} className="shrink-0 text-ink-faint transition-transform duration-150 ease-out motion-reduce:transition-none" />
          ) : (
            <ChevronDown size={11} strokeWidth={2.25} className="shrink-0 text-ink-faint transition-transform duration-150 ease-out motion-reduce:transition-none" />
          )}
          {isCollapsed ? (
            <Folder size={13} className="shrink-0 text-ink-faint" />
          ) : (
            <FolderOpen size={13} className="shrink-0 text-accent" />
          )}
          <span className="truncate text-ink font-medium text-left">{node.name}</span>
          {node.isLink && <span className="shrink-0 text-[9px] text-ink-faint font-sans">链接</span>}
        </button>
        {!isCollapsed && node.children && (
          <div className="flex flex-col">{node.children.map((c) => (c.isDir ? renderDir(c, depth + 1) : renderFile(c, depth + 1)))}</div>
        )}
      </div>
    );
  };

  const renderFile = (node: TreeNode, depth: number) => {
    const file = node.file!;
    const canPreview = file.previewable !== false;
    const isImage = IMAGE_EXT_RE.test(file.name);
    const meta = fileMetaLine(file);
    const deleting = deletingPath === file.path;
    const selected = !!selectedKeys?.has(file.path || file.url);
    const pad = { paddingLeft: `${depth * 14 + 6}px` };
    const handleActivate = () => {
      if (busy) return;
      if (selectable) onToggleSelect?.(file);
      else if (canPreview) onPreview(file);
    };
    return (
      <div
        key={node.path}
        role="button"
        tabIndex={canPreview || selectable ? 0 : -1}
        aria-pressed={selectable ? selected : undefined}
        onClick={handleActivate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleActivate();
          }
        }}
        title={
          selectable
            ? selected
              ? '已选，点击取消勾选'
              : '点击勾选'
            : canPreview
              ? `预览 ${file.path}`
              : '密钥文件，仅展示名称与目录结构，内容不可预览'
        }
        className={`group flex items-center gap-1.5 w-full py-1 pr-2 rounded-md text-[11px] font-sans select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent transition-[background-color,color] duration-150 ease-out motion-reduce:transition-none ${
          selectable && selected
            ? 'bg-paper-grid/40 hover:bg-paper-grid/40 cursor-pointer'
            : canPreview || selectable
              ? 'cursor-pointer hover:bg-accent/5'
              : 'cursor-not-allowed hover:bg-transparent'
        }`}
        style={pad}
      >
        {selectable && (
          <span
            aria-hidden
            className={`shrink-0 flex items-center justify-center w-3.5 h-3.5 rounded border transition-[background-color,border-color,transform] duration-150 ease-out motion-reduce:transition-none ${
              selected ? 'bg-accent border-accent text-paper' : 'border-ink-light/50 bg-paper'
            }`}
          >
            {selected && <Check size={10} strokeWidth={3} />}
          </span>
        )}
        {!canPreview ? (
          <Lock size={13} className="shrink-0 text-ink-faint" />
        ) : isImage ? (
          <ImageIcon size={13} className="shrink-0 text-accent" />
        ) : (
          <FileText size={13} className="shrink-0 text-accent" />
        )}
        <span className="flex flex-col min-w-0 flex-1 leading-tight">
          <span
            className={`truncate text-left ${canPreview ? 'text-ink font-medium' : 'text-ink-faint'}`}
            title={file.path}
          >
            {node.name}
          </span>
          {meta && (
            <span className="truncate text-[10px] text-ink-faint/80 tabular-nums font-mono text-left">{meta}</span>
          )}
        </span>

        {/* 行内删除（stopPropagation：不触发行点击预览 / 勾选）；批量选择态与不可预览叶子下隐藏；桌面端 hover 显现 */}
        {onDelete && !selectable && canPreview && (
          <button
            type="button"
            disabled={busy || deleting}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(file);
            }}
            title="删除文件"
            aria-label={`删除 ${file.name}`}
            className={`shrink-0 flex items-center justify-center w-6 h-6 rounded-md text-ink-faint hover:text-error hover:bg-error/10 active:scale-[0.96] transition-[color,background-color,transform,opacity] duration-150 ease-out motion-reduce:transition-none disabled:opacity-40 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-error ${
              deleting
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-sm:opacity-100'
            }`}
          >
            {deleting ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Trash2 size={12} strokeWidth={2} />
            )}
          </button>
        )}
      </div>
    );
  };

  const root = buildTree(files);
  return <div className="flex flex-col gap-0.5">{root.map((n) => (n.isDir ? renderDir(n, 0) : renderFile(n, 0)))}</div>;
};