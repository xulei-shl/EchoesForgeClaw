import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  Boxes,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { adminService } from '../../shared/services/admin';
import type {
  CanvasNodeType,
  FastClawAgentConfig,
  LLMConfig,
  NodeConfig,
  PromptTemplate,
  SkillAgentConfig,
} from '../../shared/types';
import { Button } from '../../shared/components/ui/Button';
import { Dialog } from '../../shared/components/ui/Dialog';
import { Select } from '../../shared/components/ui/Select';
import { Card } from '../../shared/components/ui/Card';
import { Toggle } from '../../shared/components/ui/Toggle';
import { Badge } from '../../shared/components/ui/Badge';
import { FieldLabel, PageHeader } from '../components/AdminBits';
import { useFeedback } from '../../shared/components/ui/FeedbackProvider';
import { NODE_TEMPLATES, NODE_PORT_TYPES, PORT_TYPE_LABELS, CATEGORY_LABELS } from '../../canvas/nodes/_shared/nodeTypes';
import { Sparkles } from 'lucide-react';

/** 模型类型短标签（下拉选项展示） */
const KIND_SHORT_LABEL: Record<string, string> = {
  text: '文本',
  multimodal: '多模态',
  image: '图像',
  video: '视频',
  audio: '音频',
};

/** 模板端口类型的只读摘要（如「输入：文本/图片 · 输出：图片」；由后端 node_types.py 模板声明） */
const portSummary = (type: string): string => {
  const pt = NODE_PORT_TYPES[type as keyof typeof NODE_PORT_TYPES];
  if (!pt) return '';
  const inputs = pt.inputs.length > 0 ? pt.inputs.map((t) => PORT_TYPE_LABELS[t]).join('/') : '无';
  const outputs = (pt.outputs ?? [pt.output]).map((t) => PORT_TYPE_LABELS[t]).join('/');
  return `输入：${inputs} · 输出：${outputs}`;
};

interface FormState {
  node_type: CanvasNodeType | '';
  name: string;
  /** 可选自定义分组（画板「+」菜单分组展示） */
  group: string;
  /** 模式：llm（提示词 + 大模型）/ agent（FastClaw Agent）/ skill_agent（Skill Agent） */
  mode: 'llm' | 'agent' | 'skill_agent';
  llm_config_id: number | '';
  prompt_id: number | '';
  agent_config_id: number | '';
  skill_agent_config_id: number | '';
  is_active: boolean;
}

const NODE_TYPE_LABEL: Record<string, string> = {
  image_analysis: '图片分析',
  text_generation: 'AI 文本生成',
  image_generation: '图像生成',
  chat: 'AI 对话',
  book_info: '图书元数据',
};

const EMPTY_FORM: FormState = {
  node_type: 'text_generation',
  name: '',
  group: '',
  mode: 'llm',
  llm_config_id: '',
  prompt_id: '',
  agent_config_id: '',
  skill_agent_config_id: '',
  is_active: true,
};

/** 内存级 SWR 缓存：页面切换 0ms 瞬间秒开 */
let cachedNodeConfigsData: NodeConfig[] | null = null;
let cachedDropdownsData: {
  llmConfigs: LLMConfig[];
  prompts: PromptTemplate[];
  fastclawAgents: FastClawAgentConfig[];
  skillAgentConfigs: SkillAgentConfig[];
} | null = null;

export const NodeConfigsPage: React.FC = () => {
  const [items, setItems] = useState<NodeConfig[]>(() => cachedNodeConfigsData ?? []);
  const [llmConfigs, setLlmConfigs] = useState<LLMConfig[]>(() => cachedDropdownsData?.llmConfigs ?? []);
  const [prompts, setPrompts] = useState<PromptTemplate[]>(() => cachedDropdownsData?.prompts ?? []);
  const [fastclawAgents, setFastclawAgents] = useState<FastClawAgentConfig[]>(() => cachedDropdownsData?.fastclawAgents ?? []);
  const [skillAgentConfigs, setSkillAgentConfigs] = useState<SkillAgentConfig[]>(() => cachedDropdownsData?.skillAgentConfigs ?? []);
  const [loading, setLoading] = useState(() => !cachedNodeConfigsData);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState<NodeConfig | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const { dialog, showToast } = useFeedback();

  // 1. 优先加载节点列表：毫秒级响应，先行出屏，不被弹窗字典阻塞
  const loadNodes = useCallback(async (silent = false) => {
    if (!silent && !cachedNodeConfigsData) setLoading(true);
    setError('');
    try {
      const nodeRes = await adminService.listNodeConfigs();
      cachedNodeConfigsData = nodeRes;
      setItems(nodeRes);
    } catch (e: any) {
      if (!cachedNodeConfigsData) setError(e?.message || '加载失败，请重试');
    } finally {
      setLoading(false);
    }
  }, []);

  // 2. 独立异步后台加载弹窗下拉字典（静默拉取，不阻塞主列表展示）
  const loadDropdowns = useCallback(async () => {
    try {
      const [llmRes, promptRes, agentRes, skillRes] = await Promise.all([
        adminService.listLlmConfigs(),
        adminService.listPrompts(),
        adminService.listFastClawAgents(),
        adminService.listSkillAgentConfigs(),
      ]);
      cachedDropdownsData = {
        llmConfigs: llmRes,
        prompts: promptRes,
        fastclawAgents: agentRes,
        skillAgentConfigs: skillRes,
      };
      setLlmConfigs(llmRes);
      setPrompts(promptRes);
      setFastclawAgents(agentRes);
      setSkillAgentConfigs(skillRes);
    } catch {
      /* 字典加载异常不影响主列表呈现 */
    }
  }, []);

  const load = useCallback(async (force = false) => {
    const isCached = !force && !!cachedNodeConfigsData;
    void loadNodes(isCached);
    void loadDropdowns();
  }, [loadNodes, loadDropdowns]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 可配置的模板（基础节点如图书元数据不需要 llm/agent 绑定） */
  const configurableTemplates = useMemo(
    () => NODE_TEMPLATES.filter((t) => t.configurable),
    []
  );

  /**
   * 提示词模板候选：非 AI 对话节点按所选节点模板类型过滤；
   * AI 对话为通用多模态对话节点（文本/图片输入，system prompt 与具体模板类型无关），
   * 展示全部类型提示词（与 Skill Agent 提示词可选口径一致）。
   * 已绑定提示词始终兜底显示，避免 select 为空。
   */
  const availablePrompts = useMemo(() => {
    const filtered =
      form.node_type === 'chat' ? prompts : prompts.filter((p) => p.node_type === form.node_type);
    if (editing && form.prompt_id !== '') {
      const bound = prompts.find((p) => p.id === form.prompt_id);
      if (bound && !filtered.some((p) => p.id === bound.id)) {
        return [...filtered, bound];
      }
    }
    return filtered;
  }, [prompts, form.node_type, form.prompt_id, editing]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setFormError('');
    setEditing(null);
    setShowCreate(false);
  };

  const openCreate = () => {
    resetForm();
    setShowCreate(true);
  };

  const openEdit = (nc: NodeConfig) => {
    setShowCreate(false);
    setEditing(nc);
    setForm({
      node_type: nc.node_type,
      name: nc.name,
      group: nc.group ?? '',
      mode: nc.skill_agent_config_id
        ? 'skill_agent'
        : nc.agent_config_id
          ? 'agent'
          : 'llm',
      llm_config_id: nc.llm_config_id ?? '',
      prompt_id: nc.prompt_id ?? '',
      agent_config_id: nc.agent_config_id ?? '',
      skill_agent_config_id: nc.skill_agent_config_id ?? '',
      is_active: nc.is_active,
    });
    setFormError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setFormError('请输入节点名称');
    if (!form.node_type) return setFormError('请选择节点模板类型');

    setSaving(true);
    setFormError('');
    setGroupOpen(false); // 关闭分组建议下拉，避免其遮挡/拦截保存按钮
    try {
      // 模式互斥：提交前只保留所选模式的字段，另一组置空
      const payload = {
        node_type: form.node_type,
        name: form.name.trim(),
        group: form.group.trim() || null,
        llm_config_id: form.mode === 'llm' && form.llm_config_id !== '' ? Number(form.llm_config_id) : null,
        prompt_id: form.mode === 'llm' && form.prompt_id !== '' ? Number(form.prompt_id) : null,
        agent_config_id: form.mode === 'agent' && form.agent_config_id !== '' ? Number(form.agent_config_id) : null,
        skill_agent_config_id:
          form.mode === 'skill_agent' && form.skill_agent_config_id !== ''
            ? Number(form.skill_agent_config_id)
            : null,
        is_active: form.is_active,
      };
      if (editing) {
        await adminService.updateNodeConfig(editing.id, payload);
        showToast('节点配置已更新', { type: 'success' });
      } else {
        await adminService.createNodeConfig(payload);
        showToast('节点配置已创建', { type: 'success' });
      }
      resetForm();
      // 保存成功后清除分组筛选：改组的配置若被当前筛选排除会“消失”，看起来像保存未生效
      setGroupFilter('');
      void loadNodes(true);
    } catch (err: any) {
      setFormError(err?.message || '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (nc: NodeConfig, next: boolean) => {
    try {
      await adminService.updateNodeConfig(nc.id, { is_active: next });
      showToast(next ? `已启用 ${nc.name}` : `已停用 ${nc.name}`, { type: 'success' });
      void loadNodes(true);
    } catch (e: any) {
      showToast(e?.message || '操作失败，请重试', { type: 'error' });
    }
  };

  const handleDelete = async (nc: NodeConfig) => {
    const ok = await dialog.confirm({
      title: '删除节点配置',
      message: `确定删除节点「${nc.name}」吗？删除后画板「+」菜单中将不再出现该节点。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await adminService.deleteNodeConfig(nc.id);
      showToast('节点配置已删除', { type: 'success' });
      setItems((prev) => {
        const next = prev.filter((it) => it.id !== nc.id);
        cachedNodeConfigsData = next;
        return next;
      });
      void loadNodes(true);
    } catch (e: any) {
      showToast(e?.message || '删除失败，请重试', { type: 'error' });
    }
  };

  /** 分组筛选：'' 全部 / '__ungrouped__' 未分组 / 具体分组名 */
  const [groupFilter, setGroupFilter] = useState('');
  /** 分组筛选后的配置列表 */
  const filteredItems = useMemo(() => {
    if (!groupFilter) return items;
    if (groupFilter === '__ungrouped__') return items.filter((nc) => !nc.group?.trim());
    return items.filter((nc) => nc.group?.trim() === groupFilter);
  }, [items, groupFilter]);

  /** 分组优先：有自定义分组的配置按 group 分组（按 group_order 升序，0 排最后、保持首见顺序，与画板「+」菜单一致）；
   *  无分组的按模板类型分组追加到末尾（保持 NODE_TEMPLATES 顺序） */
  const grouped = useMemo(() => {
    const groups: {
      key: string;
      title: string;
      description?: string;
      /** 自定义分组排序序号（模板分组不使用） */
      order?: number;
      configs: NodeConfig[];
    }[] = [];
    const groupMap = new Map<string, (typeof groups)[number]>();
    const ungrouped: NodeConfig[] = [];

    for (const nc of filteredItems) {
      const g = nc.group?.trim();
      if (g) {
        let grp = groupMap.get(g);
        if (!grp) {
          grp = { key: `group:${g}`, title: g, order: nc.group_order ?? 0, configs: [] };
          groupMap.set(g, grp);
          groups.push(grp);
        }
        grp.configs.push(nc);
      } else {
        ungrouped.push(nc);
      }
    }

    // 自定义组排序：group_order 升序（0 表示未排序，排最后、保持首见顺序）
    groups.sort((a, b) => {
      const ao = a.order || Number.MAX_SAFE_INTEGER;
      const bo = b.order || Number.MAX_SAFE_INTEGER;
      return ao - bo;
    });

    // 无分组的配置按模板类型分组追加到末尾
    for (const t of NODE_TEMPLATES) {
      const configs = ungrouped.filter((nc) => nc.node_type === t.type);
      if (configs.length > 0) {
        groups.push({
          key: `template:${t.type}`,
          title: `${CATEGORY_LABELS[t.category]} · ${t.name}`,
          description: t.description,
          configs,
        });
      }
    }
    return groups;
  }, [filteredItems]);

  // ---------- 分组拖拽排序（仅自定义分组可拖；筛选时禁用，避免对不完整分组集合排序） ----------
  const canReorderGroups = !groupFilter;
  const [dragGroupKey, setDragGroupKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const handleGroupDragStart = (e: React.DragEvent, key: string) => {
    setDragGroupKey(key);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', key);
  };
  const handleGroupDragOver = (e: React.DragEvent, key: string) => {
    if (!dragGroupKey || dragGroupKey === key) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverKey(key);
  };
  const handleGroupDrop = async (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    const fromKey = dragGroupKey ?? e.dataTransfer.getData('text/plain');
    setDragGroupKey(null);
    setDragOverKey(null);
    if (!fromKey || fromKey === targetKey) return;
    const keys = grouped.map((g) => g.key);
    const from = keys.indexOf(fromKey);
    const to = keys.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    const nextKeys = [...keys];
    nextKeys.splice(from, 1);
    nextKeys.splice(to, 0, fromKey);
    // 仅自定义分组参与排序（模板分组固定末尾，不发送）
    const order = nextKeys
      .filter((k) => k.startsWith('group:'))
      .map((k, i) => ({ group: k.slice('group:'.length), order: i + 1 }));
    if (order.length === 0) return;
    try {
      await adminService.reorderNodeGroups(order);
      showToast('分组排序已更新', { type: 'success' });
      load();
    } catch (err: any) {
      showToast(err?.message || '排序保存失败，请重试', { type: 'error' });
    }
  };
  const handleGroupDragEnd = () => {
    setDragGroupKey(null);
    setDragOverKey(null);
  };

  /** 列表分组的折叠状态（key → 折叠中） */
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  /** 已使用的分组名（去重、按首见顺序），供分组输入框下拉提示 */
  const existingGroups = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const nc of items) {
      const g = nc.group?.trim();
      if (g && !seen.has(g)) {
        seen.add(g);
        list.push(g);
      }
    }
    return list;
  }, [items]);

  /** 分组输入框：可自由输入新分组名，聚焦/输入时从已有分组下拉提示 */
  const [groupOpen, setGroupOpen] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const groupSuggestions = existingGroups.filter((g) => g.includes(form.group.trim()));

  useEffect(() => {
    if (!groupOpen) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (!groupRef.current?.contains(e.target as Node)) setGroupOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGroupOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [groupOpen]);

  return (
    <div>
      <PageHeader
        title="节点管理"
        subtitle="基于节点模板配置不同的执行节点（绑定模型 + 提示词或 Agent）；配置的节点会出现在画板「+」菜单中"
        actions={
          !showCreate && !editing && (
            <Button size="sm" onClick={openCreate}>
              <Plus size={15} strokeWidth={2} className="mr-1" />
              新建节点
            </Button>
          )
        }
      />

      {/* 新建/编辑表单弹窗 */}
      <Dialog
        open={showCreate || !!editing}
        onClose={resetForm}
        panelClassName="max-w-xl"
        title={
          <div className="flex items-center gap-2">
            <Boxes size={18} strokeWidth={1.5} className="text-accent" />
            {editing ? `编辑节点：${editing.name}` : '新建节点配置'}
          </div>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 模式互斥选择：提示词+大模型 / FastClaw Agent / Skill Agent */}
          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setForm({ ...form, mode: 'llm', agent_config_id: '' })}
              className={`rounded-md border p-3 text-left transition-all active:scale-[0.96] ${
                form.mode === 'llm'
                  ? 'border-accent/60 bg-accent-surface ring-1 ring-accent/40'
                  : 'border-paper-grid hover:border-paper-grid/70 hover:bg-paper-grid/20'
              }`}
            >
              <p className={`text-sm font-medium font-sans ${form.mode === 'llm' ? 'text-accent' : 'text-ink'}`}>
                <Link2 size={13} strokeWidth={1.5} className="inline mr-1 -mt-0.5" />
                提示词 + 大模型
              </p>
              <p className="text-xs text-ink-faint font-sans mt-1">绑定提示词与大模型</p>
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, mode: 'agent', llm_config_id: '', prompt_id: '' })}
              className={`rounded-md border p-3 text-left transition-all active:scale-[0.96] ${
                form.mode === 'agent'
                  ? 'border-accent/60 bg-accent-surface ring-1 ring-accent/40'
                  : 'border-paper-grid hover:border-paper-grid/70 hover:bg-paper-grid/20'
              }`}
            >
              <p className={`text-sm font-medium font-sans ${form.mode === 'agent' ? 'text-accent' : 'text-ink'}`}>
                <Bot size={13} strokeWidth={1.5} className="inline mr-1 -mt-0.5" />
                Agent 模式
              </p>
              <p className="text-xs text-ink-faint font-sans mt-1">调用 FastClaw Agent</p>
            </button>
            <button
              type="button"
              onClick={() =>
                setForm({ ...form, mode: 'skill_agent', llm_config_id: '', prompt_id: '', agent_config_id: '' })
              }
              className={`rounded-md border p-3 text-left transition-all active:scale-[0.96] ${
                form.mode === 'skill_agent'
                  ? 'border-accent/60 bg-accent-surface ring-1 ring-accent/40'
                  : 'border-paper-grid hover:border-paper-grid/70 hover:bg-paper-grid/20'
              }`}
            >
              <p className={`text-sm font-medium font-sans ${form.mode === 'skill_agent' ? 'text-accent' : 'text-ink'}`}>
                <Sparkles size={13} strokeWidth={1.5} className="inline mr-1 -mt-0.5" />
                Skill Agent
              </p>
              <p className="text-xs text-ink-faint font-sans mt-1">绑定 Pi Agent</p>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <FieldLabel required>节点名称</FieldLabel>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如：提示词生成 · 文学风"
                className="flex h-10 w-full rounded-md border border-dashed border-paper-grid bg-transparent px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel required>节点模板类型</FieldLabel>
              <Select
                value={form.node_type || ''}
                onChange={(val) =>
                  setForm({
                    ...form,
                    node_type: val as CanvasNodeType,
                    prompt_id: '',
                    llm_config_id: '',
                    agent_config_id: '',
                    skill_agent_config_id: '',
                  })
                }
                options={configurableTemplates.map((t) => ({
                  label: `${CATEGORY_LABELS[t.category]} · ${t.name}`,
                  value: t.type,
                  title: t.description,
                }))}
              />
              {form.node_type && (
                <p className="text-xs text-ink-faint font-sans">
                  端口（模板声明，只读）：{portSummary(form.node_type)}
                </p>
              )}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <FieldLabel>分组（可选）</FieldLabel>
              <div ref={groupRef} className="relative">
                <input
                  value={form.group}
                  onChange={(e) => {
                    setForm({ ...form, group: e.target.value });
                    setGroupOpen(true);
                  }}
                  onFocus={() => setGroupOpen(true)}
                  placeholder="如：文学风 / 写实（可输入新分组或选择已有分组）"
                  className="flex h-10 w-full rounded-md border border-dashed border-paper-grid bg-transparent px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
                />
                {groupOpen && groupSuggestions.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full max-h-40 overflow-y-auto rounded-md border border-paper-grid bg-paper shadow-lg">
                    {groupSuggestions.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => {
                          setForm({ ...form, group: g });
                          setGroupOpen(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-ink hover:bg-accent-surface/60 active:scale-[0.99] transition-colors"
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-xs text-ink-faint font-sans">
                留空则按节点模板类型分组展示
              </p>
            </div>
            {form.mode === 'skill_agent' ? (
              <div className="space-y-1.5 sm:col-span-2">
                <FieldLabel>Skill Agent 配置</FieldLabel>
                <Select
                  value={String(form.skill_agent_config_id || '')}
                  onChange={(val) => setForm({ ...form, skill_agent_config_id: val === '' ? '' : Number(val) })}
                  options={[
                    { label: '请选择 Skill Agent 配置', value: '' },
                    ...skillAgentConfigs
                      .filter((a) => a.is_active)
                      .map((a) => ({ label: a.name, value: String(a.id) })),
                  ]}
                />
                <AnimatePresence initial={false}>
                  {skillAgentConfigs.filter((a) => a.is_active).length === 0 && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <p className="text-xs text-ink-faint font-sans pt-1.5">
                        暂无启用的 Skill Agent 配置，可先在「Skill Agent」中创建
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : form.mode === 'agent' ? (
              <div className="space-y-1.5 sm:col-span-2">
                <FieldLabel>FastClaw Agent</FieldLabel>
                <Select
                  value={String(form.agent_config_id || '')}
                  onChange={(val) => setForm({ ...form, agent_config_id: val === '' ? '' : Number(val) })}
                  options={[
                    { label: '请选择 Agent', value: '' },
                    ...fastclawAgents.filter((a) => a.is_active).map((a) => {
                      // 优先展示 FastClaw 真实名字（如 Xulei），与配置名不同时并列展示
                      const real = a.agent_name || '';
                      return {
                        label: real && real !== a.name ? `${real}（${a.name}）` : a.name,
                        value: String(a.id),
                      };
                    }),
                  ]}
                />
                <AnimatePresence initial={false}>
                  {fastclawAgents.filter((a) => a.is_active).length === 0 && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <p className="text-xs text-ink-faint font-sans pt-1.5">
                        暂无启用的 Agent 配置，可先在「Agent 配置」中创建
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <FieldLabel>模型配置</FieldLabel>
                  <Select
                    value={String(form.llm_config_id || '')}
                    onChange={(val) => setForm({ ...form, llm_config_id: val === '' ? '' : Number(val) })}
                    options={[
                      { label: '请选择模型配置', value: '' },
                      ...llmConfigs.map((c) => ({
                        label: `${c.model_name || c.name}（${KIND_SHORT_LABEL[c.kind] ?? c.kind}）`,
                        value: String(c.id),
                      })),
                    ]}
                  />
                  <AnimatePresence initial={false}>
                    {llmConfigs.length === 0 && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <p className="text-xs text-ink-faint font-sans pt-1.5">
                          暂无模型配置，可先在「模型配置」中创建
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <div className="space-y-1.5">
                  <FieldLabel>提示词模板</FieldLabel>
                  <Select
                    value={String(form.prompt_id || '')}
                    onChange={(val) => setForm({ ...form, prompt_id: val === '' ? '' : Number(val) })}
                    options={[
                      { label: '请选择提示词模板', value: '' },
                      ...availablePrompts.map((p) => ({
                        label: p.name,
                        value: String(p.id),
                      })),
                    ]}
                  />
                  <AnimatePresence initial={false}>
                    {availablePrompts.length === 0 && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <p className="text-xs text-ink-faint font-sans pt-1.5">
                          暂无可用提示词，可先在「提示词管理」中创建
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            )}
            <div className="flex items-center gap-2.5 sm:col-span-2 pt-1">
              <Toggle checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="启用状态" />
              <span className="text-sm font-sans text-ink-light">{form.is_active ? '启用' : '停用'}</span>
            </div>
          </div>
          {formError && <p className="text-sm text-error font-sans">{formError}</p>}
          <div className="flex justify-end gap-3 pt-5 border-t border-dashed border-paper-grid">
            <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
              取消
            </Button>
            <Button type="submit" size="sm" isLoading={saving}>
              保存
            </Button>
          </div>
        </form>
      </Dialog>

      {/* 首次冷启动骨架屏 */}
      {loading && items.length === 0 && (
        <div className="space-y-4 animate-pulse" aria-busy="true" aria-label="正在加载节点配置">
          <div className="flex justify-between items-center pb-2">
            <div className="h-4 w-36 bg-paper-grid/50 rounded" />
            <div className="h-8 w-44 bg-paper-grid/40 rounded-lg" />
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-6 w-28 bg-paper-grid/45 rounded mb-2" />
              <div className="p-4 rounded-lg border border-dashed border-paper-grid bg-node-bg space-y-2">
                <div className="flex justify-between">
                  <div className="h-5 w-48 bg-paper-grid/50 rounded" />
                  <div className="h-4 w-12 bg-paper-grid/35 rounded" />
                </div>
                <div className="h-4 w-72 bg-paper-grid/30 rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && items.length === 0 && (
        <div className="py-12 flex flex-col items-center gap-3">
          <span className="text-sm text-error font-sans">{error}</span>
          <Button variant="ghost" size="sm" onClick={() => void load(true)}>
            <RefreshCw size={14} strokeWidth={1.5} className="mr-1" />
            重试
          </Button>
        </div>
      )}

      {/* 列表（分组优先展示，组可折叠） */}
      {items.length > 0 && (
        <div className="space-y-6">
          {/* 分组筛选工具栏 */}
          {items.length > 0 && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-ink-faint font-sans">
                {groupFilter
                  ? `已筛选：${groupFilter === '__ungrouped__' ? '未分组' : `分组「${groupFilter}」`}`
                  : `共 ${items.length} 个节点配置`}
                {existingGroups.length > 0 && !groupFilter && (
                  <span className="hidden sm:inline ml-2 text-ink-faint/70">· 拖拽自定义分组标题可调整顺序</span>
                )}
              </p>
              <Select
                value={groupFilter}
                onChange={setGroupFilter}
                size="sm"
                className="w-44 shrink-0"
                options={[
                  { label: '全部分组', value: '' },
                  { label: '未分组', value: '__ungrouped__' },
                  ...existingGroups.map((g) => ({ label: g, value: g })),
                ]}
              />
            </div>
          )}
          {/* 筛选后无匹配 */}
          {items.length > 0 && grouped.length === 0 && (
            <Card className="py-10 flex flex-col items-center gap-2 text-center">
              <Boxes size={28} strokeWidth={1} className="text-ink-faint" />
              <p className="text-sm text-ink-light font-sans">当前筛选下没有节点配置</p>
            </Card>
          )}
          {items.length === 0 ? (
            <Card className="py-14 flex flex-col items-center gap-3 text-center">
              <Boxes size={36} strokeWidth={1} className="text-ink-faint" />
              <p className="font-serif text-base text-ink">还没有节点配置</p>
              <p className="text-sm text-ink-light font-sans">
                创建节点配置后，画板「+」菜单中即可添加对应节点
              </p>
            </Card>
          ) : (
            grouped.map((group) => {
              const isCollapsed = !!collapsedGroups[group.key];
              const isCustomGroup = group.key.startsWith('group:');
              const draggable = isCustomGroup && canReorderGroups;
              return (
              <div key={group.key}>
                <button
                  type="button"
                  onClick={() =>
                    setCollapsedGroups((prev) => ({ ...prev, [group.key]: !prev[group.key] }))
                  }
                  onDragStart={draggable ? (e) => handleGroupDragStart(e, group.key) : undefined}
                  onDragOver={draggable ? (e) => handleGroupDragOver(e, group.key) : undefined}
                  onDrop={draggable ? (e) => handleGroupDrop(e, group.key) : undefined}
                  onDragEnd={draggable ? handleGroupDragEnd : undefined}
                  draggable={draggable}
                  title={
                    draggable
                      ? isCollapsed
                        ? '展开分组（可拖拽排序）'
                        : '折叠分组（可拖拽排序）'
                      : isCollapsed
                        ? '展开分组'
                        : '折叠分组'
                  }
                  className={`w-full mb-2 flex items-center gap-2 text-left group hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded ${
                    draggable ? 'cursor-grab active:cursor-grabbing' : ''
                  } ${dragGroupKey === group.key ? 'opacity-40' : ''} ${
                    dragOverKey === group.key ? 'ring-1 ring-accent bg-accent-surface/40' : ''
                  }`}
                >
                  {isCollapsed ? (
                    <ChevronRight size={15} strokeWidth={1.5} className="text-ink-faint shrink-0 transition-transform" />
                  ) : (
                    <ChevronDown size={15} strokeWidth={1.5} className="text-ink-faint shrink-0 transition-transform" />
                  )}
                  <span className="font-serif text-sm font-semibold text-ink">
                    {group.title}
                  </span>
                  {group.description && (
                    <span className="text-xs text-ink-faint font-sans truncate">{group.description}</span>
                  )}
                  <span className="ml-auto text-xs text-ink-faint font-sans tabular-nums">
                    {group.configs.length} 个
                  </span>
                  {draggable && (
                    <GripVertical size={13} strokeWidth={1.5} className="text-ink-faint/60 shrink-0" />
                  )}
                </button>
                {!isCollapsed && (
                <div className="space-y-3">
                  {group.configs.map((nc) => (
                    <Card key={nc.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-serif text-base font-semibold text-ink">{nc.name}</span>
                            {/* 模板分组（未配置自定义分组）内的卡片显示模板类型标签 */}
                            {!nc.group?.trim() && (
                              <span className="text-xs text-ink-light border border-dashed border-paper-grid rounded-pill px-2 py-px font-mono">
                                {NODE_TYPE_LABEL[nc.node_type] ?? nc.node_type}
                              </span>
                            )}
                            {portSummary(nc.node_type) && (
                              <span
                                title={portSummary(nc.node_type)}
                                className="text-[10px] text-ink-faint border border-dashed border-paper-grid/70 rounded-pill px-1.5 py-px font-mono"
                              >
                                {portSummary(nc.node_type)}
                              </span>
                            )}
                            <Badge variant={nc.is_active ? 'success' : 'default'} showDot>
                              {nc.is_active ? '启用' : '停用'}
                            </Badge>
                          </div>
                          {nc.skill_agent_config_id ? (
                            <div className="mt-2 flex items-center gap-2 flex-wrap text-sm font-sans">
                              <span className="inline-flex items-center gap-1.5 text-accent">
                                <Sparkles size={14} strokeWidth={1.5} />
                                <span className="text-ink-faint text-xs">Skill Agent 模式</span>
                                {nc.skill_agent_config_name ?? <span className="text-ink-faint">未命名配置</span>}
                              </span>
                            </div>
                          ) : nc.agent_config_id ? (
                            <div className="mt-2 flex items-center gap-2 flex-wrap text-sm font-sans">
                              <span className="inline-flex items-center gap-1.5 text-accent">
                                <Bot size={14} strokeWidth={1.5} />
                                <span className="text-ink-faint text-xs">Agent 模式</span>
                                {nc.agent_config_agent_name ?? nc.agent_config_name ?? (
                                  <span className="text-ink-faint">未命名 Agent</span>
                                )}
                              </span>
                            </div>
                          ) : (
                            <div className="mt-2 flex items-center gap-2 flex-wrap text-sm font-sans">
                              <span className="inline-flex items-center gap-1.5 text-ink">
                                <span className="text-ink-faint text-xs">模型</span>
                                {nc.llm_config_name ?? <span className="text-ink-faint">未绑定（环境变量）</span>}
                              </span>
                              <span className="text-ink-faint">→</span>
                              <span className="inline-flex items-center gap-1.5 text-ink">
                                <span className="text-ink-faint text-xs">提示词</span>
                                {nc.prompt_name ?? <span className="text-ink-faint">内置默认</span>}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Toggle checked={nc.is_active} onChange={(v) => handleToggleActive(nc, v)} label={nc.is_active ? '停用' : '启用'} />
                          <button
                            onClick={() => openEdit(nc)}
                            title="编辑"
                            className="p-1.5 rounded-md text-ink-light hover:text-accent hover:bg-accent-surface transition-colors active:scale-[0.96]"
                          >
                            <Pencil size={15} strokeWidth={1.5} />
                          </button>
                          <button
                            onClick={() => handleDelete(nc)}
                            title="删除"
                            className="p-1.5 rounded-md text-ink-light hover:text-error hover:bg-error/5 transition-colors active:scale-[0.96]"
                          >
                            <Trash2 size={15} strokeWidth={1.5} />
                          </button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
                )}
              </div>
              );
            })
          )}
          {/* 未配置的模板提示 */}
          {items.length > 0 && configurableTemplates.filter((t) => !items.some((nc) => nc.node_type === t.type)).length > 0 && (
            <p className="text-xs text-ink-faint font-sans">
              未配置的模板类型（{configurableTemplates.filter((t) => !items.some((nc) => nc.node_type === t.type)).map((t) => t.name).join('、')}）在画板中将使用「默认配置」（环境变量回退）
            </p>
          )}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <Card className="py-14 flex flex-col items-center gap-3 text-center">
          <Boxes size={36} strokeWidth={1} className="text-ink-faint" />
          <p className="font-serif text-base text-ink">还没有节点配置</p>
          <p className="text-sm text-ink-light font-sans">
            创建节点配置后，画板「+」菜单中即可添加对应节点
          </p>
        </Card>
      )}
    </div>
  );
};

export default NodeConfigsPage;
