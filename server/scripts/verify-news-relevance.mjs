/**
 * 离线验证：用本地 Turso 快照（turso_pull.sqlite3）里的真实新闻，
 * 跑 news-relevance.js 的完整流水线（相关性 → 去重 → 配额 → 打分）。
 * 不需要网络。运行：node scripts/verify-news-relevance.mjs
 */
import { createClient } from '@libsql/client';
import { shapeNewsFeed, getProfile, SOURCE_PROFILE } from '../src/news-relevance.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = path.resolve(__dirname, '../../turso_pull.sqlite3');

// 与 index.js:58 的 TELEGRAM_CHANNELS 保持一致
const TELEGRAM_CHANNELS = ['sina_724', 'FinanceNewsDaily', 'jin10data', 'cnwallstreet', 'ywcqdz', 'cai_lian_she_1'];
// 与 portfolio_holdings 的 3 只持仓一致
const HOLDING_CODES = ['600519', '000858', '600036'];

const db = createClient({ url: `file:${DB}` });

const placeholders = TELEGRAM_CHANNELS.map(() => '?').join(',');
const { rows } = await db.execute({
  sql: `SELECT source_channel, source_name, title, summary, link, published_at
        FROM news_items
        WHERE source_channel IN (${placeholders})
        ORDER BY published_at DESC
        LIMIT 400`,
  args: TELEGRAM_CHANNELS,
});

const items = rows.map((r) => ({
  source_channel: String(r.source_channel || ''),
  source_name: String(r.source_name || r.source_channel || ''),
  title: String(r.title || ''),
  summary: String(r.summary || ''),
  link: String(r.link || ''),
  published_at: Number(r.published_at) || 0,
}));

console.log('=== 输入 ===');
console.log('快照新闻条数（近 400 条，含全部电报源）:', items.length);
const bySrc = {};
for (const it of items) bySrc[it.source_channel] = (bySrc[it.source_channel] || 0) + 1;
console.log('按源分布:', JSON.stringify(bySrc, null, 0));

// ---- A. 旧行为（filter=false）：不做去重/配额，直接截断 ----
const raw = shapeNewsFeed(items, { limit: 30, filter: false });

// ---- B. 新流水线 ----
const shaped = shapeNewsFeed(items, { limit: 30, filter: true, holding_codes: HOLDING_CODES });

console.log('\n=== 流水线统计 ===');
console.log(JSON.stringify(shaped.stats, null, 2));

console.log('\n=== 去重/配额效果（前 30 条对比）===');
const srcCount = (arr) => {
  const m = {};
  for (const it of arr) m[it.source_channel] = (m[it.source_channel] || 0) + 1;
  return m;
};
const before = srcCount(raw.items);
const after = srcCount(shaped.items);
console.log('旧(无去重)源分布:', JSON.stringify(before));
console.log('新(去重+配额)源分布:', JSON.stringify(after));
const maxBefore = Math.max(...Object.values(before)) / Math.max(1, raw.items.length);
const maxAfter = Math.max(...Object.values(after)) / Math.max(1, shaped.items.length);
console.log(`单源最高占比: ${(maxBefore * 100).toFixed(1)}% -> ${(maxAfter * 100).toFixed(1)}%`);

// 重复标题检测（旧 vs 新）
const dupTitles = (arr) => {
  const seen = new Map();
  let dup = 0;
  for (const it of arr) {
    const k = it.title.replace(/\s+/g, '').slice(0, 24);
    if (seen.has(k)) dup++;
    else seen.set(k, 1);
  }
  return dup;
};
console.log(`前30条中近似重复条数: 旧=${dupTitles(raw.items)} 新=${dupTitles(shaped.items)}`);

console.log('\n=== 打分结果（前 12 条）===');
let fail = 0;
for (const it of shaped.items.slice(0, 12)) {
  const ok = typeof it.score === 'number' && !!it.level && Array.isArray(it.reasons);
  if (!ok) fail++;
  console.log(
    `[${it.pinned ? '置顶·' : ''}${it.level}/${it.level_label || '-'}] score=${it.score} dup=${it.dup_count || 0}` +
      ` also=${JSON.stringify(it.also_in || [])} src=${it.source_channel}` +
      `\n   ${String(it.title).slice(0, 46)}` +
      `\n   reasons=${JSON.stringify(it.reasons || [])}`
  );
}

console.log('\n=== 置顶区 vs 时间流 ===');
const pinnedItems = shaped.items.filter((i) => i.pinned);
const restItems = shaped.items.filter((i) => !i.pinned);
console.log(`置顶 ${pinnedItems.length} 条 / 时间流 ${restItems.length} 条（limit=${shaped.items.length}）`);
console.log('最低置顶分:', Math.min(...pinnedItems.map((i) => i.score)), ' 最高时间流分:', Math.max(0, ...restItems.map((i) => i.score)));
console.log('时间流是否仍严格时间倒序:', restItems.every((it, i) => i === 0 || restItems[i - 1].published_at >= it.published_at));

console.log('\n=== 断言 ===');
const pinCap = Math.max(1, Math.ceil(30 * 0.4));
const checks = [
  ['打分字段完整(score/level/level_label/reasons)', shaped.items.every((i) => typeof i.score === 'number' && i.level && i.level_label && Array.isArray(i.reasons))],
  // 置顶区按「同源微惩罚后的有效分」排序，因此原始分数可能有 ±0.5*n 的回摆（设计如此，用于打散同源）
  ['置顶区按有效分(含同源惩罚)单调不增', pinnedItems.every((it, i) => {
    if (i === 0) return true;
    const seen = new Map();
    const eff = (arr) => arr.map((x) => { const n = seen.get(x.source_channel) || 0; seen.set(x.source_channel, n + 1); return x.score - n * 0.5; });
    const e = eff(pinnedItems);
    return e[i - 1] >= e[i];
  })],
  ['置顶条数 <= ceil(limit*0.4)', pinnedItems.length <= pinCap],
  ['置顶区全部 >= A 级阈值(8)', pinnedItems.every((i) => i.score >= 8)],
  ['时间流保持时间倒序', restItems.every((it, i) => i === 0 || restItems[i - 1].published_at >= it.published_at)],
  ['单源占比 <= 各自 maxRatio', Object.entries(after).every(([ch, n]) => n / shaped.items.length <= getProfile(ch).maxRatio + 0.02)],
  ['去重后无同标题重复', new Set(shaped.items.map((i) => i.title.replace(/\s+/g, ''))).size === shaped.items.length],
  ['每源都有保底份额（无源被饿死）', Object.keys(after).length >= Object.keys(before).length],
  ['去重合并生效 (merged > 0)', shaped.stats.merged > 0],
];
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) fail++;
}

console.log('\n=== 源配额配置 ===');
for (const [ch, p] of Object.entries(SOURCE_PROFILE)) {
  console.log(`  ${ch}: minPerSource=${p.minPerSource} maxRatio=${p.maxRatio}`);
}
console.log(`  (默认) 未列出源: minPerSource=${getProfile('unknown_channel').minPerSource} maxRatio=${getProfile('unknown_channel').maxRatio}`);

console.log(`\n结果: ${fail === 0 ? 'ALL PASS' : fail + ' 项失败'}`);
process.exit(fail === 0 ? 0 : 1);
