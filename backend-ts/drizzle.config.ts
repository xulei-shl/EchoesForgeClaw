import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit 配置：SQLite（开发）。
 * `drizzle-kit pull` 从存量 backend/bookforge.db 反向生成 schema（对齐 Python 表结构）；
 * 生产 PostgreSQL 时另建 pg 配置（drizzle-kit push / migrate 独立管理）。
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '../backend/bookforge.db',
  },
});
