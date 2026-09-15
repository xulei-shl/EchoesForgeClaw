import React, { memo, useEffect, useRef, useState } from 'react';
import {
  ImagePlus,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { CanvasNode } from '../_shared/CanvasNode';
import { NodeActionBar } from '../_shared/NodeActionBar';
import { Tooltip } from '../../../shared/components/ui/Tooltip';
import { useFeedback } from '../../../shared/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../_shared/nodeTypes';
import {
  RASTER_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  fileToDataUrl,
  optimizeDataUrl,
  urlToDataUrl,
} from '../../core/imageUpload';
import {
  fetchFastClawWorkspaceFiles,
  fetchArtifactBlob,
  blobToDataUrl,
  isRasterArtifact,
} from '../ai/infra/agentArtifactImages';
import { fetchWorkspaceFiles } from '../ai/infra/piSessionApi';
import type { AgentFile } from '../../../shared/types';

/** 继承图来源类型：直连图片上级 / 穿透连通图书封面 / 根节点图书封面兜底 */
export type InheritedSourceKind = 'parent' | 'book_connected' | 'book_root';

export interface ImageInheritance {
  url: string;
  kind: InheritedSourceKind;
}

/** 继承来源徽标文案 */
const INHERITED_BADGE: Record<InheritedSourceKind, string> = {
  parent: '上级节点',
  book_connected: '图书封面 · 穿透',
  book_root: '图书封面 · 根节点',
};

/** chat 上级节点的 AI 产物来源描述符（三模式共用，模式决定产物列表接口） */
export interface ArtifactImageSource {
  nodeId: string;
  title: string;
  mode: 'skill_agent' | 'agent' | 'llm';
  workspaceId: string | null;
  epoch: number;
  configId: number | null;
  /** FastClaw 节点内手动覆盖的 Agent（优先于节点绑定） */
  agentConfigId: number | null;
}

const MODE_LABEL: Record<ArtifactImageSource['mode'], string> = {
  skill_agent: 'Skill Agent',
  agent: 'FastClaw',
  llm: 'LLM',
};

/** 按来源模式拉取该 chat 上级的产物文件列表（pi/LLM 同一 /chat/files 端点） */
function fetchSourceFiles(source: ArtifactImageSource): Promise<AgentFile[]> {
  if (source.mode === 'agent') {
    return fetchFastClawWorkspaceFiles({
      nodeId: source.nodeId,
      epoch: source.epoch,
      configId: source.configId,
      agentConfigId: source.agentConfigId,
      workspaceId: source.workspaceId,
    });
  }
  if (!source.workspaceId) return Promise.resolve([]);
  return fetchWorkspaceFiles(source.workspaceId);
}

export interface ImageUploadNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 已加载图片（data URL；本地上传或 AI 产物加载落盘），无图时为 null */
  imageUrl?: string | null;
  /** 已加载图片的文件名（展示用） */
  imageName?: string;
  /** 继承图（直连图片上级 → 穿透图书封面 → 根封面兜底），null = 无可继承图片 */
  inheritedUrl?: string | null;
  inheritedKind?: InheritedSourceKind;
  /** chat 上级节点的 AI 产物来源（存在时展示 AI 产物选择器入口） */
  artifactSources?: ArtifactImageSource[];
  onRemove?: (id: string) => void;
  /** 上传 / 替换 / 加载 / 清除图片：imageUrl 为 null 表示清除（回落继承源） */
  onImageChange?: (id: string, imageUrl: string | null, imageName: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  /** 卡片底部「+」插槽 */
  footer?: React.ReactNode;
  /** 根节点右键菜单回调 */
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

/** AI 产物缩略图：带鉴权 fetch → blob → objectURL 预览（SkillFileCard 同款模式），点击加载 */
const ArtifactThumb = memo(({ file, busy, onLoad }: { file: AgentFile; busy: boolean; onLoad: () => void }) => {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let created: string | null = null;
    fetchArtifactBlob(file)
      .then((blob) => {
        if (!active) return;
        created = URL.createObjectURL(blob);
        setPreview(created);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [file]);

  return (
    <button
      type="button"
      onClick={onLoad}
      disabled={busy}
      title={`加载 ${file.name}`}
      aria-label={`加载 ${file.name}`}
      className="relative group/art aspect-square rounded overflow-hidden border border-paper-grid bg-paper-grid/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-wait"
    >
      {preview ? (
        <img src={preview} alt={file.name} className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-ink-faint">
          <Loader2 size={12} className="animate-spin" />
        </div>
      )}
      <span className="absolute inset-0 flex items-center justify-center bg-paper/70 opacity-0 group-hover/art:opacity-100 focus-visible:opacity-100 transition-opacity text-[10px] font-sans text-accent">
        {busy ? <Loader2 size={12} className="animate-spin" /> : '加载'}
      </span>
    </button>
  );
});
ArtifactThumb.displayName = 'ArtifactThumb';

const ImageUploadNodeInner: React.FC<ImageUploadNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  imageUrl = null,
  imageName = '',
  inheritedUrl = null,
  inheritedKind = 'parent',
  artifactSources = [],
  onRemove,
  onImageChange,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
}) => {
  const { showToast } = useFeedback();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 拖拽悬停高亮
  const [dragOver, setDragOver] = useState(false);
  // 继承图 / AI 产物选择器
  const inherited = inheritedUrl ? { url: inheritedUrl, kind: inheritedKind } : null;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sourceFiles, setSourceFiles] = useState<Record<string, AgentFile[]>>({});
  const [sourceLoading, setSourceLoading] = useState<Record<string, boolean>>({});
  const [sourceError, setSourceError] = useState<Record<string, string | null>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [loadingInherited, setLoadingInherited] = useState(false);
  // picker 打开时拉取各来源产物（artifactSources 经 ref 读取最新值，避免父渲染重拉循环）
  const sourcesRef = useRef(artifactSources);
  sourcesRef.current = artifactSources;

  const handleFile = async (file: File) => {
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
      onImageChange?.(id, stored, file.name);
    } catch (e: any) {
      showToast(e?.message || '图片处理失败，请重试', { type: 'error' });
    }
  };

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选择同一文件
    if (file) void handleFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  /** 加载继承图到本节点（写 data.imageUrl 持久化，与上传同口径） */
  const handleLoadInherited = async () => {
    if (!inherited || loadingInherited) return;
    setLoadingInherited(true);
    try {
      const raw = inherited.url.startsWith('data:')
        ? inherited.url
        : await urlToDataUrl(inherited.url);
      const stored = await optimizeDataUrl(raw, raw.length);
      onImageChange?.(id, stored, inherited.kind === 'parent' ? '上级节点图片' : '图书封面');
      showToast('已加载继承图片', { type: 'success' });
    } catch (e: any) {
      showToast(e?.message || '继承图片获取失败，请重试', { type: 'error' });
    } finally {
      setLoadingInherited(false);
    }
  };

  /** 拉取单个 chat 上级的位图产物列表 */
  const loadSource = async (source: ArtifactImageSource) => {
    setSourceLoading((prev) => ({ ...prev, [source.nodeId]: true }));
    setSourceError((prev) => ({ ...prev, [source.nodeId]: null }));
    try {
      const files = (await fetchSourceFiles(source)).filter(isRasterArtifact);
      setSourceFiles((prev) => ({ ...prev, [source.nodeId]: files }));
    } catch (e: any) {
      setSourceError((prev) => ({ ...prev, [source.nodeId]: e?.message || '加载失败' }));
    } finally {
      setSourceLoading((prev) => ({ ...prev, [source.nodeId]: false }));
    }
  };

  // picker 打开 → 拉取全部来源（之后手动刷新；不随父渲染自动重拉）
  useEffect(() => {
    if (!pickerOpen) return;
    for (const s of sourcesRef.current) void loadSource(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerOpen]);

  /** 人工选择一个 AI 产物加载：fetch → blob → data URL → optimize → 写 data.imageUrl */
  const handleLoadArtifact = async (source: ArtifactImageSource, file: AgentFile) => {
    const key = `${source.nodeId}:${file.path}`;
    if (loadingKey) return;
    setLoadingKey(key);
    try {
      const blob = await fetchArtifactBlob(file);
      const raw = await blobToDataUrl(blob);
      const stored = await optimizeDataUrl(raw, blob.size);
      onImageChange?.(id, stored, file.name);
      showToast(`已加载 AI 产物：${file.name}`, { type: 'success' });
    } catch (e: any) {
      showToast(e?.message || 'AI 产物加载失败，请重试', { type: 'error' });
    } finally {
      setLoadingKey(null);
    }
  };

  const hasInheritance = Boolean(inherited) || artifactSources.length > 0;

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '图片加载'}
      dotColor={NODE_COLORS.image_upload}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 420, height: 420 }}
      showLeftAnchor={true}
      showRightAnchor={true}
      footer={footer}
      actionBar={
        <NodeActionBar>
          <NodeActionBar.Custom
            icon={<RefreshCw size={16} strokeWidth={1.5} />}
            tooltip={imageUrl ? '替换图片' : '上传图片'}
            onClick={() => {
              fileInputRef.current?.click();
            }}
          />
          {inherited && inherited.url !== imageUrl && (
            <NodeActionBar.Custom
              icon={loadingInherited ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} strokeWidth={1.5} />}
              tooltip="加载继承图到本节点"
              onClick={() => void handleLoadInherited()}
            />
          )}
          {imageUrl && (
            <NodeActionBar.Custom
              icon={<Trash2 size={16} strokeWidth={1.5} />}
              tooltip="清除已加载图片（回落继承源）"
              onClick={() => onImageChange?.(id, null, '')}
              className="text-ink-faint hover:text-error"
            />
          )}
        </NodeActionBar>
      }
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handlePick}
      />
      <div className="relative h-full flex flex-col flex-1 min-h-0 gap-1.5">
        {/* 来源徽标条：继承来源 + AI 产物选择器入口 */}
        {hasInheritance && (
          <div className="shrink-0 flex items-center gap-1.5 flex-wrap">
            {inherited && (
              <Tooltip content={imageUrl === inherited.url ? '继承图已加载' : '点击加载继承图'}>
                <button
                  type="button"
                  onClick={() => void handleLoadInherited()}
                  disabled={loadingInherited || imageUrl === inherited.url}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-sans border border-paper-grid bg-paper text-ink-light hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-60"
                >
                  {loadingInherited ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <ImagePlus size={10} strokeWidth={2} />
                  )}
                  {INHERITED_BADGE[inherited.kind]}
                </button>
              </Tooltip>
            )}
            {artifactSources.length > 0 && (
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-sans border transition-colors ${
                  pickerOpen
                    ? 'border-accent/50 bg-accent/10 text-accent'
                    : 'border-paper-grid bg-paper text-ink-light hover:text-accent hover:border-accent/40'
                }`}
              >
                <Sparkles size={10} strokeWidth={2} />
                AI 产物
              </button>
            )}
          </div>
        )}

        {/* AI 产物选择器：按 chat 上级分组，人工点选加载 */}
        {pickerOpen && (
          <div className="shrink-0 max-h-44 overflow-y-auto rounded-md border border-paper-grid bg-paper/60 backdrop-blur-sm">
            <div className="sticky top-0 z-10 flex items-center justify-between px-2 py-1 bg-paper/90 border-b border-paper-grid">
              <span className="text-[10px] font-sans text-ink-faint">
                选择一个 AI 产物图片加载（来自 AI 对话上级）
              </span>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                aria-label="收起产物选择器"
                className="p-0.5 rounded text-ink-faint hover:text-accent transition-colors"
              >
                <X size={12} />
              </button>
            </div>
            {artifactSources.map((source) => {
              const files = sourceFiles[source.nodeId] ?? [];
              const loading = !!sourceLoading[source.nodeId];
              const error = sourceError[source.nodeId] ?? null;
              return (
                <div key={source.nodeId} className="px-2 py-1.5 border-b border-paper-grid/60 last:border-b-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-sans text-ink-light truncate">
                      {source.title}
                      <span className="ml-1 text-ink-faint">· {MODE_LABEL[source.mode]}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void loadSource(source)}
                      disabled={loading}
                      aria-label="刷新产物列表"
                      className="p-0.5 rounded text-ink-faint hover:text-accent transition-colors disabled:opacity-60"
                    >
                      {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                    </button>
                  </div>
                  {error ? (
                    <p className="mt-1 text-[10px] font-sans text-error">产物列表获取失败：{error}</p>
                  ) : files.length === 0 ? (
                    <p className="mt-1 text-[10px] font-sans text-ink-faint">
                      {loading
                        ? '正在获取产物列表…'
                        : source.workspaceId
                          ? '暂无图片产物（先在上级对话中生成图片）'
                          : '上级对话尚未开始，无可用会话产物'}
                    </p>
                  ) : (
                    <div className="mt-1 grid grid-cols-5 gap-1.5">
                      {files.map((f) => (
                        <ArtifactThumb
                          key={f.path}
                          file={f}
                          busy={loadingKey === `${source.nodeId}:${f.path}`}
                          onLoad={() => void handleLoadArtifact(source, f)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {imageUrl ? (
          <div
            className="relative group border border-dashed rounded-lg p-1 border-paper-grid bg-paper flex-1 min-h-0 overflow-hidden"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {dragOver && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-paper/80 backdrop-blur-sm border-2 border-accent text-accent font-medium rounded-lg transition-all">
                释放以替换图片
              </div>
            )}
            <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
              <PhotoView src={imageUrl}>
                <Tooltip content="点击全屏查看">
                  <img
                    src={imageUrl}
                    alt={imageName || '已加载图片'}
                    className="w-full h-full object-contain cursor-zoom-in group-hover:opacity-95 active:scale-[0.99] transition-transform transition-opacity"
                    loading="lazy"
                  />
                </Tooltip>
              </PhotoView>
            </PhotoProvider>
            {imageName && (
              <div className="absolute inset-x-2 bottom-2 px-2 py-1 rounded bg-paper/90 backdrop-blur-sm border border-paper-grid text-[10px] text-ink-light font-sans truncate pointer-events-none">
                {imageName}
              </div>
            )}
          </div>
        ) : inherited ? (
          /* 继承预览：展示继承图 + 一键加载；仍可拖拽/点击上传替换 */
          <div
            className="relative group border border-dashed rounded-lg p-1 border-paper-grid bg-paper flex-1 min-h-0 overflow-hidden"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {dragOver && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-paper/80 backdrop-blur-sm border-2 border-accent text-accent font-medium rounded-lg transition-all">
                释放以上传图片
              </div>
            )}
            <img
              src={inherited.url}
              alt="继承图片预览"
              className="w-full h-full object-contain opacity-90"
              loading="lazy"
            />
            <button
              type="button"
              onClick={() => void handleLoadInherited()}
              disabled={loadingInherited}
              className="absolute inset-0 m-auto w-fit h-fit inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-paper/95 backdrop-blur-sm border border-accent/50 text-accent text-xs font-sans shadow-sm hover:bg-accent hover:text-paper transition-colors disabled:opacity-70"
            >
              {loadingInherited ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Upload size={13} strokeWidth={2} />
              )}
              加载继承图
            </button>
            <div className="absolute inset-x-2 bottom-2 px-2 py-1 rounded bg-paper/90 backdrop-blur-sm border border-paper-grid text-[10px] text-ink-faint font-sans truncate pointer-events-none">
              {INHERITED_BADGE[inherited.kind]} · 点击或拖拽可上传替换
            </div>
          </div>
        ) : (
          /* 空态：点击或拖拽上传 */
          <button
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`group w-full h-full min-h-[200px] flex flex-col items-center justify-center gap-2.5 rounded-md border border-dashed transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              dragOver
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-paper-grid bg-paper-grid/5 text-ink-faint hover:text-accent hover:border-accent/40 hover:bg-accent/5'
            }`}
          >
            <div className="flex items-center justify-center w-12 h-12 rounded-full border border-dashed border-paper-grid bg-paper/60 group-hover:scale-105 transition-transform duration-300">
              <ImagePlus size={22} strokeWidth={1.5} />
            </div>
            <div className="text-center">
              <p className="text-sm font-serif text-ink-light group-hover:text-accent transition-colors">
                {dragOver ? '松开鼠标上传' : '点击或拖拽图片到此处'}
              </p>
              <p className="mt-1 text-[11px] font-sans text-ink-faint">
                PNG / JPG / WebP / GIF · 不超过 8MB
              </p>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-sans border border-dashed border-paper-grid group-hover:border-accent/40 transition-colors">
              <Upload size={11} strokeWidth={2} />
              选择文件
            </span>
          </button>
        )}
      </div>
    </CanvasNode>
  );
};

export const ImageUploadNode = memo(ImageUploadNodeInner);
ImageUploadNode.displayName = 'ImageUploadNode';
export default ImageUploadNode;
