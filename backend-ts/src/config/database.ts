import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';
import * as schema from '../db/schema.js';

/**
 * 数据层（对应 Python `app/core/database.py`）。
 *
 * - 开发：SQLite（better-sqlite3），默认指向 `backend/bookforge.db`（存量库，直接复用）；
 * - 生产：PostgreSQL（pg 驱动，Phase 4 接入，DATABASE_URL 以 postgres:// 开头）。
 *
 * 表结构：`src/db/schema.ts` 由 `drizzle-kit pull` 从存量库反推（13 张表逐列一致），
 * 启动时若表缺失则执行初始迁移（幂等，对应 Python 的 alembic upgrade head）。
 */

export type DB = BetterSQLite3Database<typeof schema>;

function sqliteUrlToPath(url: string): string {
  // sqlite:///./bookforge.db → ./bookforge.db（Windows 盘符路径原样保留）
  const bare = url.replace(/^sqlite:\/\/\//, '');
  return path.resolve(bare);
}

/** 创建 drizzle 实例（指定 sqlite 文件或 ':memory:'），并确保表结构。 */
export function initDb(filePath: string): DB {
  const resolved = filePath === ':memory:' ? filePath : sqliteUrlToPath(filePath);
  if (resolved !== ':memory:') {
    mkdirSync(path.dirname(resolved), { recursive: true });
  }
  const sqlite = new Database(resolved);
  // 与 Python SQLAlchemy 的 check_same_thread=False 对应（better-sqlite3 默认即多线程安全）
  const db = drizzle(sqlite, { schema });
  applyInitialSchema(db);
  return db;
}

/** 幂等建表：执行初始迁移 DDL（表与索引均带 IF NOT EXISTS），并为存量库补列。 */
export function applyInitialSchema(db: DB): void {
  const sqlite = (db as unknown as { $client?: Database.Database }).$client;
  for (const ddl of INITIAL_DDL) sqlite?.exec(ddl);
  ensureColumn(sqlite, 'skill_agent_configs', 'image_llm_config_id', 'INTEGER');
  ensureColumn(sqlite, 'llm_configs', 'api_format', 'VARCHAR');
  ensureColumn(sqlite, 'llm_configs', 'thinking_format', 'VARCHAR');
  ensureColumn(sqlite, 'llm_configs', 'context_window', 'INTEGER');
  ensureColumn(sqlite, 'llm_configs', 'max_tokens', 'INTEGER');
}

/** 存量库补列：PRAGMA 检查缺失时 ALTER TABLE ADD COLUMN（SQLite 无 ADD COLUMN IF NOT EXISTS）。 */
function ensureColumn(
  sqlite: Database.Database | undefined | null,
  table: string,
  column: string,
  decl: string
): void {
  if (!sqlite) return;
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

let _db: DB | null = null;

/** 获取（单例）drizzle 实例。 */
export function getDb(): DB {
  if (!_db) {
    _db = initDb(env.databaseUrl);
  }
  return _db;
}

/** 测试用：注入自定义 db（如 :memory: 实例）。 */
export function setDb(db: DB | null): void {
  _db = db;
}

/** 幂等建表：users 表不存在时执行初始迁移 DDL（对应 alembic upgrade head）。 */
function ensureSchema(db: DB): void {
  const sqlite = (db as unknown as { $client?: Database.Database }).$client;
  const hasUsers =
    sqlite?.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get() != null;
  if (hasUsers) return;
  // 初始迁移 SQL（与 drizzle-kit pull 生成一致；测试库与全新部署共用）
  for (const ddl of INITIAL_DDL) sqlite?.exec(ddl);
}

/** 初始 DDL（由 drizzle-kit pull 生成的 0000_misty_doctor_faustus.sql 提炼）。 */
const INITIAL_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username VARCHAR NOT NULL,
    password_hash VARCHAR NOT NULL,
    role VARCHAR NOT NULL,
    is_active BOOLEAN,
    created_at DATETIME,
    updated_at DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS llm_configs (
    id INTEGER PRIMARY KEY,
    name VARCHAR NOT NULL,
    kind VARCHAR NOT NULL,
    api_key VARCHAR NOT NULL,
    base_url VARCHAR NOT NULL,
    model_name VARCHAR NOT NULL,
    api_format VARCHAR,
    thinking_format VARCHAR,
    context_window INTEGER,
    max_tokens INTEGER,
    is_active BOOLEAN,
    created_at DATETIME,
    updated_at DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS prompt_templates (
    id INTEGER PRIMARY KEY,
    key VARCHAR,
    name VARCHAR NOT NULL,
    node_type VARCHAR NOT NULL,
    content TEXT NOT NULL,
    is_active BOOLEAN,
    created_at DATETIME,
    updated_at DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS fastclaw_agent_configs (
    id INTEGER PRIMARY KEY,
    name VARCHAR NOT NULL,
    base_url VARCHAR NOT NULL,
    api_key VARCHAR NOT NULL,
    agent_id VARCHAR NOT NULL,
    agent_name VARCHAR,
    is_active BOOLEAN,
    created_at DATETIME,
    updated_at DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS skill_agent_configs (
    id INTEGER PRIMARY KEY,
    name VARCHAR NOT NULL,
    base_url VARCHAR NOT NULL,
    api_key VARCHAR NOT NULL,
    model_name VARCHAR NOT NULL,
    system_prompt VARCHAR NOT NULL,
    llm_config_id INTEGER,
    prompt_id INTEGER,
    image_llm_config_id INTEGER,
    is_active BOOLEAN,
    created_at DATETIME,
    updated_at DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS node_configs (
    id INTEGER PRIMARY KEY,
    node_type VARCHAR NOT NULL,
    name VARCHAR NOT NULL,
    llm_config_id INTEGER,
    prompt_id INTEGER,
    agent_config_id INTEGER,
    skill_agent_config_id INTEGER,
    "group" VARCHAR,
    group_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN,
    created_at DATETIME,
    updated_at DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY,
    key VARCHAR NOT NULL,
    value VARCHAR NOT NULL,
    description VARCHAR NOT NULL,
    updated_at DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS book_cache (
    id INTEGER PRIMARY KEY,
    isbn VARCHAR NOT NULL,
    title VARCHAR NOT NULL DEFAULT '',
    subtitle VARCHAR NOT NULL DEFAULT '',
    original_title VARCHAR NOT NULL DEFAULT '',
    author VARCHAR NOT NULL DEFAULT '',
    translator VARCHAR NOT NULL DEFAULT '',
    publisher VARCHAR NOT NULL DEFAULT '',
    producer VARCHAR NOT NULL DEFAULT '',
    pub_year VARCHAR NOT NULL DEFAULT '',
    pages VARCHAR NOT NULL DEFAULT '',
    price VARCHAR NOT NULL DEFAULT '',
    binding VARCHAR NOT NULL DEFAULT '',
    series VARCHAR NOT NULL DEFAULT '',
    series_link VARCHAR NOT NULL DEFAULT '',
    rating FLOAT NOT NULL DEFAULT 0,
    rating_count INTEGER NOT NULL DEFAULT 0,
    cover_image VARCHAR NOT NULL DEFAULT '',
    cover_image_local VARCHAR NOT NULL DEFAULT '',
    summary VARCHAR NOT NULL DEFAULT '',
    author_intro VARCHAR NOT NULL DEFAULT '',
    catalog VARCHAR NOT NULL DEFAULT '',
    url VARCHAR NOT NULL DEFAULT '',
    created_at DATETIME,
    updated_at DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS generations (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    node_type VARCHAR NOT NULL,
    name VARCHAR NOT NULL,
    stage_results JSON,
    result_url VARCHAR,
    status VARCHAR,
    created_at DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    generation_id INTEGER NOT NULL,
    created_at DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS public_shares (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    generation_id INTEGER NOT NULL,
    created_at DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS prompt_metadata (
    prompt_id VARCHAR(64) PRIMARY KEY,
    preview_image VARCHAR(512) NOT NULL DEFAULT '',
    created_at DATETIME,
    updated_at DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS user_annotations (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    resource_type VARCHAR(32) NOT NULL,
    resource_id VARCHAR(128) NOT NULL,
    rating INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    created_at DATETIME,
    updated_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ix_user_annotations_unique ON user_annotations (user_id, resource_type, resource_id)`,
  `CREATE INDEX IF NOT EXISTS ix_user_annotations_user_type ON user_annotations (user_id, resource_type)`,
];
