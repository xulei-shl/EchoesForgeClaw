import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, ImagePlus, Loader2, Paperclip, Send, Square, X } from 'lucide-react';
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

/** @ 检索弹层定位数据（优先底对齐向上弹出，视口上方空间不足时自适应翻转） */
interface MentionAnchor {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  placement: 'top' | 'bottom';
}

interface TextSegment {
  text: string;
  isMention: boolean;
}

/**
 * 将输入框文本分词为普通文本与 @ 引用文件片段
 */
function parseMentionSegments(draft: string, referencedPaths: string[]): TextSegment[] {
  if (!draft) return [];

  // 收集有效的文件路径候选，按长度降序优先匹配长路径
  const validPaths = referencedPaths
    .map((p) => p.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  let regex: RegExp;
  if (validPaths.length > 0) {
    const escaped = validPaths.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    // 匹配可选 @ 前缀后跟已知文件名，或通用的 @文件名.扩展名
    regex = new RegExp(`(@?(?:${escaped})|@[a-zA-Z0-9_\\-\\./]+\\.[a-zA-Z0-9]+)`, 'g');
  } else {
    regex = /(@[a-zA-Z0-9_\\-\\./]+\\.[a-zA-Z0-9]+)/g;
  }

  const result: TextSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(draft)) !== null) {
    if (match.index > lastIndex) {
      result.push({ text: draft.slice(lastIndex, match.index), isMention: false });
    }
    result.push({ text: match[0], isMention: true });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < draft.length) {
    result.push({ text: draft.slice(lastIndex), isMention: false });
  }

  return result;
}

interface MentionRange {
  start: number;
  end: number;
  path: string;
}

/**
 * 获取当前光标命中的 @ 引用文件整体删除区间（原子删除）
 */
function getMentionDeletionRange(
  draft: string,
  cursor: number,
  referencedPaths: string[],
  isDeleteKey: boolean = false
): MentionRange | null {
  if (!draft || cursor < 0) return null;

  const validPaths = referencedPaths
    .map((p) => p.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  let regex: RegExp;
  if (validPaths.length > 0) {
    const escaped = validPaths.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    regex = new RegExp(`(@?(?:${escaped})|@[a-zA-Z0-9_\\-\\./]+\\.[a-zA-Z0-9]+)`, 'g');
  } else {
    regex = /(@[a-zA-Z0-9_\\-\\./]+\\.[a-zA-Z0-9]+)/g;
  }

  let match: RegExpExecArray | null;
  while ((match = regex.exec(draft)) !== null) {
    const tokenStart = match.index;
    const tokenEnd = tokenStart + match[0].length;
    const pathText = match[0].startsWith('@') ? match[0].slice(1) : match[0];

    // 若后方紧邻单个空格，则把尾随空格也纳入整体删除，保持输入框整洁
    const hasTrailingSpace = draft[tokenEnd] === ' ';
    const fullEnd = hasTrailingSpace ? tokenEnd + 1 : tokenEnd;

    if (isDeleteKey) {
      if (cursor === tokenStart) {
        return { start: tokenStart, end: fullEnd, path: pathText };
      }
    } else {
      // Backspace：光标在尾随空格之后、在文件名尾部、或落在文件名内部时，均整块删除
      if (
        (hasTrailingSpace && cursor === tokenEnd + 1) ||
        (cursor > tokenStart && cursor <= tokenEnd)
      ) {
        return { start: tokenStart, end: fullEnd, path: pathText };
      }
    }
  }

  return null;
}

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
  // 已引用的文件路径列表（驱动输入框高亮底衬渲染）
  const [referencedPaths, setReferencedPaths] = useState<string[]>([]);
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
  const backdropRef = useRef<HTMLDivElement>(null);
  const { showToast } = useFeedback();
  // 拖拽上传：文件拖入输入区高亮；dragenter/leave 成对计数防闪烁
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  // 解析输入框草稿中的常规文本与引用文件片段
  const mentionSegments = useMemo(
    () => parseMentionSegments(draft, referencedPaths),
    [draft, referencedPaths]
  );

  // 输入框滚动时，像素级同步背后的高亮底衬滚动
  const handleTextareaScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (backdropRef.current) {
      backdropRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

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
      setReferencedPaths((prev) => (prev.includes(info.path) ? prev : [...prev, info.path]));
      if (workspaceId) mentionFileCacheRef.current.delete(workspaceId);
      insertIntoDraft(`@${info.path}`);
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
    setReferencedPaths([]);
    setMention(null);
  };

  /** 移除已上传文件 chip，同时从草稿文本删除对应的路径片段 */
  const removeFileAttachment = (path: string) => {
    setFileAttachments((prev) => prev.filter((a) => a.path !== path));
    setReferencedPaths((prev) => prev.filter((p) => p !== path));
    setDraft((d) => {
      const target = d.includes(`@${path}`) ? `@${path}` : path;
      const idx = d.indexOf(target);
      if (idx < 0) return d;
      let end = idx + target.length;
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
      // include_agent_resources=1：装配资源（.pi-agent/skills、prompts，含子目录穿透）一并可检索
      const resp = await fetch(
        `/api/modules/bookplate/chat/files?workspace_id=${encodeURIComponent(ws)}&include_inputs=1&include_agent_resources=1`,
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

  /** 以候选列表第 idx 项补全（插入 @path 并保留 @ 前缀标识） */
  const completeMentionAt = (idx: number) => {
    if (!mention) return;
    const pick = mentionMatches[idx];
    if (!pick) {
      setMention(null);
      return;
    }
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? draft.length;
    const insert = `@${pick.path}`;
    const next = draft.slice(0, mention.start) + insert + ' ' + draft.slice(cursor);
    setDraft(next);
    setReferencedPaths((prev) => (prev.includes(pick.path) ? prev : [...prev, pick.path]));
    setMention(null);
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const pos = mention.start + insert.length + 1;
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

    // 引用文件原子删除：按 Backspace 或 Delete 时，若光标紧贴或处于引用文件名内部，整体删除整个文件名
    if (
      (e.key === 'Backspace' || e.key === 'Delete') &&
      !e.shiftKey &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey
    ) {
      const ta = textareaRef.current;
      if (ta && ta.selectionStart === ta.selectionEnd) {
        const cursor = ta.selectionStart;
        const target = getMentionDeletionRange(draft, cursor, referencedPaths, e.key === 'Delete');
        if (target) {
          e.preventDefault();
          const nextDraft = draft.slice(0, target.start) + draft.slice(target.end);
          setDraft(nextDraft);
          requestAnimationFrame(() => {
            if (!ta) return;
            ta.focus();
            ta.setSelectionRange(target.start, target.start);
          });
          if (!nextDraft.includes(target.path)) {
            setReferencedPaths((prev) => prev.filter((p) => p !== target.path));
          }
          return;
        }
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement | null>(null);

  // 计算 @ 检索弹层锚点：优先底对齐在输入框上方展开，视口上方空间不足时自适应翻转到下方
  const calcMentionAnchor = useCallback((): MentionAnchor | null => {
    const ta = textareaRef.current;
    if (!ta || typeof window === 'undefined') return null;
    const r = ta.getBoundingClientRect();
    // 弹层最小宽度 280px，防止在窄节点下内容折叠拥挤，同时不超过视口边界
    const width = Math.min(Math.max(r.width, 280), Math.max(280, window.innerWidth - 24));
    // 保证横向对齐输入框且不超出视口左右安全距离
    const left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12));
    const spaceAbove = r.top;
    const spaceBelow = window.innerHeight - r.bottom;

    // 优先底对齐向上弹出；若视口上方空间不足（< 160px）且下方空间更充裕，则翻转到输入框下方
    if (spaceAbove < 160 && spaceBelow > spaceAbove) {
      return {
        left,
        width,
        top: r.bottom + 8,
        maxHeight: Math.max(120, Math.min(224, spaceBelow - 24)),
        placement: 'bottom',
      };
    }

    return {
      left,
      width,
      bottom: window.innerHeight - r.top + 8,
      maxHeight: Math.max(120, Math.min(224, spaceAbove - 24)),
      placement: 'top',
    };
  }, []);

  const [mentionAnchor, setMentionAnchor] = useState<MentionAnchor | null>(null);

  // 监听输入高度变动、视口缩放与画布滚动，实时对齐弹层位置
  useEffect(() => {
    if (!mention) {
      setMentionAnchor(null);
      return;
    }
    const update = () => {
      setMentionAnchor(calcMentionAnchor());
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [mention, draft, calcMentionAnchor]);

  // 点击输入框及弹层外部时关闭 @ 检索
  useEffect(() => {
    if (!mention) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (mentionMenuRef.current?.contains(target) || textareaRef.current?.contains(target)) {
        return;
      }
      setMention(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [mention]);

  const effMentionIndex = mention ? Math.min(mention.index, Math.max(0, mentionMatches.length - 1)) : 0;

  // 键盘切换高亮项时，自动将当前选项滚动到可视区域内
  useEffect(() => {
    if (activeItemRef.current) {
      activeItemRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [effMentionIndex]);

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
      {/* @ 工作区文件引用检索弹层（portal 到 body，优先底对齐在输入框上方展开） */}
      {mention && mentionAnchor && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={mentionMenuRef}
            className="fixed z-[9999]"
            style={{
              left: mentionAnchor.left,
              width: mentionAnchor.width,
              top: mentionAnchor.top,
              bottom: mentionAnchor.bottom,
              ['--pop-origin' as any]: mentionAnchor.placement === 'bottom' ? 'top left' : 'bottom left',
            }}
          >
            <div
              role="listbox"
              id="mention-file-listbox"
              aria-label="工作区文件建议"
              className="pop-enter-anim overflow-hidden rounded-xl border border-paper-grid bg-paper shadow-xl"
            >
              <div
                className="overflow-y-auto custom-scrollbar py-1"
                style={{ maxHeight: mentionAnchor.maxHeight }}
              >
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
                      ref={i === effMentionIndex ? activeItemRef : undefined}
                      id={`mention-option-${i}`}
                      role="option"
                      aria-selected={i === effMentionIndex}
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
                            i === effMentionIndex ? 'text-accent font-medium' : 'text-ink'
                          }`}
                        >
                          {f.name}
                        </span>
                        <span className="block truncate text-[9.5px] font-mono text-ink-faint leading-tight mt-0.5">
                          {f.path}
                        </span>
                      </span>
                      {i === effMentionIndex && (
                        <span className="shrink-0 flex items-center gap-0.5 text-[9.5px] font-sans font-medium text-accent bg-accent/15 px-1.5 py-0.5 rounded border border-accent/25">
                          <span className="font-mono text-[10px] leading-none">↵</span> 补全
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
              <div className="border-t border-paper-grid/40 bg-paper-grid/10 px-3 py-1.5 text-[9.5px] font-sans text-ink-faint flex items-center justify-between">
                <span>Tab / Enter 补全 · ↑↓ 选择</span>
                <span>Esc 关闭</span>
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
        {/* 输入框容器：底层为引用文件高亮底衬，顶层为原生 textarea */}
        <div className="relative flex-1 min-w-0 rounded-lg bg-node-bg">
          {/* 高亮底衬镜像层（像素级与 textarea 对齐） */}
          <div
            ref={backdropRef}
            aria-hidden="true"
            className="pointer-events-none select-none absolute inset-0 overflow-y-auto custom-scrollbar resize-none rounded-lg border border-transparent px-3 py-1.5 text-sm font-sans whitespace-pre-wrap break-words [text-wrap:pretty]"
            style={{
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
            }}
          >
            {mentionSegments.map((seg, i) =>
              seg.isMention ? (
                <mark
                  key={i}
                  className="rounded-sm bg-accent/20 ring-1 ring-accent/35 text-transparent font-sans"
                >
                  {seg.text}
                </mark>
              ) : (
                <span key={i} className="text-transparent font-sans">
                  {seg.text}
                </span>
              )
            )}
            {draft.endsWith('\n') ? ' ' : null}
          </div>

          <textarea
            ref={textareaRef}
            value={draft}
            onChange={handleDraftChange}
            onKeyDown={handleKeyDown}
            onScroll={handleTextareaScroll}
            disabled={isGenerating}
            rows={1}
            role="combobox"
            aria-expanded={Boolean(mention)}
            aria-haspopup="listbox"
            aria-controls={mention ? 'mention-file-listbox' : undefined}
            aria-activedescendant={mention && mentionMatches.length > 0 ? `mention-option-${effMentionIndex}` : undefined}
            placeholder={
              isGenerating
                ? '回复生成中…'
                : skillAgentFiles
                  ? '输入消息，@ 引用工作区文件，Enter 发送'
                  : '输入消息，Enter 发送，Shift+Enter 换行'
            }
            className="relative z-10 block w-full min-h-[36px] max-h-32 overflow-y-auto resize-none rounded-lg border border-paper-grid/70 bg-transparent px-3 py-1.5 text-sm font-sans text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-[border-color,box-shadow] duration-150 disabled:opacity-60 [text-wrap:pretty]"
          />
        </div>
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