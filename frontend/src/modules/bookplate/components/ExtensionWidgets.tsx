"use client";
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ExtensionWidgetItem } from '../piStream';

/**
 * 扩展 widget 通用面板（单实例渲染，内部按 placement 分组）。
 *
 * - 展示纯文本行（<pre> + React 转义，无 XSS 注入面）；服务端已做行数/长度上限。
 * - 折叠/展开：单 key 展开态；默认展开「行数在 (1, DEFAULT_EXPANDED_WIDGET_LINES]」的首个面板。
 * - 更新脉冲：widget 内容变化时触发短暂高亮（WIDGET_UPDATE_IDLE_MS 后消退）。
 * - 跨轮保留：widget 以服务端快照为真相源，本组件只做展示层归约。
 */

const DEFAULT_EXPANDED_WIDGET_LINES = 3; // 默认展开的行数上限
const WIDGET_UPDATE_IDLE_MS = 1100; // 更新脉冲时长
const MAX_WIDGET_LINES = 40; // 单 widget 显示行数兜底

const STYLE_INJECTIONS = `
@keyframes widget-pulse {
  0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.55); }
  100% { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
}
.extension-widget-pulse {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: currentColor;
  flex-shrink: 0;
  transition: background-color 0.2s ease;
}
.extension-widget-pulse[data-updating="true"] {
  animation: widget-pulse 0.9s ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .extension-widget-pulse[data-updating="true"] { animation: none; }
}
`;

/** 快照 widget 内容为 map（引用比较用）。 */
function snap(widgets: ExtensionWidgetItem[]): Map<string, string[]> {
  return new Map(widgets.map((w) => [w.key, [...w.lines]]));
}

/** 与上一快照相比内容发生变化的 key 集合。 */
function updatedKeys(
  prev: ReadonlyMap<string, readonly string[]> | null,
  next: ReadonlyMap<string, readonly string[]>
): string[] {
  if (!prev) return [];
  return Array.from(next, ([key, lines]) => {
    const p = prev.get(key);
    if (!p || p.length !== lines.length) return p ? key : null;
    return lines.some((l, i) => l !== p[i]) ? key : null;
  }).filter((k): k is string => k !== null);
}

function defaultExpanded(widgets: ExtensionWidgetItem[]): string | null {
  const w = widgets.find(
    (x) => x.lines.length > 1 && x.lines.length <= DEFAULT_EXPANDED_WIDGET_LINES
  );
  return w?.key ?? null;
}

const WidgetTrigger: React.FC<{
  widget: ExtensionWidgetItem;
  expanded: boolean;
  updating: boolean;
  onClick: () => void;
  idPrefix: string;
}> = ({ widget, expanded, updating, onClick, idPrefix }) => {
  const displayLabel = widget.label || widget.key;
  return (
    <button
      id={`${idPrefix}-${widget.key}`}
      onClick={onClick}
      title={expanded ? `收起 ${displayLabel}` : `展开 ${displayLabel}`}
      className="flex items-center gap-1.5 rounded-full border border-paper-grid bg-paper-grid/20 px-2.5 py-1 text-[11px] font-sans text-ink-light hover:border-accent/40 hover:text-accent hover:bg-accent/5 active:scale-[0.97] transition-colors"
    >
      <span className="extension-widget-pulse" data-updating={updating} />
      <span className="truncate max-w-[140px]" title={displayLabel}>
        {displayLabel}
      </span>
      {widget.lines.length > 0 && (
        <span className="shrink-0 text-[9.5px] text-ink-faint">{widget.lines.length} 行</span>
      )}
      {expanded ? (
        <ChevronUp size={11} strokeWidth={2} className="shrink-0" />
      ) : (
        <ChevronDown size={11} strokeWidth={2} className="shrink-0" />
      )}
    </button>
  );
};

export function ExtensionWidgets({ widgets }: { widgets: ExtensionWidgetItem[] }) {
  const idPrefix = useId();
  const prev = useRef<Map<string, string[]> | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const userChoseRef = useRef(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(() => defaultExpanded(widgets));
  const [updating, setUpdating] = useState<ReadonlySet<string>>(() => new Set());

  // 默认展开延迟到 widget 到达时生效（水合/SDE 均为异步；用户手动选择后不再自动改判）
  useEffect(() => {
    if (userChoseRef.current || expandedKey !== null) return;
    const d = defaultExpanded(widgets);
    if (d) setExpandedKey(d);
  }, [widgets, expandedKey]);

  useEffect(() => {
    const next = snap(widgets);
    const changed = updatedKeys(prev.current, next);
    prev.current = next;
    // 已消失的 widget：清理其脉冲计时与标记
    for (const [k, t] of timers.current) {
      if (!next.has(k)) {
        clearTimeout(t);
        timers.current.delete(k);
      }
    }
    setUpdating((cur) => {
      const s = new Set(Array.from(cur).filter((k) => next.has(k)));
      for (const k of changed) s.add(k);
      return s.size === cur.size && Array.from(s).every((k) => cur.has(k)) ? cur : s;
    });
    for (const k of changed) {
      const t = timers.current.get(k);
      if (t) clearTimeout(t);
      timers.current.set(
        k,
        setTimeout(() => {
          timers.current.delete(k);
          setUpdating((cur) => {
            const s = new Set(cur);
            s.delete(k);
            return s;
          });
        }, WIDGET_UPDATE_IDLE_MS)
      );
    }
  }, [widgets]);

  useEffect(
    () => () => {
      for (const t of timers.current.values()) clearTimeout(t);
      timers.current.clear();
    },
    []
  );

  if (widgets.length === 0) return null;
  const above = widgets.filter((w) => w.placement !== 'belowEditor');
  const below = widgets.filter((w) => w.placement === 'belowEditor');

  const renderGroup = (group: ExtensionWidgetItem[]) => {
    const expanded = group.find((w) => w.key === expandedKey && w.lines.length > 0);
    const expandedLabel = expanded ? (expanded.label || expanded.key) : '';
    return (
      <div className="space-y-1">
        {expanded && (
          <section
            className="rounded-lg border border-paper-grid bg-paper-grid/20 overflow-hidden"
            aria-label={expandedLabel}
          >
            <div className="flex items-center gap-1.5 px-2.5 py-1 border-b border-dashed border-paper-grid/60">
              <span className="text-[10px] font-sans font-medium text-ink-light truncate">
                {expandedLabel}
              </span>
              <span className="ml-auto shrink-0 text-[9px] text-ink-faint">
                {expanded.lines.length} 行
              </span>
            </div>
            <pre className="text-[11px] font-sans text-ink-light whitespace-pre-wrap break-words leading-relaxed px-2.5 py-2 max-h-40 overflow-y-auto custom-scrollbar select-text">
              {expanded.lines.slice(0, MAX_WIDGET_LINES).join('\n')}
            </pre>
          </section>
        )}
        <div className="flex flex-wrap gap-1.5" aria-label="Extension widgets">
          {group.map((w) => (
            <WidgetTrigger
              key={w.key}
              widget={w}
              expanded={w.key === expandedKey}
              updating={updating.has(w.key)}
              onClick={() => {
                userChoseRef.current = true;
                setExpandedKey((c) => (c === w.key ? null : w.key));
              }}
              idPrefix={idPrefix}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLE_INJECTIONS }} />
      {above.length > 0 && (
        <div className="extension-widget-group extension-widget-above mb-1.5">
          {renderGroup(above)}
        </div>
      )}
      {below.length > 0 && (
        <div className="extension-widget-group extension-widget-below mt-1.5">
          {renderGroup(below)}
        </div>
      )}
    </>
  );
}
