import * as eng from 'C:/Users/TheOne/.qclaw/workspace-3010ll10ltqof1lk/ashare-pyramid-manager/src/utils/pyramid.ts';
import { buildAccount, previewChange, checkWithdraw, TERMS } from 'C:/Users/TheOne/.qclaw/workspace-3010ll10ltqof1lk/ashare-pyramid-manager/server/src/account-ledger.ts';

console.log('eng.sumBuyCost type=', typeof eng.sumBuyCost, 'closePositionResult=', typeof eng.closePositionResult, 'maxHoldingCount=', typeof eng.maxHoldingCount);
const events = [{ type: 'init', amount: 500000, fee_rate_wan: 1.2 }];
try {
  const snap = buildAccount(events, 1.2, []);
  console.log('snapshot=', JSON.stringify(snap));
} catch (e) {
  console.log('ERR buildAccount:', e.message);
  console.log(e.stack);
}
