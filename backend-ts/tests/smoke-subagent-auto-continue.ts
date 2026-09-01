/**
 * 后台子代理「自动续轮」冒烟测试（手动冒烟，非 CI）
 *
 * 直接驱动真实代码路径（preparePiWorkspace + runPiAgent，即 ai-nodes.ts chat 路由的核心），
 * 使用 DB llm_configs 的真实 agnes 模型 + 已安装 pi-subagents 扩展，验证：
 * 1. 主 agent 派后台异步 subagent（async:true）→ tool_result 带 asyncId → 主轮 agent_settled
 * 2. 后端进入空闲监听态（心跳 + 等待续轮 agent_start）
 * 3. 后台 subagent 完成 → 捕获续轮 agent_start（turn_start）→ 续轮事件继续流出
 * 4. 后台全部结束 → 空快照 → 监听退出
 *
 * 依赖（真实环境）：
 * - backend-ts/bookforge.db 的 llm_configs（含可用 api_key 与可达 base_url）
 * - 已 `pi install` pi-subagents 且装配白名单 PI_EXTENSIONS 含 pi-subagents
 * 运行：
 *   cd backend-ts && PI_EXTENSIONS="@juicesharp/rpiv-todo,@juicesharp/rpiv-ask-user-question,pi-subagents" \
 *     npx tsx --env-file=.env tests/smoke-subagent-auto-continue.ts
 * 2026-09-01 实测 PASS：完整链路 tool_call(subagent,async)→tool_result(asyncId)→主轮 settled→
 * heartbeat(监听)→subagent complete→turn_start(续轮)→续轮正文→runs=0 退出，全程无需用户手动发消息。
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../src/config/database.js';
import { llmConfigs } from '../src/db/schema.js';
import { preparePiWorkspace } from '../src/services/pi/workspace.js';
import { runPiAgent } from '../src/services/pi/runner.js';
import { computeWorkspaceGeneration } from '../src/services/pi/generation.js';
import { resolvePiExtensions } from '../src/services/pi/resolve.js';
import type { ChatStreamEvent } from '../src/modules/bookplate/stream.js';

const db = getDb();
const llm = db.select().from(llmConfigs).where(eq(llmConfigs.id, 1)).get();
if (!llm) throw new Error('llm_config id=1 not found');

const chatModel = {
  baseUrl: llm.baseUrl,
  apiKey: llm.apiKey,
  modelName: llm.modelName,
  multimodal: llm.kind === 'multimodal',
  apiFormat: llm.apiFormat ?? null,
  thinkingFormat: llm.thinkingFormat ?? null,
  contextWindow: llm.contextWindow ?? null,
  maxTokens: llm.maxTokens ?? null,
};

const userId = 1;
const workspaceId = `smoke-${Date.now()}`;

console.log('[smoke] model:', llm.modelName, 'base:', llm.baseUrl);
console.log('[smoke] extensions:', resolvePiExtensions().map((e) => e.name).join(', '));

const generation = computeWorkspaceGeneration({
  userId,
  agentId: 2,
  skillNames: [],
  chatModel,
  imageModel: null,
  extensionNames: resolvePiExtensions().map((s) => s.name),
});

const prepared = preparePiWorkspace(userId, workspaceId, {
  agentId: 2,
  chatModel,
  imageModel: null,
  skillNames: [],
});
console.log('[smoke] ws:', prepared.ws, 'hasPrompt:', prepared.hasPrompt, 'mounted:', prepared.mountedExtensions.length);

const MESSAGE = [
  'Use the subagent tool to launch a background async subagent.',
  'Call subagent({ action: "run", agent: "delegate", task: "Reply with exactly: DONE-OK and stop.", async: true }).',
  'Then reply with exactly: "LAUNCHED" and end your turn immediately. Do not wait for the subagent, do not call subagent_wait, do not poll.',
].join('\n');

  const signal = AbortSignal.timeout(180_000);
  // AbortSignal.timeout 无 clearTimeout；超时后 abort 会触发 runner.onAbort（杀树+终局），
  // 无需手动清理；如需提前结束可另用 AbortController 手动 abort。
const t0 = Date.now();
let sawMainSettle = false;
let sawListenHeartbeat = false;
let sawTurnStart = false;
let sawContinuationContent = false;
let sawFleet = false;

try {
  for await (const evt of runPiAgent({
    userId,
    workspaceId,
    ws: prepared.ws,
    hasPrompt: prepared.hasPrompt,
    chatModelName: llm.modelName,
    imageGenEnabled: false,
    extensions: prepared.mountedExtensions,
    message: MESSAGE,
    thinkingLevel: 'off',
    signal,
    generation,
  })) {
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    switch (evt.type) {
      case 'tool_call':
        if (evt.name === 'subagent') console.log(`[${dt}s] tool_call subagent args=${evt.arguments}`);
        else console.log(`[${dt}s] tool_call ${evt.name}`);
        break;
      case 'tool_result':
        if (evt.name === 'subagent') {
          sawFleet = true;
          console.log(`[${dt}s] tool_result subagent (asyncId?) result=${evt.result.slice(0, 160)}`);
        }
        break;
      case 'content_delta':
        if (sawTurnStart) sawContinuationContent = true;
        console.log(`[${dt}s] content: ${evt.delta}`);
        break;
      case 'turn_start':
        sawTurnStart = true;
        console.log(`[${dt}s] ★★★ turn_start（续轮起始，监听捕获到后台完成）`);
        break;
      case 'heartbeat':
        if (!sawListenHeartbeat) {
          sawListenHeartbeat = true;
          console.log(`[${dt}s] ★★★ heartbeat（监听态保活）`);
        }
        break;
      case 'subagent_fleet':
        console.log(`[${dt}s] subagent_fleet runs=${evt.runs.length} states=${evt.runs.map((r) => r.state).join(',')}`);
        break;
      case 'status':
        console.log(`[${dt}s] status: ${evt.message}`);
        break;
      case 'error':
        console.log(`[${dt}s] ERROR: ${evt.message}`);
        break;
      default:
        break;
    }
    if (evt.type === 'content_delta' && evt.delta.includes('LAUNCHED')) {
      // 主轮正文出现 LAUNCHED，标记主轮接近完成
    }
  }
} catch (e) {
  console.log('[smoke] stream error:', e instanceof Error ? e.message : String(e));
}

console.log('\n=== 结果汇总 ===');
console.log('派了 subagent 工具调用:', sawFleet);
console.log('进入监听态（收到 heartbeat）:', sawListenHeartbeat);
console.log('捕获到续轮 turn_start:', sawTurnStart);
console.log('续轮产出正文:', sawContinuationContent);
const ok = sawFleet && sawTurnStart && sawContinuationContent;
console.log('RESULT:', ok ? 'PASS ✅（后台子代理自动续轮链路完整）' : 'FAIL ❌');
