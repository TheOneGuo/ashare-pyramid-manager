/**
 * Turso / libSQL 数据库适配层（v2）
 *
 * 表结构（统一）：
 * - news_items：通用新闻（含电报RSS、东财公告、东财个股新闻），用 source_channel 区分
 * - research_items：研报
 * - portfolio_snapshots：持仓快照
 * - portfolio_holdings：当前持仓（轻量表，用于触发持仓标的的新闻采集）
 * - news_sources：源健康状态
 *
 * 调用方不用关心底层，统一定义了上面 5 张表。
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
  client = createClient({ url: 'file:./dev.sqlite' });
  mode = 'sqlite-local';
}

console.log(`[db] mode=${mode} url=${url || 'file:./dev.sqlite'}`);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS news_items (
  id              TEXT PRIMARY KEY,
  source_channel  TEXT NOT NULL,
  source_name     TEXT NOT NULL DEFAULT '',
  title           TEXT NOT NULL,
  summary         TEXT NOT NULL DEFAULT '',
  link            TEXT NOT NULL DEFAULT '',
  published_at    INTEGER NOT NULL,
  fetched_at      INTEGER NOT NULL,
  raw_json        TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_news_pub ON news_items(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_src ON news_items(source_channel);
CREATE INDEX IF NOT EXISTS idx_news_src_pub ON news_items(source_channel, published_at DESC);

CREATE TABLE IF NOT EXISTS news_sources (
  source_channel  TEXT PRIMARY KEY,
  source_name     TEXT NOT NULL DEFAULT '',
  feed_url        TEXT NOT NULL DEFAULT '',
  last_fetch_at   INTEGER NOT NULL DEFAULT 0,
  last_success_at INTEGER NOT NULL DEFAULT 0,
  last_count      INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT NOT NULL DEFAULT '',
  updated_at      INTEGER NOT NULL DEFAULT 0
);

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

CREATE INDEX IF NOT EXISTS idx_snapshot_user_time ON portfolio_snapshots(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS portfolio_holdings (
  stock_code   TEXT NOT NULL,
  short_name   TEXT NOT NULL DEFAULT '',
  market       TEXT NOT NULL DEFAULT '',
  shares       INTEGER NOT NULL DEFAULT 0,
  cost_basis   REAL,
  added_at     INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (stock_code)
);

CREATE TABLE IF NOT EXISTS portfolio_recommendations (
  role         TEXT NOT NULL,    -- institution / hot_money / northbound / retail
  stock_code   TEXT NOT NULL,
  stock_name   TEXT NOT NULL DEFAULT '',
  weight       REAL NOT NULL DEFAULT 0,
  note         TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (role, stock_code)
);

CREATE INDEX IF NOT EXISTS idx_rec_role ON portfolio_recommendations(role, weight DESC);

-- 账户与保证金账本：事件流（init/deposit/withdraw/close_position/fee_rate_change）
CREATE TABLE IF NOT EXISTS portfolio_ledger_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  type      TEXT NOT NULL,
  payload   TEXT NOT NULL DEFAULT '{}',   -- 金额/代码/数量/费率等明细
  ts        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_ts ON portfolio_ledger_events(ts DESC);

-- 持仓方案跟踪：分析后生成的固定项（每标的一份）
CREATE TABLE IF NOT EXISTS portfolio_plans (
  stock_code   TEXT NOT NULL,
  stock_name   TEXT NOT NULL DEFAULT '',
  p0           REAL NOT NULL,
  atr          REAL NOT NULL,
  atr_pct      REAL,
  total_invest REAL,
  plan_json    TEXT NOT NULL DEFAULT '{}',  -- rows + tp_rows + 派生步骤
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (stock_code)
);
`;

let initialized = false;

export async function initDb() {
  if (initialized) return;
  const stmts = SCHEMA.split(';').map((s) => s.trim()).filter(Boolean);
  for (const sql of stmts) {
    try {
      await client.execute(sql);
    } catch (e) {
      if (!/already exists|duplicate/i.test(String(e.message))) {
        console.warn(`[db] init stmt skipped: ${sql.slice(0, 40)}... (${e.message?.slice(0, 60)})`);
      }
    }
  }
  initialized = true;
  console.log('[db] schema initialized (5 tables)');
}

export function getClient() { return client; }
export function getMode() { return mode; }

// =====================================================
// News
// =====================================================

/**
 * 批量 upsert news items（按 source_channel + guid）
 * @param {{ source_channel, source_name, feed_url, items, now_ts, last_error }} args
 */
export async function upsertNewsItems({ source_channel, source_name, feed_url, items, now_ts, last_error = '' }) {
  if (!items?.length) {
    // 仍然更新源状态
    await upsertSourceState({ source_channel, source_name, feed_url, last_fetch_at: now_ts, last_success_at: 0, last_count: 0, last_error });
    return 0;
  }
  let ok = 0;
  for (const it of items) {
    try {
      const id = String(it.guid || `${source_channel}|${it.link || ''}|${it.title}`);
      if (!it.title) continue;
      await client.execute({
        sql: `INSERT INTO news_items(id,source_channel,source_name,title,summary,link,published_at,fetched_at,raw_json)
              VALUES(?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                title=excluded.title, summary=excluded.summary,
                link=excluded.link, published_at=excluded.published_at,
                fetched_at=excluded.fetched_at, raw_json=excluded.raw_json`,
        args: [
          id,
          String(source_channel || '').slice(0, 80),
          String(source_name || '').slice(0, 80),
          String(it.title || '').slice(0, 500),
          String(it.summary || '').slice(0, 1000),
          String(it.link || '').slice(0, 500),
          Number(it.published_at) || Number(now_ts),
          Number(now_ts) || Date.now(),
          JSON.stringify(it.raw || {}).slice(0, 8000),
        ],
      });
      ok++;
    } catch (e) {
      console.warn(`[db] upsertNewsItems skip: ${e.message?.slice(0, 80)}`);
    }
  }
  // 更新源状态
  await upsertSourceState({
    source_channel, source_name, feed_url,
    last_fetch_at: now_ts,
    last_success_at: ok > 0 ? now_ts : 0,
    last_count: ok,
    last_error: ok === 0 ? last_error : '',
  });
  return ok;
}

async function upsertSourceState({ source_channel, source_name, feed_url, last_fetch_at, last_success_at, last_count, last_error }) {
  try {
    await client.execute({
      sql: `INSERT INTO news_sources(source_channel,source_name,feed_url,last_fetch_at,last_success_at,last_count,last_error,updated_at)
            VALUES(?,?,?,?,?,?,?,?)
            ON CONFLICT(source_channel) DO UPDATE SET
              source_name=excluded.source_name,
              feed_url=excluded.feed_url,
              last_fetch_at=excluded.last_fetch_at,
              last_success_at=excluded.last_success_at,
              last_count=excluded.last_count,
              last_error=excluded.last_error,
              updated_at=excluded.updated_at`,
      args: [
        String(source_channel).slice(0, 80),
        String(source_name || '').slice(0, 80),
        String(feed_url || '').slice(0, 500),
        Number(last_fetch_at) || 0,
        Number(last_success_at) || 0,
        Number(last_count) || 0,
        String(last_error || '').slice(0, 600),
        Date.now(),
      ],
    });
  } catch (e) {
    console.warn(`[db] upsertSourceState: ${e.message?.slice(0, 80)}`);
  }
}

export async function recordSourceError({ source_channel, source_name, feed_url, last_error, now_ts }) {
  await upsertSourceState({
    source_channel, source_name, feed_url,
    last_fetch_at: now_ts,
    last_success_at: 0,
    last_count: 0,
    last_error,
  });
}

/** 读取最新 N 条新闻（可按 source_channel 过滤） */
export async function fetchNews({ limit = 30, since = 0, source_channel = null, holding_codes = null } = {}) {
  let sql = `SELECT id,source_channel,source_name,title,summary,link,published_at,fetched_at,raw_json
             FROM news_items WHERE published_at >= ?`;
  const args = [since];

  if (source_channel) {
    sql += ` AND source_channel = ?`;
    args.push(source_channel);
  } else if (Array.isArray(holding_codes) && holding_codes.length > 0) {
    const tgChannels = ['FinanceNewsDaily', 'jin10data', 'cnwallstreet'];
    const all = [
      ...tgChannels,
      ...holding_codes.map((c) => `eastmoney_stock_news_${c}`),
      ...holding_codes.map((c) => `eastmoney_announcement_${c}`),
    ];
    sql += ` AND source_channel IN (${all.map(() => '?').join(',')})`;
    args.push(...all);
  }

  sql += ` ORDER BY published_at DESC LIMIT ?`;
  args.push(Math.min(200, Math.max(1, limit)));

  const r = await client.execute({ sql, args });
  return r.rows.map((row) => ({
    id: row.id,
    source_channel: row.source_channel,
    source_name: row.source_name,
    title: row.title,
    summary: row.summary,
    link: row.link,
    published_at: Number(row.published_at),
    fetched_at: Number(row.fetched_at),
    raw: row.raw_json ? safeJson(row.raw_json) : {},
  }));
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

export async function fetchNewsSources() {
  const r = await client.execute(`SELECT source_channel,source_name,feed_url,last_fetch_at,last_success_at,last_count,last_error,updated_at FROM news_sources ORDER BY source_channel`);
  return r.rows.map((row) => ({
    source_channel: row.source_channel,
    source_name: row.source_name,
    feed_url: row.feed_url,
    last_fetch_at: Number(row.last_fetch_at),
    last_success_at: Number(row.last_success_at),
    last_count: Number(row.last_count),
    last_error: row.last_error,
    is_error: !!row.last_error,
    updated_at: Number(row.updated_at),
  }));
}

/** 清理超过 cutoff_ms 的新闻 */
export async function cleanupOldNews(cutoff_ms) {
  try {
    const r = await client.execute({
      sql: `DELETE FROM news_items WHERE published_at < ?`,
      args: [cutoff_ms],
    });
    return r.rowsAffected || 0;
  } catch (e) {
    console.warn(`[db] cleanupOldNews: ${e.message?.slice(0, 80)}`);
    return 0;
  }
}

// =====================================================
// Portfolio Holdings
// =====================================================

export async function upsertHolding({ stock_code, short_name, market, shares, cost_basis }) {
  await client.execute({
    sql: `INSERT INTO portfolio_holdings(stock_code,short_name,market,shares,cost_basis,added_at,updated_at)
          VALUES(?,?,?,?,?,?,?)
          ON CONFLICT(stock_code) DO UPDATE SET
            short_name=excluded.short_name,
            market=excluded.market,
            shares=excluded.shares,
            cost_basis=excluded.cost_basis,
            updated_at=excluded.updated_at`,
    args: [
      String(stock_code).padStart(6, '0'),
      String(short_name || '').slice(0, 40),
      String(market || '').slice(0, 10),
      Number(shares) || 0,
      Number(cost_basis) || 0,
      Date.now(),
      Date.now(),
    ],
  });
}

export async function removeHolding(stock_code) {
  await client.execute({
    sql: `DELETE FROM portfolio_holdings WHERE stock_code=?`,
    args: [String(stock_code).padStart(6, '0')],
  });
}

export async function listHoldings() {
  const r = await client.execute(`SELECT stock_code,short_name,market,shares,cost_basis,added_at,updated_at FROM portfolio_holdings ORDER BY stock_code`);
  return r.rows.map((row) => ({
    stock_code: row.stock_code,
    short_name: row.short_name,
    market: row.market,
    shares: Number(row.shares),
    cost_basis: Number(row.cost_basis),
    added_at: Number(row.added_at),
    updated_at: Number(row.updated_at),
  }));
}

// =====================================================
// Portfolio Recommendations (4 role：机构/游资/北向/散户)
// 数据由用户手动录入（原项目 FactorEngine + 资金流向算法未搬）
// =====================================================

export const ROLE_LABELS = {
  institution: '机构',
  hot_money: '游资',
  northbound: '北向资金',
  retail: '散户',
};

export async function listRecommendations(role = null) {
  let sql = `SELECT role,stock_code,stock_name,weight,note,created_at,updated_at
             FROM portfolio_recommendations`;
  const args = [];
  if (role) {
    sql += ` WHERE role = ?`;
    args.push(role);
  }
  sql += ` ORDER BY role, weight DESC, stock_code`;
  const r = await client.execute({ sql, args });
  return r.rows.map((row) => ({
    role: row.role,
    stock_code: row.stock_code,
    stock_name: row.stock_name,
    weight: Number(row.weight),
    note: row.note || '',
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  }));
}

export async function upsertRecommendation({ role, stock_code, stock_name, weight, note }) {
  await client.execute({
    sql: `INSERT INTO portfolio_recommendations(role,stock_code,stock_name,weight,note,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?)
          ON CONFLICT(role,stock_code) DO UPDATE SET
            stock_name=excluded.stock_name,
            weight=excluded.weight,
            note=excluded.note,
            updated_at=excluded.updated_at`,
    args: [
      String(role).slice(0, 32),
      String(stock_code).padStart(6, '0'),
      String(stock_name || '').slice(0, 40),
      Number(weight) || 0,
      String(note || '').slice(0, 200),
      Date.now(),
      Date.now(),
    ],
  });
}

export async function removeRecommendation({ role, stock_code }) {
  await client.execute({
    sql: `DELETE FROM portfolio_recommendations WHERE role=? AND stock_code=?`,
    args: [String(role), String(stock_code).padStart(6, '0')],
  });
}

export async function bulkSetRecommendations(role, items) {
  // 一次性替换某 role 的全部推荐
  const now = Date.now();
  await client.execute({ sql: `DELETE FROM portfolio_recommendations WHERE role=?`, args: [String(role)] });
  for (const it of items || []) {
    await client.execute({
      sql: `INSERT INTO portfolio_recommendations(role,stock_code,stock_name,weight,note,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?)`,
      args: [
        String(role).slice(0, 32),
        String(it.stock_code || '').padStart(6, '0'),
        String(it.stock_name || '').slice(0, 40),
        Number(it.weight) || 0,
        String(it.note || '').slice(0, 200),
        now,
        now,
      ],
    });
  }
}

// 现持仓 vs 某 role 推荐：add/reduce 建议
export async function compareWithRole(role) {
  const holdings = await listHoldings();
  const recs = await listRecommendations(role);
  const userCodes = new Set(holdings.map((h) => h.stock_code));
  const recCodes = new Set(recs.map((r) => r.stock_code));
  const overlap = [...userCodes].filter((c) => recCodes.has(c));
  const onlyInUser = holdings.filter((h) => !recCodes.has(h.stock_code));
  const onlyInRec = recs.filter((r) => !userCodes.has(r.stock_code));
  const suggestions = [];
  // add：role 有 user 没
  for (const r of onlyInRec) {
    suggestions.push({
      action: 'add',
      stock_code: r.stock_code,
      stock_name: r.stock_name,
      role,
      role_label: ROLE_LABELS[role] || role,
      reason: `${ROLE_LABELS[role] || role}推荐，权重 ${(r.weight * 100).toFixed(1)}%`,
      weight: r.weight,
    });
  }
  // reduce：user 有 role 没 — 用 cost_basis vs 100 简单判断
  for (const h of onlyInUser) {
    suggestions.push({
      action: 'reduce',
      stock_code: h.stock_code,
      stock_name: h.short_name,
      role,
      role_label: ROLE_LABELS[role] || role,
      reason: `${ROLE_LABELS[role] || role}未持有（成本 ${h.cost_basis.toFixed(2)}）`,
    });
  }
  return {
    ok: true,
    role,
    role_label: ROLE_LABELS[role] || role,
    user_holdings: holdings,
    recommendations: recs,
    overlap,
    only_in_user: onlyInUser,
    only_in_rec: onlyInRec,
    suggestions,
  };
}

// =====================================================
// 账户与保证金账本（事件流持久化）
// 只存事件，状态全部由 account-ledger.buildAccount 回放推导。
// =====================================================

export async function appendLedgerEvent(type, payload = {}) {
  const now = Date.now();
  const r = await client.execute({
    sql: `INSERT INTO portfolio_ledger_events(type, payload, ts) VALUES(?,?,?)`,
    args: [String(type).slice(0, 32), JSON.stringify(payload || {}).slice(0, 4000), now],
  });
  return Number(r.lastInsertRowid) || 0;
}

export async function listLedgerEvents() {
  const r = await client.execute(`SELECT id,type,payload,ts FROM portfolio_ledger_events ORDER BY ts ASC, id ASC`);
  return r.rows.map((row) => ({
    id: Number(row.id),
    type: row.type,
    payload: safeJson(row.payload),
    ts: Number(row.ts),
  }));
}

export async function clearLedger() {
  await client.execute(`DELETE FROM portfolio_ledger_events`);
}

// =====================================================
// 持仓方案跟踪（固定项持久化，供前端恢复跟踪列表）
// =====================================================

export async function upsertPlan({ stock_code, stock_name, p0, atr, atr_pct, total_invest, plan_json }) {
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO portfolio_plans(stock_code,stock_name,p0,atr,atr_pct,total_invest,plan_json,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?)
          ON CONFLICT(stock_code) DO UPDATE SET
            stock_name=excluded.stock_name,
            p0=excluded.p0,
            atr=excluded.atr,
            atr_pct=excluded.atr_pct,
            total_invest=excluded.total_invest,
            plan_json=excluded.plan_json,
            updated_at=excluded.updated_at`,
    args: [
      String(stock_code).padStart(6, '0'),
      String(stock_name || '').slice(0, 40),
      Number(p0) || 0,
      Number(atr) || 0,
      Number(atr_pct) || 0,
      Number(total_invest) || 0,
      JSON.stringify(plan_json || {}).slice(0, 12000),
      now,
      now,
    ],
  });
}

export async function listPlans() {
  const r = await client.execute(`SELECT stock_code,stock_name,p0,atr,atr_pct,total_invest,plan_json,created_at,updated_at FROM portfolio_plans ORDER BY updated_at DESC`);
  return r.rows.map((row) => ({
    stock_code: row.stock_code,
    stock_name: row.stock_name,
    p0: Number(row.p0),
    atr: Number(row.atr),
    atr_pct: Number(row.atr_pct),
    total_invest: Number(row.total_invest),
    plan_json: safeJson(row.plan_json),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  }));
}

export async function removePlan(stock_code) {
  await client.execute({
    sql: `DELETE FROM portfolio_plans WHERE stock_code=?`,
    args: [String(stock_code).padStart(6, '0')],
  });
}

export { client as db };
