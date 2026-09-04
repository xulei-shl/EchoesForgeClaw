import { useState } from 'react';
import {
  ChevronDown,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { NodeSideDrawer } from '../../../../platform/components/node/NodeSideDrawer';
import { useFeedback } from '../../../../platform/components/ui/FeedbackProvider';
import { FilePreviewModal } from '../FilePreviewModal';
import { authHeaders } from '../../authUtils';
import { sortWorkspaceFilesByTime, WORKSPACE_FILE_CATEGORIES } from '../../workspaceFiles';
import type { AgentFile } from '../../../../platform/types';

/** 工作区产物 / 上传面板（skill_agent + FastClaw agent 模式共用；数据由宿主从服务端拉取） */
export interface ChatWorkspaceFilesPanel {
  open: boolean;
  loading: boolean;
  files: AgentFile[];
  onToggle: () => void;
  onRefresh: () => void;
}

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

/** 行元信息：大小 · 时间（任一缺失时只展示另一项） */
function fileMetaLine(file: AgentFile): string {
  const parts: string[] = [];
  if (file.size > 0) parts.push(formatFileSize(file.size));
  const time = formatFileTime(file.mtimeMs);
  if (time) parts.push(time);
  return parts.join(' · ');
}

/** 带鉴权下载文件（skill-files / fastclaw-files 接口要求登录鉴权，统一 fetch → blob → 触发保存）。 */
async function downloadAgentFile(file: AgentFile): Promise<void> {
  const resp = await fetch(file.url, { headers: authHeaders() });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 工作区文件入口条（节点底部，输入区上方）：点击展开/收起右侧吸附抽屉。
 * 收起态不占高度，展开态以 accent 高亮 + chevron 旋转表达抽屉开合。
 */
export const WorkspaceFilesTrigger: React.FC<{ panel: ChatWorkspaceFilesPanel }> = ({ panel }) => {
  const total = panel.files.length;
  return (
    <div className="shrink-0 mt-1.5 flex items-center gap-1.5">
      <button
        type="button"
        onClick={panel.onToggle}
        title={panel.open ? '收起工作区文件抽屉' : '展开工作区文件抽屉'}
        className={`flex items-center gap-1.5 text-[11px] font-sans transition-colors cursor-pointer select-none ${
          panel.open ? 'text-accent font-medium' : 'text-ink-faint hover:text-accent'
        }`}
      >
        <FolderOpen size={12} strokeWidth={2} />
        <span>工作区文件{total > 0 ? ` (${total})` : ''}</span>
        <ChevronDown size={11} strokeWidth={2} className={panel.open ? 'rotate-180' : ''} />
      </button>
      {panel.loading && <Loader2 size={10} className="animate-spin text-ink-faint" />}
    </div>
  );
};

/**
 * 工作区文件侧边吸附抽屉（挂在 CanvasNode 的 sideDrawer 插槽，见 docs/节点侧边吸附抽屉使用指南.md）：
 * - 类别 Tab 常驻展示（当前 = 工作区产物 / 我的上传），无论是否有文件都可见：
 *   有文件的类别可切换，空类别置灰不可点，始终让「上传 / 产物」归属一目了然；
 *   Tab 来自 WORKSPACE_FILE_CATEGORIES 注册表，后续新增类别只需往注册表追加一条，自动扩展；
 * - 列表按文件修改时间倒序（最新在前），无时间戳来源（FastClaw）保持原相对顺序；
 * - 图片与其它文件一律以「文件名行」展示，点击行打开统一预览弹层（FilePreviewModal，
 *   图片 / 文本 / PDF 内联预览，二进制给下载引导），不再内联渲染缩略图。
 */
export const WorkspaceFilesDrawer: React.FC<{ panel: ChatWorkspaceFilesPanel }> = ({ panel }) => {
  const { showToast } = useFeedback();
  const [activeTabId, setActiveTabId] = useState<string>(WORKSPACE_FILE_CATEGORIES[0]!.id);
  const [previewFile, setPreviewFile] = useState<AgentFile | null>(null);

  // 全量类别分桶（含空桶）：Tab 常驻展示全部类别（计数含 0）；
  // 激活 Tab = 用户所选且非空，否则回退到第一个非空类别（无文件时为 undefined）
  const buckets = WORKSPACE_FILE_CATEGORIES.map((category) => ({
    category,
    files: panel.files.filter(category.matches),
  }));
  const activeTab =
    buckets.find((b) => b.category.id === activeTabId && b.files.length > 0) ??
    buckets.find((b) => b.files.length > 0);

  const handleDownload = async (file: AgentFile) => {
    try {
      await downloadAgentFile(file);
    } catch {
      showToast('文件下载失败，请重试', { type: 'error' });
    }
  };

  const headerExtra = (
    <button
      type="button"
      onClick={panel.onRefresh}
      disabled={panel.loading}
      title="刷新文件列表"
      aria-label="刷新文件列表"
      className="flex items-center justify-center w-6 h-6 rounded-md text-ink-faint hover:text-accent hover:bg-accent/10 active:scale-95 transition disabled:opacity-40 cursor-pointer"
    >
      <RefreshCw size={12} strokeWidth={2} className={panel.loading ? 'animate-spin' : ''} />
    </button>
  );

  return (
    <>
      <NodeSideDrawer
        isOpen={panel.open}
        onClose={panel.onToggle}
        title="工作区文件"
        icon={<FolderOpen size={14} strokeWidth={1.75} />}
        headerExtra={headerExtra}
        width={300}
      >
        <div className="flex flex-col min-h-0">
          {/* 类别胶囊 Tab：常驻展示全部类别；空类别置灰禁用（仍可见计数 0） */}
          <div className="shrink-0 flex items-center gap-1 p-0.5 rounded-lg bg-paper-grid/30 border border-paper-grid/50 mb-2">
            {buckets.map(({ category, files }) => {
              const disabled = files.length === 0;
              const isActive = category.id === activeTab?.category.id;
              return (
                <button
                  key={category.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setActiveTabId(category.id)}
                  title={disabled ? `${category.label}暂无文件` : undefined}
                  className={`flex-1 px-2 py-1 rounded-md text-[11px] font-sans transition select-none ${
                    isActive
                      ? 'bg-paper text-accent shadow-2xs font-medium'
                      : disabled
                        ? 'text-ink-faint/60 cursor-not-allowed'
                        : 'text-ink-light hover:text-ink cursor-pointer'
                  }`}
                >
                  {category.label} ({files.length})
                </button>
              );
            })}
          </div>

          {/* 列表主体：加载 / 空态 / 按时间倒序的行列表 */}
          {panel.loading && !panel.files.length ? (
            <div className="flex items-center gap-1.5 text-[11px] font-sans text-ink-faint py-3">
              <Loader2 size={12} className="animate-spin" /> 加载中…
            </div>
          ) : !panel.files.length ? (
            <p className="text-[11px] font-sans text-ink-faint py-3">暂无文件</p>
          ) : activeTab ? (
            <div className="flex flex-col gap-1">
              {sortWorkspaceFilesByTime(activeTab.files).map((f) => (
                <WorkspaceFileRow key={f.url || f.path} file={f} onPreview={setPreviewFile} />
              ))}
            </div>
          ) : null}
        </div>
      </NodeSideDrawer>

      {/* 行点击 → 统一预览弹层（portal 到 body，图片同样以文件名行进入此处） */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
          onDownload={handleDownload}
        />
      )}
    </>
  );
};

/** 单个文件列表行：图标 + 文件名 + 元信息（大小 · 时间）；点击整行打开预览。 */
const WorkspaceFileRow: React.FC<{
  file: AgentFile;
  onPreview: (file: AgentFile) => void;
}> = ({ file, onPreview }) => {
  const isImage = IMAGE_EXT_RE.test(file.name);
  const meta = fileMetaLine(file);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onPreview(file)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPreview(file);
        }
      }}
      title={`预览 ${file.name}`}
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-paper-grid/60 bg-paper-grid/20 text-xs font-sans cursor-pointer hover:border-accent/40 hover:bg-accent/5 transition select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      {isImage ? (
        <ImageIcon size={14} className="shrink-0 text-accent" />
      ) : (
        <FileText size={14} className="shrink-0 text-accent" />
      )}
      <span className="flex flex-col min-w-0 flex-1 leading-tight">
        <span className="truncate text-ink font-medium" title={file.path || file.name}>
          {file.name}
        </span>
        {meta && <span className="truncate text-[10px] text-ink-faint">{meta}</span>}
      </span>
    </div>
  );
};
