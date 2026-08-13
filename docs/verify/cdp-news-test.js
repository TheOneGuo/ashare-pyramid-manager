// 直接打开 5173 news 页，验证新版 UI 渲染
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 9334;
const USER_DIR = `C:\\Users\\TheOne\\AppData\\Local\\Temp\\cdp-news-${PORT}`;
const CHROME = `C:\\Users\\TheOne\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1208\\chrome-headless-shell-win64\\chrome-headless-shell.exe`;
const OUT = path.join(__dirname, 'news-shot.png');

function fetchJson(p) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}${p}`, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--window-size=900,1100',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USER_DIR}`,
    'about:blank'
  ], { stdio: 'pipe' });
  proc.stderr.on('data', d => process.stderr.write('[chrome] ' + d));

  for (let i = 0; i < 30; i++) {
    try { await fetchJson('/json/version'); break; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  const tabs = await fetchJson('/json');
  const tab = tabs[0];

  const { WebSocket } = require('ws');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.on('message', msg => {
    const m = JSON.parse(msg);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(m.error.message));
      else res(m.result);
    }
  });
  await new Promise(res => ws.once('open', res));

  function send(method, params = {}) {
    return new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 430, height: 932, deviceScaleFactor: 2, mobile: true
  });

  // 直接打开 news tab
  await send('Page.navigate', { url: 'http://localhost:5173/#/pages/news/index' });
  await new Promise(r => setTimeout(r, 5000));

  // 抓 DOM 关键信息
  const info = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      url: location.href,
      title: document.title,
      appHtmlLen: document.querySelector('#app')?.innerHTML?.length || 0,
      pageTitle: document.querySelector('.news-title')?.textContent || null,
      cardCount: document.querySelectorAll('.news-item').length,
      sourceChips: Array.from(document.querySelectorAll('.news-source-chip')).map(e => e.textContent.trim()),
      firstCard: (function(){
        const c = document.querySelector('.news-item');
        if (!c) return null;
        return {
          source: c.querySelector('.news-item-source')?.textContent?.trim(),
          time: c.querySelector('.news-item-time')?.textContent?.trim(),
          title: c.querySelector('.news-item-title')?.textContent?.slice(0,80),
          summary: c.querySelector('.news-item-summary')?.textContent?.slice(0,80) || '',
        };
      })(),
      emptyMsg: document.querySelector('.news-empty')?.textContent?.trim() || null,
    })`,
    returnByValue: true
  });
  console.log('INFO:', info.result?.value);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('SHOT:', OUT);

  // 抓 console / page error
  const errs = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      body: document.body.innerText.slice(0,500),
    })`,
    returnByValue: true
  });
  console.log('BODY:', errs.result?.value);

  ws.close();
  proc.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });