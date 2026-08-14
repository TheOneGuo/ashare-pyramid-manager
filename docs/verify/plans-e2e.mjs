const BASE = 'http://localhost:9999';
const out = [];
async function j(url, opts) {
  const r = await fetch(BASE + url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) } });
  return { status: r.status, body: await r.json().catch(() => null) };
}
function log(...a) { out.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); }

// 先放一条持仓（已有持仓），用作 existing + stocks
await j('/api/portfolio/holdings', { method: 'POST', body: JSON.stringify({ stock_code: '600519', short_name: '贵州茅台', market: 'SH', shares: 100, cost_basis: 1700 }) });
log('seeded holding 600519');

// 分析：stocks 用 600519 成本当价，existing 同
const analyze = await j('/api/portfolio/analyze', {
  method: 'POST',
  body: JSON.stringify({
    total_capital: 450000,
    fee_wan: 1.2,
    stocks: [{ code: '600519', name: '贵州茅台', price: 1700, cost: 1700, qty: 100 }],
    existing: [{ code: '600519', name: '贵州茅台', cost: 1700, qty: 100, cur: 1700 }],
    fee_confirmed: true,
  }),
});
log('analyze ok=', analyze.body.ok, 'err=', analyze.body.error);
if (analyze.body.stocks) {
  for (const s of analyze.body.stocks) {
    log('  stock', s.code, s.name, 'plan.ok=', s.plan?.ok, 'rows=', s.plan?.rows?.length, 'tp_rows=', s.plan?.tp_rows?.length, 'total_invest=', s.plan?.total_invest);
  }
}

// 读 plans 列表（应为 analyze 后写入的 600519）
const plans = await j('/api/portfolio/plans');
log('plans count=', plans.body.items?.length, 'codes=', (plans.body.items || []).map((p) => p.stock_code).join(','));

// 删除 plans 中一项
if (plans.body.items && plans.body.items.length) {
  const code = plans.body.items[0].stock_code;
  const del = await j('/api/portfolio/plans/' + code, { method: 'DELETE' });
  log('delete plan', code, 'ok=', del.body.ok);
  const after = await j('/api/portfolio/plans');
  log('plans after delete count=', after.body.items?.length);
}

import { writeFileSync } from 'fs';
writeFileSync(new URL('./plans-e2e-result.json', import.meta.url), out.join('\n'), 'utf8');
console.log('WROTE');
