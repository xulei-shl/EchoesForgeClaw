import { ChevronDown, FolderOpen, Loader2, RefreshCw } from 'lucide-react';
import { WorkspaceFileGroup } from './SkillFileCard';
import { splitWorkspaceFiles } from '../../workspaceFiles';
import type { AgentFile } from '../../../../platform/types';

/** 工作区产物面板（skill_agent 模式专用；数据由宿主从服务端拉取，其他模式不传即不渲染） */
export interface ChatWorkspaceFilesPanel {
  open: boolean;
  loading: boolean;
  files: AgentFile[];
  onToggle: () => void;
  onRefresh: () => void;
}

/** 工作区文件面板（skill_agent）：服务端 outputs/ 快照 ∪ manifest 历史 ∪ inputs/ 上传，
 *  按来源分两组折叠展示（Agent 产物默认展开、我的上传默认收起）。 */
export const WorkspaceFilesPanel: React.FC<{ panel: ChatWorkspaceFilesPanel }> = ({ panel }) => (
  <div className="shrink-0 mt-1.5">
    <div className="flex items-center gap-1.5">
      <button
        onClick={panel.onToggle}
        className="flex items-center gap-1.5 text-[11px] font-sans text-ink-faint hover:text-accent transition-colors"
      >
        <FolderOpen size={12} strokeWidth={2} />
        <span>
          工作区文件
          {panel.files.length > 0 && ` (${panel.files.length})`}
        </span>
        {panel.open ? (
          <ChevronDown size={11} strokeWidth={2} className="rotate-180" />
        ) : (
          <ChevronDown size={11} strokeWidth={2} />
        )}
      </button>
      {panel.open && (
        <button
          onClick={() => panel.onRefresh()}
          disabled={panel.loading}
          title="刷新文件列表"
          className="flex items-center justify-center w-5 h-5 rounded-md text-ink-faint hover:text-accent hover:bg-accent/10 active:scale-95 transition disabled:opacity-40"
        >
          <RefreshCw size={10} strokeWidth={2} className={panel.loading ? 'animate-spin' : ''} />
        </button>
      )}
    </div>
    {panel.open && (() => {
      const { artifacts, uploads } = splitWorkspaceFiles(panel.files);
      return (
        <div className="mt-1.5 max-h-40 overflow-y-auto flex flex-col gap-1.5 pr-0.5 custom-scrollbar">
          {panel.loading && !panel.files.length ? (
            <div className="flex items-center gap-1.5 text-[10px] font-sans text-ink-faint py-1">
              <Loader2 size={11} className="animate-spin" /> 加载中…
            </div>
          ) : panel.files.length === 0 ? (
            <p className="text-[10px] font-sans text-ink-faint py-1">暂无文件</p>
          ) : (
            <>
              <WorkspaceFileGroup title="Agent 产物" files={artifacts} />
              <WorkspaceFileGroup
                title="我的上传"
                files={uploads}
                defaultOpen={false}
                tone="upload"
              />
            </>
          )}
        </div>
      );
    })()}
  </div>
);