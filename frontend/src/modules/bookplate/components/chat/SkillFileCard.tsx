import { memo, useEffect, useState } from 'react';
import { Loader2, Download, Eye, ChevronDown, FileText } from 'lucide-react';
import { PhotoView, PhotoProvider } from 'react-photo-view';
import { useFeedback } from '../../../../platform/components/ui/FeedbackProvider';
import { FilePreviewModal, previewKindOf } from '../FilePreviewModal';
import { authHeaders } from '../../authUtils';
import type { AgentFile } from '../../../../platform/types';

/** 带鉴权获取 skill 执行产生的文件字节。
 *  skill-files 接口要求登录鉴权，<img> / <a href> 无法携带 Authorization 头，
 *  因此图片预览与文件下载统一走 fetch + token → blob → objectURL 路线。 */
async function fetchSkillFile(file: AgentFile): Promise<Blob> {
  const resp = await fetch(file.url, { headers: authHeaders() });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.blob();
}

/** 文件大小人类可读格式（B / KB / MB） */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 单个工作区产物文件卡片（图片缩略预览 / 文本·PDF 内联预览弹层 / 文档下载）。 */
export const SkillFileCard = memo(({ file }: { file: AgentFile }) => {
  const { showToast } = useFeedback();
  const [downloading, setDownloading] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);
  // 非图片且可内联预览（文本类 / PDF）：点击卡片或预览按钮打开弹层
  const canPreview = !isImage && previewKindOf(file) !== 'binary';

  useEffect(() => {
    if (!isImage) return;
    let active = true;
    let createdUrl: string | null = null;
    fetchSkillFile(file)
      .then((blob) => {
        if (!active) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [file.url, isImage]);

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const blob = await fetchSkillFile(file);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      showToast('文件下载失败，请重试', { type: 'error' });
    } finally {
      setDownloading(false);
    }
  };

  if (isImage) {
    return (
      <div className="group/file relative inline-block rounded-lg overflow-hidden border border-paper-grid shadow-sm bg-paper-grid/20">
        {blobUrl ? (
          <PhotoView src={blobUrl}>
            <img
              src={blobUrl}
              alt={file.name}
              className="max-h-36 max-w-[240px] object-cover cursor-zoom-in hover:opacity-90 transition"
              loading="lazy"
            />
          </PhotoView>
        ) : (
          <div className="w-24 h-24 flex items-center justify-center text-ink-faint">
            <Loader2 size={16} className="animate-spin" />
          </div>
        )}
        <button
          onClick={handleDownload}
          title={`下载 ${file.name}`}
          className="absolute right-1 bottom-1 p-1 rounded-md bg-paper/90 text-ink-light hover:text-accent opacity-0 group-hover/file:opacity-100 transition shadow-sm"
        >
          {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-paper-grid bg-paper-grid/20 text-xs font-sans max-w-[260px] ${
          canPreview ? 'cursor-pointer hover:border-accent/40 hover:bg-accent/5 transition' : ''
        }`}
        onClick={canPreview ? () => setPreviewOpen(true) : undefined}
        title={canPreview ? `预览 ${file.name}` : undefined}
      >
        <FileText size={14} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-ink font-medium leading-tight" title={file.name}>
            {file.name}
          </p>
          <p className="text-[10px] text-ink-faint mt-0.5">{formatFileSize(file.size)}</p>
        </div>
        {canPreview && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPreviewOpen(true);
            }}
            title={`预览 ${file.name}`}
            className="p-1 rounded text-ink-faint hover:text-accent transition"
          >
            <Eye size={12} />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            void handleDownload();
          }}
          title={`下载 ${file.name}`}
          className="p-1 rounded text-ink-faint hover:text-accent transition"
        >
          {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
        </button>
      </div>
      {previewOpen && (
        <FilePreviewModal
          file={file}
          onClose={() => setPreviewOpen(false)}
          onDownload={handleDownload}
        />
      )}
    </>
  );
});
SkillFileCard.displayName = 'SkillFileCard';

/** 可折叠的工作区文件分组（Agent 产物 / 我的上传），共享卡片渲染；空组整组隐藏。 */
export const WorkspaceFileGroup: React.FC<{
  title: string;
  files: AgentFile[];
  /** 展开态（产物默认开、上传默认收） */
  defaultOpen?: boolean;
  /** 来源微区分：上传组用 accent 圆点，产物组用中性圆点（分组本身已表达来源，颜色仅作辅助） */
  tone?: 'artifact' | 'upload';
}> = memo(({ title, files, defaultOpen = true, tone = 'artifact' }) => {
  const [open, setOpen] = useState(defaultOpen);
  if (files.length === 0) return null;
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[10px] font-sans text-ink-faint hover:text-accent transition-colors select-none"
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            tone === 'upload' ? 'bg-accent/70' : 'bg-ink-faint/40'
          }`}
        />
        <span>{title}</span>
        <span className="text-[9px] text-ink-faint/80">({files.length})</span>
        <ChevronDown size={10} strokeWidth={2} className={open ? 'rotate-180' : ''} />
      </button>
      {open && (
        <div className="mt-1 flex flex-wrap gap-2">
          <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
            {files.map((f) => (
              <SkillFileCard key={f.url || f.path} file={f} />
            ))}
          </PhotoProvider>
        </div>
      )}
    </div>
  );
});
WorkspaceFileGroup.displayName = 'WorkspaceFileGroup';