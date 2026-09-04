import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Loader2, X, Download } from 'lucide-react';
import type { AgentFile } from '../../../platform/types';
import { authHeaders } from '../authUtils';

/**
 * 工作区文件内联预览弹层（portal 到 body）：
 * - 文本类（txt/md/json/csv/代码等）→ fetch → 文本截断渲染（React 转义，无 HTML 注入面）
 * - PDF → fetch → blob URL → <iframe> 走浏览器原生查看器
 * - 其余格式 → 提示不支持预览（保留下载按钮）
 * skill-files 接口需要鉴权头，<iframe src> 无法携带，统一 fetch → blob → objectURL。
 */

/** 文本类可预览扩展名（其余按二进制处理） */
const TEXT_PREVIEW_EXTS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'csv',
  'tsv',
  'html',
  'htm',
  'xml',
  'log',
  'py',
  'js',
  'jsx',
  'ts',
  'tsx',
  'css',
  'scss',
  'less',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'sh',
  'bash',
  'bat',
  'cmd',
  'ps1',
  'sql',
]);

/** 预览展示的文本上限（字符）；超出截断并提示（避免大文件整读进渲染） */
const MAX_PREVIEW_CHARS = 100_000;

export function previewKindOf(file: AgentFile): 'text' | 'pdf' | 'binary' {
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  if (ext === 'pdf') return 'pdf';
  if (TEXT_PREVIEW_EXTS.has(ext)) return 'text';
  return 'binary';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const FilePreviewModal: React.FC<{
  file: AgentFile;
  onClose: () => void;
  onDownload: (file: AgentFile) => void;
}> = ({ file, onClose, onDownload }) => {
  const kind = previewKindOf(file);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(kind === 'binary' ? 'ready' : 'loading');
  const [text, setText] = useState('');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (kind === 'binary') return;
    let active = true;
    let createdUrl: string | null = null;
    (async () => {
      try {
        const resp = await fetch(file.url, { headers: authHeaders() });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        if (!active) return;
        if (kind === 'pdf') {
          createdUrl = URL.createObjectURL(blob);
          setPdfUrl(createdUrl);
        } else {
          setText((await blob.text()).slice(0, MAX_PREVIEW_CHARS));
        }
        setState('ready');
      } catch {
        if (active) setState('error');
      }
    })();
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [file.url, kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const truncated = kind === 'text' && text.length >= MAX_PREVIEW_CHARS;
  const fileSizeLabel = file.size > 0 ? formatFileSize(file.size) : '';

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await onDownload(file);
    } finally {
      setDownloading(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="pop-enter-anim flex flex-col w-full max-w-[720px] h-[80vh] rounded-xl border border-paper-grid bg-paper shadow-2xl overflow-hidden">
        {/* 头部：文件名 + 大小 + 下载/关闭 */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-paper-grid bg-paper-grid/20 shrink-0">
          <FileText size={14} strokeWidth={1.75} className="shrink-0 text-accent" />
          <div className="flex-1 min-w-0">
            <p className="truncate text-xs font-sans font-medium text-ink" title={file.path}>
              {file.name}
            </p>
            <p className="truncate text-[10px] font-mono text-ink-faint leading-tight">
              {file.path}
              {fileSizeLabel ? ` · ${fileSizeLabel}` : ''}
            </p>
          </div>
          <button
            onClick={handleDownload}
            disabled={downloading}
            title="下载文件"
            className="shrink-0 flex items-center justify-center w-7 h-7 rounded-md text-ink-faint hover:text-accent hover:bg-accent/10 transition disabled:opacity-40"
          >
            {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          </button>
          <button
            onClick={onClose}
            title="关闭 (Esc)"
            className="shrink-0 flex items-center justify-center w-7 h-7 rounded-md text-ink-faint hover:text-ink hover:bg-paper-grid/40 transition"
          >
            <X size={14} />
          </button>
        </div>
        {/* 内容区 */}
        <div className="flex-1 min-h-0">
          {kind === 'binary' ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-ink-faint px-6">
              <FileText size={28} strokeWidth={1.25} />
              <p className="text-xs font-sans">该格式暂不支持内联预览，请下载后查看</p>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 rounded-md border border-paper-grid px-3 py-1.5 text-[11px] font-sans text-ink-light hover:text-accent hover:border-accent/40 transition"
              >
                <Download size={11} /> 下载文件
              </button>
            </div>
          ) : state === 'loading' ? (
            <div className="h-full flex items-center justify-center gap-2 text-ink-faint text-xs font-sans">
              <Loader2 size={16} className="animate-spin" /> 加载预览…
            </div>
          ) : state === 'error' ? (
            <div className="h-full flex items-center justify-center text-error text-xs font-sans px-6 text-center">
              预览加载失败，请下载后查看
            </div>
          ) : kind === 'pdf' && pdfUrl ? (
            <iframe
              src={pdfUrl}
              title={file.name}
              className="w-full h-full bg-paper"
            />
          ) : kind === 'text' ? (
            <div className="h-full overflow-y-auto custom-scrollbar">
              <pre className="p-3 text-[11.5px] leading-relaxed font-mono text-ink whitespace-pre-wrap break-words select-text min-h-full">
                {text}
                {truncated && (
                  <span className="block mt-2 text-[10px] text-ink-faint border-t border-dashed border-paper-grid pt-2">
                    内容过长，仅展示前 {MAX_PREVIEW_CHARS.toLocaleString()} 字符，请下载查看完整文件
                  </span>
                )}
              </pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default FilePreviewModal;