/**
 * 时间序列化工具。
 *
 * SQLite 中 SQLAlchemy DATETIME 以 `YYYY-MM-DD HH:MM:SS` 文本存储，drizzle numeric
 * 原样返回该字符串；Python 侧 pydantic 序列化为 ISO-8601（`YYYY-MM-DDTHH:MM:SS`）。
 * 本模块统一把 DB 值规整为 ISO 格式，保证 TS 后端与 Python 响应逐字节一致。
 */

/** 当前上海时间，SQLAlchemy DATETIME 文本格式（`YYYY-MM-DD HH:MM:SS.ffffff`）。
 *
 * 对应 Python `app/core/timeutils.get_current_time`（Asia/Shanghai，无夏令时，固定 UTC+8）。
 * drizzle pull 的 schema 不含 SQLAlchemy 应用侧默认值，插入/更新时必须显式写入。
 */
export function now(): string {
  const d = new Date(Date.now() + 8 * 3600_000);
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
  const ms = String(d.getUTCMilliseconds()).padStart(6, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${ms}`
  );
}

/** `YYYY-MM-DD HH:MM:SS(.ffffff)` → `YYYY-MM-DDTHH:MM:SS(.ffffff)`；非该形态原样返回。 */
export function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  // 已含 T（pydantic 或上游 ISO 格式）→ 原样
  if (value.includes('T')) return value;
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(value);
  if (m) return `${m[1]}T${m[2]}`;
  return value;
}

/** 解析 stage_results 等 JSON 文本列；非法/空返回 {}。 */
export function parseJsonColumn<T = Record<string, unknown>>(raw: string | null): T {
  if (!raw) return {} as T;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

/** 序列化对象为 JSON 文本列（null 写 null）。 */
export function stringifyJsonColumn(value: unknown): string | null {
  if (value == null) return null;
  return JSON.stringify(value);
}
