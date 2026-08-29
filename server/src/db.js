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
import { matchHoldingProfile } from './holding-profiles.js';
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
  content         TEXT NOT NULL DEFAULT '',
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
  stock_code      TEXT NOT NULL,
  short_name      TEXT NOT NULL DEFAULT '',
  market          TEXT NOT NULL DEFAULT '',
  shares          INTEGER NOT NULL DEFAULT 0,
  cost_basis      REAL,
  current_price   REAL,
  pnl             REAL,
  pnl_pct         REAL,
  added_at        INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
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
  last_price   REAL,
  last_price_at INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (stock_code)
);

-- 研报 AI 精读：外部整篇研报入库（外资/内资券商/行业研究等）
CREATE TABLE IF NOT EXISTS research_reports (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL DEFAULT '',
  broker       TEXT NOT NULL DEFAULT '',   -- 来源机构/券商
  industry     TEXT NOT NULL DEFAULT '',   -- 行业/主题（可选）
  source_url   TEXT NOT NULL DEFAULT '',   -- 原文链接（可选）
  raw_text     TEXT NOT NULL DEFAULT '',   -- 用户粘贴/上传的整篇研报原文
  tldr         TEXT NOT NULL DEFAULT '',   -- AI 一句话精读
  key_points   TEXT NOT NULL DEFAULT '[]', -- JSON 数组：核心观点提炼
  opportunities TEXT NOT NULL DEFAULT '[]',-- JSON 数组：发现的新机会
  risks        TEXT NOT NULL DEFAULT '[]', -- JSON 数组：风险点
  status       TEXT NOT NULL DEFAULT 'refined', -- pending / refined
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_created ON research_reports(created_at DESC);

-- fxbaogao 全量研报索引（按时间段分片同步入库，report_id 唯一）
CREATE TABLE IF NOT EXISTS fxbaogao_reports (
  report_id   INTEGER PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  org_name    TEXT NOT NULL DEFAULT '',   -- 机构/券商
  page_num    INTEGER NOT NULL DEFAULT 0,
  pub_time    INTEGER NOT NULL DEFAULT 0,  -- 秒时间戳（排序/筛选用）
  pub_date    TEXT NOT NULL DEFAULT '',    -- 展示用日期字符串
  recommended INTEGER NOT NULL DEFAULT 0,  -- 1=先进生产力相关推荐
  categories  TEXT NOT NULL DEFAULT '[]',  -- JSON 数组
  source_range TEXT NOT NULL DEFAULT '',   -- 同步来源时间范围标记
  pdf_url     TEXT NOT NULL DEFAULT '',    -- PDF 直链缓存（详情页秒开用）
  ai_status   INTEGER NOT NULL DEFAULT 0,  -- 0=未精读 1=精读中 2=已精读
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fxbaogao_pub_time ON fxbaogao_reports(pub_time DESC);
CREATE INDEX IF NOT EXISTS idx_fxbaogao_ai ON fxbaogao_reports(ai_status);

-- fxbaogao 研报 AI 精读结果（与原始研报分开存储，report_id 关联）
CREATE TABLE IF NOT EXISTS fxbaogao_ai (
  report_id   INTEGER PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  broker      TEXT NOT NULL DEFAULT '',
  source_url  TEXT NOT NULL DEFAULT '',
  raw_text    TEXT NOT NULL DEFAULT '',     -- PDF 提取的原文
  tldr        TEXT NOT NULL DEFAULT '',
  key_points  TEXT NOT NULL DEFAULT '[]',
  opportunities TEXT NOT NULL DEFAULT '[]',
  risks       TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'refined-llm',  -- refined-llm / refined-mock
  model       TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fxbaogao_ai_created ON fxbaogao_ai(updated_at DESC);

-- 已持仓标的 AI 研报分析：按十二研究模块生成的逐标的研报
CREATE TABLE IF NOT EXISTS research_stock_reports (
  stock_code   TEXT NOT NULL,
  stock_name   TEXT NOT NULL DEFAULT '',
  report_json  TEXT NOT NULL DEFAULT '{}',  -- ResearchReport 结构（12 模块）
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (stock_code)
);

CREATE INDEX IF NOT EXISTS idx_stock_report_updated ON research_stock_reports(updated_at DESC);

-- 持仓产业链画像（可编辑）：用户维护关键词，用于宏观/地缘/商品/政策新闻的间接关联匹配
CREATE TABLE IF NOT EXISTS holding_profiles (
  stock_code     TEXT NOT NULL,
  raw_materials  TEXT NOT NULL DEFAULT '[]',  -- JSON 数组：上游原材料
  products       TEXT NOT NULL DEFAULT '[]',  -- JSON 数组：主营产品
  customers      TEXT NOT NULL DEFAULT '[]',  -- JSON 数组：主要客户
  overseas_peers TEXT NOT NULL DEFAULT '[]',  -- JSON 数组：海外可比公司
  policy_domains TEXT NOT NULL DEFAULT '[]',  -- JSON 数组：政策域
  transport      TEXT NOT NULL DEFAULT '[]',  -- JSON 数组：运输/航道/产地
  extra_keywords TEXT NOT NULL DEFAULT '[]',  -- JSON 数组：事件型自定义关键词
  updated_at     INTEGER NOT NULL,
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
  await migrateHoldingsColumns();
  await migrateNewsContent();
  await migratePlansColumns();
  await migrateFxbaogaoColumns();
  console.log('[db] schema initialized (holdings migrated)');
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
        sql: `INSERT INTO news_items(id,source_channel,source_name,title,summary,content,link,published_at,fetched_at,raw_json)
              VALUES(?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                title=excluded.title, summary=excluded.summary, content=excluded.content,
                link=excluded.link, published_at=excluded.published_at,
                fetched_at=excluded.fetched_at, raw_json=excluded.raw_json`,
        args: [
          id,
          String(source_channel || '').slice(0, 80),
          String(source_name || '').slice(0, 80),
          String(it.title || '').slice(0, 500),
          String(it.content || it.summary || '').slice(0, 4000),
          String(it.content || '').slice(0, 16000),
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

const NEWS_COLS = `id,source_channel,source_name,title,summary,content,link,published_at,fetched_at,raw_json`;

function mapNewsRow(row) {
  return {
    id: row.id,
    source_channel: row.source_channel,
    source_name: row.source_name,
    title: row.title,
    summary: row.summary,
    content: row.content || '',
    link: row.link,
    published_at: Number(row.published_at),
    fetched_at: Number(row.fetched_at),
    raw: row.raw_json ? safeJson(row.raw_json) : {},
  };
}

/** 读取最新 N 条新闻
 * - 默认：所有源按时间倒序
 * - holding_codes：电报三源(宏观) + 每个持仓的东财公告/个股新闻 各自独立取数再合并，
 *   避免持仓源被电报海量新帖在 LIMIT 下挤出
 */
export async function fetchNews({ limit = 30, since = 0, source_channel = null, holding_codes = null, channels = null } = {}) {
  const cap = Math.min(200, Math.max(1, limit));

  if (source_channel) {
    const sql = `SELECT ${NEWS_COLS} FROM news_items WHERE published_at >= ? AND source_channel = ? ORDER BY published_at DESC LIMIT ?`;
    const r = await client.execute({ sql, args: [since, source_channel, cap] });
    return r.rows.map(mapNewsRow);
  }

  if (Array.isArray(holding_codes) && holding_codes.length > 0) {
    // 持仓标的相关：仅直接关联（每持仓的东财公告），各自独立取数，不抢 LIMIT
    const perSrc = Math.max(20, Math.ceil(cap / 2));
    const holdSql = `SELECT ${NEWS_COLS} FROM news_items WHERE published_at >= ? AND source_channel = ? ORDER BY published_at DESC LIMIT ?`;
    const rows = [];
    for (const c of holding_codes) {
      const ch = `eastmoney_announcement_${c}`;
      const r = await client.execute({ sql: holdSql, args: [since, ch, perSrc] });
      rows.push(...r.rows);
    }
    const seen = new Set();
    const dedup = [];
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      dedup.push(row);
    }
    dedup.sort((a, b) => Number(b.published_at) - Number(a.published_at));
    return dedup.slice(0, cap).map(mapNewsRow);
  }

  // 默认 / 全部：可由 channels 限定（如仅电报三源）
  let sql = `SELECT ${NEWS_COLS} FROM news_items WHERE published_at >= ?`;
  const args = [since];
  if (Array.isArray(channels) && channels.length > 0) {
    sql += ` AND source_channel IN (${channels.map(() => '?').join(',')})`;
    args.push(...channels);
  }
  sql += ` ORDER BY published_at DESC LIMIT ?`;
  args.push(cap);
  const r = await client.execute({ sql, args });
  return r.rows.map(mapNewsRow);
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

/** 清理超过 cutoff_ms 的新闻
 * keepChannels 内的源（持仓相关公告/个股新闻，发布时间可能很早）不参与清理
 */
export async function cleanupOldNews(cutoff_ms, keepChannels = []) {
  try {
    let sql = `DELETE FROM news_items WHERE published_at < ?`;
    const args = [cutoff_ms];
    if (keepChannels.length > 0) {
      // 用前缀匹配：持仓通道实际为 eastmoney_announcement_600519（带代码后缀）
      const clause = keepChannels.map(() => 'source_channel NOT LIKE ?').join(' AND ');
      sql += ` AND ${clause}`;
      args.push(...keepChannels.map((p) => `${p}%`));
    }
    const r = await client.execute({ sql, args });
    return r.rowsAffected || 0;
  } catch (e) {
    console.warn(`[db] cleanupOldNews: ${e.message?.slice(0, 80)}`);
    return 0;
  }
}

// 持仓相关源不参与时间清理（公告/个股新闻发布时间可能很早，但对持仓监控长期有用）
export const HOLDING_NEWS_CHANNELS = [
  'eastmoney_announcement',
];

// 判断某 source_channel 是否属于持仓相关源（前缀匹配）
export function isHoldingChannel(ch) {
  return HOLDING_NEWS_CHANNELS.some((p) => ch.startsWith(p));
}

// =====================================================
// Portfolio Holdings
// =====================================================

export async function upsertHolding({ stock_code, short_name, market, shares, cost_basis, current_price, pnl, pnl_pct }) {
  await client.execute({
    sql: `INSERT INTO portfolio_holdings(stock_code,short_name,market,shares,cost_basis,current_price,pnl,pnl_pct,added_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(stock_code) DO UPDATE SET
            short_name=excluded.short_name,
            market=excluded.market,
            shares=excluded.shares,
            cost_basis=excluded.cost_basis,
            current_price=excluded.current_price,
            pnl=excluded.pnl,
            pnl_pct=excluded.pnl_pct,
            updated_at=excluded.updated_at`,
    args: [
      String(stock_code).padStart(6, '0'),
      String(short_name || '').slice(0, 40),
      String(market || '').slice(0, 10),
      // 防御：shares 必须为正有限整数，否则抛错（由 importHoldings 的 try/catch 跳过，不污染 DB）
      (() => { const n = Number(shares); if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) throw new Error('shares 必须为正整数'); return n; })(),
      // cost_basis 允许为 0，但必须是有限数字
      (() => { const n = Number(cost_basis); if (!Number.isFinite(n) || n < 0) throw new Error('cost_basis 必须为非负数字'); return n; })(),
      current_price === undefined ? null : Number(current_price),
      pnl === undefined ? null : Number(pnl),
      pnl_pct === undefined ? null : Number(pnl_pct),
      Date.now(),
      Date.now(),
    ],
  });
}

// 批量入库（富化后的持仓），返回成功条数
export async function importHoldings(items) {
  let ok = 0;
  for (const it of items || []) {
    try {
      await upsertHolding(it);
      ok++;
    } catch (e) {
      console.warn('[db] importHoldings skip:', e.message);
    }
  }
  return ok;
}

// 旧库迁移：补齐新增列
export async function migrateHoldingsColumns() {
  const needed = [
    ['current_price', 'REAL'],
    ['pnl', 'REAL'],
    ['pnl_pct', 'REAL'],
  ];
  for (const [col, type] of needed) {
    try {
      await client.execute({ sql: `ALTER TABLE portfolio_holdings ADD COLUMN ${col} ${type}` });
      console.log(`[db] migrated holdings +${col}`);
    } catch (e) {
      // 列已存在则忽略
    }
  }
}

// 旧库迁移：portfolio_plans 增加 last_price 跟踪字段
export async function migratePlansColumns() {
  const needed = [
    ['last_price', 'REAL'],
    ['last_price_at', 'INTEGER'],
  ];
  for (const [col, type] of needed) {
    try {
      await client.execute({ sql: `ALTER TABLE portfolio_plans ADD COLUMN ${col} ${type}` });
      console.log(`[db] migrated plans +${col}`);
    } catch (e) {
      // 列已存在则忽略
    }
  }
}

// 旧库迁移：news_items 增加 content 整帖字段
export async function migrateNewsContent() {
  try {
    await client.execute({ sql: `ALTER TABLE news_items ADD COLUMN content TEXT NOT NULL DEFAULT ''` });
    console.log('[db] migrated news_items +content');
  } catch (e) {
    // 列已存在则忽略
  }
  // 回填：旧行的 content 为空时，用已有 summary 兜底（新抓取会用整帖覆盖）
  try {
    await client.execute({ sql: `UPDATE news_items SET content = summary WHERE content = ''` });
  } catch (e) { /* ignore */ }
}

// 旧库迁移：fxbaogao_reports 增加 pdf_url / ai_status 列（详情秒开 + 精读状态）
export async function migrateFxbaogaoColumns() {
  const needed = [
    ['pdf_url', "TEXT NOT NULL DEFAULT ''"],
    ['ai_status', 'INTEGER NOT NULL DEFAULT 0'],
  ];
  for (const [col, type] of needed) {
    try {
      await client.execute({ sql: `ALTER TABLE fxbaogao_reports ADD COLUMN ${col} ${type}` });
      console.log(`[db] migrated fxbaogao_reports +${col}`);
    } catch (e) {
      // 列已存在则忽略
    }
  }
}

export async function removeHolding(stock_code) {
  await client.execute({
    sql: `DELETE FROM portfolio_holdings WHERE stock_code=?`,
    args: [String(stock_code).padStart(6, '0')],
  });
}

export async function listHoldings() {
  const r = await client.execute(`SELECT stock_code,short_name,market,shares,cost_basis,current_price,pnl,pnl_pct,added_at,updated_at FROM portfolio_holdings ORDER BY stock_code`);
  return r.rows.map((row) => ({
    stock_code: row.stock_code,
    short_name: row.short_name,
    market: row.market,
    shares: Number(row.shares),
    cost_basis: Number(row.cost_basis),
    current_price: row.current_price === null ? null : Number(row.current_price),
    pnl: row.pnl === null ? null : Number(row.pnl),
    pnl_pct: row.pnl_pct === null ? null : Number(row.pnl_pct),
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

export async function upsertPlan({ stock_code, stock_name, p0, atr, atr_pct, total_invest, plan_json, last_price, last_price_at }) {
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO portfolio_plans(stock_code,stock_name,p0,atr,atr_pct,total_invest,plan_json,last_price,last_price_at,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(stock_code) DO UPDATE SET
            stock_name=excluded.stock_name,
            p0=excluded.p0,
            atr=excluded.atr,
            atr_pct=excluded.atr_pct,
            total_invest=excluded.total_invest,
            plan_json=excluded.plan_json,
            last_price=COALESCE(excluded.last_price, last_price),
            last_price_at=COALESCE(excluded.last_price_at, last_price_at),
            updated_at=excluded.updated_at`,
    args: [
      String(stock_code).padStart(6, '0'),
      String(stock_name || '').slice(0, 40),
      Number(p0) || 0,
      Number(atr) || 0,
      Number(atr_pct) || 0,
      Number(total_invest) || 0,
      JSON.stringify(plan_json || {}).slice(0, 12000),
      last_price != null ? Number(last_price) : null,
      last_price_at != null ? Number(last_price_at) : null,
      now,
      now,
    ],
  });
}

export async function getPlan(stock_code) {
  const r = await client.execute({
    sql: `SELECT stock_code,stock_name,p0,atr,atr_pct,total_invest,plan_json,last_price,last_price_at,created_at,updated_at FROM portfolio_plans WHERE stock_code=?`,
    args: [String(stock_code).padStart(6, '0')],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0];
  return {
    stock_code: row.stock_code,
    stock_name: row.stock_name,
    p0: Number(row.p0),
    atr: Number(row.atr),
    atr_pct: Number(row.atr_pct),
    total_invest: Number(row.total_invest),
    plan_json: safeJson(row.plan_json),
    last_price: row.last_price != null ? Number(row.last_price) : null,
    last_price_at: row.last_price_at != null ? Number(row.last_price_at) : null,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  };
}

export async function updatePlanPrice(stock_code, price, ts = Date.now()) {
  await client.execute({
    sql: `UPDATE portfolio_plans SET last_price=?, last_price_at=?, updated_at=? WHERE stock_code=?`,
    args: [Number(price) || 0, Number(ts), Number(ts), String(stock_code).padStart(6, '0')],
  });
}

export async function listPlans() {
  const r = await client.execute(`SELECT stock_code,stock_name,p0,atr,atr_pct,total_invest,plan_json,last_price,last_price_at,created_at,updated_at FROM portfolio_plans ORDER BY updated_at DESC`);
  return r.rows.map((row) => ({
    stock_code: row.stock_code,
    stock_name: row.stock_name,
    p0: Number(row.p0),
    atr: Number(row.atr),
    atr_pct: Number(row.atr_pct),
    total_invest: Number(row.total_invest),
    plan_json: safeJson(row.plan_json),
    last_price: row.last_price != null ? Number(row.last_price) : null,
    last_price_at: row.last_price_at != null ? Number(row.last_price_at) : null,
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

// =====================================================
// 研报 AI 精读（外部整篇研报入库）
// =====================================================

export async function upsertResearchReport({ id, title, broker, industry, source_url, raw_text, tldr, key_points, opportunities, risks, status = 'refined' }) {
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO research_reports(id,title,broker,industry,source_url,raw_text,tldr,key_points,opportunities,risks,status,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, broker=excluded.broker, industry=excluded.industry,
            source_url=excluded.source_url, raw_text=excluded.raw_text, tldr=excluded.tldr,
            key_points=excluded.key_points, opportunities=excluded.opportunities, risks=excluded.risks,
            status=excluded.status, updated_at=excluded.updated_at`,
    args: [
      String(id), String(title || '').slice(0, 200), String(broker || '').slice(0, 80),
      String(industry || '').slice(0, 80), String(source_url || '').slice(0, 500),
      String(raw_text || '').slice(0, 60000), String(tldr || '').slice(0, 2000),
      JSON.stringify(key_points || []), JSON.stringify(opportunities || []), JSON.stringify(risks || []),
      String(status), now, now,
    ],
  });
}

export async function listResearchReports() {
  const r = await client.execute(`SELECT id,title,broker,industry,source_url,raw_text,tldr,key_points,opportunities,risks,status,created_at,updated_at FROM research_reports ORDER BY created_at DESC LIMIT 100`);
  return r.rows.map((row) => ({
    id: row.id,
    title: row.title,
    broker: row.broker,
    industry: row.industry,
    source_url: row.source_url,
    raw_text: row.raw_text,
    tldr: row.tldr,
    key_points: safeJson(row.key_points),
    opportunities: safeJson(row.opportunities),
    risks: safeJson(row.risks),
    status: row.status,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  }));
}

// 带过滤的研报列表（按 created_at 距今的天数 + broker 匹配）
// dateRange: '1d' | '1w' | '1m' | '3m' | 'all'
// institution: 精确匹配 broker 列（空字符串=不过滤）
export async function listResearchReportsFiltered(opts = {}) {
  const { dateRange = 'all', institution = '', limit = 200 } = opts
  const wheres = []
  const args = []
  const now = Date.now()
  if (dateRange !== 'all') {
    const days = { '1d': 1, '1w': 7, '1m': 30, '3m': 90 }[dateRange] || 0
    if (days > 0) {
      wheres.push('created_at >= ?')
      args.push(now - days * 86400_000)
    }
  }
  if (institution && institution.trim()) {
    wheres.push('broker = ?')
    args.push(institution.trim())
  }
  const whereSql = wheres.length ? 'WHERE ' + wheres.join(' AND ') : ''
  const sql = `SELECT id,title,broker,industry,source_url,raw_text,tldr,key_points,opportunities,risks,status,created_at,updated_at FROM research_reports ${whereSql} ORDER BY created_at DESC LIMIT ?`
  args.push(limit)
  const r = await client.execute({ sql, args })
  return r.rows.map((row) => ({
    id: row.id,
    title: row.title,
    broker: row.broker,
    industry: row.industry,
    source_url: row.source_url,
    raw_text: row.raw_text,
    tldr: row.tldr,
    key_points: safeJson(row.key_points),
    opportunities: safeJson(row.opportunities),
    risks: safeJson(row.risks),
    status: row.status,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  }))
}

// 各时间窗 + 每个 broker 的计数（前端底部筛选条用）
export async function countResearchReportsGrouped() {
  const r = await client.execute('SELECT broker, created_at FROM research_reports')
  const now = Date.now()
  const byDateRange = { '1d': 0, '1w': 0, '1m': 0, '3m': 0, 'all': 0 }
  const byBroker = {}
  for (const row of r.rows) {
    const age = now - Number(row.created_at)
    byDateRange['all']++
    if (age <= 86400_000) byDateRange['1d']++
    if (age <= 7 * 86400_000) byDateRange['1w']++
    if (age <= 30 * 86400_000) byDateRange['1m']++
    if (age <= 90 * 86400_000) byDateRange['3m']++
    const b = String(row.broker || '未知')
    byBroker[b] = (byBroker[b] || 0) + 1
  }
  return {
    byDateRange,
    byBroker: Object.entries(byBroker).sort((a, b) => b[1] - a[1]).map(([broker, n]) => ({ broker, n })),
    total: r.rows.length,
  }
}

export async function deleteResearchReport(id) {
  await client.execute({ sql: `DELETE FROM research_reports WHERE id=?`, args: [String(id)] });
}

// =====================================================
// fxbaogao 全量研报索引（分片同步）
// =====================================================

// 批量 upsert（report_id 冲突时更新 title/org_name/pub_time 等，pdf_url/ai_status 保留）
export async function upsertFxbaogaoReports(list) {
  if (!list || !list.length) return 0;
  const now = Date.now();
  const stmts = list.map((r) => {
    // fxbaogao 返回的 pubTime 是秒；若偶见毫秒也归一到秒，统一入库单位
    const t = Number(r.pubTime || 0);
    const sec = t >= 1e12 ? Math.floor(t / 1000) : t;
    return {
      sql: `INSERT INTO fxbaogao_reports(report_id,title,org_name,page_num,pub_time,pub_date,recommended,categories,source_range,pdf_url,ai_status,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(report_id) DO UPDATE SET
              title=excluded.title, org_name=excluded.org_name, page_num=excluded.page_num,
              pub_time=excluded.pub_time, pub_date=excluded.pub_date, recommended=excluded.recommended,
              categories=excluded.categories, source_range=excluded.source_range`,
      args: [
        Number(r.reportId) || 0,
        String(r.title || '').slice(0, 300),
        String(r.orgName || '').slice(0, 80),
        Number(r.pageNum || 0),
        sec,
        String(r.pubTimeStr || r.pubDate || '').slice(0, 40),
        r.recommended ? 1 : 0,
        JSON.stringify(Array.isArray(r.categories) ? r.categories : []),
        String(r.sourceRange || '').slice(0, 60),
        String(r.pdfUrl || '').slice(0, 500),
        0,
        now,
      ],
    };
  });
  await client.batch(stmts, 'write');
  return list.length;
}

// 缓存 PDF 直链（详情页秒开：命中缓存无需再调 MCP）
export async function updateFxbaogaoPdfUrl(reportId, url) {
  if (!reportId || !url) return;
  await client.execute({
    sql: `UPDATE fxbaogao_reports SET pdf_url=? WHERE report_id=?`,
    args: [String(url).slice(0, 500), Number(reportId)],
  });
}

// 分页读取（按 pub_time 倒序），支持时间范围过滤（startMs/endMs 均为毫秒，库内为秒，自动换算）
export async function listFxbaogaoReports({ offset = 0, limit = 20, startMs = 0, endMs = 0 } = {}) {
  const wheres = [];
  const args = [];
  if (startMs > 0) { wheres.push('pub_time >= ?'); args.push(Math.floor(startMs / 1000)); }
  if (endMs > 0) { wheres.push('pub_time <= ?'); args.push(Math.floor(endMs / 1000)); }
  const whereSql = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
  const sql = `SELECT report_id,title,org_name,page_num,pub_time,pub_date,recommended,categories,pdf_url,ai_status FROM fxbaogao_reports ${whereSql} ORDER BY pub_time DESC LIMIT ? OFFSET ?`;
  args.push(Math.min(Math.max(Number(limit) || 20, 1), 200), Math.max(Number(offset) || 0, 0));
  const r = await client.execute({ sql, args });
  return r.rows.map((row) => ({
    reportId: Number(row.report_id),
    title: String(row.title || ''),
    orgName: String(row.org_name || ''),
    pageNum: Number(row.page_num || 0),
    pubTime: Number(row.pub_time || 0),
    pubTimeStr: String(row.pub_date || ''),
    recommended: Number(row.recommended || 0) === 1,
    categories: safeJson(row.categories),
    pdfUrl: String(row.pdf_url || ''),
    aiStatus: Number(row.ai_status || 0),
  }));
}

// 统计：总数 + 最新入库时间（返回毫秒，与前端 Date.now() 同单位）
export async function getFxbaogaoStats() {
  const r = await client.execute('SELECT COUNT(*) AS n, COALESCE(MAX(pub_time),0) AS latest FROM fxbaogao_reports');
  const latestSec = Number(r.rows[0]?.latest || 0);
  const latestMs = latestSec >= 1e12 ? latestSec : latestSec * 1000;
  return {
    total: Number(r.rows[0]?.n || 0),
    latestPubTime: latestMs,
  };
}

// 按 report_id 取单条（含 pdf_url 缓存），供详情页「秒开 PDF」用
export async function getFxbaogaoReportById(reportId) {
  const r = await client.execute({
    sql: `SELECT report_id,title,org_name,page_num,pub_time,pub_date,recommended,categories,pdf_url,ai_status FROM fxbaogao_reports WHERE report_id=? LIMIT 1`,
    args: [Number(reportId)],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0];
  return {
    reportId: Number(row.report_id),
    title: String(row.title || ''),
    orgName: String(row.org_name || ''),
    pageNum: Number(row.page_num || 0),
    pubTime: Number(row.pub_time || 0),
    pubTimeStr: String(row.pub_date || ''),
    recommended: Number(row.recommended || 0) === 1,
    categories: safeJson(row.categories),
    pdfUrl: String(row.pdf_url || ''),
    aiStatus: Number(row.ai_status || 0),
  };
}

// 未精读总数（摘要/状态展示用）
export async function maxUnrefinedCount() {
  const r = await client.execute('SELECT COUNT(*) AS n FROM fxbaogao_reports WHERE ai_status=0');
  return Number(r.rows[0]?.n || 0);
}

// =====================================================
// fxbaogao 研报 AI 精读（与原文分开存储）
// =====================================================

export async function upsertFxbaogaoAi({ report_id, title, broker, source_url, raw_text, tldr, key_points, opportunities, risks, status, model }) {
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO fxbaogao_ai(report_id,title,broker,source_url,raw_text,tldr,key_points,opportunities,risks,status,model,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(report_id) DO UPDATE SET
            title=excluded.title, broker=excluded.broker, source_url=excluded.source_url, raw_text=excluded.raw_text,
            tldr=excluded.tldr, key_points=excluded.key_points, opportunities=excluded.opportunities,
            risks=excluded.risks, status=excluded.status, model=excluded.model, updated_at=excluded.updated_at`,
    args: [
      Number(report_id),
      String(title || '').slice(0, 300),
      String(broker || '').slice(0, 80),
      String(source_url || '').slice(0, 500),
      String(raw_text || '').slice(0, 60000),
      String(tldr || '').slice(0, 2000),
      JSON.stringify(Array.isArray(key_points) ? key_points : []),
      JSON.stringify(Array.isArray(opportunities) ? opportunities : []),
      JSON.stringify(Array.isArray(risks) ? risks : []),
      String(status || 'refined-llm'),
      String(model || '').slice(0, 40),
      now,
      now,
    ],
  });
  // 同步标记索引表 ai_status = 2（已精读）
  await client.execute({
    sql: `UPDATE fxbaogao_reports SET ai_status=2 WHERE report_id=?`,
    args: [Number(report_id)],
  });
}

export async function getFxbaogaoAi(report_id) {
  const r = await client.execute({
    sql: `SELECT report_id,title,broker,source_url,raw_text,tldr,key_points,opportunities,risks,status,model,created_at,updated_at FROM fxbaogao_ai WHERE report_id=?`,
    args: [Number(report_id)],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0];
  return {
    report_id: Number(row.report_id),
    title: String(row.title || ''),
    broker: String(row.broker || ''),
    source_url: String(row.source_url || ''),
    raw_text: String(row.raw_text || ''),
    tldr: String(row.tldr || ''),
    key_points: safeJson(row.key_points),
    opportunities: safeJson(row.opportunities),
    risks: safeJson(row.risks),
    status: String(row.status || ''),
    model: String(row.model || ''),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  };
}

// 取"已入库但尚未精读"的研报（供后台 15 分钟任务消费），limit 可限流
export async function listUnrefinedFxbaogao(limit = 20) {
  const cap = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const r = await client.execute({
    sql: `SELECT report_id,title,org_name,page_num,pub_time,pub_date FROM fxbaogao_reports WHERE ai_status=0 ORDER BY pub_time DESC LIMIT ?`,
    args: [cap],
  });
  return r.rows.map((row) => ({
    reportId: Number(row.report_id),
    title: String(row.title || ''),
    orgName: String(row.org_name || ''),
    pageNum: Number(row.page_num || 0),
    pubTime: Number(row.pub_time || 0),
    pubTimeStr: String(row.pub_date || ''),
  }));
}

// 将某条研报标记为"精读中"，避免多实例重复消费
export async function markFxbaogaoAiPending(report_id) {
  await client.execute({ sql: `UPDATE fxbaogao_reports SET ai_status=1 WHERE report_id=?`, args: [Number(report_id)] });
}

// 清理超过 cutoffMs 的研报（线上库仅保留最近 3 个月）；级联删精读结果
export async function cleanupOldFxbaogao(cutoffMs) {
  try {
    const cutoffSec = Math.floor(cutoffMs / 1000);
    await client.execute({ sql: `DELETE FROM fxbaogao_ai WHERE report_id IN (SELECT report_id FROM fxbaogao_reports WHERE pub_time < ?)`, args: [cutoffSec] });
    const r = await client.execute({ sql: `DELETE FROM fxbaogao_reports WHERE pub_time < ?`, args: [cutoffSec] });
    return r.rowsAffected || 0;
  } catch (e) {
    console.warn('[db] cleanupOldFxbaogao:', e.message?.slice(0, 80));
    return 0;
  }
}

// =====================================================
// 已持仓标的 AI 研报（十二模块，逐标的持久化）
// =====================================================

export async function upsertStockReport({ stock_code, stock_name, report_json }) {
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO research_stock_reports(stock_code,stock_name,report_json,created_at,updated_at)
          VALUES(?,?,?,?,?)
          ON CONFLICT(stock_code) DO UPDATE SET
            stock_name=excluded.stock_name, report_json=excluded.report_json, updated_at=excluded.updated_at`,
    args: [String(stock_code).padStart(6, '0'), String(stock_name || '').slice(0, 40), JSON.stringify(report_json || {}).slice(0, 20000), now, now],
  });
}

export async function listStockReports() {
  const r = await client.execute(`SELECT stock_code,stock_name,report_json,created_at,updated_at FROM research_stock_reports ORDER BY updated_at DESC`);
  return r.rows.map((row) => ({
    stock_code: row.stock_code,
    stock_name: row.stock_name,
    report: safeJson(row.report_json),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  }));
}

export async function deleteStockReport(stock_code) {
  await client.execute({ sql: `DELETE FROM research_stock_reports WHERE stock_code=?`, args: [String(stock_code).padStart(6, '0')] });
}

// =====================================================
// 持仓产业链画像（可编辑，间接关联匹配用）
// =====================================================

function jarr(s) {
  const a = safeJson(s);
  return Array.isArray(a) ? a.map(String) : [];
}

// 用静态画像（holding-profiles.ts）作为种子，覆盖库里没有的持仓
const SEED_PROFILES = new Map();
import { HOLDING_PROFILES as _SEED } from './holding-profiles.js';
for (const p of _SEED) SEED_PROFILES.set(p.stock_code, p);

export async function upsertHoldingProfile({ stock_code, raw_materials, products, customers, overseas_peers, policy_domains, transport, extra_keywords }) {
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO holding_profiles(stock_code,raw_materials,products,customers,overseas_peers,policy_domains,transport,extra_keywords,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?)
          ON CONFLICT(stock_code) DO UPDATE SET
            raw_materials=excluded.raw_materials, products=excluded.products, customers=excluded.customers,
            overseas_peers=excluded.overseas_peers, policy_domains=excluded.policy_domains, transport=excluded.transport,
            extra_keywords=excluded.extra_keywords, updated_at=excluded.updated_at`,
    args: [
      String(stock_code).padStart(6, '0'),
      JSON.stringify(raw_materials || []), JSON.stringify(products || []), JSON.stringify(customers || []),
      JSON.stringify(overseas_peers || []), JSON.stringify(policy_domains || []), JSON.stringify(transport || []),
      JSON.stringify(extra_keywords || []), now,
    ],
  });
}

export async function listHoldingProfiles() {
  const r = await client.execute(`SELECT stock_code,raw_materials,products,customers,overseas_peers,policy_domains,transport,extra_keywords,updated_at FROM holding_profiles`);
  const dbRows = r.rows.map((row) => ({
    stock_code: row.stock_code,
    raw_materials: jarr(row.raw_materials),
    products: jarr(row.products),
    customers: jarr(row.customers),
    overseas_peers: jarr(row.overseas_peers),
    policy_domains: jarr(row.policy_domains),
    transport: jarr(row.transport),
    extra_keywords: jarr(row.extra_keywords),
    updated_at: Number(row.updated_at),
  }));
  const byCode = new Map(dbRows.map((p) => [p.stock_code, p]));
  // 合并种子（库里没有的持仓用静态画像兜底，并标注 seed=true）
  const merged = [];
  const allCodes = new Set([...byCode.keys(), ...SEED_PROFILES.keys()]);
  for (const code of allCodes) {
    const seed = SEED_PROFILES.get(code);
    const dbP = byCode.get(code);
    if (dbP) merged.push({ ...dbP, short_name: seed?.short_name || dbP.stock_code, industry: seed?.industry || '', from_db: true });
    else if (seed) merged.push({
      stock_code: seed.stock_code, raw_materials: seed.raw_materials, products: seed.products, customers: seed.customers,
      overseas_peers: seed.overseas_peers, policy_domains: seed.policy_domains, transport: seed.transport,
      extra_keywords: seed.extra_keywords, short_name: seed.short_name, industry: seed.industry, from_db: false, updated_at: 0,
    });
  }
  return merged;
}

export async function deleteHoldingProfile(stock_code) {
  await client.execute({ sql: `DELETE FROM holding_profiles WHERE stock_code=?`, args: [String(stock_code).padStart(6, '0')] });
}

// 清理旧版采集写入的脏公告行（source_name='t' / 旧 guid 格式 ann:CODE:TS:IDX）
export async function cleanupStaleAnnouncements() {
  try {
    await client.execute({ sql: `DELETE FROM news_items WHERE source_name = 't' AND source_channel LIKE 'eastmoney_announcement_%'` });
    await client.execute({ sql: `DELETE FROM news_items WHERE source_channel LIKE 'eastmoney_announcement_%' AND id LIKE 'ann:%:%:%'` });
    return true;
  } catch (e) {
    console.warn('[db] cleanupStaleAnnouncements:', e.message?.slice(0, 80));
    return false;
  }
}

export { client as db };
