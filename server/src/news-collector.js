/**
 * News Collector · 4 档频率采集策略
 *
 * 移植自原 heatmap_app/telegram_news.py (806 行)
 *
 * 频率策略：
 *   - A 股交易时段 09:30~11:30 / 13:00~15:00: 30 秒
 *   - 日间 (8:00~24:00 非交易时段): 3 分钟
 *   - 夜盘 (21:00~次日 02:00): 5 分钟
 *   - 节假日: 10 分钟
 *
 * 数据源（生产）：
 *   - 华尔街见闻
 *   - 金十数据
 *   - FinanceNewsDaily RSS
 *
 * 开发期：NEWS_SOURCE_MODE=mock，使用本地 mock 数据
 */
import { fetchNews, upsertNews } from './db.js';
import { fetchAllReal, REAL_SOURCES } from './news-sources.js';

const MODE = (process.env.NEWS_SOURCE_MODE || 'mock').toLowerCase();
console.log(`[news-collector] mode=${MODE}`);

// ========================================================================
// 频率调度
// ========================================================================

export function pickIntervalMs(now = new Date()) {
  const h = now.getHours();
  const m = now.getMinutes();
  const day = now.getDay(); // 0=周日
  const isWeekend = day === 0 || day === 6;

  // A 股交易时段：9:30-11:30 / 13:00-15:00
  const t = h * 60 + m;
  const inMorn = t >= 9 * 60 + 30 && t <= 11 * 60 + 30;
  const inAft = t >= 13 * 60 && t <= 15 * 60;
  if (!isWeekend && (inMorn || inAft)) return 30 * 1000;

  // 夜盘
  if (h >= 21 || h < 2) return 5 * 60 * 1000;

  // 节假日（粗略判断：周末）
  if (isWeekend) return 10 * 60 * 1000;

  // 日间非交易时段
  return 3 * 60 * 1000;
}

// ========================================================================
// 数据源（生产）
// 真实源定义在 news-sources.js，全部走公开 JSON / RSS，无 API key
// ========================================================================

// ========================================================================
// Mock 数据（开发期）
// ========================================================================

const MOCK_TEMPLATES = [
  { source: '财联社', title: '央行公开市场操作净投放 1000 亿元', summary: '维护流动性合理充裕。', tags: ['宏观', '流动性'] },
  { source: '金十数据', title: '北向资金早盘净流入 38 亿元', summary: '外资持续看好 A 股核心资产。', tags: ['资金面'] },
  { source: '华尔街见闻', title: '新一期 CPI 数据同比 +0.3%，符合预期', summary: '通胀温和，关注下周 PPI。', tags: ['宏观', 'CPI'] },
  { source: '财联社', title: '新能源车板块持续走强，宁德时代涨逾 3%', summary: '行业景气度回升。', tags: ['新能源', '汽车'] },
  { source: '金十数据', title: '国常会：研究部署进一步推动西部大开发工作', summary: '政策面持续加码。', tags: ['政策'] },
  { source: '财联社', title: '工信部就智能网联汽车准入征求行业意见', summary: '推动 L3 级及以上自动驾驶落地。', tags: ['政策', '汽车'] },
  { source: '华尔街见闻', title: '美联储官员：年内或再加息一次', summary: '海外流动性预期收紧。', tags: ['海外', '美联储'] },
  { source: '金十数据', title: 'OPEC+ 维持产量配额不变', summary: '油价短期企稳。', tags: ['商品', '原油'] },
];

let mockCursor = 0;

function genMockItems() {
  const now = Date.now();
  const batch = [];
  // 每次生成 3 条新闻，每条间隔 5 分钟
  for (let i = 0; i < 3; i++) {
    const tpl = MOCK_TEMPLATES[(mockCursor + i) % MOCK_TEMPLATES.length];
    batch.push({
      id: `mock-${now}-${mockCursor + i}`,
      title: tpl.title,
      summary: tpl.summary,
      source: tpl.source,
      tags: tpl.tags,
      published_at: now - i * 5 * 60 * 1000,
      fetched_at: now,
    });
  }
  mockCursor += 3;
  return batch;
}

// ========================================================================
// 主采集循环
// ========================================================================

async function collectOnce() {
  const start = Date.now();
  let items = [];
  if (MODE === 'mock') {
    items = genMockItems();
  } else if (MODE === 'real' || MODE === 'live') {
    // 真实模式：拉 4 个公开源（财联社 / 新浪 / 东方财富 / BBC）
    items = await fetchAllReal();
  } else {
    console.warn(`[news-collector] unknown mode=${MODE}, fall back to mock`);
    items = genMockItems();
  }
  if (items.length) {
    const n = await upsertNews(items);
    console.log(`[news-collector] mode=${MODE} upserted ${n} items in ${Date.now() - start}ms`);
  } else {
    console.log(`[news-collector] mode=${MODE} got 0 items in ${Date.now() - start}ms`);
  }
  return items.length;
}

let timer = null;

export function startCollector() {
  if (timer) return;
  const tick = async () => {
    try {
      await collectOnce();
    } catch (e) {
      console.error('[news-collector] error', e);
    } finally {
      const ms = pickIntervalMs();
      timer = setTimeout(tick, ms);
    }
  };
  tick();
  console.log('[news-collector] started');
}

export function stopCollector() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

export { collectOnce, fetchNews };