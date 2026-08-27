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
import { initDb, getMode, fetchNews, fetchNewsSources, upsertNewsItems, recordSourceError, cleanupOldNews, cleanupStaleAnnouncements, listHoldingProfiles, upsertHoldingProfile, deleteHoldingProfile, upsertHolding, removeHolding, listHoldings, importHoldings, listRecommendations, upsertRecommendation, removeRecommendation, bulkSetRecommendations, compareWithRole, ROLE_LABELS } from './db.js';
import { enrichHolding, importFromText, importFromFile, fetchQuote } from './stock-service.js';
import { registerCorsAndParse, requireAuth, ifindRateLimit } from './middleware.js';
import { getProvider } from './providers/index.js';
import { getCached, setCached } from './cache.js';
import { computeTrackState } from './track-executor.js';
import { refreshAll, refreshIntervalSeconds, labelForInterval, CHANNELS } from './news-collector.js';
import { handleAnalyze } from './portfolio-analyzer.js';
import { handleExtract } from './portfolio-extract.js';
import { handleResearch, refineExternalReport, refineWithLlm, buildRefinedReport } from './research-report.js';
import {
  isFxbaogaoAvailable, fxbaogaoKeyTail,
  searchFxbaogaoReports, getFxbaogaoParagraphs, getFxbaogaoPdfUrl,
  downloadFxbaogaoPdf, extractPdfText,
} from './fxbaogao.js';
import { buildAccount, previewChange, checkWithdraw, TERMS, EVENT_DEPOSIT, EVENT_WITHDRAW, EVENT_FEE_RATE } from './account-ledger.js';
import { listLedgerEvents, appendLedgerEvent, clearLedger, upsertPlan, listPlans, removePlan,
  upsertResearchReport, listResearchReports, deleteResearchReport,
  upsertStockReport, listStockReports, deleteStockReport } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 9999);
const MODE = (process.env.NEWS_SOURCE_MODE || 'real').toLowerCase();
const PREVIEW_DIR = path.resolve(__dirname, '../../preview');

const TELEGRAM_CHANNELS = ['FinanceNewsDaily', 'jin10data', 'cnwallstreet'];

const app = express();

// CORS / JSON 解析错误 / 鉴权 中间件抽到 middleware.js 统一管理
registerCorsAndParse(app);

// 刷新互斥锁（防止并发刷新叠加打爆外部源）
let refreshing = false;

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
    const limitRaw = Number(req.query.limit);
    const sinceRaw = Number(req.query.since);
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 30;
    const since = Number.isFinite(sinceRaw) ? sinceRaw : 0;
    const holding = req.query.holding === '1' || req.query.holding === 'true';
    let items;
    if (holding) {
      const holdings = await listHoldings();
      const codes = holdings.map((h) => h.stock_code);
      items = await fetchNews({ limit, since, holding_codes: codes });
    } else {
      // 全部：仅电报三源（用户要求固定为这三个内容源，不加其他）
      items = await fetchNews({ limit, since, channels: TELEGRAM_CHANNELS });
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

app.post('/api/news/refresh', requireAuth, async (req, res) => {
  if (refreshing) return res.status(429).json({ ok: false, error: 'refresh_in_progress' });
  refreshing = true;
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
    res.status(500).json({ ok: false, error: 'internal_error' });
  } finally {
    refreshing = false;
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

app.post('/api/holdings', requireAuth, async (req, res) => {
  try {
    const { stock_code, short_name, market, shares, cost_basis } = req.body || {};
    const code = String(stock_code || '').trim();
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ ok: false, error: 'stock_code 必须为 6 位数字' });
    }
    const sh = Number(shares);
    if (!Number.isFinite(sh) || !Number.isInteger(sh) || sh <= 0) {
      return res.status(400).json({ ok: false, error: 'shares 必须为正整数' });
    }
    const cost = cost_basis == null ? 0 : Number(cost_basis);
    if (!Number.isFinite(cost) || cost < 0) {
      return res.status(400).json({ ok: false, error: 'cost_basis 必须为非负数字' });
    }
    if (short_name != null && typeof short_name !== 'string') {
      return res.status(400).json({ ok: false, error: 'short_name 必须为字符串' });
    }
    await upsertHolding({ stock_code: code, short_name, market, shares: sh, cost_basis: cost });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

app.delete('/api/holdings/:code', requireAuth, async (req, res) => {
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

app.post('/api/portfolio/recommendations', requireAuth, async (req, res) => {
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

app.post('/api/portfolio/recommendations/item', requireAuth, async (req, res) => {
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

app.delete('/api/portfolio/recommendations/:role/:code', requireAuth, async (req, res) => {
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
app.post('/api/portfolio/extract', requireAuth, async (req, res) => {
  try {
    const result = await handleExtract(req.body || {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// =====================================================
// 持仓入库（拍照/导入文件/手动）→ 富化（代码/名称/现价/盈亏）
// 等价替代 akshare：腾讯行情 + 新浪提示
// =====================================================
app.post('/api/portfolio/holdings/import', requireAuth, async (req, res) => {
  try {
    const { source, images, file_b64, file_name, text, items } = req.body || {};
    let enriched = [];
    let errors = [];
    if (source === 'manual' && Array.isArray(items) && items.length) {
      for (const it of items) {
        try { enriched.push(await enrichHolding({ code: it.code, name: it.name, cost: Number(it.cost), shares: Number(it.shares) })); }
        catch (e) { errors.push(`${it.code || it.name || '?'}：${e.message}`); }
      }
    } else if (source === 'file' && file_b64) {
      const r = await importFromFile(file_b64, file_name || 'upload', (imgs) => handleExtract({ images: imgs }));
      enriched = r.enriched; errors = r.errors;
    } else if (source === 'photo' && Array.isArray(images) && images.length) {
      const ocr = await handleExtract({ images });
      for (const p of (ocr.positions || [])) {
        try { enriched.push(await enrichHolding({ code: p.code, name: p.name, cost: Number(p.cost), shares: Number(p.qty) })); }
        catch (e) { errors.push(`${p.code || p.name || '?'}：${e.message}`); }
      }
    } else if (text) {
      const r = await importFromText(text, source || 'text');
      enriched = r.enriched; errors = r.errors;
    } else {
      return res.status(400).json({ ok: false, error: '缺少入库数据（images/file_b64/text/items）' });
    }
    const okCount = await importHoldings(enriched);
    res.json({ ok: okCount > 0, imported: okCount, total: enriched.length, errors });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 代码→名称（实时行情补全，给拟新买标的用）
app.post('/api/portfolio/resolve', async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code || !/^\d{6}$/.test(String(code).padStart(6, '0'))) return res.status(400).json({ ok: false, error: '代码格式不正确' });
    const q = await fetchQuote(String(code).padStart(6, '0'));
    if (!q) return res.json({ ok: false, name: '', price: null });
    res.json({ ok: true, name: q.name, price: q.price, code: String(code).padStart(6, '0') });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/portfolio/analyze', requireAuth, async (req, res) => {
  try {
    const result = await handleAnalyze(req.body || {});
    // 注意：分析仅返回方案，不再自动写入「持仓方案跟踪」。
    // 由前端用户在「策略方案」中点「确认并加入跟踪」后，调用 POST /api/portfolio/plans 显式加入。
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 显式「确认并加入跟踪」：前端用户在策略方案中点确认后调用
app.post('/api/portfolio/plans', requireAuth, async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    let ok = 0;
    for (const it of items) {
      if (!it || !it.stock_code || !it.plan_json) continue;
      await upsertPlan({
        stock_code: it.stock_code,
        stock_name: it.stock_name || '',
        p0: it.p0 || (it.plan_json.rows && it.plan_json.rows[0] && it.plan_json.rows[0].price) || 0,
        atr: it.atr || 0,
        atr_pct: it.plan_json.atr_pct || 0,
        total_invest: it.plan_json.total_invest || 0,
        plan_json: it.plan_json,
      });
      ok++;
    }
    res.json({ ok: true, persisted: ok });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// AI 研报解读（结构化 mock，后续接真 LLM）
app.post('/api/portfolio/research', requireAuth, async (req, res) => {
  try {
    const result = await handleResearch(req.body || {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// =====================================================
// 研报 AI 精读（外部整篇研报入库 + 提炼）
// =====================================================
app.post('/api/research/ingest', requireAuth, async (req, res) => {
  try {
    const { title, broker, industry, source_url, raw_text } = req.body || {};
    if (!raw_text || !String(raw_text).trim()) {
      return res.status(400).json({ ok: false, error: '请提供研报原文（粘贴或上传）' });
    }
    const refined = refineExternalReport({ title, broker, industry, source_url, raw_text });
    await upsertResearchReport(refined);
    res.json(refined);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/research/reports', async (_req, res) => {
  try {
    res.json({ ok: true, items: await listResearchReports() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/research/reports/:id', requireAuth, async (req, res) => {
  try {
    await deleteResearchReport(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 已持仓标的 AI 研报（十二模块）：持久化 / 列表 / 删除
app.post('/api/research/stock-report', requireAuth, async (req, res) => {
  try {
    const { stock_code, stock_name, report } = req.body || {};
    if (!stock_code) return res.status(400).json({ ok: false, error: '缺少 stock_code' });
    await upsertStockReport({ stock_code, stock_name, report_json: report });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/research/stock-reports', async (_req, res) => {
  try {
    res.json({ ok: true, items: await listStockReports() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/research/stock-reports/:code', requireAuth, async (req, res) => {
  try {
    await deleteStockReport(req.params.code);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// =====================================================
// 发现报告 (fxbaogao.com) 搜索 + 段落 + PDF + AI 精读
// 凭证：FXBAOGAO_API_KEY 走 server/.env
// =====================================================

// 探针：前端可用来判断 fxbaogao 是否可用 + LLM 是否可用
app.get('/api/research/fxbaogao/status', async (_req, res) => {
  res.json({
    ok: true,
    fxbaogao: { available: isFxbaogaoAvailable(), keyTail: fxbaogaoKeyTail() },
  });
});

// 1) 搜索（按关键词 / 时间范围 / 机构）
app.get('/api/research/fxbaogao/search', async (req, res) => {
  try {
    if (!isFxbaogaoAvailable()) return res.status(503).json({ ok: false, error: 'FXBAOGAO_API_KEY 未配置' })
    const keywords = String(req.query.keywords || '').trim()
    const startTime = String(req.query.startTime || req.query.timeRange || 'last1mon')
    const endTime = req.query.endTime ? String(req.query.endTime) : undefined
    const pageNum = Math.min(Math.max(Number(req.query.pageNum) || 1, 1), 10)
    const orgNames = req.query.orgNames ? String(req.query.orgNames).split(',').map((s) => s.trim()).filter(Boolean) : undefined
    const items = await searchFxbaogaoReports({ keywords, startTime, endTime, pageNum, orgNames })
    res.json({ ok: true, items, count: items.length, pageNum, startTime, keywords })
  } catch (e) {
    console.warn('[fxbaogao search]', e?.message || e)
    res.status(500).json({ ok: false, error: e?.message || '搜索失败' })
  }
})

// 2) 摘要/目录/命中段（结构化正文）
app.get('/api/research/fxbaogao/paragraphs', async (req, res) => {
  try {
    if (!isFxbaogaoAvailable()) return res.status(503).json({ ok: false, error: 'FXBAOGAO_API_KEY 未配置' })
    const reportId = Number(req.query.reportId)
    const keyword = String(req.query.keyword || '').trim()
    if (!reportId) return res.status(400).json({ ok: false, error: 'reportId 必填' })
    const data = await getFxbaogaoParagraphs({ reportId, keyword })
    res.json({ ok: true, ...data })
  } catch (e) {
    console.warn('[fxbaogao paragraphs]', e?.message || e)
    res.status(500).json({ ok: false, error: e?.message || '获取段落失败' })
  }
})

// 3) 拿 PDF 直链（前端用这个去浏览器原生下载）
app.get('/api/research/fxbaogao/pdf-url', async (req, res) => {
  try {
    if (!isFxbaogaoAvailable()) return res.status(503).json({ ok: false, error: 'FXBAOGAO_API_KEY 未配置' })
    const reportId = Number(req.query.reportId)
    if (!reportId) return res.status(400).json({ ok: false, error: 'reportId 必填' })
    const url = await getFxbaogaoPdfUrl({ reportId })
    res.json({ ok: true, reportId, url, viewUrl: `https://www.fxbaogao.com/view?id=${reportId}` })
  } catch (e) {
    console.warn('[fxbaogao pdf-url]', e?.message || e)
    res.status(500).json({ ok: false, error: e?.message || '获取 PDF 链接失败' })
  }
})

// 4) 一键 AI 精读入研报库：下载 PDF → 抽文本 → LLM 提炼 → 入 research_reports
app.post('/api/research/fxbaogao/ingest', requireAuth, async (req, res) => {
  try {
    if (!isFxbaogaoAvailable()) return res.status(503).json({ ok: false, error: 'FXBAOGAO_API_KEY 未配置' })
    const { reportId, industry, forceReDownload } = req.body || {}
    if (!reportId) return res.status(400).json({ ok: false, error: 'reportId 必填' })
    // 拿元信息（从搜索缓存或重新搜一次以拿到 title/broker）
    const id = Number(reportId)
    const viewUrl = `https://www.fxbaogao.com/view?id=${id}`
    // 先在最近 1mon 搜索里找
    let meta = null
    try {
      // 多关键词兜底：last3mon + 空关键词 + last1mon + 高频关键词
      for (const q of ['', '评级 目标价', '公司研究', '行业研究']) {
        const list = await searchFxbaogaoReports({ keywords: q, startTime: 'last3mon', pageNum: 1 })
        meta = list.find((r) => r.reportId === id)
        if (meta) break
      }
    } catch {}
    const title = meta?.title || `发现报告 #${id}`
    const broker = meta?.orgName || '外部研报'
    // 1) PDF → 文本
    let rawText = ''
    let pdfStatus = ''
    try {
      const buf = await downloadFxbaogaoPdf({ reportId: id })
      rawText = await extractPdfText(buf, 24000)
      pdfStatus = rawText.length > 200 ? 'ok' : 'too_short'
    } catch (e) {
      pdfStatus = 'pdf_failed:' + (e?.message || '').slice(0, 80)
    }
    // 2) LLM 提炼（有 key 才调；失败走 mock 兜底）
    let llmResult = null
    if (rawText.length > 200) {
      try { llmResult = await refineWithLlm({ raw_text: rawText, title, broker, industry }) }
      catch (e) { console.warn('[fxbaogao ingest] llm failed', e?.message || e) }
    }
    // 3) 入库
    const refined = buildRefinedReport({
      title, broker,
      industry: industry || '',
      source_url: viewUrl,
      raw_text: rawText || `[fxbaogao reportId=${id}，PDF 解析失败：${pdfStatus}]`,
      llmResult,
    })
    await upsertResearchReport(refined)
    res.json({
      ok: true,
      report: refined,
      pdf_status: pdfStatus,
      llm_used: llmResult?.mode === 'llm',
      raw_text_chars: rawText.length,
    })
  } catch (e) {
    console.warn('[fxbaogao ingest]', e?.message || e)
    res.status(500).json({ ok: false, error: e?.message || '精读失败' })
  }
})

// 5) 为持仓批量搜最近卖方研报
app.post('/api/research/fxbaogao/auto-search-holdings', requireAuth, async (req, res) => {
  try {
    if (!isFxbaogaoAvailable()) return res.status(503).json({ ok: false, error: 'FXBAOGAO_API_KEY 未配置' })
    const { holdings, timeRange } = req.body || {}
    if (!Array.isArray(holdings) || holdings.length === 0) {
      return res.status(400).json({ ok: false, error: 'holdings 必填' })
    }
    const startTime = String(timeRange || 'last1mon')
    const results = []
    for (const h of holdings) {
      const code = String(h.stock_code || h.code || '').padStart(6, '0').slice(-6)
      const name = String(h.short_name || h.name || '').trim()
      if (!code && !name) continue
      // 关键词策略：代码 + 名称 + "评级 目标价" 提质
      const keywords = [code, name, '评级 目标价'].filter(Boolean).join(' ')
      try {
        const items = await searchFxbaogaoReports({ keywords, startTime, pageNum: 1 })
        // 过滤：机构在常用卖方名单里
        const BROKERS = ['高盛', '摩根士丹利', '摩根大通', '瑞银', '美银', '花旗', '汇丰', '中金', '中信建投', '中信证券', '华泰', '国泰君安', '海通', '广发', '招商', '申万宏源', '浙商', '国信', '东方', '国金', '兴业', '东吴', '开源', '天风', '中泰', '国海', '西部', '平安', '安信', '长城', '长江', '光大']
        const buySide = items.filter((it) => BROKERS.some((b) => it.orgName.includes(b)))
        results.push({ code, name, count: buySide.length, items: buySide.slice(0, 5) })
      } catch (e) {
        results.push({ code, name, count: 0, items: [], error: e?.message || 'search failed' })
      }
    }
    res.json({ ok: true, results, timeRange: startTime })
  } catch (e) {
    console.warn('[fxbaogao auto-search]', e?.message || e)
    res.status(500).json({ ok: false, error: e?.message || 'auto search failed' })
  }
})

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
app.post('/api/portfolio/ledger', requireAuth, async (req, res) => {
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
app.post('/api/portfolio/ledger/preview', requireAuth, async (req, res) => {
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
app.delete('/api/portfolio/ledger', requireAuth, async (_req, res) => {
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

app.delete('/api/portfolio/plans/:code', requireAuth, async (req, res) => {
  try {
    await removePlan(req.params.code);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// =====================================================
// 持仓产业链画像（可编辑，间接关联匹配用）
// =====================================================
app.get('/api/portfolio/holding-profiles', async (_req, res) => {
  try {
    const list = await listHoldingProfiles();
    res.json({ ok: true, profiles: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/portfolio/holding-profiles', requireAuth, async (req, res) => {
  try {
    const { stock_code, raw_materials, products, customers, overseas_peers, policy_domains, transport, extra_keywords } = req.body || {};
    if (!stock_code) return res.status(400).json({ ok: false, error: 'stock_code 必填' });
    const arr = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean) : (String(v || '').split(/[,，\n]/).map((s) => s.trim()).filter(Boolean)));
    await upsertHoldingProfile({
      stock_code,
      raw_materials: arr(raw_materials),
      products: arr(products),
      customers: arr(customers),
      overseas_peers: arr(overseas_peers),
      policy_domains: arr(policy_domains),
      transport: arr(transport),
      extra_keywords: arr(extra_keywords),
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/portfolio/holding-profiles/:code', requireAuth, async (req, res) => {
  try {
    await deleteHoldingProfile(req.params.code);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// =====================================================
// iFind token 健康检查（不打印 token 本体）
// =====================================================
app.get('/api/ifind/health', requireAuth, async (_req, res) => {
  if (!ifindRateLimit()) {
    return res.status(429).json({ ok: false, error: 'too_frequent' });
  }
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
// 行情数据（akshare provider 抽象层，开发期走 akshare-service）
// 这些为只读查询，不写库、不鉴权；失败自动降级为 503，前端可回退现有直连源
// =====================================================
function marketHandler(kind, fn) {
  return async (req, res) => {
    try {
      const hit = getCached(kind, req);
      if (hit !== undefined) {
        res.json({ ...hit, cached: true });
        return;
      }
      const data = await fn(req);
      setCached(kind, req, data);
      res.json({ ...data, cached: false });
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  };
}

app.get('/api/market/hist', marketHandler('hist', (req) =>
  getProvider().getHist(String(req.query.code || ''), {
    period: req.query.period, start: req.query.start, end: req.query.end,
    adjust: req.query.adjust, limit: req.query.limit ? Number(req.query.limit) : undefined,
  })));
app.get('/api/market/north', marketHandler('north', (req) =>
  getProvider().getNorth(req.query.limit ? Number(req.query.limit) : 60)));
app.get('/api/market/lhb', marketHandler('lhb', (req) =>
  getProvider().getLhb(String(req.query.date || ''), req.query.limit ? Number(req.query.limit) : 50)));
app.get('/api/market/f10', marketHandler('f10', (req) =>
  getProvider().getF10(String(req.query.code || ''), req.query.kind || 'indicator', req.query.limit ? Number(req.query.limit) : 40)));

// =====================================================
// 启动
// =====================================================
// 全局兜底错误处理器：统一返回 JSON，不泄漏内部实现细节
app.use((err, _req, res, _next) => {
  console.error('[server] unhandled error:', err && err.message);
  if (res.headersSent) return _next(err);
  res.status(500).json({ ok: false, error: 'internal_error' });
});

async function main() {
  await initDb();
  // 清理旧版采集写入的脏公告行（source_name='t' / 旧 guid 格式 ann:CODE:TS:IDX）
  cleanupStaleAnnouncements().then((ok) => console.log('[server] cleanup stale announcements:', ok ? 'done' : 'skipped')).catch(() => {});
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
  // 定时刷新：自调度 setTimeout，每次执行后按当前时段重新算间隔，避免启动后永久不变
  let refreshTimer = null;
  async function scheduledRefresh() {
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
    } finally {
      const intervalSec = Math.max(60, refreshIntervalSeconds());
      refreshTimer = setTimeout(scheduledRefresh, intervalSec * 1000);
    }
  }
  refreshTimer = setTimeout(scheduledRefresh, Math.max(60, refreshIntervalSeconds()) * 1000);

  // 持仓方案跟踪轮询（实时价 → 自动执行 → 写回持仓）
  setInterval(runTrackOnce, TRACK_POLL_MS);
  // 启动后 5s 跑一次，尽快体现跟踪
  setTimeout(runTrackOnce, 5000);
}

// =====================================================
// 持仓方案跟踪：持续采集实时价 → 到价位自动执行 → 写回已有持仓列表
// 间隔 60s（与行情刷新解耦，独立轻量轮询）
// =====================================================
const TRACK_POLL_MS = 60_000;

async function runTrackOnce() {
  try {
    const plans = await listPlans();
    if (!plans.length) return;
    for (const p of plans) {
      const code = p.stock_code;
      const q = await fetchQuote(code);
      if (!q || !q.price) continue;
      await updatePlanPrice(code, q.price, Date.now());
      const state = computeTrackState(p, q.price);
      // 未到建仓价前不写入持仓（避免把持仓清零），清仓时保留 0 股记录
      if (!state.opened && !state.cleared) continue;
      await importHoldings([{
        code,
        name: p.stock_name || q.name,
        cost: state.avg_cost || p.p0,
        shares: state.shares,
        current_price: q.price,
      }]);
      if (state.cleared) {
        console.log(`[track] ${code} 已清仓（实时价 ${q.price}）`);
      }
    }
  } catch (e) {
    console.warn('[track] loop error:', e.message);
  }
}

main().catch((e) => {
  console.error('[server] fatal:', e);
  process.exit(1);
});
