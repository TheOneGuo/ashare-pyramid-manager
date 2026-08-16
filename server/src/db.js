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
export async function fetchNews({ limit = 30, since = 0, source_channel = null, holding_codes = null } = {}) {
  const cap = Math.min(200, Math.max(1, limit));

  if (source_channel) {
    const sql = `SELECT ${NEWS_COLS} FROM news_items WHERE published_at >= ? AND source_channel = ? ORDER BY published_at DESC LIMIT ?`;
    const r = await client.execute({ sql, args: [since, source_channel, cap] });
    return r.rows.map(mapNewsRow);
  }

  if (Array.isArray(holding_codes) && holding_codes.length > 0) {
    const directCh = [];
    const perSrc = Math.max(20, Math.ceil(cap / 2)); // 每个持仓源保底 20 条
    const rows = [];
    // ① 直接关联：每个持仓的东财公告（中文，按代码命中）单独取，不抢 LIMIT
    const holdSql = `SELECT ${NEWS_COLS} FROM news_items WHERE published_at >= ? AND source_channel = ? ORDER BY published_at DESC LIMIT ?`;
    for (const c of holding_codes) {
      const ch = `eastmoney_announcement_${c}`;
      directCh.push(ch);
      const r = await client.execute({ sql: holdSql, args: [since, ch, perSrc] });
      rows.push(...r.rows);
    }
    // ② 间接关联：宏观/电报/商品新闻中命中持仓产业链画像关键词（不含英文源、不混入全量）
    const indirectChannels = ['FinanceNewsDaily', 'jin10data', 'cnwallstreet', 'macro_commodity', 'macro_sina_roll'];
    const tgSql = `SELECT ${NEWS_COLS} FROM news_items WHERE published_at >= ? AND source_channel = ? ORDER BY published_at DESC LIMIT ?`;
    // 画像优先取 DB（可编辑），DB 无则用静态种子兜底
    let dbProfiles = [];
    try { dbProfiles = await listHoldingProfiles(); } catch { dbProfiles = []; }
    const profiles = dbProfiles
      .filter((p) => holding_codes.includes(p.stock_code))
      .map((p) => ({
        stock_code: p.stock_code,
        short_name: p.short_name || p.stock_code,
        industry: p.industry || '',
        raw_materials: p.raw_materials, products: p.products, customers: p.customers,
        overseas_peers: p.overseas_peers, policy_domains: p.policy_domains,
        transport: p.transport, extra_keywords: p.extra_keywords,
      }));
    for (const ch of indirectChannels) {
      const r = await client.execute({ sql: tgSql, args: [since, ch, cap] });
      for (const row of r.rows) {
        const text = `${row.title || ''}\n${row.summary || ''}\n${row.content || ''}`;
        const matched = matchHoldingProfile(text, profiles);
        if (matched.length > 0) rows.push(row);
      }
    }
    // 去重 + 排序 + 限顶
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

  const sql = `SELECT ${NEWS_COLS} FROM news_items WHERE published_at >= ? ORDER BY published_at DESC LIMIT ?`;
  const r = await client.execute({ sql, args: [since, cap] });
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
      Number(shares) || 0,
      Number(cost_basis) || 0,
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

export async function deleteResearchReport(id) {
  await client.execute({ sql: `DELETE FROM research_reports WHERE id=?`, args: [String(id)] });
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
