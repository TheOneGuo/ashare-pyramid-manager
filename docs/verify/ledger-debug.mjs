import { listLedgerEvents, appendLedgerEvent } from 'file:///C:/Users/TheOne/.qclaw/workspace-3010ll10ltqof1lk/ashare-pyramid-manager/server/src/db.js';
import { buildAccount } from 'file:///C:/Users/TheOne/.qclaw/workspace-3010ll10ltqof1lk/ashare-pyramid-manager/server/src/account-ledger.ts';

try {
  console.log('append init...');
  const id = await appendLedgerEvent('init', { amount: 500000, fee_rate_wan: 1.2 });
  console.log('append ok id=', id);
  const events = await listLedgerEvents();
  console.log('events=', JSON.stringify(events));
  const mapped = events.map((e) => ({ type: e.type, ...e.payload }));
  console.log('mapped=', JSON.stringify(mapped));
  const snap = buildAccount(mapped, 1.2, []);
  console.log('snapshot=', JSON.stringify(snap));
} catch (e) {
  console.log('ERR:', e.message);
  console.log(e.stack);
}
