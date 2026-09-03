import React, { useState } from 'react';
import {
  Sparkles,
  Printer,
  Frame,
  Stamp,
  Scroll,
  RotateCcw,
  Check,
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

type StudioTab = 'templates' | 'printing' | 'frame' | 'lettering' | 'ground_paper';

export const StampStudioPanel: React.FC<StampStudioPanelProps> = ({
  isOpen,
  settings,
  templateId,
  onUpdate,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<StudioTab>('templates');

  const handleApplyTemplate = (tmpl: StampTemplate) => {
    onUpdate({ ...tmpl.settings }, tmpl.id);
  };

  const handleResetToBasic = () => {
    onUpdate({ ...defaultStudioSettings, designOn: false }, null);
  };

  return (
    <NodeSideDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="邮票工坊"
      subtitle={templateId ? `当前: ${templateId}` : '自定义调参'}
      icon={<Sparkles size={14} />}
      width={290}
      headerExtra={
        <button
          type="button"
          onClick={handleResetToBasic}
          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-ink-light hover:text-accent hover:bg-paper-grid/40 transition cursor-pointer"
          title="重置为极简原画直出"
        >
          <RotateCcw size={11} />
          <span>极简</span>
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        {/* 顶部 Tab 分段按钮 */}
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-paper-grid/30 border border-paper-grid/50 select-none shrink-0 overflow-x-auto scrollbar-none">
          <button
            type="button"
            onClick={() => setActiveTab('templates')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition whitespace-nowrap cursor-pointer ${
              activeTab === 'templates'
                ? 'bg-paper shadow-2xs text-accent font-medium'
                : 'text-ink-light hover:text-ink'
            }`}
          >
            <Sparkles size={12} />
            <span>模板</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('printing')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition whitespace-nowrap cursor-pointer ${
              activeTab === 'printing'
                ? 'bg-paper shadow-2xs text-accent font-medium'
                : 'text-ink-light hover:text-ink'
            }`}
          >
            <Printer size={12} />
            <span>印刷</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('frame')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition whitespace-nowrap cursor-pointer ${
              activeTab === 'frame'
                ? 'bg-paper shadow-2xs text-accent font-medium'
                : 'text-ink-light hover:text-ink'
            }`}
          >
            <Frame size={12} />
            <span>边框</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('lettering')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition whitespace-nowrap cursor-pointer ${
              activeTab === 'lettering'
                ? 'bg-paper shadow-2xs text-accent font-medium'
                : 'text-ink-light hover:text-ink'
            }`}
          >
            <Stamp size={12} />
            <span>铭记</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('ground_paper')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition whitespace-nowrap cursor-pointer ${
              activeTab === 'ground_paper'
                ? 'bg-paper shadow-2xs text-accent font-medium'
                : 'text-ink-light hover:text-ink'
            }`}
          >
            <Scroll size={12} />
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
          <div className="space-y-3">
            {/* 装饰总开关 */}
            <div className="flex items-center justify-between p-2 rounded-lg bg-paper-grid/20 border border-paper-grid/50">
              <div>
                <div className="font-medium text-ink">启用工坊印版装饰</div>
                <div className="text-[10px] text-ink-faint">底纹、边框与印刷工艺</div>
              </div>
              <input
                type="checkbox"
                checked={settings.designOn}
                onChange={(e) => onUpdate({ designOn: e.target.checked })}
                className="w-4 h-4 rounded text-accent cursor-pointer"
              />
            </div>

            {/* 印刷工艺 */}
            <div className="space-y-1">
              <label className="text-ink-light font-medium">印刷工艺 (Print Process)</label>
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
                    onClick={() => onUpdate({ print: p.id, designOn: true })}
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
                <label className="text-ink-light font-medium">油墨颜色 (Ink Colour)</label>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-ink-faint">{settings.inkColor}</span>
                  <input
                    type="color"
                    value={settings.inkColor}
                    onChange={(e) => onUpdate({ inkColor: e.target.value, designOn: true })}
                    className="w-5 h-5 rounded border border-paper-grid/60 cursor-pointer"
                  />
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {INK_SWATCHES.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => onUpdate({ inkColor: color, frameColor: color, designOn: true })}
                    className={`w-6 h-6 rounded-full border transition cursor-pointer ${
                      settings.inkColor.toLowerCase() === color.toLowerCase()
                        ? 'ring-2 ring-accent scale-110'
                        : 'border-white/60 hover:scale-105'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            {/* 油墨厚度 */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-ink-light">油墨浓度 (Ink Weight)</span>
                <span className="text-ink-faint tabular-nums">{settings.ink.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.4"
                max="2.0"
                step="0.05"
                value={settings.ink}
                onChange={(e) => onUpdate({ ink: parseFloat(e.target.value) })}
                className="w-full accent-accent cursor-pointer"
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
                    onClick={() => onUpdate({ frame: f.id, designOn: true })}
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
                    onClick={() => onUpdate({ vignette: v.id, designOn: true })}
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
            <div className="space-y-1.5 pt-1 border-t border-paper-grid/30">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-ink-light">边缘羽化柔和度</span>
                <span className="text-ink-faint tabular-nums">
                  {Math.round(settings.feather * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="0.8"
                step="0.02"
                value={settings.feather}
                onChange={(e) => onUpdate({ feather: parseFloat(e.target.value), designOn: true })}
                className="w-full accent-accent cursor-pointer"
              />

              <div className="flex items-center justify-between">
                <span className="text-ink-light text-[11px]">勾勒视窗金色细线</span>
                <input
                  type="checkbox"
                  checked={settings.vignetteRule}
                  onChange={(e) => onUpdate({ vignetteRule: e.target.checked })}
                  className="w-4 h-4 rounded text-accent cursor-pointer"
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
                    onClick={() => onUpdate({ ornament: o.id, designOn: true })}
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
          <div className="space-y-3">
            {/* 国名 */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-ink-light font-medium">国名铭记</label>
                <label className="flex items-center gap-1 text-[11px] text-ink-faint cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.countryArc}
                    onChange={(e) => onUpdate({ countryArc: e.target.checked, designOn: true })}
                    className="w-3.5 h-3.5 rounded text-accent"
                  />
                  <span>拱顶弧形</span>
                </label>
              </div>
              <input
                type="text"
                value={settings.country}
                onChange={(e) => onUpdate({ country: e.target.value, designOn: true })}
                placeholder="例如: CHINA POST 中国邮政"
                className="w-full bg-paper/80 border border-paper-grid/60 rounded px-2 py-1 text-xs text-ink"
              />
            </div>

            {/* 面额 */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-ink-light font-medium">经典面额</label>
                <label className="flex items-center gap-1 text-[11px] text-ink-faint cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.tablets}
                    onChange={(e) => onUpdate({ tablets: e.target.checked, designOn: true })}
                    className="w-3.5 h-3.5 rounded text-accent"
                  />
                  <span>反白角块</span>
                </label>
              </div>
              <input
                type="text"
                value={settings.denomination}
                onChange={(e) => onUpdate({ denomination: e.target.value, designOn: true })}
                placeholder="例如: ¥1.20 或 20"
                className="w-full bg-paper/80 border border-paper-grid/60 rounded px-2 py-1 text-xs text-ink"
              />
            </div>

            {/* 副题 */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-ink-light font-medium">底部副题</label>
                <label className="flex items-center gap-1 text-[11px] text-ink-faint cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.ribbon}
                    onChange={(e) => onUpdate({ ribbon: e.target.checked, designOn: true })}
                    className="w-3.5 h-3.5 rounded text-accent"
                  />
                  <span>飘带 (Ribbon)</span>
                </label>
              </div>
              <input
                type="text"
                value={settings.caption}
                onChange={(e) => onUpdate({ caption: e.target.value, designOn: true })}
                placeholder="例如: 黄山迎客松"
                className="w-full bg-paper/80 border border-paper-grid/60 rounded px-2 py-1 text-xs text-ink"
              />
            </div>

            {/* 字体风格 */}
            <div className="space-y-1">
              <label className="text-ink-light font-medium">字体族 (Typeface)</label>
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
                    onClick={() => onUpdate({ typeface: t.id, designOn: true })}
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
            <div className="p-2 rounded-lg bg-paper-grid/20 border border-paper-grid/50 space-y-2 pt-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink">盖销邮戳 (Postmark)</span>
                <input
                  type="checkbox"
                  checked={settings.postmarkOn}
                  onChange={(e) => onUpdate({ postmarkOn: e.target.checked, designOn: true })}
                  className="w-4 h-4 rounded text-accent cursor-pointer"
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
                        onClick={() => onUpdate({ postmarkStyle: pm.id })}
                        className={`px-1 py-0.5 rounded border text-[10px] text-center cursor-pointer ${
                          settings.postmarkStyle === pm.id
                            ? 'border-accent bg-accent/15 text-accent font-medium'
                            : 'border-paper-grid/60 text-ink-light'
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
                      className="bg-paper border border-paper-grid/60 rounded px-1.5 py-0.5 text-xs text-ink"
                    />
                    <input
                      type="text"
                      value={settings.postmarkDate}
                      onChange={(e) => onUpdate({ postmarkDate: e.target.value })}
                      placeholder="日期 (如 2024.10.01)"
                      className="bg-paper border border-paper-grid/60 rounded px-1.5 py-0.5 text-xs text-ink"
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
                    onClick={() => onUpdate({ ground: g.id, designOn: true })}
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
                    { id: 'perforated', label: '标准齿孔' },
                    { id: 'wavy', label: '波浪剪' },
                    { id: 'rouletted', label: '滚刀孔' },
                    { id: 'imperforate', label: '光边' },
                  ] as { id: EdgeStyle; label: string }[]
                ).map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onUpdate({ edge: e.id })}
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
            <div className="space-y-2 pt-1 border-t border-paper-grid/30">
              <label className="text-ink-light font-medium">纸张岁月质感</label>

              <div className="space-y-0.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-ink-light">泛黄古感 (Toning)</span>
                  <span className="text-ink-faint tabular-nums">
                    {Math.round(settings.toning * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.6"
                  step="0.02"
                  value={settings.toning}
                  onChange={(e) => onUpdate({ toning: parseFloat(e.target.value), designOn: true })}
                  className="w-full accent-accent cursor-pointer"
                />
              </div>

              <div className="space-y-0.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-ink-light">潮湿霉斑 (Foxing)</span>
                  <span className="text-ink-faint tabular-nums">
                    {Math.round(settings.foxing * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.4"
                  step="0.02"
                  value={settings.foxing}
                  onChange={(e) => onUpdate({ foxing: parseFloat(e.target.value), designOn: true })}
                  className="w-full accent-accent cursor-pointer"
                />
              </div>

              <div className="space-y-0.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-ink-light">手感折痕 (Wear)</span>
                  <span className="text-ink-faint tabular-nums">
                    {Math.round(settings.wear * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.5"
                  step="0.02"
                  value={settings.wear}
                  onChange={(e) => onUpdate({ wear: parseFloat(e.target.value), designOn: true })}
                  className="w-full accent-accent cursor-pointer"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </NodeSideDrawer>
  );
};
