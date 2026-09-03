import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Palette,
  Heart,
  Globe,
  Loader2,
  Pencil,
  Check,
  Dices,
  SlidersHorizontal,
  PenTool,
  Brush,
  CircleDot,
  Type,
} from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Select, type SelectOption } from '../../../platform/components/ui/Select';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import {
  type InkWashState,
  type InkWashCompositionMode,
  type InkWashToolMode,
  type InkWashPaperStyle,
  type InkWashAspectRatio,
  type InkWashResolution,
  type InkWashInscriptionItem,
  type InkWashTraceConfig,
  DEFAULT_INKWASH_TRACE_CONFIG,
  INKWASH_DEFAULT_PARAMS,
  INKWASH_PRESET_RECIPES,
  InkWashSession,
  applyInkWashPreset,
  renderInkWashArt,
  InkWashStudioPanel,
  getInkWashDimensions,
  composeInkWashArtwork,
  extractInscriptionFromUpstream,
  getRandomSealSrc,
  InkWashInscriptionOverlay,
} from '../inkwash';

const PRESET_SELECT_OPTIONS: SelectOption[] = [
  { value: 'custom', label: '自由挥毫', title: '空白宣纸·尽情手绘互动' },
  { value: 'image_trace', label: '底图拓印', title: '工笔白描·焦墨铁线勾勒·熟宣精细拓印' },
  { value: 'zen_splash', label: '破墨飞白', title: '《降临》外星水墨圆相·荆棘触须·垂滴飞白' },
  { value: 'mountain_mist', label: '远山烟岚', title: '层峦叠嶂·远山如黛·烟雨溟蒙' },
  { value: 'misty_rain', label: '烟雨江南', title: '柔水润墨·水汽氤氲·水墨清岚' },
  { value: 'plum_branch', label: '疏影横斜', title: '劲挺寒枝·点染墨梅·虚实相生' },
  { value: 'lone_boat', label: '寒江独钓', title: '澄江如练·一叶轻舟·计白当黑' },
  { value: 'scorched_bamboo', label: '焦墨劲竹', title: '焦墨干擦·节节凌云·骨法用笔' },
  { value: 'splashing_waves', label: '惊涛骇浪', title: '激流翻卷·水汽喷涌·气势磅礴' },
];

export interface InkWashNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  data?: Partial<InkWashState> & {
    imageUrl?: string | null;
    isSaved?: boolean;
    error?: string | null;
  };
  upstreamText?: string | null;
  upstreamImageUrl?: string | null;
  isFavorited?: boolean;
  isPublic?: boolean;
  isSelected?: boolean;
  recordDeleted?: boolean;
  onSelect?: (id: string) => void;
  onRemove?: (id: string) => void;
  onToggleFavorite?: (id: string) => Promise<boolean>;
  onTogglePublic?: (id: string) => Promise<boolean>;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  mismatchBadge?: string | null;
  onUpdateState?: (id: string, patch: Partial<InkWashState>, undoable?: boolean) => void;
  onExport?: (id: string, dataUrl: string, state: InkWashState) => Promise<void>;
}

const InkWashNodeInner: React.FC<InkWashNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  data = {},
  upstreamText,
  upstreamImageUrl,
  isFavorited = false,
  isPublic = false,
  isSelected = false,
  recordDeleted = false,
  onSelect,
  onRemove,
  onToggleFavorite,
  onTogglePublic,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
  mismatchBadge,
  onUpdateState,
  onExport,
}) => {
  const { showToast } = useFeedback();

  // 核心参数
  const mode: InkWashCompositionMode = data.mode ?? INKWASH_DEFAULT_PARAMS.mode;
  const toolMode: InkWashToolMode = data.toolMode ?? INKWASH_DEFAULT_PARAMS.toolMode;
  const size = data.size ?? INKWASH_DEFAULT_PARAMS.size;
  const flow = data.flow ?? INKWASH_DEFAULT_PARAMS.flow;
  const bleed = data.bleed ?? INKWASH_DEFAULT_PARAMS.bleed;
  const dry = data.dry ?? INKWASH_DEFAULT_PARAMS.dry;
  const color = data.color ?? INKWASH_DEFAULT_PARAMS.color;
  const bink = data.bink ?? INKWASH_DEFAULT_PARAMS.bink;
  const inkColor = data.inkColor ?? INKWASH_DEFAULT_PARAMS.inkColor;
  const paperStyle: InkWashPaperStyle = data.paperStyle ?? INKWASH_DEFAULT_PARAMS.paperStyle;
  const aspectRatio: InkWashAspectRatio = data.aspectRatio ?? INKWASH_DEFAULT_PARAMS.aspectRatio;
  const resolution: InkWashResolution = data.resolution ?? INKWASH_DEFAULT_PARAMS.resolution;
  const seed = data.seed ?? INKWASH_DEFAULT_PARAMS.seed;
  const traceConfig: InkWashTraceConfig = data.traceConfig ?? DEFAULT_INKWASH_TRACE_CONFIG;

  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [isEditing, setIsEditing] = useState<boolean>(!data?.imageUrl);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isRollingDice, setIsRollingDice] = useState(false);

  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const sessionRef = useRef<InkWashSession | null>(null);

  // 当外部 data.imageUrl 变更时同步编辑态
  useEffect(() => {
    setIsEditing(!data?.imageUrl);
  }, [data?.imageUrl]);

  // 诗书画印题款与印章多文本列表
  const inscriptions: InkWashInscriptionItem[] = useMemo(() => {
    if (Array.isArray(data.inscriptions) && data.inscriptions.length > 0) {
      return data.inscriptions;
    }
    if (data.inscription) {
      return [{ ...data.inscription, id: data.inscription.id || 'insc_1' }];
    }
    if (upstreamText) {
      return [
        {
          ...INKWASH_DEFAULT_PARAMS.inscriptions![0],
          id: 'insc_upstream',
          text: extractInscriptionFromUpstream(upstreamText),
          enabled: true,
        },
      ];
    }
    return INKWASH_DEFAULT_PARAMS.inscriptions || [];
  }, [data.inscriptions, data.inscription, upstreamText]);

  const [selectedInscriptionId, setSelectedInscriptionId] = useState<string | null>(null);
  const [isAddingNewInscription, setIsAddingNewInscription] = useState(false);

  const currentState: InkWashState = useMemo(
    () => ({
      mode,
      toolMode,
      size,
      flow,
      bleed,
      dry,
      color,
      bink,
      inkColor,
      paperStyle,
      aspectRatio,
      resolution,
      seed,
      imageUrl: data.imageUrl || null,
      isSaved: data.isSaved,
      error: null,
      uploadedImage: data.uploadedImage || upstreamImageUrl || null,
      inscriptions,
      inscription: inscriptions[0],
      traceConfig,
    }),
    [
      mode,
      toolMode,
      size,
      flow,
      bleed,
      dry,
      color,
      bink,
      inkColor,
      paperStyle,
      aspectRatio,
      resolution,
      seed,
      data.imageUrl,
      data.isSaved,
      data.uploadedImage,
      upstreamImageUrl,
      inscriptions,
      traceConfig,
    ]
  );

  // 保证 Canvas 始终挂载在当前有效的 DOM 容器上
  useEffect(() => {
    if (!containerEl || !sessionRef.current || sessionStatus !== 'ready') return;
    containerEl.replaceChildren();
    const canvas = sessionRef.current.canvas;
    canvas.className = 'max-w-full max-h-full object-contain cursor-crosshair';
    containerEl.appendChild(canvas);
  }, [containerEl, sessionStatus]);

  // 会话建立：进入编辑态时创建 WebGL2 渲染目标
  useEffect(() => {
    if (!isEditing) {
      sessionRef.current?.dispose();
      sessionRef.current = null;
      setSessionStatus('idle');
      return;
    }

    let cancelled = false;
    setSessionStatus('loading');

    (async () => {
      try {
        const dims = getInkWashDimensions(aspectRatio, 512);
        const session = await InkWashSession.create({
          params: currentState,
          width: dims.width,
          height: dims.height,
        });

        if (cancelled) {
          session.dispose();
          return;
        }

        sessionRef.current?.dispose();
        sessionRef.current = session;

        // 若不是自由模式且尚无图片，自动渲染所选意境配方
        if (mode !== 'custom') {
          await applyInkWashPreset(
            session,
            mode,
            seed,
            currentState.uploadedImage,
            currentState.traceConfig
          );
        }

        setSessionStatus('ready');
      } catch (err: any) {
        console.error('初始化水墨写意流体引擎失败:', err);
        setSessionStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, aspectRatio]);

  // 参数更新实时响应
  useEffect(() => {
    const session = sessionRef.current;
    if (!session || sessionStatus !== 'ready') return;
    session.updateParams(currentState);
  }, [currentState, sessionStatus]);

  // 监听参考底图变动：如果处于底图拓印模式，自动刷新拓印
  const prevUploadedImageRef = useRef<string | null>(currentState.uploadedImage);
  useEffect(() => {
    if (prevUploadedImageRef.current === currentState.uploadedImage) return;
    prevUploadedImageRef.current = currentState.uploadedImage;
    const session = sessionRef.current;
    if (!session || sessionStatus !== 'ready') return;
    if (mode === 'image_trace') {
      applyInkWashPreset(
        session,
        'image_trace',
        seed,
        currentState.uploadedImage,
        currentState.traceConfig
      );
    }
  }, [currentState.uploadedImage, currentState.traceConfig, mode, seed, sessionStatus]);

  const patchParam = useCallback(
    (patch: Partial<InkWashState>, undoable?: boolean) => {
      onUpdateState?.(id, patch, undoable);
    },
    [id, onUpdateState]
  );

  /** 重新执行底图拓印（支持使用最新的 traceConfig 即时重算） */
  const handleRetrace = useCallback(
    (customCfg?: InkWashTraceConfig) => {
      const session = sessionRef.current;
      if (!session || sessionStatus !== 'ready' || !currentState.uploadedImage) return;
      const cfg = customCfg || currentState.traceConfig || DEFAULT_INKWASH_TRACE_CONFIG;
      applyInkWashPreset(
        session,
        mode === 'image_trace' ? 'image_trace' : mode,
        seed,
        currentState.uploadedImage,
        cfg
      );
    },
    [currentState.uploadedImage, currentState.traceConfig, mode, seed, sessionStatus]
  );

  /** 切换装载意境配方 */
  const handleApplyPresetRecipe = useCallback(
    async (newMode: InkWashCompositionMode) => {
      if (newMode === 'custom') {
        patchParam({ mode: 'custom' });
        sessionRef.current?.clear();
        return;
      }
      if (newMode === 'image_trace' && !currentState.uploadedImage) {
        showToast('暂无参考底图（可连线图片/图书节点，或在画布添加图书元数据）', { type: 'info' });
      }
      const recipe = INKWASH_PRESET_RECIPES[newMode as Exclude<InkWashCompositionMode, 'custom'>];
      const newSeed = Math.floor(Math.random() * 999999);
      const patch = {
        mode: newMode,
        seed: newSeed,
        ...recipe,
      };
      patchParam(patch);

      const session = sessionRef.current;
      if (session && sessionStatus === 'ready') {
        session.updateParams({ ...currentState, ...patch });
        await applyInkWashPreset(
          session,
          newMode,
          newSeed,
          currentState.uploadedImage,
          currentState.traceConfig
        );
      }
    },
    [patchParam, currentState, sessionStatus, showToast]
  );

  /** 全维度灵感洗牌 */
  const handleRandomizeAll = useCallback(async () => {
    setIsRollingDice(true);
    window.setTimeout(() => setIsRollingDice(false), 350);

    const modes: Array<Exclude<InkWashCompositionMode, 'custom'>> = [
      'zen_splash',
      'mountain_mist',
      'misty_rain',
      'plum_branch',
      'lone_boat',
      'scorched_bamboo',
      'splashing_waves',
    ];
    const pickedMode = modes[Math.floor(Math.random() * modes.length)];
    const recipe = INKWASH_PRESET_RECIPES[pickedMode];
    const newSeed = Math.floor(Math.random() * 999999);

    const randomState: Partial<InkWashState> = {
      mode: pickedMode,
      seed: newSeed,
      ...recipe,
      size: Number((Math.random() * 0.4 + 0.35).toFixed(2)),
      flow: Number((Math.random() * 0.5 + 0.4).toFixed(2)),
      bleed: Number((Math.random() * 0.5 + 0.35).toFixed(2)),
      dry: Number((Math.random() * 0.5 + 0.25).toFixed(2)),
      color: Number((Math.random() * 0.6 + 0.2).toFixed(2)),
    };

    patchParam(randomState);

    const session = sessionRef.current;
    if (session && sessionStatus === 'ready') {
      session.updateParams({ ...currentState, ...randomState });
      await applyInkWashPreset(session, pickedMode, newSeed, currentState.uploadedImage);
    }
    showToast(`已生成全新水墨意境：${PRESET_SELECT_OPTIONS.find((o) => o.value === pickedMode)?.label}`, {
      type: 'success',
    });
  }, [patchParam, currentState, sessionStatus, showToast]);

  /** 统一重置参数为初始默认值 */
  const handleResetParams = useCallback(() => {
    const patch: Partial<InkWashState> = {
      ...INKWASH_DEFAULT_PARAMS,
    };

    if (data?.imageUrl && !isEditing) {
      setIsEditing(true);
      patch.imageUrl = null;
      patch.isSaved = false;
    }

    patchParam(patch);
    sessionRef.current?.clear();
    showToast('已重置为初始宣纸与参数', { type: 'success' });
  }, [data?.imageUrl, isEditing, patchParam, showToast]);

  /** 定墨烘干 */
  const handleFix = useCallback(() => {
    sessionRef.current?.fix();
    showToast('已定墨烘干，沉淀进宣纸', { type: 'success' });
  }, [showToast]);

  /** 澄心洗纸 */
  const handleClear = useCallback(() => {
    sessionRef.current?.clear();
    showToast('已澄心洗纸，宣纸已洁净', { type: 'info' });
  }, [showToast]);

  /** 触发添加书画题款：弹出编辑输入框（对齐手账制作交互规范） */
  const handleStartAddInscription = useCallback(() => {
    setIsAddingNewInscription(true);
  }, []);

  /** 确认添加书画题款（真正加入宣纸并记入撤销历史） */
  const handleConfirmAddInscription = useCallback(
    (textContent: string) => {
      const text = textContent.trim() || '松风水月';
      const newId = 'insc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const count = inscriptions.length;
      // 依据当前已有题款数量自适应向左排布避开重叠
      const newX = count === 0 ? 82 : Math.max(15, 82 - count * 15);
      const newItem: InkWashInscriptionItem = {
        id: newId,
        enabled: true,
        text,
        fontFamily: '钟齐志莽行书',
        writingMode: 'vertical',
        textAlign: 'center',
        color: '#16161e',
        fontSizeRatio: 0.038,
        x: newX,
        y: 28,
        sealEnabled: false,
        sealSrc: getRandomSealSrc(),
      };
      const nextInscriptions = [...inscriptions, newItem];
      patchParam({ inscriptions: nextInscriptions }, true);
      setSelectedInscriptionId(newId);
      setIsAddingNewInscription(false);
      showToast('已添加书画题款', { type: 'success' });
    },
    [inscriptions, patchParam, showToast]
  );

  /** 取消添加书画题款 */
  const handleCancelAddInscription = useCallback(() => {
    setIsAddingNewInscription(false);
  }, []);

  /** 更新单个题款组件（修改文案/样式时带 undoable 记撤销历史） */
  const handleUpdateInscriptionItem = useCallback(
    (targetId: string, patch: Partial<InkWashInscriptionItem>, undoable = false) => {
      const next = inscriptions.map((it) => (it.id === targetId ? { ...it, ...patch } : it));
      patchParam({ inscriptions: next }, undoable);
    },
    [inscriptions, patchParam]
  );

  /** 删除单个题款组件（记入撤销历史） */
  const handleDeleteInscriptionItem = useCallback(
    (targetId: string) => {
      const next = inscriptions.filter((it) => it.id !== targetId);
      patchParam({ inscriptions: next }, true);
      if (selectedInscriptionId === targetId) {
        setSelectedInscriptionId(null);
      }
      showToast('已删除该题款', { type: 'info' });
    },
    [inscriptions, patchParam, selectedInscriptionId, showToast]
  );

  // 键盘快捷键监听：Delete / Backspace 快速删除选中文本，Escape 取消选中（对齐手账制作节点）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isAddingNewInscription) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
      }

      if (selectedInscriptionId) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          handleDeleteInscriptionItem(selectedInscriptionId);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setSelectedInscriptionId(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAddingNewInscription, selectedInscriptionId, handleDeleteInscriptionItem]);

  /** 生成：执行高清物理水墨渲染导出 */
  const handleGenerate = useCallback(async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      let dataUrl = '';
      const session = sessionRef.current;

      if (session && sessionStatus === 'ready') {
        // 先定墨固化
        session.fix();
        session.render();
        dataUrl = session.toDataUrl();
      } else {
        const result = await renderInkWashArt(currentState, async (s) => {
          if (mode !== 'custom') {
            await applyInkWashPreset(
              s,
              mode,
              seed,
              currentState.uploadedImage,
              currentState.traceConfig
            );
          }
        });
        dataUrl = result.dataUrl;
      }

      // 诗书画印：执行高清书法题款与朱砂真迹印章离屏多图层批量合成
      const dims = getInkWashDimensions(aspectRatio, resolution);
      dataUrl = await composeInkWashArtwork(dataUrl, inscriptions, dims.width, dims.height);

      setIsEditing(false);

      onUpdateState?.(id, {
        ...currentState,
        imageUrl: dataUrl,
        isSaved: false,
      });

      showToast(`水墨写意生成完成 (${resolution}p·${paperStyle === 'transparent' ? '透明底' : '宣纸底'})`, {
        type: 'success',
      });
    } catch (err: any) {
      console.error('生成水墨画作失败:', err);
      showToast(err?.message || '生成失败，请重试', { type: 'error' });
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, sessionStatus, currentState, id, mode, seed, aspectRatio, resolution, paperStyle, inscriptions, onUpdateState, showToast]);

  /** 独立保存到数据库 */
  const handleSaveToDatabase = useCallback(async () => {
    const imgUrl = data?.imageUrl;
    if (!imgUrl || isExporting || !onExport) return;
    setIsExporting(true);
    try {
      await onExport(id, imgUrl, {
        ...currentState,
        imageUrl: imgUrl,
        isSaved: true,
      });
      onUpdateState?.(id, { isSaved: true });
      onSelect?.(id);
      showToast('水墨画作已保存到数据库，已解锁公开与收藏', { type: 'success' });
    } catch (err: any) {
      console.error('保存水墨画作失败:', err);
      showToast(err?.detail || err?.message || '保存失败，请重试', { type: 'error' });
    } finally {
      setIsExporting(false);
    }
  }, [data?.imageUrl, isExporting, onExport, id, currentState, onUpdateState, onSelect, showToast]);

  /** 本地直接下载 PNG */
  const handleDownload = useCallback(() => {
    const url = data?.imageUrl;
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = `inkwash-${mode}-${Date.now()}.png`;
    link.click();
    showToast('水墨画作 PNG 已下载', { type: 'success' });
  }, [data?.imageUrl, mode, showToast]);

  /** 收藏与公开切换 */
  const runToggle = async (
    fn: ((id: string) => Promise<boolean>) | undefined,
    okMsg: (active: boolean) => string
  ) => {
    if (!fn) return;
    try {
      const active = await fn(id);
      showToast(okMsg(active), { type: 'success' });
    } catch {
      showToast('操作失败，请重试', { type: 'error' });
    }
  };

  const hasGenerated = Boolean(data?.imageUrl && !isEditing);
  const isSaved = Boolean(data?.isSaved);

  // 宣纸底色样式
  const paperBackgroundStyle: React.CSSProperties = useMemo(() => {
    if (paperStyle === 'transparent') {
      return {
        backgroundImage: `
          linear-gradient(45deg, rgba(0, 0, 0, 0.06) 25%, transparent 25%),
          linear-gradient(-45deg, rgba(0, 0, 0, 0.06) 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, rgba(0, 0, 0, 0.06) 75%),
          linear-gradient(-45deg, transparent 75%, rgba(0, 0, 0, 0.06) 75%)
        `,
        backgroundSize: '16px 16px',
        backgroundColor: '#f8f8fa',
      };
    }
    if (paperStyle === 'sized_xuan') return { backgroundColor: '#F9F8F5' };
    if (paperStyle === 'antique_silk') return { backgroundColor: '#E2D3B8' };
    if (paperStyle === 'pure_white') return { backgroundColor: '#FFFFFF' };
    return { backgroundColor: '#F5F3ED' }; // raw_xuan 生宣暖白
  }, [paperStyle]);

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '水墨写意'}
      dotColor={NODE_COLORS.ink_wash || 'oklch(0.38 0.04 260)'}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 450, height: 640 }}
      className={`transition-[opacity,transform] duration-150 ease-out ${
        isSelected ? 'ring-2 ring-accent/70 shadow-md' : ''
      }`}
      showLeftAnchor={true}
      showRightAnchor={true}
      onClick={() => onSelect?.(id)}
      footer={footer}
      sideDrawer={
        isEditing ? (
          <InkWashStudioPanel
            isOpen={isDrawerOpen}
            size={size}
            flow={flow}
            bleed={bleed}
            dry={dry}
            color={color}
            bink={bink}
            inkColor={inkColor}
            paperStyle={paperStyle}
            aspectRatio={aspectRatio}
            resolution={resolution}
            upstreamText={upstreamText}
            inscription={inscriptions[0]}
            traceConfig={currentState.traceConfig || DEFAULT_INKWASH_TRACE_CONFIG}
            disabled={isGenerating}
            onUpdate={(patch) => {
              if (patch.inscription) {
                const updatedFirst = patch.inscription;
                const nextInscriptions =
                  inscriptions.length > 0
                    ? inscriptions.map((it, idx) => (idx === 0 ? { ...it, ...updatedFirst } : it))
                    : [{ ...updatedFirst, id: 'insc_1' }];
                patchParam({ ...patch, inscriptions: nextInscriptions });
              } else if (patch.traceConfig) {
                patchParam(patch);
                // 调节拓印参数时实时联动重新拓印
                handleRetrace(patch.traceConfig);
              } else {
                patchParam(patch);
              }
            }}
            onRetrace={() => handleRetrace()}
            onClose={() => setIsDrawerOpen(false)}
            onFix={handleFix}
            onClear={handleClear}
          />
        ) : undefined
      }
      mismatchBadge={mismatchBadge}
      actionBar={
        <NodeActionBar>
          {hasGenerated ? (
            <>
              <NodeActionBar.Retry
                onClick={() => setIsEditing(true)}
                disabled={isExporting}
                tooltip="继续挥毫 / 调整参数"
              />
              <NodeActionBar.Custom
                icon={<Check size={16} strokeWidth={1.5} className={isSaved ? 'text-accent' : ''} />}
                onClick={handleSaveToDatabase}
                disabled={isExporting || isSaved}
                tooltip={isSaved ? '已保存到数据库' : '保存到数据库（保存后可公开/收藏）'}
                className={isSaved ? 'text-accent opacity-70' : 'text-ink-light hover:text-accent'}
              />
              <NodeActionBar.Custom
                icon={
                  <Heart
                    size={16}
                    strokeWidth={1.5}
                    className={isSaved && isFavorited ? 'fill-accent text-accent' : ''}
                  />
                }
                tooltip={
                  !isSaved
                    ? '请先保存到数据库后再收藏'
                    : isFavorited
                      ? '取消收藏'
                      : '收藏'
                }
                onClick={() =>
                  isSaved && runToggle(onToggleFavorite, (act) => (act ? '已收藏' : '已取消收藏'))
                }
                disabled={!isSaved || isExporting || !onToggleFavorite}
              />
              <NodeActionBar.Custom
                icon={
                  <Globe
                    size={16}
                    strokeWidth={1.5}
                    className={isSaved && isPublic ? 'text-accent' : ''}
                  />
                }
                tooltip={
                  !isSaved
                    ? '请先保存到数据库后再公开'
                    : isPublic
                      ? '从画廊撤下'
                      : '公开到画廊'
                }
                onClick={() =>
                  isSaved && runToggle(onTogglePublic, (act) => (act ? '已公开' : '已撤下'))
                }
                disabled={!isSaved || isExporting || !onTogglePublic}
              />
              <NodeActionBar.Download
                onClick={handleDownload}
                disabled={isExporting}
                tooltip="直接下载水墨 PNG"
              />
              <NodeActionBar.Reset
                onClick={handleResetParams}
                disabled={isExporting}
                tooltip="重置为初始默认参数"
              />
            </>
          ) : (
            <>
              <NodeActionBar.Custom
                icon={
                  isGenerating ? (
                    <Loader2 size={16} className="animate-spin motion-reduce:animate-none text-accent" />
                  ) : (
                    <Palette size={16} strokeWidth={1.5} />
                  )
                }
                tooltip="生成水墨"
                onClick={handleGenerate}
                disabled={isGenerating}
              />
              <NodeActionBar.Custom
                icon={<Type size={16} strokeWidth={1.5} />}
                tooltip="添加书画题款文本"
                onClick={handleStartAddInscription}
                disabled={isGenerating}
              />
              <NodeActionBar.Custom
                icon={
                  <SlidersHorizontal
                    size={16}
                    strokeWidth={1.5}
                    className={isDrawerOpen ? 'text-accent' : ''}
                  />
                }
                tooltip={isDrawerOpen ? '收起画室抽屉' : '展开水墨画室抽屉'}
                onClick={() => setIsDrawerOpen((prev) => !prev)}
                className={isDrawerOpen ? 'text-accent' : ''}
              />
              <NodeActionBar.Custom
                icon={
                  <Dices
                    size={16}
                    strokeWidth={1.5}
                    className={`transition-transform duration-300 ease-out ${
                      isRollingDice ? 'rotate-180 scale-110 text-accent' : ''
                    }`}
                  />
                }
                tooltip="全参数灵感洗牌（一键随机生成全新水墨意境）"
                onClick={handleRandomizeAll}
                disabled={isGenerating}
              />
              <NodeActionBar.Reset
                onClick={handleResetParams}
                disabled={isGenerating}
                tooltip="重置为初始默认宣纸与参数"
              />
            </>
          )}
        </NodeActionBar>
      }
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-2">
        {/* 顶部常驻快捷栏：意境配方选择器与绘制笔法快速切换 */}
        {!hasGenerated && (
          <div className="flex items-center gap-1.5 p-1.5 rounded-xl bg-paper/95 border border-paper-grid/80 text-xs font-sans text-ink-light select-none shadow-2xs shrink-0">
            <div className="flex-1 min-w-0">
              <Select
                value={mode}
                onChange={(val) => handleApplyPresetRecipe(val as InkWashCompositionMode)}
                options={PRESET_SELECT_OPTIONS}
                disabled={isGenerating}
                size="sm"
                className="w-full"
              />
            </div>

            {/* 笔刷工具快速切换：勾线 / 毛笔 / 白墨 */}
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-paper-grid/40 border border-paper-grid">
              <Tooltip content="焦墨勾线笔（焦墨细线）">
                <button
                  type="button"
                  onClick={() => patchParam({ toolMode: 'pen' })}
                  className={`p-1.5 rounded-md transition-colors ${
                    toolMode === 'pen'
                      ? 'bg-paper text-accent shadow-2xs font-medium'
                      : 'text-ink-light hover:text-ink'
                  }`}
                >
                  <PenTool size={13} />
                </button>
              </Tooltip>

              <Tooltip content="运水毛笔（铺水带墨，浸润晕化）">
                <button
                  type="button"
                  onClick={() => patchParam({ toolMode: 'brush' })}
                  className={`p-1.5 rounded-md transition-colors ${
                    toolMode === 'brush'
                      ? 'bg-paper text-accent shadow-2xs font-medium'
                      : 'text-ink-light hover:text-ink'
                  }`}
                >
                  <Brush size={13} />
                </button>
              </Tooltip>

              <Tooltip content="白墨提亮（洗白、白毫留白）">
                <button
                  type="button"
                  onClick={() => patchParam({ toolMode: 'white' })}
                  className={`p-1.5 rounded-md transition-colors ${
                    toolMode === 'white'
                      ? 'bg-paper text-accent shadow-2xs font-medium'
                      : 'text-ink-light hover:text-ink'
                  }`}
                >
                  <CircleDot size={13} />
                </button>
              </Tooltip>
            </div>

            <Tooltip content={isDrawerOpen ? '收起画室抽屉' : '展开画室抽屉，精调水墨流场与纸张'}>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(!isDrawerOpen)}
                className={`h-8 px-2.5 flex items-center gap-1.5 rounded-md border border-dashed text-xs font-medium transition-[color,border-color,background-color,transform] active:scale-[0.96] shrink-0 cursor-pointer ${
                  isDrawerOpen
                    ? 'bg-accent/10 border-accent/40 text-accent font-semibold'
                    : 'border-paper-grid text-ink-light hover:text-accent hover:border-accent/40 bg-transparent'
                }`}
                aria-label={isDrawerOpen ? '收起画室抽屉' : '展开画室抽屉'}
              >
                <SlidersHorizontal size={13} />
                <span className="text-[11px]">{isDrawerOpen ? '收起' : '参数'}</span>
              </button>
            </Tooltip>
          </div>
        )}

        {/* 视口：交互宣纸画布或成画预览 */}
        <div
          className="relative flex-1 min-h-0 w-full overflow-hidden rounded border border-paper-grid/40 flex flex-col items-center justify-center select-none shadow-inner p-2"
          style={paperBackgroundStyle}
        >
          {!hasGenerated ? (
            <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
              {/* Canvas 挂载容器 */}
              <div ref={setContainerEl} className="w-full h-full flex items-center justify-center" />

              {/* 诗书画印：所见即所得多段书画题款与真迹印章浮动层 */}
              {sessionStatus === 'ready' && !hasGenerated && (
                <InkWashInscriptionOverlay
                  inscriptions={inscriptions}
                  selectedId={selectedInscriptionId}
                  onSelectId={setSelectedInscriptionId}
                  containerWidth={containerEl?.clientWidth || 400}
                  containerHeight={containerEl?.clientHeight || 400}
                  disabled={isGenerating}
                  isAddingNew={isAddingNewInscription}
                  onConfirmAdd={handleConfirmAddInscription}
                  onCancelAdd={handleCancelAddInscription}
                  onUpdateItem={handleUpdateInscriptionItem}
                  onDeleteItem={handleDeleteInscriptionItem}
                />
              )}


              {/* 加载动效遮罩 */}
              {sessionStatus === 'loading' && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2.5 bg-paper/80 backdrop-blur-[2px] text-ink-light pointer-events-none">
                  <Loader2 size={26} className="animate-spin motion-reduce:animate-none text-accent" />
                  <span className="text-xs font-sans text-ink-light font-medium">正在准备水墨宣纸…</span>
                </div>
              )}

              {/* 错误提示遮罩 */}
              {sessionStatus === 'error' && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-paper/90 backdrop-blur-sm text-ink-faint p-4 text-center">
                  <span className="text-xs">无法建立 WebGL2 流体动力学模拟上下文</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSessionStatus('idle');
                      patchParam({ seed: Date.now() % 100000 });
                    }}
                    className="px-2.5 py-1 rounded text-xs bg-paper-grid/40 hover:bg-paper-grid/70 active:scale-[0.96] transition-colors duration-150"
                  >
                    重试
                  </button>
                </div>
              )}
            </div>
          ) : (
            <PhotoProvider maskOpacity={0.85} bannerVisible={false}>
              <div className="relative w-full h-full flex items-center justify-center p-2">
                {data.imageUrl ? (
                  <div className="relative group max-w-full max-h-full flex items-center justify-center">
                    <PhotoView src={data.imageUrl}>
                      <img
                        src={data.imageUrl}
                        alt="水墨写意预览"
                        className="max-w-full max-h-[460px] object-contain drop-shadow-md select-none rounded cursor-zoom-in hover:opacity-95 transition-opacity"
                      />
                    </PhotoView>
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="absolute bottom-3 right-3 px-2.5 py-1.5 rounded-full bg-paper/90 backdrop-blur text-ink text-xs shadow-md border border-paper-grid/40 hover:bg-white hover:text-accent active:scale-[0.96] transition-[opacity,transform,background-color,color] flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent duration-150 z-10"
                    >
                      <Pencil size={12} strokeWidth={1.5} />
                      <span>继续挥毫</span>
                    </button>
                  </div>
                ) : (
                  <div className="text-xs text-ink-faint">暂无水墨生成结果</div>
                )}
              </div>
            </PhotoProvider>
          )}

          {isGenerating && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-black/35 backdrop-blur-sm text-paper">
              <Loader2 size={28} className="animate-spin motion-reduce:animate-none" />
              <span className="text-xs">正在渲染高清写意水墨…</span>
            </div>
          )}
        </div>

        {/* 状态弱提示 */}
        {recordDeleted && hasGenerated && !isExporting && (
          <div className="flex items-center justify-end gap-1.5 text-right text-xs text-ink-faint font-sans">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent/60" />
            记录已删除 · 收藏将重新生成记录
          </div>
        )}
      </div>
    </CanvasNode>
  );
};

export const InkWashNode = memo(InkWashNodeInner);
InkWashNode.displayName = 'InkWashNode';
export default InkWashNode;
