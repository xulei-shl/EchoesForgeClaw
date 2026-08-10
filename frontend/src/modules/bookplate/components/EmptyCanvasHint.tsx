import React from 'react';
import { ArrowRight, BookOpen, ImageIcon, Plus, ScanSearch, Wand2 } from 'lucide-react';

interface Step {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  label: string;
  desc: string;
}

const STEPS: Step[] = [
  { icon: BookOpen, label: '输入 ISBN', desc: '获取图书元数据' },
  { icon: Plus, label: '点击「+」', desc: '添加下一级节点' },
  { icon: ScanSearch, label: '分析图片', desc: '封面艺术风格分析' },
  { icon: Wand2, label: '生成提示词', desc: '基于元数据与分析' },
  { icon: ImageIcon, label: '生成图像', desc: '得到藏书票' },
];

const EmptyCanvasHint: React.FC = () => {
  return (
    <div className="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none">
      <div className="flex flex-col items-center gap-6 max-w-xl px-8">
        <div className="flex flex-col items-center gap-2.5 text-center">
          <h2 className="font-serif text-2xl font-semibold text-ink/90">开始创作藏书票</h2>
          <p className="text-sm text-ink-light font-sans leading-relaxed">
            在下方输入 ISBN 创建第一个「图书元数据」节点，
            <br className="hidden sm:block" />
            之后在任意节点下方点击「+」搭建你的工作流
          </p>
        </div>

        {/* 工作流步骤 */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
          {STEPS.map((step, i) => (
            <React.Fragment key={step.label}>
              {i > 0 && (
                <ArrowRight size={14} strokeWidth={1.5} className="text-ink-faint/60 hidden sm:block" />
              )}
              <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-paper-grid bg-paper/70 shadow-sm">
                <step.icon size={15} strokeWidth={1.5} className="text-accent" />
                <div className="flex flex-col">
                  <span className="text-xs font-serif text-ink font-medium leading-tight">{step.label}</span>
                  <span className="text-[10px] text-ink-faint font-sans leading-tight">{step.desc}</span>
                </div>
              </div>
            </React.Fragment>
          ))}
        </div>

        {/* 分支提示 */}
        <p className="text-[11px] text-ink-faint font-sans">
          右键节点可快速添加子节点或删除整条分支
        </p>
      </div>
    </div>
  );
};

export default EmptyCanvasHint;
