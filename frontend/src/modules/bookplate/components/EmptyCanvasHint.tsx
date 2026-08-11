import React from 'react';
import { ArrowRight, Plus, Sparkles, Wand2 } from 'lucide-react';

interface Step {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  label: string;
  desc: string;
}

const STEPS: Step[] = [
  { icon: Plus, label: '生成图书元数据', desc: '在底部输入框输入触发' },
  { icon: Wand2, label: '选择处理方式', desc: '点击「+」扩展工作流' },
  { icon: Sparkles, label: '多模态生成', desc: '获取你的创作素材' },
];

const EmptyCanvasHint: React.FC = () => {
  return (
    <div className="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none">
      <div className="flex flex-col items-center gap-6 max-w-xl px-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <h2 className="font-serif text-2xl font-semibold text-ink/90 text-balance antialiased">
            搭建多模态工作流
          </h2>
          <p className="text-sm text-ink-light font-sans leading-relaxed text-pretty max-w-md">
            在底部输入框输入内容，生成「图书元数据」作为起始节点，将不同模态的处理能力自由组合，生成所需的创作素材。
          </p>
        </div>

        {/* 工作流步骤 */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-center mt-2">
          {STEPS.map((step, i) => (
            <React.Fragment key={step.label}>
              {i > 0 && (
                <ArrowRight size={14} strokeWidth={1.5} className="text-ink-faint/60 hidden sm:block" />
              )}
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border border-dashed border-paper-grid bg-paper/70 shadow-sm">
                <step.icon size={16} strokeWidth={1.5} className="text-accent shrink-0" />
                <div className="flex flex-col text-left">
                  <span className="text-xs font-serif text-ink font-medium leading-tight mb-0.5">{step.label}</span>
                  <span className="text-[10px] text-ink-faint font-sans leading-tight">{step.desc}</span>
                </div>
              </div>
            </React.Fragment>
          ))}
        </div>

        {/* 分支提示 */}
        <p className="text-[11px] text-ink-faint font-sans mt-4">
          提示：右键已有节点可快速添加子节点或删除分支
        </p>
      </div>
    </div>
  );
};

export default EmptyCanvasHint;
