const BASE = 'http://localhost:9999';
const out = [];
async function j(url, opts) {
  const r = await fetch(BASE + url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) } });
  return { status: r.status, body: await r.json().catch(() => null) };
}
function log(...a) { out.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); }

// 招商银行 ~38元，可开4档
const analyze = await j('/api/portfolio/analyze', {
  method: 'POST',
  body: JSON.stringify({
    total_capital: 450000,
    fee_wan: 1.2,
    stocks: [{ code: '600036', name: '招商银行', price: 38, cost: 38, qty: 300 }],
    existing: [{ code: '600036', name: '招商银行', cost: 38, qty: 300, cur: 38 }],
    fee_confirmed: true,
  }),
});
log('analyze ok=', analyze.body.ok);
for (const s of analyze.body.stocks || []) {
  log('  stock', s.code, 'plan.ok=', s.plan?.ok, 'rows=', s.plan?.rows?.length, 'tp_rows=', s.plan?.tp_rows?.length, 'total_invest=', s.plan?.total_invest, 'too_expensive=', s.plan?.too_expensive);
}

const plans = await j('/api/portfolio/plans');
log('plans count=', plans.body.items?.length, 'codes=', (plans.body.items || []).map((p) => p.stock_code + '/' + p.stock_name).join(','));
if (plans.body.items && plans.body.items[0]) {
  const it = plans.body.items[0];
  log('  first plan_json rows=', it.plan_json?.rows?.length, 'tp_rows=', it.plan_json?.tp_rows?.length, 'p0=', it.p0, 'atr=', it.atr);
}

import { writeFileSync } from 'fs';
writeFileSync(new URL('./plans-viable-result.json', import.meta.url), out.join('\n'), 'utf8');
console.log('WROTE');
