import React, { memo, useEffect, useState, useCallback, useMemo } from 'react';
import { Languages, Loader2, ArrowLeftRight, AlertTriangle, Link2, Shuffle, Globe, Trash2 } from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { BeamGlow } from '../../../platform/components/node/BeamGlow';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Streamdown, cjk, code } from '../../../platform/utils/markdown';
import { normalizeMarkdown } from '../../../platform/utils/normalizeMarkdown';
import { NODE_COLORS } from '../nodeTypes';

export type TranslationSource = 'random' | 'google' | 'deeplx';

export interface TranslationRequest {
  text: string;
  from: string;
  to: string;
  source: TranslationSource;
}

export interface TranslationTabData {
  output: string;
  usedSource: string;
  error: string | null;
  isGenerating: boolean;
}

export const SOURCE_OPTIONS: { value: TranslationSource; label: string }[] = [
  { value: 'random', label: '随机' },
  { value: 'google', label: 'Google 翻译' },
  { value: 'deeplx', label: 'DeepLX' },
];

export const SOURCE_LABEL: Record<string, string> = {
  google: 'Google 翻译',
  deeplx: 'DeepLX',
};

export const COMMON_LANGUAGES = [
  { value: 'auto', label: '自动检测' },
  { value: 'zh-Hans', label: '简体中文' },
  { value: 'zh-Hant', label: '繁体中文' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
  { value: 'fr', label: '法语' },
  { value: 'es', label: '西班牙语' },
  { value: 'pt', label: '葡萄牙语' },
  { value: 'de', label: '德语' },
  { value: 'it', label: '意大利语' },
  { value: 'ru', label: '俄语' },
  { value: 'ar', label: '阿拉伯语' },
  { value: 'tr', label: '土耳其语' },
  { value: 'nl', label: '荷兰语' },
  { value: 'pl', label: '波兰语' },
  { value: 'sv', label: '瑞典语' },
  { value: 'da', label: '丹麦语' },
  { value: 'fi', label: '芬兰语' },
  { value: 'cs', label: '捷克语' },
  { value: 'ro', label: '罗马尼亚语' },
  { value: 'hu', label: '匈牙利语' },
  { value: 'el', label: '希腊语' },
  { value: 'id', label: '印尼语' },
  { value: 'vi', label: '越南语' },
  { value: 'th', label: '泰语' },
  { value: 'uk', label: '乌克兰语' },
  { value: 'bg', label: '保加利亚语' },
  { value: 'et', label: '爱沙尼亚语' },
  { value: 'lt', label: '立陶宛语' },
  { value: 'lv', label: '拉脱维亚语' },
  { value: 'sl', label: '斯洛文尼亚语' },
  { value: 'sk', label: '斯洛伐克语' },
  { value: 'hr', label: '克罗地亚语' },
  { value: 'nb', label: '挪威语' },
];

const TAB_INITIAL: TranslationTabData = { output: '', usedSource: '', error: null, isGenerating: false };

export interface TextTranslationNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  upstreamText?: string;
  from?: string;
  to?: string;
  source?: TranslationSource;
  tabData?: Partial<Record<TranslationSource, TranslationTabData>>;
  output?: string;
  isGenerating?: boolean;
  error?: string | null;
  onFetch?: (id: string, payload: TranslationRequest) => void;
  onUpdateEditor?: (id: string, patch: Record<string, any>) => void;
  onRemove?: (id: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  hasDownstream?: boolean;
}

const TextTranslationNodeInner: React.FC<TextTranslationNodeProps> = ({
  id, initialX, initialY, title,
  upstreamText = '', from = 'auto', to = 'en', source = 'random',
  tabData = {},
  onFetch, onUpdateEditor, onRemove, onPositionChange, onSizeChange, onDrag,
  footer, onContextMenu, hasDownstream,
}) => {
  const [fromLan, setFromLan] = useState(from);
  const [toLan, setToLan] = useState(to);
  const [activeSource, setActiveSource] = useState<TranslationSource>(source);

  useEffect(() => { setFromLan(from); }, [from]);
  useEffect(() => { setToLan(to); }, [to]);
  useEffect(() => { setActiveSource(source); }, [source]);

  const currentTab = useMemo<TranslationTabData>(
    () => ({ ...TAB_INITIAL, ...tabData[activeSource] }),
    [tabData, activeSource],
  );

  const hasUpstream = upstreamText.trim().length > 0;
  const effectiveText = hasUpstream ? upstreamText.trim() : '';

  const handleSourceChange = (src: TranslationSource) => {
    setActiveSource(src);
    onUpdateEditor?.(id, { source: src });
  };

  const handleTranslate = useCallback(() => {
    if (currentTab.isGenerating || hasDownstream || !effectiveText) return;

    onUpdateEditor?.(id, {
      tabData: {
        ...tabData,
        [activeSource]: { ...currentTab, isGenerating: true, error: null },
      },
      isGenerating: true,
      error: null,
    });

    onFetch?.(id, { text: effectiveText, from: fromLan, to: toLan, source: activeSource });
  }, [activeSource, currentTab, effectiveText, fromLan, hasDownstream, id, onFetch, onUpdateEditor, tabData, toLan]);

  const handleSwapLanguages = () => {
    if (fromLan === 'auto') return;
    setFromLan(toLan);
    setToLan(fromLan);
  };

  const handleClearCurrent = () => {
    if (hasDownstream || currentTab.isGenerating) return;
    const nextTab = { ...TAB_INITIAL };
    const nextTabData = { ...tabData, [activeSource]: nextTab };
    onUpdateEditor?.(id, {
      tabData: nextTabData,
      output: '',
      error: null,
    });
  };

  const renderActionBar = () => {
    if (currentTab.isGenerating) return undefined;
    return (
      <NodeActionBar>
        {(currentTab.output.trim() || currentTab.error) && (
          <NodeActionBar.Retry
            onClick={handleTranslate}
            error={!!currentTab.error}
            hasDownstream={hasDownstream}
            tooltip={currentTab.error ? '重试翻译' : '重新翻译'}
          />
        )}
        {currentTab.output.trim() && (
          <NodeActionBar.Copy
            text={currentTab.output}
            tooltip="复制翻译结果"
            toastMessage="翻译结果已复制到剪贴板"
          />
        )}
      </NodeActionBar>
    );
  };

  const sourceIcon = (src: TranslationSource) => {
    if (src === 'random') return <Shuffle size={12} strokeWidth={2} />;
    return <Globe size={12} strokeWidth={2} />;
  };

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '文本翻译'}
      dotColor={NODE_COLORS.text_translation}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 460, height: 520 }}
      className={currentTab.isGenerating && !currentTab.error ? 'transition-[box-shadow,border-color,opacity] duration-200 border-transparent' : ''}
      glowOverlay={currentTab.isGenerating && !currentTab.error ? <BeamGlow /> : undefined}
      showLeftAnchor
      showRightAnchor
      footer={footer}
      actionBar={renderActionBar()}
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-3">
        {hasUpstream ? (
          <div className="flex items-center justify-between p-2.5 rounded-md border border-accent/40 bg-accent/5 shrink-0">
            <div className="flex items-center gap-2 min-w-0 pr-2">
              <div className="w-6 h-6 rounded-full bg-accent/15 flex items-center justify-center shrink-0 text-accent">
                <Link2 size={13} strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-serif text-accent uppercase tracking-wider">上级连线输入文本</div>
                <div className="text-sm font-medium text-ink truncate font-mono max-w-[200px]">{upstreamText}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-2.5 rounded-md border border-dashed border-paper-grid bg-paper-grid/10 shrink-0">
            <Languages size={14} strokeWidth={1.5} className="text-ink-faint shrink-0" />
            <span className="text-xs text-ink-faint font-sans">请连线上级文本节点获取待翻译文本</span>
          </div>
        )}

        <div className="shrink-0 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <select
                value={fromLan}
                onChange={(e) => setFromLan(e.target.value)}
                disabled={currentTab.isGenerating}
                className="w-full h-9 rounded-md border border-dashed border-paper-grid bg-transparent px-2 text-xs text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors disabled:opacity-50"
              >
                {COMMON_LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={handleSwapLanguages}
              disabled={fromLan === 'auto' || currentTab.isGenerating}
              title="交换源语言与目标语言"
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-ink-faint hover:text-accent hover:bg-accent/10 transition-colors disabled:opacity-30"
            >
              <ArrowLeftRight size={14} strokeWidth={2} />
            </button>
            <div className="flex-1">
              <select
                value={toLan}
                onChange={(e) => setToLan(e.target.value)}
                disabled={currentTab.isGenerating}
                className="w-full h-9 rounded-md border border-dashed border-paper-grid bg-transparent px-2 text-xs text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors disabled:opacity-50"
              >
                {COMMON_LANGUAGES.filter((l) => l.value !== 'auto').map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-1.5 overflow-x-auto custom-scrollbar py-0.5">
              {SOURCE_OPTIONS.map((opt) => {
                const isActive = activeSource === opt.value;
                const tab = tabData[opt.value];
                const hasResult = tab && (tab.output.trim() || tab.error);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleSourceChange(opt.value)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-sans border transition-all active:scale-[0.96] shrink-0 ${
                      isActive
                        ? 'border-accent/60 bg-accent/10 text-accent font-medium'
                        : 'border-dashed border-paper-grid text-ink-light hover:border-paper-grid hover:text-ink hover:bg-paper-grid/20'
                    }`}
                  >
                    {sourceIcon(opt.value)}
                    {opt.label}
                    {hasResult && !isActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-accent/40" />
                    )}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={handleTranslate}
              disabled={currentTab.isGenerating || !effectiveText || hasDownstream}
              title={!effectiveText ? '请连线上级节点获取文本' : '翻译'}
              className="flex items-center justify-center gap-1.5 px-3 h-9 shrink-0 rounded-md bg-accent text-paper text-xs font-sans hover:bg-accent-hover active:scale-[0.96] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {currentTab.isGenerating ? (
                <Loader2 size={13} className="animate-spin" strokeWidth={2} />
              ) : (
                <Languages size={13} strokeWidth={2} />
              )}
              {currentTab.isGenerating ? '翻译中...' : '翻译'}
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
          {currentTab.isGenerating ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center min-h-[120px]">
              <div className="w-12 h-12 rounded-full border border-dashed border-accent/40 bg-accent/5 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-accent animate-spin" strokeWidth={1.5} />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-serif text-accent font-medium">正在翻译...</p>
                <p className="text-[11px] font-mono text-ink-faint">
                  {activeSource === 'random' ? '随机选择翻译源' : SOURCE_LABEL[activeSource] ?? activeSource}
                </p>
              </div>
            </div>
          ) : currentTab.error ? (
            <div className="p-3.5 rounded-md border border-error/20 bg-error/5 flex items-start gap-2.5">
              <AlertTriangle size={15} strokeWidth={2} className="text-error shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-1.5 font-sans">
                <p className="text-[12px] text-error/90 leading-relaxed break-words">{currentTab.error}</p>
                <button type="button" onClick={handleTranslate}
                  className="inline-flex items-center text-[11px] text-error font-medium hover:underline active:scale-[0.96] transition-transform">
                  重试翻译
                </button>
              </div>
            </div>
          ) : currentTab.output.trim() ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-ink-faint font-sans">
                <span>翻译源：{SOURCE_LABEL[currentTab.usedSource] ?? currentTab.usedSource}</span>
                {!hasDownstream && (
                  <button type="button" onClick={handleClearCurrent}
                    className="inline-flex items-center gap-1 text-ink-faint hover:text-error transition-colors">
                    <Trash2 size={11} strokeWidth={1.5} />
                    清空
                  </button>
                )}
              </div>
              <div className="w-full min-w-0 font-mono text-sm leading-relaxed p-3 rounded-md bg-paper/60 border border-dashed border-paper-grid">
                <Streamdown plugins={{ cjk, code }} isAnimating={false} caret="block" linkSafety={{ enabled: false }}>
                  {normalizeMarkdown(currentTab.output)}
                </Streamdown>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center min-h-[120px]">
              <div className="w-14 h-14 rounded-full border border-dashed border-paper-grid bg-paper-grid/20 flex items-center justify-center text-ink-faint">
                <Languages size={24} strokeWidth={1.5} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-serif text-ink-light">选择语言后点击翻译</p>
                <p className="text-xs text-ink-faint font-sans">可连线上级文本节点自动获取待翻译文本</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </CanvasNode>
  );
};

export const TextTranslationNode = memo(TextTranslationNodeInner);
TextTranslationNode.displayName = 'TextTranslationNode';
export default TextTranslationNode;