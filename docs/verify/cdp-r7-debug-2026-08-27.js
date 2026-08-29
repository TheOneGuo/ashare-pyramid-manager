// CDP debug: 检查 Tab 1 加载状态
const ws = require('ws');
const http = require('http');

const CDP_PORT = 9333;
const H5_BASE = 'http://localhost:5173';

function getJSON(p) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${CDP_PORT}${p}`, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  const targets = await getJSON('/json');
  const page = targets.find(t => t.type === 'page');
  const sock = new ws(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  function send(method, params = {}) {
    return new Promise((resolve) => {
      const i = ++id;
      pending.set(i, resolve);
      sock.send(JSON.stringify({ id: i, method, params }));
    });
  }
  const consoleLogs = [];
  sock.on('message', (data) => {
    const m = JSON.parse(data.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); }
    else if (m.method === 'Runtime.consoleAPICalled') {
      const args = (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
      consoleLogs.push(`[${m.params.type}] ${args}`);
    } else if (m.method === 'Runtime.exceptionThrown') {
      consoleLogs.push(`[exception] ${m.params.exceptionDetails?.text || ''}`);
    } else if (m.method === 'Network.responseReceived' && m.params.response.url.includes('/api/research/reports')) {
      consoleLogs.push(`[net] ${m.params.response.status} ${m.params.response.url}`);
    }
  });
  await new Promise(r => sock.once('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 3, mobile: true });
  await send('Page.navigate', { url: `${H5_BASE}/#/pages/research/index` });
  await send('Page.reload');
  await wait(10000);

  // 检查状态
  const state = await send('Runtime.evaluate', {
    expression: `(()=>{
      const pane = Array.from(document.querySelectorAll('.rs-pane')).find(p => getComputedStyle(p).display !== 'none');
      return JSON.stringify({
        hasPane: !!pane,
        paneTag: pane?.querySelector('.rs-section-title')?.textContent,
        cardCount: pane?.querySelectorAll('.rs-report-card').length,
        datePills: pane?.querySelectorAll('.rs-fx-time-pill').length,
        brokerPills: pane?.querySelectorAll('.rs-broker-pill').length,
        emptyMsg: pane?.querySelector('.rs-empty')?.textContent,
      });
    })()`,
    returnByValue: true,
  });
  console.log('state:', state.result.value);
  console.log('last 20 console:');
  consoleLogs.slice(-20).forEach(l => console.log(' ', l));
  sock.close();
  process.exit(0);
})();
