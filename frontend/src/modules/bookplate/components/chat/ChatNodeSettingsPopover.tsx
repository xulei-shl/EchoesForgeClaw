import React, { memo } from 'react';
import { createPortal } from 'react-dom';
import { Eraser, Lock } from 'lucide-react';
import { Toggle } from '../../../../platform/components/ui/Toggle';
import { ModelOverrideField } from '../ModelOverrideField';
import { AgentOverrideField } from '../AgentOverrideField';
import type { ChatNodeSettings } from '../../../../platform/types';

const SettingsToggleRow = memo(({ label, description, checked, onChange, disabled }: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) => (
  <div className="flex items-start justify-between gap-2.5">
    <div className="min-w-0">
      <p className="text-xs font-sans text-ink">{label}</p>
      <p className="text-[10px] text-ink-faint font-sans mt-0.5 leading-snug">{description}</p>
    </div>
    <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
  </div>
));
SettingsToggleRow.displayName = 'SettingsToggleRow';

interface ChatNodeSettingsPopoverProps {
  open: boolean;
  coords: { x: number; y: number };
  popupRef: React.RefObject<HTMLDivElement | null>;
  settings: ChatNodeSettings;
  /** 图书元数据开关当前生效状态（显式设置或按 book_info 连通性的默认值），驱动设置弹层开关展示 */
  bookMetadataEnabled: boolean;
  /** 封面开关当前生效状态（显式设置或按 book_info 连通性的默认值），驱动设置弹层开关展示 */
  bookCoverEnabled: boolean;
  /** 节点执行模式：LLM 模式展示「模型」下拉、Agent 模式展示「Agent」下拉、skill_agent 展示思考模式 */
  mode?: 'llm' | 'agent' | 'skill_agent';
  configId?: number | null;
  /** 已有对话时锁定上下文配置 */
  hasMessages: boolean;
  onUpdateSettings: (next: ChatNodeSettings) => void;
  onClearChat: () => void;
  onClose: () => void;
}

/** ChatNode 运行设置弹层（portal 定位，避免被节点滚动容器裁剪）。 */
export const ChatNodeSettingsPopover: React.FC<ChatNodeSettingsPopoverProps> = ({
  open,
  coords,
  popupRef,
  settings,
  bookMetadataEnabled,
  bookCoverEnabled,
  mode,
  configId,
  hasMessages,
  onUpdateSettings,
  onClearChat,
  onClose,
}) => {
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div ref={popupRef} className="fixed z-[9999]" style={{ right: coords.x, bottom: coords.y, ['--pop-origin' as any]: 'bottom right' }}>
      <div className="w-64 pop-enter-anim">
        <div className="bg-paper border border-paper-grid rounded-xl shadow-xl overflow-hidden">
          <div className="px-3 py-2.5 border-b border-dashed border-paper-grid bg-paper-grid/10">
            <p className="text-xs font-sans font-medium text-ink-light">运行设置</p>
          </div>
          <div className="p-3 space-y-3">
            <SettingsToggleRow
              label="继承图书元数据"
              description="上游穿透的图书节点或兜底的图书节点"
              checked={bookMetadataEnabled}
              onChange={(v) => onUpdateSettings({ ...settings, includeBook: v })}
              disabled={hasMessages}
            />
            <SettingsToggleRow
              label="加载图书封面图片"
              description="上游穿透的图书节点或兜底的图书节点的封面图"
              checked={bookCoverEnabled}
              onChange={(v) => onUpdateSettings({ ...settings, includeBookCover: v })}
              disabled={hasMessages}
            />
            <SettingsToggleRow
              label="加载直接上级文本"
              description="仅提取紧邻相连的父节点输出的文字内容"
              checked={settings.includeUpstream}
              onChange={(v) => onUpdateSettings({ ...settings, includeUpstream: v })}
              disabled={hasMessages}
            />
            <SettingsToggleRow
              label="加载直接上级图片"
              description="仅提取紧邻相连的父节点输出的图像"
              checked={settings.includeUpstreamImages !== false}
              onChange={(v) => onUpdateSettings({ ...settings, includeUpstreamImages: v })}
              disabled={hasMessages}
            />
            {/* 模型选择：仅 LLM 模式（Agent 模式模型由 Agent 侧决定）；候选 = admin 已配置模型，留空 = 配置默认模型 */}
            {mode === 'llm' && configId != null && (
              <div className="space-y-1.5">
                <div>
                  <p className="text-xs font-sans text-ink">模型</p>
                  <p className="text-[10px] text-ink-faint font-sans mt-0.5 leading-snug">
                    切换为后台已配置的其他模型
                  </p>
                </div>
                <ModelOverrideField
                  value={settings.modelOverride}
                  onChange={(v) =>
                    onUpdateSettings({ ...settings, modelOverride: v })
                  }
                  configId={configId}
                  // 允许对话中切换模型：每轮全量重发 payload.messages（含注入上下文），
                  // 新模型天然接续完整历史，无需先清空对话（区别于 Agent/上下文，见下方说明）
                />
              </div>
            )}
            {/* Agent 选择：仅 Agent 模式（全部启用 FastClaw Agent，留空 = 节点绑定 Agent；
                对话开始后锁定，需先清空对话才能切换：换 Agent = FastClaw 新会话，
                历史将按文本层折中续聊，详见路由层跨 Agent 折叠逻辑） */}
            {mode === 'agent' && configId != null && (
              <div className="space-y-1.5">
                <div>
                  <p className="text-xs font-sans text-ink">Agent</p>
                  <p className="text-[10px] text-ink-faint font-sans mt-0.5 leading-snug">
                    切换为后台已配置的其他 FastClaw Agent
                  </p>
                </div>
                <AgentOverrideField
                  value={settings.agentOverride}
                  onChange={(v) =>
                    onUpdateSettings({ ...settings, agentOverride: v })
                  }
                  configId={configId}
                  disabled={hasMessages}
                />
              </div>
            )}
            {/* Thinking：仅 Skill Agent 模式（pi --thinking 透传；对话开始后锁定） */}
            {mode === 'skill_agent' && (
              <div className="space-y-1.5">
                <div>
                  <p className="text-xs font-sans text-ink">思考模式</p>
                  <p className="text-[10px] text-ink-faint font-sans mt-0.5 leading-snug">
                    启用 = 高推理档；关闭 = 视模型/服务商是否支持；默认 = 跟随模型默认
                  </p>
                </div>
                <select
                  value={
                    settings.piThinking === 'off' ? 'off' : settings.piThinking ? 'on' : ''
                  }
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, piThinking: e.target.value || undefined })
                  }
                  disabled={hasMessages}
                  className="w-full rounded-md border border-paper-grid bg-paper px-2 py-1.5 text-xs font-sans text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <option value="">默认（跟随模型）</option>
                  <option value="on">启用思考</option>
                  <option value="off">关闭思考</option>
                </select>
              </div>
            )}
            {hasMessages ? (
              <div className="flex items-start gap-1.5 p-2 rounded-md bg-paper-grid/40 border border-paper-grid text-ink-light">
                <Lock size={12} strokeWidth={1.5} className="shrink-0 mt-0.5" />
                <p className="text-[10px] font-sans leading-snug flex-1">
                  对话已开始：模型可在下方随时切换（历史自动续传）；上下文 / Agent 配置已锁定，切换需先清空对话。
                </p>
              </div>
            ) : (
              <p className="text-[10px] text-ink-faint font-sans leading-snug">
                上下文在首轮自动注入并随消息历史保持；清空对话后可重新注入。
              </p>
            )}
            {hasMessages && (
              <div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onClearChat();
                  }}
                  className="w-full flex items-center justify-center gap-1.5 rounded-md border border-dashed py-1.5 text-[11px] font-sans transition-[color,background-color,border-color,transform] duration-150 ease-out border-error/30 text-error/90 hover:bg-error/5 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-error cursor-pointer"
                >
                  <Eraser size={11} strokeWidth={2} />
                  清空对话（清空后重新注入上下文）
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};