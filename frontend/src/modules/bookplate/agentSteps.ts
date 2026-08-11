import type { Dispatch, SetStateAction } from 'react';
import type { NodeData } from './graphTypes';

type SetNodes = Dispatch<SetStateAction<NodeData[]>>;

/** 把 agent 中间步骤事件（tool_call / tool_result / status）追加到节点数据 */
export function appendAgentStep(setNodes: SetNodes, nodeId: string, step: any) {
  setNodes((prev) =>
    prev.map((n) => {
      if (n.id !== nodeId) return n;
      let newMessages = n.data?.messages;
      if (n.type === 'chat' && Array.isArray(newMessages) && newMessages.length > 0) {
        const msgs = [...newMessages];
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg.role === 'assistant') {
          const msgSteps = Array.isArray(lastMsg.agentSteps) ? lastMsg.agentSteps : [];
          msgs[msgs.length - 1] = { ...lastMsg, agentSteps: [...msgSteps, step] };
          newMessages = msgs;
        }
      }
      const steps = Array.isArray(n.data?.agentSteps) ? n.data.agentSteps : [];
      return {
        ...n,
        data: {
          ...n.data,
          agentSteps: [...steps, step],
          ...(newMessages ? { messages: newMessages } : {}),
        },
      };
    })
  );
}

/** 解析 SSE 事件并追加 agent 中间步骤（tool_call / tool_result / status 事件为 JSON） */
export function handleAgentSseMessage(
  setNodes: SetNodes,
  nodeId: string,
  event: string,
  data: string
) {
  if (event === 'agent_tool_call' || event === 'agent_tool_result' || event === 'agent_status') {
    let payload: any = {};
    try {
      payload = JSON.parse(data);
    } catch {
      payload = { message: data };
    }
    appendAgentStep(setNodes, nodeId, { type: event, ...payload });
  }
}
