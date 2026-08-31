import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Scissors,
  Heart,
  Globe,
  Upload,
  Trash2,
  Sparkles,
  Loader2,
  Pencil,
  Check,
  Type,
} from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import {
  type StampAspectRatio,
  type StampCropBox,
  type StampGrid,
  type StampTextItem,
  type StampCutterState,
  type StampGestureMode,
  StampTextItemView,
  StampTextToolbar,
  STAMP_TEXT_PRESETS,
  renderStampFromImage,
  loadImage,
  downloadStampImage,
} from '../stamp';

import { usePreloadJournalFonts } from '../journal/text/FontControls';

export interface StampCutterNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 节点持久化数据 */
  data?: Partial<StampCutterState> & {
    imageUrl?: string | null;
    uploadedImage?: string | null;
    isExporting?: boolean;
    error?: string | null;
  };
  /** 上游图书元数据封面图或直接上级图片输出 */
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
  /** 状态更新写入 node.data */
  onUpdateState?: (id: string, patch: Partial<StampCutterState>) => void;
  /** 导出邮票：PNG Data URL 落盘保存 + 写入历史数据库 */
  onExport?: (id: string, dataUrl: string, state: StampCutterState) => Promise<void>;
}

/** 默认 3:4 比例的初始选框 */
const DEFAULT_CROP_BOX: StampCropBox = {
  x: 0.2,
  y: 0.15,
  width: 0.6,
  height: 0.7,
};

const StampCutterNodeInner: React.FC<StampCutterNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  data = {},
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

  // 预加载全部手账与邮票共用字体
  usePreloadJournalFonts();

  // 1. 输入图片四级优先级：本地上传 > 直连图片/穿透封面/根节点封面兜底
  const activeImageSrc = useMemo(() => {
    return data?.uploadedImage || upstreamImageUrl || null;
  }, [data?.uploadedImage, upstreamImageUrl]);

  const [withMargin, setWithMargin] = useState<boolean>(
    data.withMargin !== undefined ? data.withMargin : true
  );
  const [aspectRatio, setAspectRatio] = useState<StampAspectRatio>(
    data.aspectRatio || '3:4'
  );
  const [grid, setGrid] = useState<StampGrid>(
    data.grid || { rows: 1, cols: 1 }
  );
  const [cropBox, setCropBox] = useState<StampCropBox>(
    data.cropBox || DEFAULT_CROP_BOX
  );
  const [textItems, setTextItems] = useState<StampTextItem[]>(
    data.textItems || []
  );

  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [activeGestureId, setActiveGestureId] = useState<string | null>(null);

  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isAnimatingCrop, setIsAnimatingCrop] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(!data?.imageUrl);

  const containerRef = useRef<HTMLDivElement>(null);
  const cropBoxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 选框实际像素宽度（供文字缩放计算字号）
  const [cropBoxWidthPx, setCropBoxWidthPx] = useState<number>(300);

  // 选框拖拽与缩放状态
  const [isDraggingBox, setIsDraggingBox] = useState(false);
  const [isResizingBox, setIsResizingBox] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; box: StampCropBox } | null>(null);

  // 文字手势引用
  const textGestureRef = useRef<{
    mode: StampGestureMode;
    itemId: string;
    startPx: number;
    startPy: number;
    startX: number;
    startY: number;
    startW: number;
    startAngle: number;
    startPointerAngle: number;
    centerPx: number;
    centerPy: number;
    boxW: number;
    boxH: number;
  } | null>(null);

  // 当外部 data.imageUrl 变更时同步编辑态
  useEffect(() => {
    if (data?.imageUrl) {
      setIsEditing(false);
    } else {
      setIsEditing(true);
    }
  }, [data?.imageUrl]);

  // 当外部 data.textItems 变更时同步文字项
  useEffect(() => {
    if (data?.textItems !== undefined) {
      setTextItems(data.textItems);
    }
  }, [data?.textItems]);

  // 监听选框尺寸变化
  useEffect(() => {
    if (cropBoxRef.current) {
      setCropBoxWidthPx(cropBoxRef.current.offsetWidth || 300);
    }
  }, [cropBox, aspectRatio, isEditing]);

  // 根据选定单张比例与多联版式调整选框高度/宽度
  const applyAspectRatio = useCallback(
    (ratio: StampAspectRatio, currentBox: StampCropBox, currentGrid: StampGrid = grid) => {
      if (ratio === 'free') return currentBox;
      let singleRatio = 3 / 4;
      if (ratio === '4:3') singleRatio = 4 / 3;
      if (ratio === '1:1') singleRatio = 1;

      // 考虑多联网格版式计算整组裁剪目标长宽比
      const targetRatio = (singleRatio * currentGrid.cols) / currentGrid.rows;

      // 获取当前图片实际物理比例以做精准换算
      const img = imgRef.current;
      const imgRatio = img && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;

      // 归一化坐标系下的宽高比换算
      const normRatio = targetRatio / imgRatio;
      let newW = currentBox.width;
      let newH = newW / normRatio;

      if (newH > 0.9) {
        newH = 0.85;
        newW = newH * normRatio;
      }
      if (newW > 0.9) {
        newW = 0.85;
        newH = newW / normRatio;
      }

      const newX = Math.max(0, Math.min(1 - newW, currentBox.x + (currentBox.width - newW) / 2));
      const newY = Math.max(0, Math.min(1 - newH, currentBox.y + (currentBox.height - newH) / 2));

      return {
        x: newX,
        y: newY,
        width: Math.min(1, newW),
        height: Math.min(1, newH),
      };
    },
    [grid]
  );

  // 切换长宽比
  const handleRatioChange = (ratio: StampAspectRatio) => {
    setAspectRatio(ratio);
    const adjusted = applyAspectRatio(ratio, cropBox, grid);
    setCropBox(adjusted);
    onUpdateState?.(id, { aspectRatio: ratio, cropBox: adjusted, grid, textItems });
  };

  // 切换多联版式
  const handleGridChange = (newGrid: StampGrid) => {
    setGrid(newGrid);
    const adjusted = applyAspectRatio(aspectRatio, cropBox, newGrid);
    setCropBox(adjusted);
    onUpdateState?.(id, { grid: newGrid, cropBox: adjusted, textItems });
  };

  // 切换白边开关
  const handleToggleMargin = () => {
    const next = !withMargin;
    setWithMargin(next);
    onUpdateState?.(id, { withMargin: next, textItems });
  };

  // 添加文字素材（智能分配默认位置与样式）
  const handleAddText = useCallback(
    (preset?: { text: string; writingMode?: 'horizontal' | 'vertical'; w?: number }) => {
      const count = textItems.length;
      const maxZ = textItems.reduce((m, it) => Math.max(m, it.z), 0);

      let defaultX = 50;
      let defaultY = 50;
      let defaultW = 7;
      let defaultText = '¥6.00';
      let defaultWritingMode: 'horizontal' | 'vertical' = 'horizontal';
      let defaultColor = '#8b5e3c';

      if (count === 0) {
        // 第 1 个：经典左上面值
        defaultX = 20;
        defaultY = 16;
        defaultW = 9;
        defaultText = '¥6.00';
        defaultColor = '#8b5e3c';
      } else if (count === 1) {
        // 第 2 个：右上竖排地名与主题
        defaultX = 84;
        defaultY = 26;
        defaultW = 7;
        defaultText = '北京\nBEIJING';
        defaultWritingMode = 'vertical';
        defaultColor = '#2d2a24';
      } else if (count === 2) {
        // 第 3 个：左下角志号/年份
        defaultX = 18;
        defaultY = 92;
        defaultW = 4.5;
        defaultText = '2024-1';
        defaultColor = '#2d2a24';
      } else {
        // 第 4 个及以上：中国邮政铭记等
        defaultX = 50;
        defaultY = 92;
        defaultW = 5;
        defaultText = '中国邮政 CHINA';
        defaultColor = '#2d2a24';
      }

      const newItem: StampTextItem = {
        id: `st-text-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text: preset?.text || defaultText,
        fontFamily: '思源宋体',
        color: defaultColor,
        writingMode: preset?.writingMode || defaultWritingMode,
        textAlign: 'center',
        x: defaultX,
        y: defaultY,
        w: preset?.w || defaultW,
        angle: 0,
        z: maxZ + 1,
      };


      const next = [...textItems, newItem];
      setTextItems(next);
      setSelectedTextId(newItem.id);
      onUpdateState?.(id, { textItems: next });
      showToast('已添加文字素材', { type: 'success' });
    },
    [textItems, id, onUpdateState, showToast]
  );

  // 更新文字素材属性
  const handleUpdateTextItem = useCallback(
    (itemId: string, patch: Partial<StampTextItem>) => {
      setTextItems((prev) => {
        const next = prev.map((it) => (it.id === itemId ? { ...it, ...patch } : it));
        onUpdateState?.(id, { textItems: next });
        return next;
      });
    },
    [id, onUpdateState]
  );

  // 删除文字素材
  const handleDeleteTextItem = useCallback(
    (itemId: string) => {
      setTextItems((prev) => {
        const next = prev.filter((it) => it.id !== itemId);
        onUpdateState?.(id, { textItems: next });
        return next;
      });
      setSelectedTextId(null);
      showToast('已删除文字', { type: 'success' });
    },
    [id, onUpdateState, showToast]
  );

  // 文字图层层级移动
  const handleBumpTextLayer = useCallback(
    (itemId: string, mode: 'up' | 'down' | 'top' | 'bottom') => {
      const sorted = [...textItems].sort((a, b) => a.z - b.z);
      const idx = sorted.findIndex((it) => it.id === itemId);
      if (idx < 0) return;
      let target = idx;
      if (mode === 'up') target = Math.min(sorted.length - 1, idx + 1);
      else if (mode === 'down') target = Math.max(0, idx - 1);
      else if (mode === 'top') target = sorted.length - 1;
      else target = 0;
      if (target === idx) return;
      const [picked] = sorted.splice(idx, 1);
      sorted.splice(target, 0, picked);
      const next = sorted.map((it, i) => ({ ...it, z: i }));
      setTextItems(next);
      onUpdateState?.(id, { textItems: next });
    },
    [textItems, id, onUpdateState]
  );

  // 步进旋转 90 度
  const handleRotateStepText = useCallback(
    (itemId: string, direction: 'cw' | 'ccw') => {
      setTextItems((prev) => {
        const next = prev.map((it) => {
          if (it.id !== itemId) return it;
          const step = direction === 'cw' ? 90 : -90;
          const raw = (it.angle || 0) + step;
          const snapped = Math.round(raw / 90) * 90;
          const normalized = ((snapped % 360) + 360) % 360;
          return { ...it, angle: normalized > 180 ? normalized - 360 : normalized };
        });
        onUpdateState?.(id, { textItems: next });
        return next;
      });
    },
    [id, onUpdateState]
  );

  // 确认修改文字内容
  const confirmTextEdit = useCallback(() => {
    if (!editingTextId) return;
    setTextItems((prev) => {
      const next = prev.map((it) =>
        it.id === editingTextId ? { ...it, text: editingText.trim() || '文字' } : it
      );
      onUpdateState?.(id, { textItems: next });
      return next;
    });
    setEditingTextId(null);
    setEditingText('');
  }, [editingTextId, editingText, id, onUpdateState]);

  // 监听键盘快捷键（Delete / Backspace 删除选中的文字，Esc 取消选中）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 若处于弹窗编辑态或焦点在输入控件内，不拦截按键
      if (editingTextId) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
      }

      if (selectedTextId) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          handleDeleteTextItem(selectedTextId);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setSelectedTextId(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedTextId, editingTextId, handleDeleteTextItem]);


  // 文字手势操作：拖动、缩放、旋转
  const handleTextGestureStart = (
    e: React.PointerEvent<HTMLElement>,
    item: StampTextItem,
    mode: StampGestureMode
  ) => {

    if (e.button !== 0 || !isEditing || isExporting || isAnimatingCrop) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect?.(id);

    const boxEl = cropBoxRef.current;
    if (!boxEl) return;
    const boxRect = boxEl.getBoundingClientRect();

    let centerPx = boxRect.left + (item.x / 100) * boxRect.width;
    let centerPy = boxRect.top + (item.y / 100) * boxRect.height;
    let startPointerAngle = 0;

    if (mode === 'rotate') {
      startPointerAngle =
        (Math.atan2(e.clientY - centerPy, e.clientX - centerPx) * 180) / Math.PI;
    }

    textGestureRef.current = {
      mode,
      itemId: item.id,
      startPx: e.clientX,
      startPy: e.clientY,
      startX: item.x,
      startY: item.y,
      startW: item.w,
      startAngle: item.angle || 0,
      startPointerAngle,
      centerPx,
      centerPy,
      boxW: boxRect.width,
      boxH: boxRect.height,
    };

    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      // 忽略可能未 capture 的异常
    }
    setSelectedTextId(item.id);
    setActiveGestureId(item.id);
  };

  // 鼠标在选框内按下开始拖拽移动选框
  const handleBoxPointerDown = (e: React.PointerEvent) => {
    if (!isEditing || isExporting || isAnimatingCrop) return;
    // 点击空白处取消文字选中态
    setSelectedTextId(null);
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsDraggingBox(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      box: { ...cropBox },
    };
  };

  // 选框右下角手柄缩放
  const handleResizePointerDown = (e: React.PointerEvent) => {
    if (!isEditing || isExporting || isAnimatingCrop) return;
    setSelectedTextId(null);
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsResizingBox(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      box: { ...cropBox },
    };
  };

  // 拖拽与缩放移动事件
  const handlePointerMove = (e: React.PointerEvent) => {
    // 优先响应文字手势
    if (textGestureRef.current) {
      const g = textGestureRef.current;
      if (g.boxW <= 0 || g.boxH <= 0) return;
      e.stopPropagation();

      setTextItems((prev) =>
        prev.map((it) => {
          if (it.id !== g.itemId) return it;
          if (g.mode === 'move') {
            const dx = ((e.clientX - g.startPx) / g.boxW) * 100;
            const dy = ((e.clientY - g.startPy) / g.boxH) * 100;
            return {
              ...it,
              x: Math.max(0, Math.min(100, g.startX + dx)),
              y: Math.max(0, Math.min(100, g.startY + dy)),
            };
          }
          if (g.mode === 'resize') {
            const dw = ((e.clientX - g.startPx) / g.boxW) * 100;
            return {
              ...it,
              w: Math.max(2, Math.min(30, g.startW + dw)),
            };
          }
          if (g.mode === 'rotate') {
            const curAngle =
              (Math.atan2(e.clientY - g.centerPy, e.clientX - g.centerPx) * 180) / Math.PI;
            const delta = curAngle - g.startPointerAngle;
            return {
              ...it,
              angle: Math.round((g.startAngle + delta) * 10) / 10,
            };
          }
          return it;
        })
      );
      return;
    }

    if (!dragStartRef.current || !imgRef.current) return;
    const imgRect = imgRef.current.getBoundingClientRect();
    if (imgRect.width <= 0 || imgRect.height <= 0) return;

    const deltaX = (e.clientX - dragStartRef.current.mouseX) / imgRect.width;
    const deltaY = (e.clientY - dragStartRef.current.mouseY) / imgRect.height;
    const origBox = dragStartRef.current.box;

    if (isDraggingBox) {
      const nextX = Math.max(0, Math.min(1 - origBox.width, origBox.x + deltaX));
      const nextY = Math.max(0, Math.min(1 - origBox.height, origBox.y + deltaY));
      setCropBox((prev) => ({ ...prev, x: nextX, y: nextY }));
    } else if (isResizingBox) {
      let nextW = Math.max(0.15, Math.min(1 - origBox.x, origBox.width + deltaX));
      let nextH = Math.max(0.15, Math.min(1 - origBox.y, origBox.height + deltaY));

      if (aspectRatio !== 'free') {
        const img = imgRef.current;
        const imgRatio = img && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
        let singleRatio = 3 / 4;
        if (aspectRatio === '4:3') singleRatio = 4 / 3;
        if (aspectRatio === '1:1') singleRatio = 1;
        const targetRatio = (singleRatio * grid.cols) / grid.rows;
        const normRatio = targetRatio / imgRatio;

        nextH = nextW / normRatio;
        if (origBox.y + nextH > 1) {
          nextH = 1 - origBox.y;
          nextW = nextH * normRatio;
        }
      }

      setCropBox((prev) => ({
        ...prev,
        width: Math.min(1 - origBox.x, nextW),
        height: Math.min(1 - origBox.y, nextH),
      }));
    }
  };

  // 松开鼠标，保存状态
  const handlePointerUp = (e: React.PointerEvent) => {
    if (textGestureRef.current) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }
      textGestureRef.current = null;
      setActiveGestureId(null);
      onUpdateState?.(id, { textItems });
      return;
    }

    if (isDraggingBox || isResizingBox) {
      setIsDraggingBox(false);
      setIsResizingBox(false);
      dragStartRef.current = null;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // 忽略可能未 capture 的异常
      }
      onUpdateState?.(id, { cropBox, textItems });
    }
  };

  // 鼠标滚轮在图片上快速缩放选框
  const handleWheelOnImage = (e: React.WheelEvent) => {
    if (!isEditing || isExporting || isAnimatingCrop) return;
    e.stopPropagation();
    const zoomFactor = e.deltaY < 0 ? 0.05 : -0.05;
    setCropBox((prev) => {
      let newW = Math.max(0.15, Math.min(1, prev.width * (1 + zoomFactor)));
      let newH = Math.max(0.15, Math.min(1, prev.height * (1 + zoomFactor)));

      if (aspectRatio !== 'free') {
        const img = imgRef.current;
        const imgRatio = img && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
        let singleRatio = 3 / 4;
        if (aspectRatio === '4:3') singleRatio = 4 / 3;
        if (aspectRatio === '1:1') singleRatio = 1;
        const targetRatio = (singleRatio * grid.cols) / grid.rows;
        const normRatio = targetRatio / imgRatio;
        newH = newW / normRatio;
      }

      const newX = Math.max(0, Math.min(1 - newW, prev.x + (prev.width - newW) / 2));
      const newY = Math.max(0, Math.min(1 - newH, prev.y + (prev.height - newH) / 2));
      const next = { x: newX, y: newY, width: newW, height: newH };
      onUpdateState?.(id, { cropBox: next, textItems });
      return next;
    });
  };

  // 重置选框到居中初始状态（若在成品展示态，则清空生成图片回退到选框模式）
  const handleResetCrop = useCallback(() => {
    const defaultGrid = { rows: 1, cols: 1 };
    setGrid(defaultGrid);
    const initial = applyAspectRatio('3:4', DEFAULT_CROP_BOX, defaultGrid);
    setCropBox(initial);
    setAspectRatio('3:4');
    setWithMargin(true);
    setSelectedTextId(null);
    if (data?.imageUrl && !isEditing) {
      setIsEditing(true);
      onUpdateState?.(id, {
        imageUrl: null,
        cropBox: initial,
        aspectRatio: '3:4',
        withMargin: true,
        grid: defaultGrid,
        textItems,
      });
      showToast('已重置并返回选框模式', { type: 'success' });
    } else {
      onUpdateState?.(id, {
        cropBox: initial,
        aspectRatio: '3:4',
        withMargin: true,
        grid: defaultGrid,
        textItems,
      });
      showToast('选框已重置为居中', { type: 'success' });
    }
  }, [applyAspectRatio, data?.imageUrl, isEditing, id, textItems, onUpdateState, showToast]);

  // 本地上传图片
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件', { type: 'warning' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      const result = evt.target?.result as string;
      if (result) {
        onUpdateState?.(id, { uploadedImage: result, imageUrl: null, textItems });
        setIsEditing(true);
        showToast('已加载本地图片', { type: 'success' });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // 清空本地上传图片，恢复上游继承
  const handleClearUpload = () => {
    onUpdateState?.(id, { uploadedImage: null, imageUrl: null, textItems });
    setIsEditing(true);
    showToast('已恢复上级输入图片', { type: 'success' });
  };

  // 执行纯前端离线截取与文字合成（不写数据库，毫秒级所见即所得）
  const handleExecuteCrop = useCallback(async () => {
    if (!activeImageSrc || isExporting) return;
    setIsAnimatingCrop(true);

    try {
      // 1. 加载源图
      const img = await loadImage(activeImageSrc);

      // 2. 离线 Canvas 高保真渲染（含裁剪、打孔、文字排版与立体阴影）
      const resultDataUrl = await renderStampFromImage(img, cropBox, {
        withMargin,
        grid,
        textItems,
      });

      // 3. 优雅过渡延迟让动画自然展现
      await new Promise((resolve) => setTimeout(resolve, 360));

      // 4. 更新节点数据（此时为未保存到数据库状态）
      onUpdateState?.(id, {
        imageUrl: resultDataUrl,
        isSaved: false,
        withMargin,
        aspectRatio,
        grid,
        cropBox,
        textItems,
        uploadedImage: data.uploadedImage || null,
      });

      setIsEditing(false);
      showToast('邮票制作完成（可点击保存按钮写入数据库）', { type: 'success' });
    } catch (err: any) {
      console.error('截取邮票失败:', err);
      showToast(err?.message || '生成邮票失败，请重试', { type: 'error' });
    } finally {
      setIsAnimatingCrop(false);
    }
  }, [
    activeImageSrc,
    isExporting,
    cropBox,
    withMargin,
    grid,
    textItems,
    id,
    aspectRatio,
    data.uploadedImage,
    onUpdateState,
    showToast,
  ]);

  // 独立保存到数据库
  const handleSaveToDatabase = useCallback(async () => {
    const imgUrl = data?.imageUrl;
    if (!imgUrl || isExporting || !onExport) return;
    setIsExporting(true);

    try {
      await onExport(id, imgUrl, {
        withMargin,
        aspectRatio,
        grid,
        cropBox,
        textItems,
        uploadedImage: data.uploadedImage || null,
        isSaved: true,
      });
      onUpdateState?.(id, { isSaved: true });
      onSelect?.(id);
      showToast('邮票已保存到数据库，已解锁公开与收藏', { type: 'success' });
    } catch (err: any) {
      console.error('保存到数据库失败:', err);
      showToast(err?.detail || err?.message || '保存失败，请重试', { type: 'error' });
    } finally {
      setIsExporting(false);
    }
  }, [
    data?.imageUrl,
    isExporting,
    onExport,
    id,
    withMargin,
    aspectRatio,
    grid,
    cropBox,
    textItems,
    data?.uploadedImage,
    onUpdateState,
    onSelect,
    showToast,
  ]);

  // 本地直接下载 PNG（随时可用，不影响下载）
  const handleDownload = useCallback(() => {
    const url = data?.imageUrl;
    if (!url) return;
    downloadStampImage(url, `stamp-${Date.now()}.png`);
    showToast('邮票图片已下载', { type: 'success' });
  }, [data?.imageUrl, showToast]);

  // 收藏与公开
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
  const selectedTextItem = useMemo(
    () => textItems.find((it) => it.id === selectedTextId),
    [textItems, selectedTextId]
  );

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '邮票截图框'}
      dotColor={NODE_COLORS.stamp_cutter || 'oklch(0.68 0.16 25)'}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 440, height: 560 }}
      className={`transition-[opacity,transform,box-shadow,border-color] duration-150 ease-out ${
        isSelected ? 'ring-2 ring-accent/70 shadow-md' : ''
      }`}
      showLeftAnchor={true}
      showRightAnchor={true}
      onClick={() => onSelect?.(id)}
      footer={footer}
      mismatchBadge={mismatchBadge}
      actionBar={
        <NodeActionBar>
          {hasGenerated ? (
            <>
              <NodeActionBar.Retry
                onClick={() => setIsEditing(true)}
                disabled={isExporting}
                tooltip="重新调整选框与排版"
              />
              <NodeActionBar.Custom
                icon={<Upload size={16} strokeWidth={1.5} />}
                tooltip="上传/替换本地图片"
                onClick={() => fileInputRef.current?.click()}
                disabled={isExporting}
              />
              {data?.uploadedImage && (
                <NodeActionBar.Custom
                  icon={<Trash2 size={16} strokeWidth={1.5} className="text-error/80 hover:text-error" />}
                  tooltip="恢复上级继承图片（清空本地上传）"
                  onClick={handleClearUpload}
                  disabled={isExporting}
                />
              )}
              {/* 独立保存到数据库按钮 */}
              <NodeActionBar.Custom
                icon={<Check size={16} strokeWidth={isSaved ? 2.5 : 1.5} className={isSaved ? 'text-accent' : ''} />}
                onClick={handleSaveToDatabase}
                disabled={isExporting || isSaved}
                tooltip={isSaved ? '已保存到数据库' : '保存到数据库（保存后可公开/收藏）'}
                className={isSaved ? 'text-accent opacity-70' : 'text-ink-light hover:text-accent'}
              />
              {/* 收藏按钮（未保存时禁用并提示） */}
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
              {/* 公开按钮（未保存时禁用并提示） */}
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
              {/* 下载按钮（随时可用，不影响下载） */}
              <NodeActionBar.Download
                onClick={handleDownload}
                disabled={isExporting}
                tooltip="直接下载邮票 PNG"
              />
              <NodeActionBar.Reset
                onClick={handleResetCrop}
                disabled={isExporting}
                tooltip="重置为初始选框态"
              />
            </>
          ) : (
            <>
              <NodeActionBar.Custom
                icon={
                  isExporting || isAnimatingCrop ? (
                    <Loader2 size={16} className="animate-spin text-accent" />
                  ) : (
                    <Scissors size={16} strokeWidth={1.5} />
                  )
                }
                tooltip="截取并生成邮票"
                onClick={handleExecuteCrop}
                disabled={!activeImageSrc || isExporting || isAnimatingCrop}
              />
              <NodeActionBar.Custom
                icon={<Type size={16} strokeWidth={1.5} />}
                tooltip="添加文字素材 (面值/地名/志号)"
                onClick={() => handleAddText()}
                disabled={!activeImageSrc || isExporting || isAnimatingCrop}
              />
              <NodeActionBar.Custom
                icon={<Upload size={16} strokeWidth={1.5} />}
                tooltip="上传/替换本地图片"
                onClick={() => fileInputRef.current?.click()}
                disabled={isExporting || isAnimatingCrop}
              />
              {data?.uploadedImage && (
                <NodeActionBar.Custom
                  icon={<Trash2 size={16} strokeWidth={1.5} className="text-error/80 hover:text-error" />}
                  tooltip="恢复上级继承图片（清空本地上传）"
                  onClick={handleClearUpload}
                  disabled={isExporting || isAnimatingCrop}
                />
              )}
              <NodeActionBar.Reset
                onClick={handleResetCrop}
                disabled={isExporting || isAnimatingCrop}
                tooltip="重置选框位置"
              />
            </>
          )}
        </NodeActionBar>
      }
    >
      {/* 隐藏的真实文件上传 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileUpload}
      />

      <div className="h-full flex flex-col flex-1 min-h-0 gap-2">
        {/* 顶部工具栏（始终展示邮票版式参数） */}
        {isEditing && (
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-paper-grid/20 border border-paper-grid/40 text-xs font-sans text-ink-light select-none shrink-0 flex-wrap">
            {/* 左组：版式选择与比例分段控制 */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-ink-faint text-[11px] px-0.5 whitespace-nowrap">版式:</span>
                <select
                  value={`${grid.rows}x${grid.cols}`}
                  onChange={(e) => {
                    const [r, c] = e.target.value.split('x').map(Number);
                    if (r && c) {
                      handleGridChange({ rows: r, cols: c });
                    }
                  }}
                  className="bg-paper/90 border border-paper-grid/60 text-ink rounded px-1.5 py-0.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
                >
                  <optgroup label="基础">
                    <option value="1x1">1×1 单张</option>
                  </optgroup>
                  <optgroup label="竖版多联">
                    <option value="2x1">1×2 竖双联</option>
                    <option value="3x1">1×3 竖三联</option>
                    <option value="4x1">1×4 竖四联</option>
                  </optgroup>
                  <optgroup label="横版多联">
                    <option value="1x2">2×1 横双联</option>
                    <option value="1x3">3×1 横三联</option>
                    <option value="1x4">4×1 横四联</option>
                  </optgroup>
                  <optgroup label="方形/网格多联">
                    <option value="2x2">2×2 四方联</option>
                    <option value="2x3">3×2 六联</option>
                    <option value="3x2">2×3 六联</option>
                    <option value="3x3">3×3 九联</option>
                  </optgroup>
                </select>
              </div>

              <div className="w-px h-3.5 bg-paper-grid/60 my-auto shrink-0" />

              <div className="flex items-center p-0.5 rounded-md bg-paper-grid/30 border border-paper-grid/50 select-none shrink-0">
                {(['3:4', '4:3', '1:1', 'free'] as StampAspectRatio[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => handleRatioChange(r)}
                    className={`px-1.5 py-0.5 rounded text-[11px] transition duration-150 ${
                      aspectRatio === r
                        ? 'bg-paper shadow-2xs text-accent font-medium'
                        : 'text-ink-light hover:text-ink hover:bg-paper-grid/40'
                    }`}
                  >
                    {r === 'free' ? '自由' : r}
                  </button>
                ))}
              </div>
            </div>

            {/* 右组：纸边开关与添加文字操作 */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleToggleMargin}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition duration-150 ${
                  withMargin
                    ? 'bg-accent/15 text-accent font-medium'
                    : 'hover:bg-paper-grid/40 text-ink-light'
                }`}
                title={withMargin ? '开启白边' : '关闭白边'}
              >
                <Sparkles size={12} />
                <span>纸边</span>
              </button>

              <button
                type="button"
                onClick={() => handleAddText()}
                className="flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-accent/15 hover:bg-accent/25 text-accent active:scale-95 transition duration-150 font-medium text-xs shadow-2xs"
                title="在邮票上添加文字素材（面值/地名/志号）"
              >
                <Type size={12} />
                <span>+ 文字</span>
              </button>
            </div>
          </div>
        )}

        {/* 核心操作与预览画布 */}
        <div
          ref={containerRef}
          className="relative flex-1 min-h-0 w-full overflow-hidden rounded bg-paper-grid/10 border border-paper-grid/40 flex items-center justify-center select-none"
          onWheel={handleWheelOnImage}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onClick={() => setSelectedTextId(null)}
        >
          {/* 选中文本时的悬浮微交互工具栏（字体、颜色、横竖排、字号、图层与删除） */}
          {isEditing && selectedTextItem && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 pointer-events-auto">
              <StampTextToolbar
                variant="floating"
                item={selectedTextItem}
                disabled={isExporting || isAnimatingCrop}
                onUpdate={(patch) => handleUpdateTextItem(selectedTextItem.id, patch)}
                onOpenEdit={() => {
                  setEditingTextId(selectedTextItem.id);
                  setEditingText(selectedTextItem.text || '');
                }}
                onDelete={() => handleDeleteTextItem(selectedTextItem.id)}
                onBumpLayer={(mode) => handleBumpTextLayer(selectedTextItem.id, mode)}
                onRotateStep={(dir) => handleRotateStepText(selectedTextItem.id, dir)}
                onClose={() => setSelectedTextId(null)}
              />
            </div>
          )}

          <AnimatePresence mode="wait">
            {!hasGenerated ? (
              // 选框编辑模式
              <motion.div
                key="editor"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="relative w-full h-full flex items-center justify-center overflow-hidden p-2"
              >
                {activeImageSrc ? (
                  <div className="relative inline-flex items-center justify-center max-w-full max-h-full">
                    {/* 底图 */}
                    <img
                      ref={imgRef}
                      src={activeImageSrc}
                      alt="Crop Source"
                      className="max-w-full max-h-[420px] object-contain rounded shadow-sm pointer-events-none"
                      crossOrigin="anonymous"
                    />

                    {/* 全局暗色蒙层 */}
                    <div className="absolute inset-0 bg-black/45 pointer-events-none rounded transition-opacity duration-300" />

                    {/* 镂空高亮/打孔锯齿邮票选框 */}
                    <motion.div
                      ref={cropBoxRef}
                      style={{
                        position: 'absolute',
                        left: `${cropBox.x * 100}%`,
                        top: `${cropBox.y * 100}%`,
                        width: `${cropBox.width * 100}%`,
                        height: `${cropBox.height * 100}%`,
                      }}
                      animate={
                        isAnimatingCrop
                          ? {
                              scale: 1.15,
                              boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
                            }
                          : { scale: 1 }
                      }
                      transition={{ type: 'spring', damping: 20, stiffness: 220 }}
                      onPointerDown={handleBoxPointerDown}
                      className={`group cursor-move z-10 box-border flex items-center justify-center ${
                        isDraggingBox ? 'cursor-grabbing' : ''
                      }`}
                    >
                      {/* 选框内的清晰高亮原图镜像 */}
                      <div className="absolute inset-0 overflow-hidden rounded-[2px] shadow-lg pointer-events-none">
                        <div
                          className="absolute"
                          style={{
                            left: `-${(cropBox.x / cropBox.width) * 100}%`,
                            top: `-${(cropBox.y / cropBox.height) * 100}%`,
                            width: `${(1 / cropBox.width) * 100}%`,
                            height: `${(1 / cropBox.height) * 100}%`,
                          }}
                        >
                          <img
                            src={activeImageSrc}
                            alt=""
                            className="w-full h-full object-contain pointer-events-none"
                            crossOrigin="anonymous"
                          />
                        </div>
                      </div>

                      {/* 白色纸边框 (withMargin) */}
                      {withMargin && (
                        <div className="absolute inset-0 border-[6px] border-white/95 pointer-events-none shadow-sm" />
                      )}

                      {/* 外部锯齿打孔描边装饰 */}
                      <div className="absolute inset-0 border-2 border-dashed border-white/80 pointer-events-none" />

                      {/* 内部多联打孔分割线（横向与纵向） */}
                      {grid.rows > 1 &&
                        Array.from({ length: grid.rows - 1 }).map((_, idx) => {
                          const topPercent = ((idx + 1) / grid.rows) * 100;
                          return (
                            <div
                              key={`row-guide-${idx}`}
                              className="absolute left-0 right-0 pointer-events-none flex items-center justify-center z-10"
                              style={{ top: `${topPercent}%`, transform: 'translateY(-50%)' }}
                            >
                              <div className="w-full h-0 border-t-2 border-dotted border-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />
                            </div>
                          );
                        })}

                      {grid.cols > 1 &&
                        Array.from({ length: grid.cols - 1 }).map((_, idx) => {
                          const leftPercent = ((idx + 1) / grid.cols) * 100;
                          return (
                            <div
                              key={`col-guide-${idx}`}
                              className="absolute top-0 bottom-0 pointer-events-none flex items-center justify-center z-10"
                              style={{ left: `${leftPercent}%`, transform: 'translateX(-50%)' }}
                            >
                              <div className="h-full w-0 border-l-2 border-dotted border-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />
                            </div>
                          );
                        })}

                      {/* 选框内排版文字列表 */}
                      {textItems.map((item) => (
                        <StampTextItemView
                          key={item.id}
                          item={item}
                          selected={item.id === selectedTextId}
                          isGesturing={item.id === activeGestureId}
                          stageWidth={cropBoxWidthPx}
                          disabled={isExporting || isAnimatingCrop}
                          onSelect={() => setSelectedTextId(item.id)}
                          onOpenEdit={() => {
                            setEditingTextId(item.id);
                            setEditingText(item.text || '');
                          }}
                          onGestureStart={handleTextGestureStart}
                          onGestureMove={handlePointerMove}
                          onGestureEnd={handlePointerUp}
                        />
                      ))}

                      {/* 中央截取快捷悬浮按钮（仅在未选中文字时展示，避免遮挡） */}
                      {!selectedTextId && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleExecuteCrop();
                          }}
                          disabled={isExporting || isAnimatingCrop}
                          className="relative z-20 px-2.5 py-1 rounded-full bg-paper/90 backdrop-blur text-ink font-medium text-xs shadow-md hover:bg-white hover:scale-105 active:scale-95 transition flex items-center gap-1.5 opacity-0 group-hover:opacity-100 duration-150"
                        >
                          <Scissors size={13} className="text-accent" />
                          <span>点击截取</span>
                        </button>
                      )}

                      {/* 缩放手柄（右下角） */}
                      <div
                        onPointerDown={handleResizePointerDown}
                        className="absolute -right-1.5 -bottom-1.5 w-4 h-4 bg-accent rounded-full border-2 border-white cursor-se-resize shadow-md flex items-center justify-center hover:scale-125 transition z-20"
                        title="拖拽缩放选框"
                      >
                        <div className="w-1.5 h-1.5 bg-white rounded-full" />
                      </div>
                    </motion.div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-ink-faint gap-2 p-6 text-center">
                    <Upload size={32} strokeWidth={1.2} />
                    <p className="text-xs">请连线上级图片或点击上方按钮上传本地图片</p>
                  </div>
                )}
              </motion.div>
            ) : (
              // 截取完成展示模式
              <motion.div
                key="preview"
                initial={{ scale: 0.88, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.88, opacity: 0 }}
                transition={{ type: 'spring', damping: 22, stiffness: 240 }}
                className="relative w-full h-full flex items-center justify-center p-3"
              >
                {data.imageUrl ? (
                  <div className="relative group max-w-full max-h-full flex items-center justify-center">
                    <img
                      src={data.imageUrl}
                      alt="Stamp Output"
                      className="max-w-full max-h-[440px] object-contain drop-shadow-md select-none pointer-events-none"
                    />

                    {/* 快捷悬浮重新编辑按钮 */}
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-paper/90 backdrop-blur text-ink text-xs shadow-md border border-paper-grid/40 hover:bg-white hover:text-accent transition flex items-center gap-1.5 opacity-0 group-hover:opacity-100 duration-150"
                    >
                      <Pencil size={12} />
                      <span>重新排版</span>
                    </button>
                  </div>
                ) : (
                  <div className="text-xs text-ink-faint">暂无邮票生成结果</div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* 内联文字编辑弹层 */}
          {editingTextId && (
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4"
              onClick={() => confirmTextEdit()}
            >
              <div
                className="bg-paper border border-paper-grid/80 rounded-xl p-3.5 shadow-2xl w-full max-w-[320px] flex flex-col gap-2.5 animate-in fade-in zoom-in-95 duration-150 select-text"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between text-xs font-medium text-ink">
                  <span className="font-sans font-semibold">编辑邮票文字</span>
                  <span className="text-[10px] text-ink-faint">Enter 确定 · Shift+Enter 换行</span>
                </div>
                <textarea
                  autoFocus
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      confirmTextEdit();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setEditingTextId(null);
                      setEditingText('');
                    }
                  }}
                  className="w-full h-20 bg-paper-grid/20 border border-paper-grid/60 rounded-md p-2 text-xs font-sans text-ink focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                  placeholder="输入面值、地名、志号或发行文字..."
                />

                {/* 常用邮票词条快捷填充 */}
                <div className="flex flex-col gap-1.5 pt-1 border-t border-paper-grid/40">
                  <span className="text-[10px] text-ink-faint select-none">快捷填入常用邮票格式:</span>
                  <div className="flex flex-col gap-1">
                    {STAMP_TEXT_PRESETS.map((group) => (
                      <div key={group.group} className="flex items-center gap-1 flex-wrap">
                        <span className="text-[10px] text-ink-faint w-14 shrink-0">{group.group}:</span>
                        {group.items.map((pst) => (
                          <button
                            key={pst.label}
                            type="button"
                            onClick={() => {
                              setEditingText(pst.text);
                              if (selectedTextItem) {
                                handleUpdateTextItem(selectedTextItem.id, {
                                  ...(pst.writingMode ? { writingMode: pst.writingMode } : {}),
                                  ...(pst.w ? { w: pst.w } : {}),
                                });
                              }
                            }}
                            className="px-1.5 py-0.5 rounded bg-paper-grid/30 hover:bg-paper-grid/60 text-ink-light hover:text-ink text-[10px] active:scale-95 transition"
                          >
                            {pst.label}
                          </button>
                        ))}

                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-paper-grid/40">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingTextId(null);
                      setEditingText('');
                    }}
                    className="px-3 py-1 rounded text-xs text-ink-light hover:bg-paper-grid/40 transition"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={confirmTextEdit}
                    className="px-3.5 py-1 rounded text-xs bg-accent text-white font-medium hover:bg-accent/90 transition shadow-xs"
                  >
                    确定
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* 状态与弱提示 */}
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

export const StampCutterNode = memo(StampCutterNodeInner);
StampCutterNode.displayName = 'StampCutterNode';
export default StampCutterNode;
