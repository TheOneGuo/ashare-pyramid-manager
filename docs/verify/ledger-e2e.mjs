// ledger API e2e - dump raw to file
const BASE = 'http://localhost:9999';
const out = [];
async function j(url, opts) {
  const r = await fetch(BASE + url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
function log(...a) { out.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); }

await j('/api/portfolio/ledger', { method: 'DELETE' });
log('step1 cleared');

const init = await j('/api/portfolio/ledger', {
  method: 'POST',
  body: JSON.stringify({ type: 'init', payload: { amount: 500000, fee_rate_wan: 1.2 } }),
});
log('step2 init ok=', init.body.ok, 'err=', init.body.error, 'snapshot=', init.body.snapshot);

const prev = await j('/api/portfolio/ledger/preview', {
  method: 'POST',
  body: JSON.stringify({ type: 'withdraw', amount: 100000 }),
});
log('step3 preview withdraw 100000:', JSON.stringify(prev.body.preview));

const wd = await j('/api/portfolio/ledger', {
  method: 'POST',
  body: JSON.stringify({ type: 'withdraw', payload: { amount: 100000 } }),
});
log('step4 real withdraw snapshot:', JSON.stringify(wd.body.snapshot));

const over = await j('/api/portfolio/ledger/preview', {
  method: 'POST',
  body: JSON.stringify({ type: 'withdraw', amount: 99999999 }),
});
log('step5 over-limit preview:', JSON.stringify(over.body.preview));

const dep = await j('/api/portfolio/ledger', {
  method: 'POST',
  body: JSON.stringify({ type: 'deposit', payload: { amount: 50000 } }),
});
log('step6 deposit 50000 available=', dep.body.snapshot?.available, 'total_margin=', dep.body.snapshot?.total_margin);

const get = await j('/api/portfolio/ledger');
log('step7 events:', JSON.stringify(get.body.events));
log('step7 snapshot:', JSON.stringify(get.body.snapshot));

import { writeFileSync } from 'fs';
writeFileSync(new URL('./ledger-e2e-result.json', import.meta.url), out.join('\n'), 'utf8');
console.log('WROTE result');
