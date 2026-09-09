import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentFile } from '../../../../shared/types';

/**
 * 工作区文件面板共享状态机（ChatNodeHost / PiChatNodeHost 复用）：
 * - 面板展开时加载文件列表；panelVersion 递增（生成收尾等时机）时展开状态下自动刷新；
 * - loader 返回 null 表示「跳过本次刷新」（如节点/工作区尚未就绪），不触碰已有列表；
 * - openOverride：外部受控展开态（多面板合并为单一侧边抽屉时由宿主统一驱动）；
 *   缺省 = 内部自管理。返回的 open 恒为生效值（openOverride ?? 内部状态）；
 * - 与旧实现的差异：列表状态统一为 AgentFile[]（旧实现偶用 null 表示未加载，渲染层 `?? []` 等价）。
 */
export function useWorkspaceFilesPanel(
  loader: () => Promise<AgentFile[] | null>,
  openOverride?: boolean
) {
  const [open, setOpen] = useState(false);
  const effectiveOpen = openOverride ?? open;
  const [files, setFiles] = useState<AgentFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);

  const openRef = useRef(effectiveOpen);
  openRef.current = effectiveOpen;

  // loader 经 ref 读取：调用方可安全传入内联函数，不会因每次渲染重建导致 load 依赖漂移
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await loaderRef.current();
      if (list !== null) setFiles(list);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (effectiveOpen) void load();
  }, [effectiveOpen, version, load]);

  /** 无条件重新拉取（面板内「刷新」按钮；面板隐藏时也执行，与旧实现一致） */
  const refresh = useCallback(() => void load(), [load]);
  /** 展开状态下重新拉取（生成收尾等时机经 ref 读取最新 open，避免闭包陈旧） */
  const refreshIfOpen = useCallback(() => {
    if (openRef.current) void load();
  }, [load]);
  /** 生成收尾 / 其他时机：递增版本号，展开状态下 effect 会自动刷新 */
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  /** 工作区切换（清空对话再生）时清空列表 */
  const reset = useCallback(() => setFiles([]), []);

  return { open: effectiveOpen, setOpen, files, setFiles, loading, refresh, refreshIfOpen, bump, reset };
}