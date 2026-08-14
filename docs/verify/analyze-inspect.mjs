const BASE = 'http://localhost:9999';
const r = await fetch(BASE + '/api/portfolio/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    total_capital: 450000,
    fee_wan: 1.2,
    stocks: [{ code: '600519', name: '贵州茅台', price: 1700, cost: 1700, qty: 100 }],
    existing: [{ code: '600519', name: '贵州茅台', cost: 1700, qty: 100, cur: 1700 }],
    fee_confirmed: true,
  }),
});
const d = await r.json();
console.log(JSON.stringify(d, null, 2));
