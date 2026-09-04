import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, FileText, ImagePlus, Loader2, Paperclip, Send, Square, X } from 'lucide-react';
import { useFeedback } from '../../../../platform/components/ui/FeedbackProvider';
import { authHeaders, handleUnauthorized } from '../../authUtils';
import { rankMentionFiles } from '../../utils/mentionMatch';
import {
  RASTER_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  fileToDataUrl,
  optimizeDataUrl,
} from '../../imageUpload';
import type { AgentFile } from '../../../../platform/types';

// 单轮最多附带的图片数（与后端透传上限保持一致）
const MAX_ATTACHMENTS = 4;

interface ChatNodeComposerProps {
  /** 节点执行模式：skill_agent + onUploadFile 时启用任意文件上传与 @ 引用 */
  mode?: 'llm' | 'agent' | 'skill_agent';
  /** 任意格式文件上传到工作区 inputs/ 的回调（返回工作区相对路径） */
  onUploadFile?: (file: File) => Promise<{ name: string; path: string; mime: string; size: number }>;
  /** 是否正在生成（禁用输入 / 上传） */
  isGenerating: boolean;
  /** 当前节点工作区 id（@ 引用检索文件列表） */
  workspaceId?: string | null;
  /** 发送一条用户消息（text 为空时仅带图） */
  onSend: (text: string, images?: string[]) => void;
  /** 停止当前生成 */
  onStop: () => void;
}

/** ChatNode 输入区：文本 + 附件（Skill Agent 模式为任意格式文件 → 工作区 inputs/，其他模式为图片 base64）
 *  支持拖拽文件到输入区（skill_agent = 任意格式，其他 = 图片校验），以及 @ 工作区文件引用检索。 */
export const ChatNodeComposer: React.FC<ChatNodeComposerProps> = ({
  mode,
  onUploadFile,
  isGenerating,
  workspaceId,
  onSend,
  onStop,
}) => {
  const [draft, setDraft] = useState('');
  // 本轮待发送的图片附件（data URL），随消息发送后在气泡内展示
  const [attachments, setAttachments] = useState<string[]>([]);
  // Skill Agent 模式已上传的文件 chips（路径已插入草稿文本；chips 仅展示/移除用）
  const [fileAttachments, setFileAttachments] = useState<{ name: string; path: string }[]>([]);
  // @ 文件引用检索状态（Skill Agent 模式；见 handleDraftChange / handleKeyDown）
  const [mention, setMention] = useState<{
    start: number;
    query: string;
    index: number;
    files: AgentFile[];
    loading: boolean;
    failed: boolean;
  } | null>(null);
  /** @ 检索文件列表缓存（key = workspaceId；上传新文件后失效） */
  const mentionFileCacheRef = useRef<Map<string, AgentFile[]>>(new Map());
  /** Skill Agent 模式：启用任意文件上传 + @ 引用（其他模式保持图片 base64 行为） */
  const skillAgentFiles = mode === 'skill_agent' && !!onUploadFile;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { showToast } = useFeedback();
  // 拖拽上传：文件拖入输入区高亮；dragenter/leave 成对计数防闪烁
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '36px';
      if (draft) {
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      }
    }
  }, [draft]);

  /** 选择并处理附件图片（格式 / 体积校验 + 压缩），追加到附件列表 */
  const handleAttachFile = async (file: File) => {
    if (!RASTER_IMAGE_TYPES.includes(file.type)) {
      showToast('请选择 PNG / JPG / WebP / GIF 格式的图片', { type: 'error' });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      showToast('图片大小不能超过 8MB', { type: 'error' });
      return;
    }
    try {
      const raw = await fileToDataUrl(file);
      const stored = await optimizeDataUrl(raw, file.size);
      setAttachments((prev) => (prev.length < MAX_ATTACHMENTS ? [...prev, stored] : prev));
    } catch (e: any) {
      showToast(e?.message || '图片处理失败，请重试', { type: 'error' });
    }
  };

  /** 把一段文本插入草稿的光标位置（焦点留在插入末尾；用于文件路径补全）。
   *  函数式更新 + 实时读取光标：连续多文件选中时避免陈旧闭包互相覆盖。 */
  const insertIntoDraft = (insert: string) => {
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? draft.length;
    setDraft((d) => d.slice(0, cursor) + insert + ' ' + d.slice(cursor));
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const pos = cursor + insert.length + 1;
      ta.setSelectionRange(pos, pos);
    });
  };

  /** Skill Agent 模式：上传任意文件到工作区 inputs/，路径插入草稿并展示 chip */
  const pickUploadFile = async (file: File) => {
    if (!onUploadFile) return;
    try {
      const info = await onUploadFile(file);
      if (!info || !info.path) return;
      setFileAttachments((prev) =>
        prev.some((a) => a.path === info.path) ? prev : [...prev, { name: info.name, path: info.path }]
      );
      if (workspaceId) mentionFileCacheRef.current.delete(workspaceId);
      insertIntoDraft(info.path);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '文件上传失败，请重试', { type: 'error' });
    }
  };

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // 允许重复选择同一文件
    if (files.length === 0) return;
    if (skillAgentFiles) {
      files.forEach((f) => void pickUploadFile(f));
      return;
    }
    files.slice(0, MAX_ATTACHMENTS - attachments.length).forEach((f) => void handleAttachFile(f));
  };

  /** 拖入的文件统一走与「选择文件」相同的通道（skill_agent = 任意格式上传，其他 = 图片校验） */
  const ingestFiles = (files: File[]) => {
    if (isGenerating) {
      showToast('回复生成中，请稍后再上传', { type: 'error' });
      return;
    }
    if (skillAgentFiles) {
      files.forEach((f) => void pickUploadFile(f));
      return;
    }
    files.slice(0, MAX_ATTACHMENTS - attachments.length).forEach((f) => void handleAttachFile(f));
  };

  const isFileDrag = (e: React.DragEvent): boolean =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files');

  const handleDragEnter = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setDragOver(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) ingestFiles(files);
  };

  const handleSend = () => {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || isGenerating) return;
    onSend(text, attachments.length ? attachments : undefined);
    setDraft('');
    setAttachments([]);
    setFileAttachments([]);
    setMention(null);
  };

  /** 移除已上传文件 chip，同时从草稿文本删除对应的路径片段 */
  const removeFileAttachment = (path: string) => {
    setFileAttachments((prev) => prev.filter((a) => a.path !== path));
    setDraft((d) => {
      const idx = d.indexOf(path);
      if (idx < 0) return d;
      let end = idx + path.length;
      if (d[end] === ' ' || d[end] === '\n') end += 1;
      return d.slice(0, idx) + d.slice(end);
    });
  };

  /** 拉取当前工作区文件列表（含 inputs/ 上传文件）供 @ 引用检索；结果按工作区缓存 */
  const loadMentionFiles = useCallback(async (ws: string) => {
    const cached = mentionFileCacheRef.current.get(ws);
    if (cached) {
      setMention((m) => (m ? { ...m, files: cached, loading: false, failed: false, index: 0 } : m));
      return;
    }
    setMention((m) => (m ? { ...m, loading: true, failed: false } : m));
    try {
      const resp = await fetch(
        `/api/modules/bookplate/chat/files?workspace_id=${encodeURIComponent(ws)}&include_inputs=1`,
        { headers: authHeaders() }
      );
      if (resp.status === 401) {
        handleUnauthorized();
        throw new Error('401');
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { files?: AgentFile[] };
      const files = (data.files ?? []).filter((f) => f.exists !== false);
      mentionFileCacheRef.current.set(ws, files);
      setMention((m) => (m ? { ...m, files, loading: false, failed: false, index: 0 } : m));
    } catch {
      setMention((m) => (m ? { ...m, loading: false, failed: true } : m));
    }
  }, []);

  /** 草稿变化时探测 @ 触发：最近一个 @ 后无空白 → 打开检索，query = @ 后已输入内容 */
  const handleDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft(value);
    if (!skillAgentFiles || !workspaceId || isGenerating) {
      setMention(null);
      return;
    }
    const cursor = e.target.selectionStart;
    const before = value.slice(0, cursor);
    const atIdx = before.lastIndexOf('@');
    if (atIdx < 0 || /\s/.test(before.slice(atIdx + 1))) {
      setMention(null);
      return;
    }
    const query = before.slice(atIdx + 1);
    if (mention && mention.start === atIdx) {
      setMention((m) => (m ? { ...m, query, index: 0 } : m));
    } else {
      setMention({ start: atIdx, query, index: 0, files: [], loading: true, failed: false });
      void loadMentionFiles(workspaceId);
    }
  };

  // 模糊匹配（子序列 + 连续/前缀加分）后的 @ 候选列表（纯函数见 utils/mentionMatch）
  const mentionMatches = useMemo(() => {
    if (!mention) return [];
    return rankMentionFiles(mention.files, mention.query);
  }, [mention]);

  /** 以候选列表第 idx 项补全（替换 @ 及其后已输入内容） */
  const completeMentionAt = (idx: number) => {
    if (!mention) return;
    const pick = mentionMatches[idx];
    if (!pick) {
      setMention(null);
      return;
    }
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? draft.length;
    const next = draft.slice(0, mention.start) + pick.path + ' ' + draft.slice(cursor);
    setDraft(next);
    setMention(null);
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const pos = mention.start + pick.path.length + 1;
      ta.setSelectionRange(pos, pos);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // @ 检索打开时：方向键切换、Enter/Tab 补全、Esc 关闭（Enter 不再发送）
    if (mention) {
      if (mentionMatches.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMention({ ...mention, index: (mention.index + 1) % mentionMatches.length });
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMention({
            ...mention,
            index: (mention.index - 1 + mentionMatches.length) % mentionMatches.length,
          });
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          completeMentionAt(Math.min(mention.index, mentionMatches.length - 1));
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        // 无候选（加载中/无匹配）：关闭提示并继续发送
        setMention(null);
        handleSend();
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // @ 检索弹层锚点：textarea 上方（portal 到 body，避免被节点滚动容器裁剪）
  const mentionAnchor = useMemo(() => {
    if (!mention) return null;
    const ta = textareaRef.current;
    if (!ta) return null;
    const r = ta.getBoundingClientRect();
    return { left: r.left, top: r.top - 6, width: r.width };
  }, [mention]);
  const effMentionIndex = mention ? Math.min(mention.index, Math.max(0, mentionMatches.length - 1)) : 0;

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative shrink-0 mt-2 pt-2 border-t border-solid transition-colors ${
        dragOver
          ? 'border-accent/60 bg-accent/5 rounded-lg'
          : 'border-black/5 dark:border-white/5'
      }`}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-paper/85 backdrop-blur-sm text-accent text-xs font-sans font-medium">
          {skillAgentFiles ? '松开以上传文件（任意格式）' : '松开以附带图片'}
        </div>
      )}
      {skillAgentFiles ? (
        fileAttachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {fileAttachments.map((a) => (
              <div
                key={a.path}
                className="group flex items-center gap-1 max-w-[190px] rounded-md border border-paper-grid/70 bg-paper-grid/20 pl-2 pr-1 py-0.5"
              >
                <FileText size={11} strokeWidth={1.75} className="shrink-0 text-accent" />
                <span
                  className="truncate text-[10.5px] font-sans text-ink-light"
                  title={`${a.path}（已写入输入框）`}
                >
                  {a.name}
                </span>
                <button
                  type="button"
                  onClick={() => removeFileAttachment(a.path)}
                  disabled={isGenerating}
                  aria-label={`移除附件 ${a.name}`}
                  title="移除文件"
                  className="shrink-0 flex items-center justify-center w-5 h-5 -mr-0.5 rounded text-ink-faint hover:text-error hover:bg-error/10 active:scale-[0.96] transition-[color,background-color,transform] duration-150 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-error"
                >
                  <X size={10} strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>
        )
      ) : (
        attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {attachments.map((img, i) => (
              <div
                key={i}
                className="relative group w-11 h-11 rounded-md overflow-hidden border border-paper-grid bg-paper"
              >
                <img
                  src={img}
                  alt={`附件 ${i + 1}`}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  disabled={isGenerating}
                  aria-label={`移除附件图片 ${i + 1}`}
                  title="移除图片"
                  className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-5 h-5 rounded-full bg-paper border border-paper-grid shadow-xs text-ink-faint hover:text-error hover:border-error/40 active:scale-[0.96] transition-[color,background-color,border-color,transform] duration-150 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-error"
                >
                  <X size={10} strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>
        )
      )}
      {/* @ 工作区文件引用检索弹层（portal 到 body，锚定在输入框上方） */}
      {mention && mentionAnchor && typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed z-[9999]" style={{ left: mentionAnchor.left, top: mentionAnchor.top, width: mentionAnchor.width }}>
            <div className="pop-enter-anim overflow-hidden rounded-lg border border-paper-grid bg-paper shadow-xl">
              <div className="max-h-56 overflow-y-auto custom-scrollbar py-1">
                {mention.loading && mentionMatches.length === 0 ? (
                  <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-sans text-ink-faint">
                    <Loader2 size={12} className="animate-spin" /> 加载工作区文件…
                  </div>
                ) : mention.failed && mentionMatches.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] font-sans text-error">工作区文件加载失败</div>
                ) : mentionMatches.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] font-sans text-ink-faint">无匹配文件</div>
                ) : (
                  mentionMatches.map((f, i) => (
                    <button
                      key={f.path}
                      type="button"
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => completeMentionAt(i)}
                      onMouseEnter={() => setMention((m) => (m ? { ...m, index: i } : m))}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                        i === effMentionIndex ? 'bg-accent/10' : 'hover:bg-paper-grid/40'
                      }`}
                    >
                      <FileText size={12} strokeWidth={1.75} className="shrink-0 text-accent" />
                      <span className="flex-1 min-w-0">
                        <span
                          className={`block truncate text-[11.5px] font-sans leading-tight ${
                            i === effMentionIndex ? 'text-accent' : 'text-ink'
                          }`}
                        >
                          {f.name}
                        </span>
                        <span className="block truncate text-[9.5px] font-mono text-ink-faint leading-tight mt-0.5">
                          {f.path}
                        </span>
                      </span>
                      {i === effMentionIndex && <ChevronDown size={10} strokeWidth={2} className="shrink-0 text-accent rotate-180" />}
                    </button>
                  ))
                )}
              </div>
              <div className="border-t border-dashed border-paper-grid/50 px-3 py-1 text-[9px] font-sans text-ink-faint">
                Tab / Enter 补全 · ↑↓ 选择 · Esc 关闭
              </div>
            </div>
          </div>,
          document.body
        )}
      <div className="relative flex items-end gap-1.5">
        <input
          ref={fileInputRef}
          type="file"
          accept={skillAgentFiles ? undefined : 'image/png,image/jpeg,image/webp,image/gif'}
          multiple
          className="hidden"
          onChange={handlePick}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isGenerating}
          aria-label={
            skillAgentFiles
              ? '上传文件到工作区（任意格式）'
              : attachments.length >= MAX_ATTACHMENTS
                ? `最多附带 ${MAX_ATTACHMENTS} 张图片`
                : '附带图片'
          }
          title={
            skillAgentFiles
              ? '上传文件到工作区（任意格式）'
              : attachments.length >= MAX_ATTACHMENTS
                ? `最多附带 ${MAX_ATTACHMENTS} 张图片`
                : '附带图片'
          }
          className="flex shrink-0 items-center justify-center w-9 h-9 rounded-lg border border-paper-grid/70 text-ink-faint hover:text-accent hover:border-accent/40 hover:bg-accent/5 active:scale-[0.96] transition-[color,background-color,border-color,transform] duration-150 ease-out disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {skillAgentFiles ? <Paperclip size={15} strokeWidth={2} /> : <ImagePlus size={15} strokeWidth={2} />}
        </button>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={handleDraftChange}
          onKeyDown={handleKeyDown}
          disabled={isGenerating}
          rows={1}
          placeholder={
            isGenerating
              ? '回复生成中…'
              : skillAgentFiles
                ? '输入消息，@ 引用工作区文件，Enter 发送'
                : '输入消息，Enter 发送，Shift+Enter 换行'
          }
          className="flex-1 min-w-0 min-h-[36px] max-h-32 overflow-y-auto resize-none rounded-lg border border-paper-grid/70 bg-node-bg px-3 py-1.5 text-sm font-sans text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-[border-color,box-shadow] duration-150 disabled:opacity-60 [text-wrap:pretty]"
        />
        {isGenerating ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="停止生成"
            title="停止生成"
            className="flex shrink-0 items-center justify-center w-9 h-9 rounded-lg border border-error/30 bg-error/5 text-error hover:bg-error/10 active:scale-[0.96] transition-[color,background-color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
          >
            <Square size={14} strokeWidth={2} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!draft.trim() && attachments.length === 0}
            aria-label="发送消息 (Enter)"
            title="发送 (Enter)"
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-accent text-white shadow-xs hover:bg-accent/90 active:scale-[0.96] transition-[background-color,transform] duration-150 ease-out disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Send size={15} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
};