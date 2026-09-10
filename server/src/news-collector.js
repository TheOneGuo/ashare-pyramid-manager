// news-collector.js — 整合多个新闻源，按 4 档频率策略调度
//
// 数据源：
//  1. 电报 RSS（7×24 全市场中文快讯，金十/华尔街见闻/财经Daily/格隆汇）
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
import { fetchSinaLive, CHANNEL_META as SINA_META } from './sina-live.js';
import * as em from './eastmoney.js';
import * as macro from './macro-news.js';
import { HOLDING_NEWS_CHANNELS } from './db.js';
import { writeGuarded, retryWithTimeout, flushSpool, spoolStats, NEWS_WRITE_SPOOL } from './write-guard.js';

const SECONDS = {
  TRADING: 15 * 60,
  DAYTIME: 60 * 60,
  NIGHT: 4 * 60 * 60,
  HOLIDAY: 8 * 60 * 60,
};

const NEWS_RETENTION_HOURS = 24;

function mockGuid(channel, title, i){let h=0;const s=channel+":"+title;for(let k=0;k<s.length;k++){h=(h*31+s.charCodeAt(k))>>>0;}return channel+":mock:"+h+":"+i;}
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
// 说明：新浪 7×24 为轻量直连请求，采集成本低；为让快讯接近实时，
// 非交易时段的上限压到 15 分钟（原 1h/4h/8h 过慢）。
function refreshIntervalSeconds(now = new Date()) {
  const policy = (() => {
    if (!isTradeDayShanghai(now)) return SECONDS.HOLIDAY;
    if (inTradingSessionShanghai(now)) return SECONDS.TRADING;
    // 日间 vs 夜间按小时判断
    const sh = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
    const m = sh.getHours() * 60 + sh.getMinutes();
    if (m >= 8 * 60 && m < 22 * 60) return SECONDS.DAYTIME;
    return SECONDS.NIGHT;
  })();
  return Math.min(policy, SECONDS.TRADING);
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
  if (channel === 'ywcqdz') {
    return [
      { title: `【格隆汇】${ts} 港股通标的名单调整今日生效 多只科技股获纳入`, summary: '格隆汇快讯：港股通标的名单调整今日生效，多只科技股获纳入，相关标的成交活跃。', link: 'https://t.me/ywcqdz/1', published_at: now - 45_000 },
      { title: `【格隆汇】${ts} 南向资金今日净买入超50亿港元`, summary: '格隆汇快讯：南向资金今日净买入超50亿港元，连续多日净流入。', link: 'https://t.me/ywcqdz/2', published_at: now - 3 * 60_000 },
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
    macro: { refreshed: 0, fetched: 0, items: 0, errors: [] },
    write_failed: 0,
    write_spooled: 0,
  };

  // =====================================================
  // 0-pre) 先补写上一轮因 Turso 抖动落盘的批次（幂等，重放无副作用）
  // =====================================================
  try {
    const r = await flushNewsWriteSpool(db, log);
    if (r.flushed) summary.spool_flushed = r.flushed;
    if (r.kept) summary.spool_pending = r.kept;
  } catch (e) {
    summary.write_errors = [`spool_flush: ${e?.message}`];
  }

  // =====================================================
  // 0) 新浪 7×24（国内直连，不依赖代理；电报被墙时的主快讯源）
  // =====================================================
  try {
    summary.telegram.refreshed++; // 复用 telegram 桶展示
    if (mode === 'mock' || mode === 'hybrid') {
      // mock 模式跳过
    } else {
      const r = await fetchSinaLive({ pageSize: 60, log });
      if (r.items.length > 0) {
        const w = await upsertNews(db, {
          source_channel: SINA_META.channel,
          source_name: SINA_META.name,
          feed_url: r.usedUrl,
          items: r.items,
          now_ts: now,
          last_error: '',
        });
        if (w.ok) {
          summary.telegram.fetched++;
          summary.telegram.items += r.items.length;
        } else {
          tallyWriteFailure(summary, SINA_META.channel, r.items.length, w);
        }
      }
    }
  } catch (e) {
    summary.telegram.errors.push(`sina_724: ${e.message}`);
    try {
      await recordSourceError(db, SINA_META, 'https://zhibo.sina.com.cn/api/zhibo/feed', e.message, now);
    } catch {}
  }

  // =====================================================
  // 1) 电报多源（见 telegram-rss.js 的 CHANNELS；需代理 NEWS_PROXY_URL；失败不影响 sina 主源）
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
          guid: mockGuid(channelMeta.channel, it.title, i),
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
        const w = await upsertNews(db, {
          source_channel: channelMeta.channel,
          source_name: channelMeta.name,
          feed_url: usedUrl,
          items,
          now_ts: now,
          last_error: '',
        });
        if (w.ok) {
          summary.telegram.fetched++;
          summary.telegram.items += items.length;
        } else {
          // 写入彻底失败：计数字段不再虚报，同时把原因带出来，便于 /api/news/status 一眼看到
          tallyWriteFailure(summary, channelMeta.channel, items.length, w);
        }
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
  // 1.5) 宏观/产业链数据源（商品期货行情 + 新浪滚动新闻）
  // 不按持仓过滤；商品/地缘/政策新闻通常不出现股票名，统一打标后由持仓分支经画像关键词命中
  // =====================================================
  try {
    summary.macro.refreshed++;
    if (mode === 'mock' || mode === 'hybrid') {
      // mock 模式跳过真实拉取
    } else {
      const items = await macro.fetchAllMacro();
      if (items.length > 0) {
        // 商品期货按品种分别 upsert（每个 commodity 一个 source_channel，便于后续扩展）
        const byCh = new Map();
        for (const it of items) {
          if (!byCh.has(it.source_channel)) byCh.set(it.source_channel, []);
          byCh.get(it.source_channel).push(it);
        }
        for (const [ch, chItems] of byCh) {
          await upsertNews(db, {
            source_channel: ch,
            source_name: chItems[0].source_name,
            feed_url: 'https://push2.eastmoney.com/',
            items: chItems,
            now_ts: now,
            last_error: '',
          });
        }
        summary.macro.fetched++;
        summary.macro.items += items.length;
      }
    }
  } catch (e) {
    summary.macro.errors.push(e.message);
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
            guid: `ann:${code}:mock:${i}`,
            title: it.title,
            summary: it.summary,
            link: it.link,
            published_at: it.published_at,
            raw: { mock: true, stock_code: code },
          }));
        } else {
          try {
            const list = await em.fetchAnnouncements(code, { pageSize: 10 });
            // 逐条补公告正文 + PDF（详情接口），失败不影响标题/摘要入库
            annItems = await Promise.all(list.map((it) => em.enrichAnnouncement(it)));
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
            guid: `news:${code}:mock:${i}`,
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
  // 收尾清理失败不影响本轮采集结果，加超时避免无限期挂住整个 refresh
  try {
    await retryWithTimeout(
      () => db.cleanupOldNews(now - NEWS_RETENTION_HOURS * 3600_000, HOLDING_NEWS_CHANNELS),
      { delays: [0, 800], timeoutMs: WRITE_TIMEOUT_MS, label: 'cleanupOldNews' },
    );
  } catch (e) {
    summary.write_errors = [...(summary.write_errors || []), `cleanup: ${e?.message}`];
  }

  return summary;
}

function labelForInterval(sec) {
  if (sec === SECONDS.TRADING) return '交易时段 · 15分钟';
  if (sec === SECONDS.DAYTIME) return '交易日日间 · 1小时';
  if (sec === SECONDS.NIGHT) return '交易日夜间 · 4小时';
  return '休市日 · 8小时';
}

// 策略标签（反映 15 分钟上限压缩后的实际节奏）
function refreshLabel(now = new Date()) {
  if (!isTradeDayShanghai(now)) return '休市日 · 上限15分钟';
  if (inTradingSessionShanghai(now)) return '交易时段 · 15分钟';
  const sh = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const m = sh.getHours() * 60 + sh.getMinutes();
  if (m >= 8 * 60 && m < 22 * 60) return '交易日日间 · 上限15分钟';
  return '交易日夜间 · 上限15分钟';
}

// =====================================================
// DB 写入辅助（经 write-guard 加固：硬超时 + 退避重试 + 全失败落 spool）
// 目的：Turso（东京）抖动时不再「静默丢弃整轮采集」，也不允许 await 永久悬停。
// =====================================================
// 写超时：Turso 走代理，单次 batch 往返一般 0.5~3s；15s 给足冷连接余量。
// 配合 db.upsertNewsItems 的 batch 写（往返次数 N→1），正常一轮远低于该值。
const WRITE_TIMEOUT_MS = Number(process.env.NEWS_WRITE_TIMEOUT_MS || 15000);
const WRITE_DELAYS = [0, 800, 2000];

async function upsertNews(db, { source_channel, source_name, feed_url, items, now_ts, last_error }) {
  if (typeof db.upsertNewsItems !== 'function') return { ok: false, skipped: true };
  const payload = { source_channel, source_name, feed_url, items, now_ts, last_error };
  const r = await writeGuarded((p) => db.upsertNewsItems(p), payload, {
    label: `upsertNews:${source_channel}`,
    timeoutMs: WRITE_TIMEOUT_MS,
    delays: WRITE_DELAYS,
    spoolFile: NEWS_WRITE_SPOOL,
    onFail: (e, i) => console.warn(`[news] ${source_channel} 写入第${i + 1}次失败: ${e?.message?.slice(0, 90)}`),
  });
  if (r.ok) return r;
  console.warn(
    `[news] ${source_channel} 写入 ${r.attempts} 次全失败` +
    `${r.spooled ? '，已落 spool 待下轮补写' : '，且 spool 落盘失败（本批已丢）'}: ${r.error?.slice(0, 90)}`,
  );
  return r;
}

/** 源状态写入属于「诊断信息」，失败不落 spool，最多重试 2 次后放弃。 */
async function recordSourceError(db, channelMeta, feed_url, error, now_ts) {
  if (typeof db.recordSourceError !== 'function') return;
  await retryWithTimeout(
    () => db.recordSourceError({
      source_channel: channelMeta.channel,
      source_name: channelMeta.name,
      feed_url,
      last_error: error,
      now_ts,
    }),
    { delays: [0, 600], timeoutMs: 5000, label: `recordSourceError:${channelMeta.channel}` },
  );
}

/** 写入彻底失败时统一记账：不虚报 items，并把失败原因暴露给状态接口 */
function tallyWriteFailure(summary, channel, n, w) {
  if (w.spooled) {
    summary.write_spooled = (summary.write_spooled || 0) + 1;
    summary.telegram?.errors?.push(`${channel}: 写入失败已落 spool 待补写(${n}条) ${w.error || ''}`.trim());
  } else {
    summary.write_failed = (summary.write_failed || 0) + 1;
    summary.telegram?.errors?.push(`${channel}: 写入失败且未落盘，丢失 ${n} 条 (${w.error || 'unknown'})`);
  }
}

/** 回放上一轮落盘的写入批次（Turso 恢复后补写；news_items 幂等 upsert，不会重复） */
export async function flushNewsWriteSpool(db, log = console) {
  if (typeof db?.upsertNewsItems !== 'function') return { flushed: 0, kept: 0 };
  const say = (m) => (typeof log?.log === 'function' ? log.log(m) : console.log(m));
  return flushSpool(
    NEWS_WRITE_SPOOL,
    // 补写时把 now_ts 换成当前时间：否则 fetched_at 仍是旧时间戳，可能被「近 24 小时」过滤掉
    (entry) => db.upsertNewsItems({ ...(entry?.payload || {}), now_ts: Date.now() }),
    { log: say, max: 30, timeoutMs: WRITE_TIMEOUT_MS },
  );
}

/** 未补写的积压批次数量（诊断用，暴露到 /api/news/status） */
export function newsWriteSpoolStats() {
  return spoolStats(NEWS_WRITE_SPOOL);
}

export {
  refreshAll,
  refreshIntervalSeconds,
  refreshLabel,
  inTradingSessionShanghai,
  isTradeDayShanghai,
  labelForInterval,
  CHANNELS,
  NEWS_RETENTION_HOURS,
};
