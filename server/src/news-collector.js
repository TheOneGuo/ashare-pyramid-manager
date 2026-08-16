// news-collector.js — 整合多个新闻源，按 4 档频率策略调度
//
// 数据源：
//  1. 电报 RSS（7×24 全市场中文快讯，金十/华尔街见闻/财经Daily）
//  2. 东方财富公告（仅采集「持仓标的」的公告）
//  3. 东方财富个股新闻（仅采集「持仓标的」的相关新闻）
//
// 4 档采集频率（移植自原项目 telegram_news.get_news_refresh_policy）：
//   - 交易时段 09:30-11:30 / 13:00-15:00 → 15min
//   - 交易日日间  → 1h
//   - 交易日夜间  → 4h
//   - 休市日      → 8h
//
// 模式：
//   MODE=mock  → 内置 mock 数据（开发）
//   MODE=real  → 真实源（生产）
//   MODE=hybrid → 真实源 + 持仓过滤（推荐）

import { CHANNELS, fetchOneSource } from './telegram-rss.js';
import * as em from './eastmoney.js';

const SECONDS = {
  TRADING: 15 * 60,
  DAYTIME: 60 * 60,
  NIGHT: 4 * 60 * 60,
  HOLIDAY: 8 * 60 * 60,
};

const NEWS_RETENTION_HOURS = 24;
const HOLIDAY_CHECK_URL = 'https://www.sse.com.cn/disclosure/dealinstruc/closed/list/';

// 简化版：判定 A 股是否交易日（不调 SSE，先按 weekday）
// 实际部署需配合 trade_calendar.js 实现
function isTradeDayShanghai(now = new Date()) {
  const sh = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const dow = sh.getDay();
  return dow >= 1 && dow <= 5; // 周一到周五（忽略节假日先简化）
}

// 判断当前是否处于连续竞价时段（9:30-11:30, 13:00-15:00）
function inTradingSessionShanghai(now = new Date()) {
  const sh = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const m = sh.getHours() * 60 + sh.getMinutes();
  const morning = m >= 9 * 60 + 30 && m < 11 * 60 + 30;
  const afternoon = m >= 13 * 60 && m < 15 * 60;
  return morning || afternoon;
}

// 判断当前时段类别，返回对应刷新间隔
function refreshIntervalSeconds(now = new Date()) {
  if (!isTradeDayShanghai(now)) return SECONDS.HOLIDAY;
  if (inTradingSessionShanghai(now)) return SECONDS.TRADING;
  // 日间 vs 夜间按小时判断
  const sh = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const m = sh.getHours() * 60 + sh.getMinutes();
  if (m >= 8 * 60 && m < 22 * 60) return SECONDS.DAYTIME;
  return SECONDS.NIGHT;
}

// =====================================================
// Mock 数据（开发用）
// =====================================================
function mockNewsForChannel(channelMeta) {
  const now = Date.now();
  const ts = new Date(now).toLocaleTimeString('zh-CN', { hour12: false });
  const channel = channelMeta.channel;
  if (channel === 'jin10data') {
    return [
      { title: `【金十数据】${ts} 美联储官员讲话重申通胀仍是关注重点`, summary: '美联储官员在最新讲话中重申通胀仍是当前政策关注重点，市场对降息节奏预期出现分歧。', link: 'https://t.me/jin10data/1', published_at: now - 60_000 },
      { title: `【金十数据】${ts} OPEC+ 维持产量政策 油价小幅收涨`, summary: 'OPEC+ 会议维持当前产量政策不变，国际油价小幅收涨。', link: 'https://t.me/jin10data/2', published_at: now - 5 * 60_000 },
    ];
  }
  if (channel === 'cnwallstreet') {
    return [
      { title: `【华尔街见闻】${ts} A股午后冲高回落 创业板指收红`, summary: '今日 A 股三大指数走势分化，创业板指收红，沪指小幅下跌。', link: 'https://t.me/cnwallstreet/1', published_at: now - 120_000 },
    ];
  }
  // FinanceNewsDaily
  return [
    { title: `【财经Daily】${ts} 北向资金今日净流入30亿元`, summary: '北向资金今日净流入30亿元，主要流入白酒、新能源板块。', link: 'https://t.me/FinanceNewsDaily/1', published_at: now - 30_000 },
    { title: `【财经Daily】${ts} 央行公开市场操作净投放1000亿`, summary: '央行今日开展1000亿元逆回购操作，实现净投放。', link: 'https://t.me/FinanceNewsDaily/2', published_at: now - 90_000 },
  ];
}

function mockAnnouncementsForCode(code) {
  const now = Date.now();
  return [
    { title: `【${code}】关于2026年中期分红派息实施公告`, summary: '公司2026年中期分红派息方案已获股东大会通过', link: 'https://data.eastmoney.com/', published_at: now - 60_000 },
    { title: `【${code}】2026年半年度报告`, summary: '半年度报告', link: 'https://data.eastmoney.com/', published_at: now - 4 * 3600_000 },
  ];
}

// =====================================================
// 主调度：一次完整刷新（被定时器 / API 调用）
// =====================================================
async function refreshAll({ db, mode = 'real', holdingCodes = [], log = console } = {}) {
  const intervalSec = refreshIntervalSeconds();
  const now = Date.now();
  const summary = {
    refreshed_at: now,
    interval_seconds: intervalSec,
    mode_label: labelForInterval(intervalSec),
    telegram: { refreshed: 0, fetched: 0, items: 0, errors: [] },
    holdings_news: { refreshed: 0, items: 0, errors: [] },
    announcements: { refreshed: 0, items: 0, errors: [] },
  };

  // =====================================================
  // 1) 电报 3 源
  // =====================================================
  for (const channelMeta of CHANNELS) {
    summary.telegram.refreshed++;
    let items = [];
    let usedUrl = '';
    let errors = [];
    try {
      if (mode === 'mock' || mode === 'hybrid') {
        // mock 模式用 mock
        const m = mockNewsForChannel(channelMeta);
        items = m.map((it, i) => ({
          guid: `${channelMeta.channel}:mock:${now}:${i}`,
          title: it.title,
          summary: it.summary,
          content: it.summary,
          link: it.link,
          published_at: it.published_at,
          raw: { mock: true },
        }));
        usedUrl = `mock://${channelMeta.channel}`;
      } else {
        const r = await fetchOneSource(channelMeta, { log });
        items = r.items;
        usedUrl = r.usedUrl;
        errors = r.errors;
      }
      if (items.length > 0) {
        await upsertNews(db, {
          source_channel: channelMeta.channel,
          source_name: channelMeta.name,
          feed_url: usedUrl,
          items,
          now_ts: now,
          last_error: '',
        });
        summary.telegram.fetched++;
        summary.telegram.items += items.length;
      } else if (errors.length > 0) {
        await recordSourceError(db, channelMeta, usedUrl, errors.join('; '), now);
        summary.telegram.errors.push(`${channelMeta.channel}: ${errors[0]}`);
      }
    } catch (e) {
      summary.telegram.errors.push(`${channelMeta.channel}: ${e.message}`);
      await recordSourceError(db, channelMeta, usedUrl || '', e.message, now);
    }
  }

  // =====================================================
  // 2) 持仓标的相关 — 公告 + 个股新闻
  // =====================================================
  if (holdingCodes && holdingCodes.length > 0) {
    for (const code of holdingCodes) {
      // 公告
      try {
        summary.announcements.refreshed++;
        let annItems = [];
        let annErr = '';
        if (mode === 'mock' || mode === 'hybrid-mock-an') {
          annItems = mockAnnouncementsForCode(code).map((it, i) => ({
            source_channel: `eastmoney_announcement_${code}`,
            source_name: `东方财富·公告·${code}`,
            guid: `ann:${code}:${now}:${i}`,
            title: it.title,
            summary: it.summary,
            link: it.link,
            published_at: it.published_at,
            raw: { mock: true, stock_code: code },
          }));
        } else {
          try {
            const list = await em.fetchAnnouncements(code, { pageSize: 10 });
            annItems = list.map((it) => ({ ...it, source_channel: `eastmoney_announcement_${code}` }));
          } catch (e) { annErr = e.message; }
        }
        if (annItems.length > 0) {
          await upsertNews(db, {
            source_channel: `eastmoney_announcement_${code}`,
            source_name: `东方财富·公告·${code}`,
            feed_url: 'https://np-anotice-stock.eastmoney.com/api/security/ann',
            items: annItems,
            now_ts: now,
            last_error: annErr,
          });
          summary.announcements.fetched++;
          summary.announcements.items += annItems.length;
        } else if (annErr) {
          summary.announcements.errors.push(`ann:${code}: ${annErr}`);
        }
      } catch (e) {
        summary.announcements.errors.push(`ann:${code}: ${e.message}`);
      }

      // 个股新闻
      try {
        summary.holdings_news.refreshed++;
        let newsItems = [];
        let newsErr = '';
        if (mode === 'mock' || mode === 'hybrid-mock-news') {
          newsItems = mockAnnouncementsForCode(code).map((it, i) => ({
            source_channel: `eastmoney_stock_news_${code}`,
            source_name: `东方财富·新闻·${code}`,
            guid: `news:${code}:${now}:${i}`,
            title: `[新闻] ${it.title}`,
            summary: it.summary,
            link: it.link,
            published_at: it.published_at,
            raw: { mock: true, stock_code: code },
          }));
        }
        // 注：real 模式跳过英文 Yahoo 个股新闻采集（用户要求持仓相关仅中文、无英文）；
        // 中文个股新闻接口（东财/Sina/同花顺/QQ）当前均不可用。间接关联改由持仓 tab
        // 经产业链画像关键词命中宏观电报实现。
        if (newsItems.length > 0) {
          await upsertNews(db, {
            source_channel: `eastmoney_stock_news_${code}`,
            source_name: `东方财富·新闻·${code}`,
            feed_url: 'https://np-listapi.eastmoney.com/comm/web/getListInfo',
            items: newsItems,
            now_ts: now,
            last_error: newsErr,
          });
          summary.holdings_news.fetched++;
          summary.holdings_news.items += newsItems.length;
        } else if (newsErr) {
          summary.holdings_news.errors.push(`news:${code}: ${newsErr}`);
        }
      } catch (e) {
        summary.holdings_news.errors.push(`news:${code}: ${e.message}`);
      }
    }
  }

  // 清理过期（持仓相关公告/个股新闻因发布时间可能很早，不参与清理）
  await db.cleanupOldNews(now - NEWS_RETENTION_HOURS * 3600_000, db.HOLDING_NEWS_CHANNELS);

  return summary;
}

function labelForInterval(sec) {
  if (sec === SECONDS.TRADING) return '交易时段 · 15分钟';
  if (sec === SECONDS.DAYTIME) return '交易日日间 · 1小时';
  if (sec === SECONDS.NIGHT) return '交易日夜间 · 4小时';
  return '休市日 · 8小时';
}

// =====================================================
// DB 写入辅助（调用 db.js 提供的接口）
// =====================================================
async function upsertNews(db, { source_channel, source_name, feed_url, items, now_ts, last_error }) {
  if (typeof db.upsertNewsItems === 'function') {
    await db.upsertNewsItems({ source_channel, source_name, feed_url, items, now_ts, last_error });
  }
}

async function recordSourceError(db, channelMeta, feed_url, error, now_ts) {
  if (typeof db.recordSourceError === 'function') {
    await db.recordSourceError({
      source_channel: channelMeta.channel,
      source_name: channelMeta.name,
      feed_url,
      last_error: error,
      now_ts,
    });
  }
}

export {
  refreshAll,
  refreshIntervalSeconds,
  inTradingSessionShanghai,
  isTradeDayShanghai,
  labelForInterval,
  CHANNELS,
  NEWS_RETENTION_HOURS,
};
