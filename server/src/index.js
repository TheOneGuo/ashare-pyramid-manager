/**
 * Ashare Pyramid Manager · Backend Server (v2)
 *
 * Routes:
 *   GET  /api/health                   健康检查（含 db mode）
 *   GET  /api/news?limit=30&since=ts   通用新闻（电报 3 源 + 持仓相关）
 *   GET  /api/news/sources             各源采集状态
 *   POST /api/news/refresh             手动触发一次刷新
 *   GET  /api/holdings                 当前持仓列表
 *   POST /api/holdings                 增/改持仓  body: {stock_code, short_name?, market?, shares, cost_basis?}
 *   DELETE /api/holdings/:code         删除持仓
 *   POST /api/portfolio/analyze        调用 pyramid 算法算加仓表（未来）
 *
 * 安全：
 *   - IFIND_REFRESH_TOKEN 仅存在 OS env，不入库
 *   - Turso token 同上
 *   - 启动时打印 db mode 和端口
 */

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, getMode, fetchNews, fetchNewsSources, upsertNewsItems, recordSourceError, cleanupOldNews, upsertHolding, removeHolding, listHoldings, listRecommendations, upsertRecommendation, removeRecommendation, bulkSetRecommendations, compareWithRole, ROLE_LABELS } from './db.js';
import { refreshAll, refreshIntervalSeconds, labelForInterval, CHANNELS } from './news-collector.js';
import { handleAnalyze } from './portfolio-analyzer.js';
import { handleExtract } from './portfolio-extract.js';
import { handleResearch } from './research-report.js';
import { buildAccount, previewChange, checkWithdraw, TERMS, EVENT_DEPOSIT, EVENT_WITHDRAW, EVENT_FEE_RATE } from './account-ledger.js';
import { listLedgerEvents, appendLedgerEvent, clearLedger, upsertPlan, listPlans, removePlan } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 9999);
const MODE = (process.env.NEWS_SOURCE_MODE || 'real').toLowerCase();
const PREVIEW_DIR = path.resolve(__dirname, '../../preview');

const app = express();

// =====================================================
// CORS - 开发模式允许所有 origin（H5 dev 5173 + preview file://）
// 生产模式收窄为白名单
// =====================================================
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim());
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowed = CORS_ORIGINS.includes('*') ||
    CORS_ORIGINS.includes(origin) ||
    origin === 'null' ||  // file:// origin
    /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '2mb' }));

let lastRefreshAt = 0;
let lastRefreshSummary = null;

// =====================================================
// Health
// =====================================================
app.get('/api/health', async (_req, res) => {
  const intervalSec = refreshIntervalSeconds();
  res.json({
    ok: true,
    service: 'ashare-pyramid-server',
    db: getMode(),
    mode: MODE,
    version: '0.2.0',
    interval_seconds: intervalSec,
    mode_label: labelForInterval(intervalSec),
    last_refresh_at: lastRefreshAt,
    ifind_token_loaded: !!process.env.IFIND_REFRESH_TOKEN,
    uptime: process.uptime(),
  });
});

// =====================================================
// News
// =====================================================
app.get('/api/news', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 30);
    const since = Number(req.query.since || 0);
    const holding = req.query.holding === '1' || req.query.holding === 'true';
    let items;
    if (holding) {
      const holdings = await listHoldings();
      const codes = holdings.map((h) => h.stock_code);
      items = await fetchNews({ limit, since, holding_codes: codes });
    } else {
      items = await fetchNews({ limit, since });
    }
    res.json({ ok: true, count: items.length, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/news/sources', async (_req, res) => {
  try {
    const sources = await fetchNewsSources();
    res.json({ ok: true, sources });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/news/refresh', async (req, res) => {
  try {
    const holdings = await listHoldings();
    const codes = holdings.map((h) => h.stock_code);
    const summary = await refreshAll({
      db: { upsertNewsItems, recordSourceError, cleanupOldNews },
      mode: MODE,
      holdingCodes: codes,
    });
    lastRefreshAt = Date.now();
    lastRefreshSummary = summary;
    res.json({ ok: true, summary });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// =====================================================
// Portfolio Holdings
// =====================================================
app.get('/api/holdings', async (_req, res) => {
  try {
    const items = await listHoldings();
    res.json({ ok: true, count: items.length, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/holdings', async (req, res) => {
  try {
    const { stock_code, short_name, market, shares, cost_basis } = req.body || {};
    if (!stock_code || shares == null) {
      return res.status(400).json({ ok: false, error: 'stock_code & shares required' });
    }
    await upsertHolding({ stock_code, short_name, market, shares, cost_basis });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/holdings/:code', async (req, res) => {
  try {
    await removeHolding(req.params.code);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// =====================================================
// Portfolio Recommendations (4 role：机构/游资/北向/散户)
// 数据由用户手动录入
// =====================================================
app.get('/api/portfolio/roles', async (_req, res) => {
  res.json({ ok: true, roles: ROLE_LABELS });
});

app.get('/api/portfolio/recommendations', async (req, res) => {
  try {
    const role = req.query.role || null;
    const items = await listRecommendations(role);
    res.json({ ok: true, count: items.length, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/portfolio/recommendations', async (req, res) => {
  try {
    const { role, items } = req.body || {};
    if (!role || !ROLE_LABELS[role]) {
      return res.status(400).json({ ok: false, error: 'role 必须 ∈ {institution, hot_money, northbound, retail}' });
    }
    if (!Array.isArray(items)) {
      return res.status(400).json({ ok: false, error: 'items 必须是数组' });
    }
    await bulkSetRecommendations(role, items);
    res.json({ ok: true, role, count: items.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/portfolio/recommendations/item', async (req, res) => {
  try {
    const { role, stock_code, stock_name, weight, note } = req.body || {};
    if (!role || !ROLE_LABELS[role]) {
      return res.status(400).json({ ok: false, error: 'role 无效' });
    }
    if (!stock_code) {
      return res.status(400).json({ ok: false, error: 'stock_code 必填' });
    }
    await upsertRecommendation({ role, stock_code, stock_name, weight, note });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/portfolio/recommendations/:role/:code', async (req, res) => {
  try {
    await removeRecommendation({ role: req.params.role, stock_code: req.params.code });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/portfolio/recommendations/compare', async (req, res) => {
  try {
    const role = req.query.role;
    if (!role || !ROLE_LABELS[role]) {
      return res.status(400).json({ ok: false, error: 'role 无效' });
    }
    const data = await compareWithRole(role);
    res.json(data);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// =====================================================
// Portfolio Analyze（截图识别 + 5 步校验 + pyramid 算方案）
// =====================================================
app.post('/api/portfolio/extract', async (req, res) => {
  try {
    const result = await handleExtract(req.body || {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/portfolio/analyze', async (req, res) => {
  try {
    const result = await handleAnalyze(req.body || {});
    // 分析成功后，把每个有方案的标的写入「持仓方案跟踪」表（供模块5恢复）
    if (result && result.ok && Array.isArray(result.stocks)) {
      for (const s of result.stocks) {
        if (s && s.plan && s.plan.ok) {
          try {
            await upsertPlan({
              stock_code: s.code,
              stock_name: s.name || '',
              p0: s.p0,
              atr: s.atr,
              atr_pct: s.plan.atr_pct,
              total_invest: s.plan.total_invest,
              plan_json: {
                rows: s.plan.rows,
                tp_rows: s.plan.tp_rows,
                total_invest: s.plan.total_invest,
                atr_pct: s.plan.atr_pct,
                ratio_note: s.plan.ratio_note,
                notices: s.plan.notices,
                stop_loss_pct: s.plan.stop_loss_pct,
              },
            });
          } catch (pe) {
            console.warn('[plans] persist failed', s.code, pe.message);
          }
        }
      }
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// AI 研报解读（结构化 mock，后续接真 LLM）
app.post('/api/portfolio/research', async (req, res) => {
  try {
    const result = await handleResearch(req.body || {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// =====================================================
// 账户与保证金账本（事件流，忠实移植 position_account.py）
// 状态全部由 buildAccount 从事件回放推导，不允许前端直接写金额。
// =====================================================

// GET 账本当前状态（事件列表 + 回放结果 + 当前持仓占用）
app.get('/api/portfolio/ledger', async (_req, res) => {
  try {
    const events = await listLedgerEvents();
    const positions = await listHoldings();
    // fee_rate_wan 取最近一条 fee 事件或默认 1.2
    let feeWan = 1.2;
    for (const e of events) {
      if (e.type === 'fee_rate_change' || e.type === 'init') {
        if (e.payload && e.payload.fee_rate_wan != null) feeWan = Number(e.payload.fee_rate_wan);
      }
    }
    const snapshot = buildAccount(events.map((e) => ({ type: e.type, ...e.payload })), feeWan, positions);
    res.json({ ok: true, events, snapshot, terms: TERMS });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST 追加一条账本事件（init/deposit/withdraw/close_position/fee_rate_change）
app.post('/api/portfolio/ledger', async (req, res) => {
  try {
    const { type, payload } = req.body || {};
    if (!['init', 'deposit', 'withdraw', 'close_position', 'fee_rate_change'].includes(type)) {
      return res.status(400).json({ ok: false, error: 'type 非法' });
    }
    const id = await appendLedgerEvent(type, payload || {});
    // 回放并返回最新快照
    const events = await listLedgerEvents();
    const positions = await listHoldings();
    let feeWan = 1.2;
    for (const e of events) {
      if (e.type === 'fee_rate_change' || e.type === 'init') {
        if (e.payload && e.payload.fee_rate_wan != null) feeWan = Number(e.payload.fee_rate_wan);
      }
    }
    const snapshot = buildAccount(events.map((e) => ({ type: e.type, ...e.payload })), feeWan, positions);
    res.json({ ok: true, id, snapshot, events, terms: TERMS });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST 预览一次账本变更（先给结果再确认，提取可能降低可开标的上限）
app.post('/api/portfolio/ledger/preview', async (req, res) => {
  try {
    const { type, amount, fee_rate_wan } = req.body || {};
    const events = await listLedgerEvents();
    const positions = await listHoldings();
    let feeWan = 1.2;
    for (const e of events) {
      if (e.type === 'fee_rate_change' || e.type === 'init') {
        if (e.payload && e.payload.fee_rate_wan != null) feeWan = Number(e.payload.fee_rate_wan);
      }
    }
    const snapshot = buildAccount(events.map((e) => ({ type: e.type, ...e.payload })), feeWan, positions);
    const out = previewChange(snapshot, type, amount, fee_rate_wan);
    res.json({ ok: true, preview: out, snapshot });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE 清空账本（重新开始）
app.delete('/api/portfolio/ledger', async (_req, res) => {
  try {
    await clearLedger();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// =====================================================
// 持仓方案跟踪（固定项持久化，分析后写入，可恢复列表）
// =====================================================
app.get('/api/portfolio/plans', async (_req, res) => {
  try {
    const items = await listPlans();
    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/portfolio/plans', async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    for (const it of items) {
      await upsertPlan(it);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/portfolio/plans/:code', async (req, res) => {
  try {
    await removePlan(req.params.code);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// =====================================================
// iFind token 健康检查（不打印 token 本体）
// =====================================================
app.get('/api/ifind/health', async (_req, res) => {
  const tk = process.env.IFIND_REFRESH_TOKEN;
  if (!tk) {
    return res.status(200).json({
      ok: false,
      reason: 'IFIND_REFRESH_TOKEN not set in env',
    });
  }
  // 拿 access_token
  try {
    const r = await fetch('https://ft.10jqka.com.cn/api/v1/get_access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: tk }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(10_000) : undefined,
    });
    const j = await r.json();
    res.json({
      ok: !!(j && j.data && j.data.access_token),
      has_access_token: !!(j && j.data && j.data.access_token),
      raw_message: j && j.message ? j.message : (j && j.msg ? j.msg : ''),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// =====================================================
// Preview
// =====================================================
app.use('/preview', express.static(PREVIEW_DIR, { maxAge: 0, etag: false }));

// 兼容根路径访问预览页
app.get('/', (_req, res) => {
  res.sendFile(path.join(PREVIEW_DIR, 'index.html'));
});

// =====================================================
// 启动
// =====================================================
async function main() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
    console.log(`[server] NEWS_SOURCE_MODE=${MODE}`);
    console.log(`[server] refresh interval: ${labelForInterval(refreshIntervalSeconds())} (${refreshIntervalSeconds()}s)`);
  });

  // 首次启动触发一次采集（异步，不阻塞）
  setTimeout(async () => {
    try {
      const holdings = await listHoldings();
      const codes = holdings.map((h) => h.stock_code);
      const summary = await refreshAll({
        db: { upsertNewsItems, recordSourceError, cleanupOldNews },
        mode: MODE,
        holdingCodes: codes,
      });
      lastRefreshAt = Date.now();
      lastRefreshSummary = summary;
      console.log(`[server] initial refresh done: telegram=${summary.telegram.items}, ann=${summary.announcements.items}, news=${summary.holdings_news.items}`);
    } catch (e) {
      console.warn(`[server] initial refresh failed: ${e.message}`);
    }
  }, 800);

  // 定时刷新（按当前时段间隔）
  setInterval(async () => {
    try {
      const holdings = await listHoldings();
      const codes = holdings.map((h) => h.stock_code);
      const summary = await refreshAll({
        db: { upsertNewsItems, recordSourceError, cleanupOldNews },
        mode: MODE,
        holdingCodes: codes,
      });
      lastRefreshAt = Date.now();
      lastRefreshSummary = summary;
      const intervalSec = refreshIntervalSeconds();
      console.log(`[server] refresh done: telegram=${summary.telegram.items}, ann=${summary.announcements.items}, news=${summary.holdings_news.items}  next=${labelForInterval(intervalSec)}`);
    } catch (e) {
      console.warn(`[server] scheduled refresh failed: ${e.message}`);
    }
  }, Math.max(60, refreshIntervalSeconds()) * 1000);
}

main().catch((e) => {
  console.error('[server] fatal:', e);
  process.exit(1);
});
