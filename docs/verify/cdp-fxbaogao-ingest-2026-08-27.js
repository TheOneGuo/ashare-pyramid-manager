// CDP 验证：fxbaogao 一键 AI 精读入库流程
const ws = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

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
  sock.on('message', (data) => {
    const m = JSON.parse(data.toString());
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result || m.error);
      pending.delete(m.id);
    }
  });
  await new Promise(r => sock.once('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const outDir = path.resolve(__dirname);

  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 3, mobile: true });

  // 去研究页 + 切 fxbaogao
  await send('Page.navigate', { url: `${H5_BASE}/#/pages/research/index` });
  await send('Page.reload');
  await wait(5000);
  await send('Runtime.evaluate', {
    expression: `(()=>{ const t=document.querySelectorAll('.rs-tab')[2]; if(t) t.click(); })()`,
  });
  await wait(1500);

  // 搜 600519 + 评级
  await send('Runtime.evaluate', {
    expression: `(()=>{
      const i = document.querySelector('.rs-input');
      if (i) { i.value='600519'; i.dispatchEvent(new Event('input', { bubbles:true })); }
      const b = Array.from(document.querySelectorAll('.rs-btn')).find(x => x.textContent.trim()==='✦ 搜索');
      if (b) b.click();
    })()`,
  });
  await wait(7000);

  // 展开第 1 个（应该是高盛茅台或浙商茅台）
  await send('Runtime.evaluate', {
    expression: `(()=>{
      const pane = Array.from(document.querySelectorAll('.rs-pane')).find(p => getComputedStyle(p).display !== 'none');
      const h = pane?.querySelector('.rs-report-card .rs-report-head');
      if (h) h.click();
    })()`,
  });
  await wait(3000);

  // 点 AI 精读入库
  console.log('--- click AI 精读入库 ---');
  await send('Runtime.evaluate', {
    expression: `(()=>{
      const pane = Array.from(document.querySelectorAll('.rs-pane')).find(p => getComputedStyle(p).display !== 'none');
      const b = Array.from(pane.querySelectorAll('.rs-btn')).find(x => x.textContent.includes('AI 精读入库'));
      if (b) b.click();
    })()`,
  });
  // PDF 下载 + LLM 提炼需要 30-60s
  await wait(60000);

  // 截图入库结果
  const png = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, 'fxbaogao-r5-ingested-iPhone.png'), Buffer.from(png.data, 'base64'));
  console.log('saved: fxbaogao-r5-ingested-iPhone.png');

  // 看入库状态
  const state = await send('Runtime.evaluate', {
    expression: `(()=>{
      const pane = Array.from(document.querySelectorAll('.rs-pane')).find(p => getComputedStyle(p).display !== 'none');
      if (!pane) return JSON.stringify({err:'no pane'});
      const tldr = pane.querySelector('.rs-report-body .rs-tldr-body')?.textContent.trim();
      const kps = Array.from(pane.querySelectorAll('.rs-report-body .rs-li-text')).map(t=>t.textContent.trim().slice(0,80));
      const ingested = pane.querySelector('.rs-block-label')?.textContent;
      return JSON.stringify({ tldr: (tldr||'').slice(0,200), kpCount: kps.length, firstKp: kps[0], label: ingested });
    })()`,
    returnByValue: true,
  });
  console.log('ingested state:', state.result.value);

  sock.close();
  process.exit(0);
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
