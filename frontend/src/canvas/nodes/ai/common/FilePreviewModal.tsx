import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Image as ImageIcon, Loader2, Music, Video, X, Download } from 'lucide-react';
import { Streamdown, cjk, code } from '../../../../shared/utils/markdown';
import { normalizeMarkdown } from '../../../../shared/utils/normalizeMarkdown';
import type { AgentFile } from '../../../../shared/types';
import { authHeaders } from '../infra/authUtils';

/**
 * 工作区文件内联预览弹层（portal 到 body）：
 * - markdown（md/markdown）→ fetch → streamdown 渲染（React 渲染 + shiki 高亮，无 HTML 注入面）
 * - 文本类（txt/json/csv/代码等）→ fetch → 文本截断渲染（React 转义）
 * - PDF → fetch → blob URL → <iframe> 走浏览器原生查看器
 * - 图片类 → fetch → blob URL → <img> 居中预览
 * - 音频 / 视频 → fetch → blob URL → <audio>/<video> 原生播放器（超大体积累退化为下载卡）
 * - 其余格式 → 提示不支持预览（保留下载按钮）
 * skill-files 接口需要鉴权头，<img>/<iframe>/<audio>/<video> 无法携带，统一 fetch → blob → objectURL。
 */

/** 图片类可预览扩展名（走 fetch → blob → <img> 预览） */
const IMAGE_PREVIEW_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

/** 音频类可预览扩展名（走 fetch → blob → <audio controls>；浏览器原生播放） */
const AUDIO_PREVIEW_EXTS = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba']);

/** 视频类可预览扩展名（走 fetch → blob → <video controls>；浏览器原生播放） */
const VIDEO_PREVIEW_EXTS = new Set(['mp4', 'webm', 'm4v', 'ogv', 'mov']);

/** 文本类可预览扩展名（其余按二进制处理） */
const TEXT_PREVIEW_EXTS = new Set([
  'txt',
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

/** 媒体内联预览体积上限：blob 全量缓冲（objectURL 无 HTTP Range 流式），超大音视频退化为下载卡 */
const MAX_MEDIA_PREVIEW_BYTES = 50 * 1024 * 1024;

export type PreviewKind = 'markdown' | 'text' | 'pdf' | 'image' | 'audio' | 'video' | 'binary';

export function previewKindOf(file: AgentFile): PreviewKind {
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_PREVIEW_EXTS.has(ext)) return 'image';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (AUDIO_PREVIEW_EXTS.has(ext) || VIDEO_PREVIEW_EXTS.has(ext)) {
    // 已知 size 超过阈值（正文提取来源 size=0 视为未知，走预览）→ 退化下载卡
    if (file.size > MAX_MEDIA_PREVIEW_BYTES) return 'binary';
    return AUDIO_PREVIEW_EXTS.has(ext) ? 'audio' : 'video';
  }
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
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
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
        if (kind === 'pdf' || kind === 'image' || kind === 'audio' || kind === 'video') {
          createdUrl = URL.createObjectURL(blob);
          setBlobUrl(createdUrl);
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
      if (e.key === 'Escape') {
        // 拦截冒泡到 window 级监听：弹层优先于外层 NodeSideDrawer 的 Esc 收抽屉
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const truncated = (kind === 'text' || kind === 'markdown') && text.length >= MAX_PREVIEW_CHARS;
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

  // 头部图标随预览类型区分（image/audio/video/markdown 各用专属图标，其余回落 FileText）
  const HeaderIcon =
    kind === 'image' ? ImageIcon : kind === 'audio' ? Music : kind === 'video' ? Video : FileText;

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
          <HeaderIcon size={14} strokeWidth={1.75} className="shrink-0 text-accent" />
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
          ) : kind === 'image' && blobUrl ? (
            <div className="h-full flex items-center justify-center p-4 bg-paper-grid/10">
              <img
                src={blobUrl}
                alt={file.name}
                className="max-h-full max-w-full object-contain drop-shadow-md select-none"
              />
            </div>
          ) : kind === 'pdf' && blobUrl ? (
            <iframe
              src={blobUrl}
              title={file.name}
              className="w-full h-full bg-paper"
            />
          ) : kind === 'audio' && blobUrl ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 p-6 bg-paper-grid/10">
              <Music size={36} strokeWidth={1.25} className="text-ink-faint" />
              <audio controls src={blobUrl} className="w-full max-w-md" preload="metadata">
                您的浏览器不支持音频播放，请下载后查看
              </audio>
            </div>
          ) : kind === 'video' && blobUrl ? (
            <div className="h-full flex items-center justify-center p-4 bg-paper-grid/10">
              <video
                controls
                src={blobUrl}
                className="max-h-full max-w-full object-contain rounded-lg select-none"
                preload="metadata"
              >
                您的浏览器不支持视频播放，请下载后查看
              </video>
            </div>
          ) : kind === 'markdown' ? (
            <div className="h-full overflow-y-auto custom-scrollbar">
              <div className="p-3 text-sm leading-relaxed font-sans text-ink select-text min-h-full">
                <Streamdown
                  plugins={{ cjk, code }}
                  isAnimating={false}
                  caret="block"
                  linkSafety={{ enabled: false }}
                >
                  {normalizeMarkdown(text)}
                </Streamdown>
                {truncated && (
                  <span className="block mt-2 text-[10px] text-ink-faint border-t border-dashed border-paper-grid pt-2">
                    内容过长，仅展示前 {MAX_PREVIEW_CHARS.toLocaleString()} 字符，请下载查看完整文件
                  </span>
                )}
              </div>
            </div>
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