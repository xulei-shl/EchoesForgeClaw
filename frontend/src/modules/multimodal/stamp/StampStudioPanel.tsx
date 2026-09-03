import React, { useState } from 'react';
import {
  Sparkles,
  Printer,
  Frame,
  Stamp,
  Scroll,
  Check,
  Pipette,
} from 'lucide-react';
import type {
  StampStudioSettings,
  PrintMethod,
  FrameStyle,
  VignetteShape,
  OrnamentStyle,
  GroundStyle,
  EdgeStyle,
  PostmarkStyle,
  StampTypeface,
} from './types';
import { STAMP_TEMPLATES, type StampTemplate, defaultStudioSettings } from './templates';
import { NodeSideDrawer } from '../../../platform/components/node/NodeSideDrawer';
import { ColorPickerPopover } from '../../../platform/components/ui/ColorPicker';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
import { SliderRow } from '../../../platform/components/ui/Slider';
import { Toggle } from '../../../platform/components/ui/Toggle';

interface StampStudioPanelProps {
  isOpen: boolean;
  settings: StampStudioSettings;
  templateId?: string | null;
  onUpdate: (patch: Partial<StampStudioSettings>, newTemplateId?: string | null) => void;
  onClose: () => void;
}

const INK_SWATCHES = [
  '#14418c', // 深海蓝
  '#1f5c3a', // 森林绿
  '#1c5b6b', // 水青灰
  '#1b3350', // 靛青蓝
  '#4f3068', // 紫晶紫
  '#7b3420', // 铁锈棕
  '#8a1c2b', // 胭脂红
  '#222222', // 炭黑
];

const INK_SWATCH_LABELS: Record<string, string> = {
  '#14418c': '深海蓝 (Navy Blue)',
  '#1f5c3a': '森林绿 (Forest Green)',
  '#1c5b6b': '水青灰 (Slate Teal)',
  '#1b3350': '靛青蓝 (Indigo Blue)',
  '#4f3068': '紫晶紫 (Amethyst Purple)',
  '#7b3420': '铁锈棕 (Rust Brown)',
  '#8a1c2b': '胭脂红 (Crimson Red)',
  '#222222': '炭黑色 (Charcoal Black)',
};

/**
 * 切换单选选项：若已选中目标值则取消并回退至 fallback，否则选中 target
 */
function toggleOption<T>(current: T, target: T, fallback: T): T {
  return current === target ? fallback : target;
}

type StudioTab = 'templates' | 'printing' | 'frame' | 'lettering' | 'ground_paper';

export const StampStudioPanel: React.FC<StampStudioPanelProps> = ({
  isOpen,
  settings,
  templateId,
  onUpdate,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<StudioTab>('templates');

  const isCustomInkColor = !INK_SWATCHES.map((c) => c.toLowerCase()).includes(
    (settings.inkColor || '').toLowerCase()
  );

  const handleApplyTemplate = (tmpl: StampTemplate) => {
    if (templateId === tmpl.id) {
      onUpdate({ ...defaultStudioSettings, designOn: false }, null);
    } else {
      onUpdate({ ...tmpl.settings }, tmpl.id);
    }
  };

  return (
    <NodeSideDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="邮票工坊"
      subtitle={templateId ? `当前: ${templateId}` : '自定义调参'}
      icon={<Sparkles size={14} />}
      width={310}
    >
      <div className="flex flex-col gap-3">
        {/* 顶部 Tab 分段按钮（同心圆角 6px+2px=8px） */}
        <div className="grid grid-cols-5 gap-0.5 p-0.5 rounded-lg bg-paper-grid/30 border border-paper-grid/50 select-none shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('templates')}
            className={`flex items-center justify-center gap-1 py-1 px-1 rounded-md text-[11px] transition active:scale-[0.96] whitespace-nowrap cursor-pointer ${
              activeTab === 'templates'
                ? 'bg-paper shadow-2xs text-accent font-medium'
                : 'text-ink-light hover:text-ink'
            }`}
            title="艺术模板"
          >
            <Sparkles size={11} className="shrink-0" />
            <span>模板</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('printing')}
            className={`flex items-center justify-center gap-1 py-1 px-1 rounded-md text-[11px] transition active:scale-[0.96] whitespace-nowrap cursor-pointer ${
              activeTab === 'printing'
                ? 'bg-paper shadow-2xs text-accent font-medium'
                : 'text-ink-light hover:text-ink'
            }`}
            title="印刷工艺"
          >
            <Printer size={11} className="shrink-0" />
            <span>印刷</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('frame')}
            className={`flex items-center justify-center gap-1 py-1 px-1 rounded-md text-[11px] transition active:scale-[0.96] whitespace-nowrap cursor-pointer ${
              activeTab === 'frame'
                ? 'bg-paper shadow-2xs text-accent font-medium'
                : 'text-ink-light hover:text-ink'
            }`}
            title="边框与视窗"
          >
            <Frame size={11} className="shrink-0" />
            <span>边框</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('lettering')}
            className={`flex items-center justify-center gap-1 py-1 px-1 rounded-md text-[11px] transition active:scale-[0.96] whitespace-nowrap cursor-pointer ${
              activeTab === 'lettering'
                ? 'bg-paper shadow-2xs text-accent font-medium'
                : 'text-ink-light hover:text-ink'
            }`}
            title="铭记与邮戳"
          >
            <Stamp size={11} className="shrink-0" />
            <span>铭记</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('ground_paper')}
            className={`flex items-center justify-center gap-1 py-1 px-1 rounded-md text-[11px] transition active:scale-[0.96] whitespace-nowrap cursor-pointer ${
              activeTab === 'ground_paper'
                ? 'bg-paper shadow-2xs text-accent font-medium'
                : 'text-ink-light hover:text-ink'
            }`}
            title="底纹与纸张"
          >
            <Scroll size={11} className="shrink-0" />
            <span>底纹</span>
          </button>
        </div>

        {/* 1. 模板选项卡 */}
        {activeTab === 'templates' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-ink-faint">
              <span>经典艺术模板 (点击即时生效)</span>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {STAMP_TEMPLATES.map((tmpl) => {
                const isSelected = templateId === tmpl.id;
                return (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => handleApplyTemplate(tmpl)}
                    className={`flex flex-col text-left p-2 rounded-lg border transition cursor-pointer ${
                      isSelected
                        ? 'border-accent bg-accent/10 shadow-xs'
                        : 'border-paper-grid/60 bg-paper/80 hover:border-paper-grid hover:bg-paper'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-0.5">
                      <div className="flex items-center gap-1.5 font-medium text-xs text-ink">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: tmpl.themeColor }}
                        />
                        <span>{tmpl.label}</span>
                      </div>
                      {isSelected && <Check size={13} className="text-accent" />}
                    </div>
                    <span className="text-[11px] text-ink-faint leading-tight line-clamp-2">
                      {tmpl.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 2. 印刷与色彩选项卡 */}
        {activeTab === 'printing' && (
          <div className="space-y-3.5">
            {/* 装饰总开关 */}
            <div className="flex items-center justify-between p-2 rounded-lg bg-paper-grid/20 border border-paper-grid/50">
              <div className="min-w-0 pr-2">
                <div className="font-medium text-xs text-ink">启用工坊印版装饰</div>
                <div className="text-[10px] text-ink-faint mt-0.5">底纹、边框与印刷工艺</div>
              </div>
              <Toggle
                checked={settings.designOn}
                onChange={(checked) => onUpdate({ designOn: checked })}
                label="启用工坊印版装饰"
              />
            </div>

            {/* 印刷工艺 */}
            <div className="space-y-1.5">
              <label className="text-ink-light font-medium text-xs">印刷工艺 (Print Process)</label>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    { id: 'offset', label: '平版胶印 (原图)' },
                    { id: 'engraved', label: '雕刻凹版 (钢版)' },
                    { id: 'photogravure', label: '照相凹版 (柔调)' },
                    { id: 'typeset', label: '凸版活字 (二值)' },
                  ] as { id: PrintMethod; label: string }[]
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onUpdate({ print: toggleOption(settings.print, p.id, 'offset'), designOn: true })}
                    className={`px-2 py-1.5 rounded border text-[11px] text-left transition cursor-pointer ${
                      settings.print === p.id
                        ? 'border-accent bg-accent/15 text-accent font-medium'
                        : 'border-paper-grid/60 hover:bg-paper-grid/30 text-ink-light'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 油墨调色 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-ink-light font-medium text-xs">油墨颜色 (Ink Colour)</label>
                <span className="text-[10px] text-ink-faint font-mono">{settings.inkColor}</span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {INK_SWATCHES.map((color) => (
                  <Tooltip
                    key={color}
                    content={INK_SWATCH_LABELS[color] || `油墨色 ${color}`}
                  >
                    <button
                      type="button"
                      onClick={() => onUpdate({ inkColor: color, frameColor: color, designOn: true })}
                      className={`w-5 h-5 rounded-full border transition cursor-pointer ${
                        settings.inkColor.toLowerCase() === color.toLowerCase()
                          ? 'border-accent ring-2 ring-accent/40 scale-110 shadow-2xs'
                          : 'border-paper-grid/70 hover:scale-110'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  </Tooltip>
                ))}

                {/* 自定义颜色与吸管取色器（与贴纸制作节点一致） */}
                <ColorPickerPopover
                  value={settings.inkColor}
                  onChange={(hex) => onUpdate({ inkColor: hex, frameColor: hex, designOn: true })}
                  align="right"
                >
                  <Tooltip
                    content={
                      isCustomInkColor
                        ? `自定义油墨颜色（当前: ${settings.inkColor}）`
                        : '自定义颜色 / 吸管取色'
                    }
                  >
                    <button
                      type="button"
                      style={{ backgroundColor: isCustomInkColor ? settings.inkColor : undefined }}
                      className={`w-5 h-5 rounded-full border flex items-center justify-center transition cursor-pointer ${
                        isCustomInkColor
                          ? 'border-accent ring-2 ring-accent/40 scale-110 shadow-2xs'
                          : 'border-paper-grid/80 hover:border-accent hover:scale-110 bg-paper text-ink-light hover:text-accent'
                      }`}
                    >
                      {!isCustomInkColor && <Pipette size={10} strokeWidth={2} />}
                    </button>
                  </Tooltip>
                </ColorPickerPopover>
              </div>
            </div>

            {/* 油墨厚度 */}
            <div className="pt-1">
              <SliderRow
                label="油墨浓度"
                min={0.4}
                max={2.0}
                step={0.05}
                value={settings.ink}
                display={`${settings.ink.toFixed(2)}x`}
                labelWidth="w-16"
                onChange={(val) => onUpdate({ ink: val })}
              />
            </div>
          </div>
        )}

        {/* 3. 边框与视窗选项卡 */}
        {activeTab === 'frame' && (
          <div className="space-y-3">
            {/* 边框样式 */}
            <div className="space-y-1">
              <label className="text-ink-light font-medium">古典边框样式 (Frame Style)</label>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { id: 'none', label: '无' },
                    { id: 'rule', label: '单线' },
                    { id: 'classic', label: '经典角块' },
                    { id: 'ornate', label: '华丽珠边' },
                    { id: 'arched', label: '拱形' },
                  ] as { id: FrameStyle; label: string }[]
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => onUpdate({ frame: toggleOption(settings.frame, f.id, 'none'), designOn: true })}
                    className={`px-1.5 py-1 rounded border text-[11px] text-center transition cursor-pointer ${
                      settings.frame === f.id
                        ? 'border-accent bg-accent/15 text-accent font-medium'
                        : 'border-paper-grid/60 hover:bg-paper-grid/30 text-ink-light'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 图像视窗形状 */}
            <div className="space-y-1">
              <label className="text-ink-light font-medium">视窗遮罩形状 (Vignette Shape)</label>
              <div className="grid grid-cols-4 gap-1">
                {(
                  [
                    { id: 'none', label: '满版' },
                    { id: 'arch', label: '拱门' },
                    { id: 'oval', label: '椭圆' },
                    { id: 'circle', label: '正圆' },
                  ] as { id: VignetteShape; label: string }[]
                ).map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => onUpdate({ vignette: toggleOption(settings.vignette, v.id, 'none'), designOn: true })}
                    className={`px-1 py-1 rounded border text-[11px] text-center transition cursor-pointer ${
                      settings.vignette === v.id
                        ? 'border-accent bg-accent/15 text-accent font-medium'
                        : 'border-paper-grid/60 hover:bg-paper-grid/30 text-ink-light'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 边缘羽化与内描边 */}
            <div className="space-y-2 pt-1 border-t border-paper-grid/30">
              <SliderRow
                label="边缘羽化"
                min={0}
                max={0.8}
                step={0.02}
                value={settings.feather}
                display={`${Math.round(settings.feather * 100)}%`}
                labelWidth="w-16"
                onChange={(val) => onUpdate({ feather: val, designOn: true })}
              />

              <div className="flex items-center justify-between py-0.5">
                <span className="text-ink-light text-xs">勾勒视窗金色细线</span>
                <Toggle
                  checked={settings.vignetteRule}
                  onChange={(checked) => onUpdate({ vignetteRule: checked })}
                  label="勾勒视窗金色细线"
                />
              </div>
            </div>

            {/* 四角角饰 */}
            <div className="space-y-1 pt-1 border-t border-paper-grid/30">
              <label className="text-ink-light font-medium">四角蚀刻角饰 (Corner Ornaments)</label>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { id: 'none', label: '无' },
                    { id: 'scroll', label: '卷草纹' },
                    { id: 'leaf', label: '莨苕叶' },
                    { id: 'deco', label: '装饰派' },
                    { id: 'rosette', label: '罗盘玫瑰' },
                  ] as { id: OrnamentStyle; label: string }[]
                ).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => onUpdate({ ornament: toggleOption(settings.ornament, o.id, 'none'), designOn: true })}
                    className={`px-1 py-1 rounded border text-[11px] text-center transition cursor-pointer ${
                      settings.ornament === o.id
                        ? 'border-accent bg-accent/15 text-accent font-medium'
                        : 'border-paper-grid/60 hover:bg-paper-grid/30 text-ink-light'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 4. 铭记与邮戳选项卡 */}
        {activeTab === 'lettering' && (
          <div className="space-y-3.5">
            {/* 国名 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-ink-light font-medium text-xs">国名铭记</label>
                <button
                  type="button"
                  onClick={() => onUpdate({ countryArc: !settings.countryArc, designOn: true })}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border transition cursor-pointer ${
                    settings.countryArc
                      ? 'border-accent bg-accent/15 text-accent font-medium'
                      : 'border-paper-grid/60 bg-paper/60 text-ink-faint hover:text-ink'
                  }`}
                  title={settings.countryArc ? '已开启拱顶弧形排版' : '点击开启拱顶弧形排版'}
                >
                  <Check size={10} className={settings.countryArc ? 'opacity-100 text-accent' : 'opacity-0'} />
                  <span>拱顶弧形</span>
                </button>
              </div>
              <input
                type="text"
                value={settings.country}
                onChange={(e) => onUpdate({ country: e.target.value, designOn: true })}
                placeholder="例如: CHINA POST 中国邮政"
                className="w-full bg-paper/80 border border-paper-grid/60 rounded px-2 py-1 text-xs text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition"
              />
            </div>

            {/* 面额 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-ink-light font-medium text-xs">经典面额</label>
                <button
                  type="button"
                  onClick={() => onUpdate({ tablets: !settings.tablets, designOn: true })}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border transition cursor-pointer ${
                    settings.tablets
                      ? 'border-accent bg-accent/15 text-accent font-medium'
                      : 'border-paper-grid/60 bg-paper/60 text-ink-faint hover:text-ink'
                  }`}
                  title={settings.tablets ? '已开启反白角块底托' : '点击开启反白角块底托'}
                >
                  <Check size={10} className={settings.tablets ? 'opacity-100 text-accent' : 'opacity-0'} />
                  <span>反白角块</span>
                </button>
              </div>
              <input
                type="text"
                value={settings.denomination}
                onChange={(e) => onUpdate({ denomination: e.target.value, designOn: true })}
                placeholder="例如: ¥1.20 或 20"
                className="w-full bg-paper/80 border border-paper-grid/60 rounded px-2 py-1 text-xs text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition"
              />
            </div>

            {/* 副题 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-ink-light font-medium text-xs">底部副题</label>
                <button
                  type="button"
                  onClick={() => onUpdate({ ribbon: !settings.ribbon, designOn: true })}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border transition cursor-pointer ${
                    settings.ribbon
                      ? 'border-accent bg-accent/15 text-accent font-medium'
                      : 'border-paper-grid/60 bg-paper/60 text-ink-faint hover:text-ink'
                  }`}
                  title={settings.ribbon ? '已开启底部横幅飘带' : '点击开启底部横幅飘带'}
                >
                  <Check size={10} className={settings.ribbon ? 'opacity-100 text-accent' : 'opacity-0'} />
                  <span>飘带 (Ribbon)</span>
                </button>
              </div>
              <input
                type="text"
                value={settings.caption}
                onChange={(e) => onUpdate({ caption: e.target.value, designOn: true })}
                placeholder="例如: 黄山迎客松"
                className="w-full bg-paper/80 border border-paper-grid/60 rounded px-2 py-1 text-xs text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition"
              />
            </div>

            {/* 字体风格 */}
            <div className="space-y-1.5">
              <label className="text-ink-light font-medium text-xs">字体族 (Typeface)</label>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { id: 'serif', label: '衬线' },
                    { id: 'didone', label: '现代' },
                    { id: 'grotesque', label: '无衬线' },
                    { id: 'condensed', label: '紧凑' },
                    { id: 'typewriter', label: '打字机' },
                    { id: 'script', label: '圆体' },
                  ] as { id: StampTypeface; label: string }[]
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onUpdate({ typeface: toggleOption(settings.typeface, t.id, 'serif'), designOn: true })}
                    className={`px-1.5 py-1 rounded border text-[10px] text-center transition cursor-pointer ${
                      settings.typeface === t.id
                        ? 'border-accent bg-accent/15 text-accent font-medium'
                        : 'border-paper-grid/60 hover:bg-paper-grid/30 text-ink-light'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 盖销邮戳 */}
            <div className="p-2 rounded-lg bg-paper-grid/20 border border-paper-grid/50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-ink">盖销邮戳 (Postmark)</span>
                <Toggle
                  checked={settings.postmarkOn}
                  onChange={(checked) => onUpdate({ postmarkOn: checked, designOn: true })}
                  label="盖销邮戳"
                />
              </div>
              {settings.postmarkOn && (
                <div className="space-y-1.5 pt-1">
                  <div className="grid grid-cols-4 gap-1">
                    {(
                      [
                        { id: 'both', label: '双联戳' },
                        { id: 'bars', label: '波浪戳' },
                        { id: 'datestamp', label: '日戳' },
                        { id: 'grid', label: '网格' },
                      ] as { id: PostmarkStyle; label: string }[]
                    ).map((pm) => (
                      <button
                        key={pm.id}
                        type="button"
                        onClick={() => {
                          if (settings.postmarkStyle === pm.id) {
                            onUpdate({ postmarkOn: false });
                          } else {
                            onUpdate({ postmarkStyle: pm.id, postmarkOn: true });
                          }
                        }}
                        className={`px-1 py-0.5 rounded border text-[10px] text-center cursor-pointer transition ${
                          settings.postmarkStyle === pm.id
                            ? 'border-accent bg-accent/15 text-accent font-medium'
                            : 'border-paper-grid/60 text-ink-light hover:bg-paper-grid/30'
                        }`}
                      >
                        {pm.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="text"
                      value={settings.postmarkCity}
                      onChange={(e) => onUpdate({ postmarkCity: e.target.value })}
                      placeholder="城市 (如 BEIJING)"
                      className="bg-paper border border-paper-grid/60 rounded px-1.5 py-0.5 text-xs text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition"
                    />
                    <input
                      type="text"
                      value={settings.postmarkDate}
                      onChange={(e) => onUpdate({ postmarkDate: e.target.value })}
                      placeholder="日期 (如 2024.10.01)"
                      className="bg-paper border border-paper-grid/60 rounded px-1.5 py-0.5 text-xs text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 5. 底纹与纸张质感选项卡 */}
        {activeTab === 'ground_paper' && (
          <div className="space-y-3">
            {/* 防伪底纹 */}
            <div className="space-y-1">
              <label className="text-ink-light font-medium">防伪底纹 (Ground Pattern)</label>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { id: 'none', label: '无底纹' },
                    { id: 'guilloche', label: '机雕陀螺' },
                    { id: 'burelage', label: '网状波纹' },
                    { id: 'crosshatch', label: '交叉线' },
                    { id: 'panel', label: '渐变板' },
                    { id: 'stipple', label: '斑点' },
                  ] as { id: GroundStyle; label: string }[]
                ).map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => onUpdate({ ground: toggleOption(settings.ground, g.id, 'none'), designOn: true })}
                    className={`px-1 py-1 rounded border text-[11px] text-center transition cursor-pointer ${
                      settings.ground === g.id
                        ? 'border-accent bg-accent/15 text-accent font-medium'
                        : 'border-paper-grid/60 hover:bg-paper-grid/30 text-ink-light'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 齿孔工艺 */}
            <div className="space-y-1 pt-1 border-t border-paper-grid/30">
              <label className="text-ink-light font-medium">齿孔边缘 (Edge Style)</label>
              <div className="grid grid-cols-4 gap-1">
                {(
                  [
                    { id: 'imperforate', label: '光边' },
                    { id: 'perforated', label: '标准齿孔' },
                    { id: 'wavy', label: '波浪剪' },
                    { id: 'rouletted', label: '滚刀孔' },
                  ] as { id: EdgeStyle; label: string }[]
                ).map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onUpdate({ edge: toggleOption(settings.edge, e.id, 'imperforate') })}
                    className={`px-1 py-1 rounded border text-[11px] text-center transition cursor-pointer ${
                      settings.edge === e.id
                        ? 'border-accent bg-accent/15 text-accent font-medium'
                        : 'border-paper-grid/60 hover:bg-paper-grid/30 text-ink-light'
                    }`}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 岁月质感 */}
            <div className="space-y-2.5 pt-1 border-t border-paper-grid/30">
              <label className="text-ink-light font-medium text-xs">纸张岁月质感</label>

              <SliderRow
                label="泛黄古感"
                min={0}
                max={0.6}
                step={0.02}
                value={settings.toning}
                display={`${Math.round(settings.toning * 100)}%`}
                labelWidth="w-16"
                onChange={(val) => onUpdate({ toning: val, designOn: true })}
              />

              <SliderRow
                label="潮湿霉斑"
                min={0}
                max={0.4}
                step={0.02}
                value={settings.foxing}
                display={`${Math.round(settings.foxing * 100)}%`}
                labelWidth="w-16"
                onChange={(val) => onUpdate({ foxing: val, designOn: true })}
              />

              <SliderRow
                label="手感折痕"
                min={0}
                max={0.5}
                step={0.02}
                value={settings.wear}
                display={`${Math.round(settings.wear * 100)}%`}
                labelWidth="w-16"
                onChange={(val) => onUpdate({ wear: val, designOn: true })}
              />
            </div>
          </div>
        )}
      </div>
    </NodeSideDrawer>
  );
};
