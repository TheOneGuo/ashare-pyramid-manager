/**
 * Turso / libSQL 数据库适配层
 *
 * - 有 TURSO_DATABASE_URL 时走远程 libSQL（生产）
 * - 没有时降级到本地 better-sqlite3 / 文件 SQLite（开发）
 *
 * 调用方不用关心底层，统一定义了 news_items / research_items 表。
 */
import { createClient } from '@libsql/client';
import 'dotenv/config';

const url = process.env.TURSO_DATABASE_URL?.trim();
const token = process.env.TURSO_AUTH_TOKEN?.trim();

let client = null;
let mode = 'uninitialized';

if (url) {
  client = createClient({ url, authToken: token || undefined });
  mode = token ? 'turso-remote' : 'turso-local-file';
} else {
  // 开发期：本地文件
  client = createClient({ url: 'file:./dev.sqlite' });
  mode = 'sqlite-local';
}

console.log(`[db] mode=${mode} url=${url || 'file:./dev.sqlite'}`);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS news_items (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  summary     TEXT,
  source      TEXT NOT NULL,
  url         TEXT,
  published_at INTEGER NOT NULL,
  fetched_at  INTEGER NOT NULL,
  tags        TEXT
);

CREATE INDEX IF NOT EXISTS idx_news_pub ON news_items(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_src ON news_items(source);

CREATE TABLE IF NOT EXISTS research_items (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  broker       TEXT,
  industry     TEXT,
  summary      TEXT,
  key_points   TEXT,
  risk_points  TEXT,
  ai_tldr      TEXT,
  published_at INTEGER,
  fetched_at   INTEGER NOT NULL,
  status       TEXT DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_research_pub ON research_items(published_at DESC);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  positions   TEXT NOT NULL,
  total_cost  REAL,
  market_value REAL,
  net_value   REAL,
  pnl         REAL,
  plan_json   TEXT,
  created_at  INTEGER NOT NULL
);
`;

let initialized = false;

export async function initDb() {
  if (initialized) return;
  // libSQL 支持一次执行多语句
  const stmts = SCHEMA.split(';').map((s) => s.trim()).filter(Boolean);
  for (const sql of stmts) {
    await client.execute(sql);
  }
  initialized = true;
  console.log('[db] schema initialized');
}

export function getClient() {
  return client;
}

export function getMode() {
  return mode;
}

/** 写入新闻（upsert by id） */
export async function upsertNews(items) {
  if (!items?.length) return 0;
  for (const it of items) {
    await client.execute({
      sql: `INSERT INTO news_items (id,title,summary,source,url,published_at,fetched_at,tags)
            VALUES (?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              title=excluded.title, summary=excluded.summary,
              source=excluded.source, url=excluded.url,
              published_at=excluded.published_at, fetched_at=excluded.fetched_at,
              tags=excluded.tags`,
      args: [
        it.id, it.title, it.summary ?? null, it.source,
        it.url ?? null, it.published_at, it.fetched_at,
        it.tags ? JSON.stringify(it.tags) : null,
      ],
    });
  }
  return items.length;
}

/** 读取最新 N 条新闻 */
export async function fetchNews({ limit = 30, since = 0 } = {}) {
  const r = await client.execute({
    sql: `SELECT id,title,summary,source,url,published_at,fetched_at,tags
          FROM news_items
          WHERE published_at >= ?
          ORDER BY published_at DESC
          LIMIT ?`,
    args: [since, limit],
  });
  return r.rows.map((row) => ({
    ...row,
    tags: row.tags ? JSON.parse(row.tags) : [],
  }));
}

export { client as db };