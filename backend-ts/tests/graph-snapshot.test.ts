import { describe, expect, it } from 'vitest';
import type { EdgeData, NodeData } from '../../frontend/src/modules/bookplate/graphTypes.js';
import {
  buildGraphSnapshot,
  collectAncestorIds,
} from '../../frontend/src/modules/bookplate/graphSnapshot.js';
import {
  sanitizeNodeData,
  MAX_CHAT_MESSAGES,
  MAX_AGENT_STEPS,
} from '../../frontend/src/modules/bookplate/graphSnapshotSanitize.js';
import {
  hydrateGraphSnapshot,
  nextCanvasX,
} from '../../frontend/src/modules/bookplate/graphSnapshotImport.js';

const node = (id: string, type: string, x: number, y: number, data: any = {}): NodeData => ({
  id,
  type: type as any,
  x,
  y,
  data,
});
const edge = (source: string, target: string): EdgeData => ({ id: `e-${source}-${target}`, source, target });

describe('collectAncestorIds', () => {
  it('沿入边向上 BFS 收集全部祖先（含自身）', () => {
    const edges = [
      edge('a', 'b'),
      edge('b', 'c'),
      edge('x', 'c'),
      edge('c', 'r'),
      edge('r', 'z'),
    ];
    expect(collectAncestorIds('r', edges)).toEqual(new Set(['r', 'a', 'c', 'b', 'x']));
  });

  it('无入边时只有自身', () => {
    expect(collectAncestorIds('root', [edge('other', 'x')])).toEqual(new Set(['root']));
  });
});

describe('buildGraphSnapshot', () => {
  it('结果节点不存在时返回 null', () => {
    const nodes = [node('n1', 'text', 0, 0)];
    expect(buildGraphSnapshot('nope', nodes, [])).toBeNull();
  });

  it('采集整链条并圈定子图边', () => {
    const nodes = [
      node('book', 'book_info', 0, 0, { isbn: '978', title: 'T', cover_image_local: 'data:image/png;base64,xxx' }),
      node('text', 'text_generation', 380, 0, { content: 'prompt A', isGenerating: true }),
      node('img', 'image_generation', 760, 0, { imageUrl: '/static/generated/1/a.png', isGenerating: true }),
      node('unrelated', 'text', 9999, 9999, {}),
    ];
    const edges = [edge('book', 'text'), edge('text', 'img'), edge('unrelated', 'img')];
    const snap = buildGraphSnapshot('img', nodes, edges);
    expect(snap).not.toBeNull();
    expect(snap!.version).toBe(1);
    expect(snap!.resultNodeId).toBe('img');
    // unrelated → img 直连，属于上游祖先，也在快照内
    expect(snap!.nodes.map((n) => n.id)).toEqual(['book', 'text', 'img', 'unrelated']);
    expect(snap!.edges.map((e) => `${e.source}->${e.target}`)).toEqual([
      'book->text',
      'text->img',
      'unrelated->img',
    ]);

    // 瞬态字段被清洗、base64 被丢弃
    const bookNode = snap!.nodes.find((n) => n.id === 'book')!;
    expect(bookNode.data.isbn).toBe('978');
    expect(bookNode.data.title).toBe('T');
    expect(bookNode.data.cover_image_local).toBeUndefined();
    expect(snap!.nodes.find((n) => n.id === 'text')!.data.isGenerating).toBeUndefined();
    expect(snap!.nodes.find((n) => n.id === 'img')!.data.imageUrl).toBe('/static/generated/1/a.png');
  });
});

describe('sanitizeNodeData', () => {
  it('丢弃瞬态字段与 base64，保留文本与 /static url', () => {
    const out = sanitizeNodeData('image_generation', {
      prompt: 'hi',
      imageUrl: '/static/generated/1/a.png',
      uploadedImage: 'data:image/png;base64,abc',
      isGenerating: true,
      error: 'x',
      agentSteps: [
        { type: 'agent_status', message: 'm' },
        { type: 'agent_tool_call', name: 't', arguments: 'a'.repeat(1000) },
      ],
    });
    expect(out.prompt).toBe('hi');
    expect(out.imageUrl).toBe('/static/generated/1/a.png');
    expect(out.uploadedImage).toBeUndefined();
    expect(out.isGenerating).toBeUndefined();
    expect(out.error).toBeUndefined();
    expect(out.agentSteps.length).toBe(2);
    expect(out.agentSteps[1].arguments.length).toBeLessThanOrEqual(500 + 1); // 截断 + 省略号
  });

  it('chat 只保留最近 N 条消息', () => {
    const msgs = Array.from({ length: MAX_CHAT_MESSAGES + 5 }, (_, i) => ({ role: 'user', content: `m${i}`, images: ['data:image/png;base64,x'] }));
    const out = sanitizeNodeData('chat', { messages: msgs, output: 'final' });
    expect(out.messages.length).toBe(MAX_CHAT_MESSAGES);
    expect(out.messages[0].content).toBe(`m${5}`);
    expect(out.messages[1].images).toEqual([]);
    expect(out.output).toBe('final');
  });

  it('agentSteps 条数封顶', () => {
    const steps = Array.from({ length: MAX_AGENT_STEPS + 3 }, (_, i) => ({ type: 'agent_status', message: `s${i}` }));
    const out = sanitizeNodeData('text_generation', { agentSteps: steps });
    expect(out.agentSteps.length).toBe(MAX_AGENT_STEPS);
    expect(out.agentSteps[0].message).toBe(`s${3}`);
  });

  it('非对象 data 返回空对象', () => {
    expect(sanitizeNodeData('text', null)).toEqual({});
    expect(sanitizeNodeData('text', 'str')).toEqual({});
  });
});

describe('hydrateGraphSnapshot', () => {
  it('重映射 id、平移到现有画布右侧、合并 seedData 默认值', () => {
    const snap = {
      version: 1 as const,
      resultNodeId: 'img',
      nodes: [
        { id: 'book', type: 'book_info' as const, x: 0, y: 0, data: { isbn: '978' } },
        { id: 'img', type: 'image_generation' as const, x: 760, y: 0, data: { imageUrl: '/static/generated/1/a.png', prompt: 'p' } },
      ],
      edges: [{ source: 'book', target: 'img' }],
    };
    const existing = [node('old', 'text', 0, 0)];
    const { nodes, edges, resultNodeId } = hydrateGraphSnapshot(snap, existing, 120);

    expect(nodes.length).toBe(2);
    expect(edges.length).toBe(1);
    expect(resultNodeId).toMatch(/^node-import-\d+$/);

    const img = nodes.find((n) => n.id === resultNodeId)!;
    expect(img.type).toBe('image_generation');
    expect(img.data.imageUrl).toBe('/static/generated/1/a.png');
    expect(img.data.prompt).toBe('p');
    expect(img.data.isGenerating).toBe(false);
    // seedDataFor(image_generation) 的默认字段被合并
    expect(img.data.agentSteps).toEqual([]);

    // 布局：现有节点宽 380 → 新子图左侧起于 380+；且保持内部相对偏移（img.x - book.x === 760）
    const book = nodes.find((n) => n.id !== resultNodeId)!;
    expect(book.x).toBeGreaterThanOrEqual(nextCanvasX(existing));
    expect(img.x - book.x).toBe(760);
    expect(book.y - img.y).toBe(0);
  });

  it('连线两端 id 被重映射且唯一', () => {
    const snap = {
      version: 1 as const,
      resultNodeId: 'r',
      nodes: [
        { id: 'a', type: 'text' as const, x: 0, y: 0, data: {} },
        { id: 'r', type: 'image_generation' as const, x: 380, y: 0, data: {} },
      ],
      edges: [{ source: 'a', target: 'r' }],
    };
    const { nodes, edges } = hydrateGraphSnapshot(snap, [], 120);
    const edge = edges[0];
    expect(nodes.some((n) => n.id === edge.source)).toBe(true);
    expect(nodes.some((n) => n.id === edge.target)).toBe(true);
    expect(edge.source).not.toBe('a');
  });
});