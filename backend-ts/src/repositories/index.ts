import { and, eq } from 'drizzle-orm';
import { now } from '../shared/datetime.js';
import { getDb, type DB } from '../config/database.js';
import {
  appSettings,
  bookCache,
  fastclawAgentConfigs,
  llmConfigs,
  nodeConfigs,
  promptTemplates,
  users,
} from '../db/schema.js';

/**
 * 数据访问层（对应 Python `app/models/*` + 路由内的 db.query 调用）。
 * 查询一律经 drizzle schema 类型化，不写裸 SQL。
 */

export interface UserRow {
  id: number;
  username: string;
  passwordHash: string;
  role: string;
  isActive: boolean | null;
  createdAt: string | null;
}

export function findUserByUsername(db: DB, username: string): UserRow | undefined {
  return db.select().from(users).where(eq(users.username, username)).get();
}

export function findUserById(db: DB, id: number): UserRow | undefined {
  return db.select().from(users).where(eq(users.id, id)).get();
}

/** LLMConfig 行（含明文 api_key，仅供服务端内部使用，绝不回传）。 */
export interface LLMConfigRow {
  id: number;
  name: string;
  kind: string;
  apiKey: string;
  baseUrl: string;
  modelName: string;
  isActive: boolean | null;
}

export function findLLMConfigById(db: DB, id: number): LLMConfigRow | undefined {
  return db.select().from(llmConfigs).where(eq(llmConfigs.id, id)).get();
}

/** 全部启用的 LLM 配置的模型名（节点「模型」候选列表数据源，去重由调用方做）。
 *  kinds 非空时仅返回这些 kind 的配置（如图像生成节点只列 image 类）；空 = 不限。 */
export function listActiveLLMConfigModelNames(db: DB, kinds?: string[]): string[] {
  const rows = db
    .select({ modelName: llmConfigs.modelName, kind: llmConfigs.kind })
    .from(llmConfigs)
    .where(eq(llmConfigs.isActive, true))
    .all();
  return rows
    .filter((r) => !kinds?.length || (r.kind != null && kinds.includes(r.kind)))
    .map((r) => r.modelName)
    .filter((n): n is string => typeof n === 'string' && n.trim() !== '');
}

/** PromptTemplate 行。 */
export interface PromptTemplateRow {
  id: number;
  key: string | null;
  name: string;
  nodeType: string;
  content: string;
  isActive: boolean | null;
}

export function findPromptTemplateById(db: DB, id: number): PromptTemplateRow | undefined {
  return db.select().from(promptTemplates).where(eq(promptTemplates.id, id)).get();
}

/** FastClawAgentConfig 行。 */
export interface FastClawAgentConfigRow {
  id: number;
  name: string;
  baseUrl: string;
  apiKey: string;
  agentId: string;
  agentName: string | null;
  isActive: boolean | null;
}

export function findFastClawAgentConfigById(db: DB, id: number): FastClawAgentConfigRow | undefined {
  return db.select().from(fastclawAgentConfigs).where(eq(fastclawAgentConfigs.id, id)).get();
}

/** 全部启用的 FastClaw Agent 配置（用户级列表，不含 api_key 等敏感字段）。 */
export function listActiveFastClawAgents(db: DB): Array<{
  id: number;
  name: string;
  agentName: string | null;
}> {
  return db
    .select({
      id: fastclawAgentConfigs.id,
      name: fastclawAgentConfigs.name,
      agentName: fastclawAgentConfigs.agentName,
    })
    .from(fastclawAgentConfigs)
    .where(eq(fastclawAgentConfigs.isActive, true))
    .orderBy(fastclawAgentConfigs.id)
    .all();
}

/** NodeConfig 行（节点模板的一个可执行实例）。 */
export interface NodeConfigRow {
  id: number;
  nodeType: string;
  name: string;
  llmConfigId: number | null;
  promptId: number | null;
  agentConfigId: number | null;
  skillAgentConfigId: number | null;
  group: string | null;
  groupOrder: number;
  isActive: boolean | null;
}

export function findNodeConfigById(db: DB, id: number): NodeConfigRow | undefined {
  return db.select().from(nodeConfigs).where(eq(nodeConfigs.id, id)).get();
}

/** 全部启用的节点配置（node-registry 数据源）。 */
export function listActiveNodeConfigs(db: DB): NodeConfigRow[] {
  return db.select().from(nodeConfigs).where(eq(nodeConfigs.isActive, true)).all();
}

/** AppSetting 键值对（系统设置）。 */
export function getAppSettingsMap(db: DB): Record<string, string> {
  const rows = db.select().from(appSettings).all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/**
 * 获取某服务的有效代理 URL：检查 `{service}.use_proxy` 开关 + 全局 `http.proxy`。
 * 开关为 'true' 且全局代理非空时返回代理 URL，否则返回空串（直连）。
 */
export function getServiceProxy(settings: Record<string, string>, service: string): string {
  if (settings[`${service}.use_proxy`] !== 'true') return '';
  return (settings['http.proxy'] ?? '').trim();
}

/** BookCache 行 → 与豆瓣客户端一致的扁平元数据（对应 Python _row_to_book 白名单字段）。 */
export function rowToBook(row: typeof bookCache.$inferSelect): Record<string, unknown> {
  return {
    title: row.title,
    subtitle: row.subtitle,
    original_title: row.originalTitle,
    author: row.author,
    translator: row.translator,
    publisher: row.publisher,
    producer: row.producer,
    pub_year: row.pubYear,
    pages: row.pages,
    price: row.price,
    binding: row.binding,
    series: row.series,
    series_link: row.seriesLink,
    rating: row.rating,
    rating_count: row.ratingCount,
    cover_image: row.coverImage,
    cover_image_local: row.coverImageLocal,
    summary: row.summary,
    author_intro: row.authorIntro,
    catalog: row.catalog,
    url: row.url,
  };
}

/** 把豆瓣元数据写入 BookCache 行（仅覆盖白名单字段，空值兜底）。 */
export function updateBookRow(
  db: DB,
  isbn: string,
  book: Record<string, unknown>
): void {
  const fields: Array<[keyof typeof bookCache.$inferSelect, string]> = [
    ['title', 'title'], ['subtitle', 'subtitle'], ['originalTitle', 'original_title'],
    ['author', 'author'], ['translator', 'translator'], ['publisher', 'publisher'],
    ['producer', 'producer'], ['pubYear', 'pub_year'], ['pages', 'pages'],
    ['price', 'price'], ['binding', 'binding'], ['series', 'series'],
    ['seriesLink', 'series_link'], ['coverImage', 'cover_image'],
    ['coverImageLocal', 'cover_image_local'], ['summary', 'summary'],
    ['authorIntro', 'author_intro'], ['catalog', 'catalog'], ['url', 'url'],
  ];
  const set: Record<string, unknown> = {};
  for (const [col, key] of fields) {
    let val = book[key];
    if (val == null || val === '') {
      val = key === 'rating' ? 0 : key === 'rating_count' ? 0 : '';
    }
    set[col as string] = val;
  }
  db.update(bookCache).set({ ...(set as Record<string, unknown>), updatedAt: now() } as never).where(eq(bookCache.isbn, isbn)).run();
}

/** 按 ISBN 查 BookCache 行。 */
export function findBookByIsbn(db: DB, isbn: string): (typeof bookCache.$inferSelect) | undefined {
  return db.select().from(bookCache).where(eq(bookCache.isbn, isbn)).get();
}

/** 新建 BookCache 行（返回行；并发重复写入由 isbn 唯一约束 + 调用方兜底）。 */
export function insertBookByIsbn(db: DB, isbn: string): (typeof bookCache.$inferSelect) {
  return db.insert(bookCache).values({ isbn, createdAt: now() }).returning().get();
}

/** 生成列表查询的公共过滤（Phase 4 使用）。 */
export const db = { and, eq };
