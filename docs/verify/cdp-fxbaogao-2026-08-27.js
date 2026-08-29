// CDP 验证：fxbaogao 3 号 sub-tab（直板机 + 折叠屏）
// 流程：
//   1) 直板机 iPhone · 切到研究页 · 切 3 号 tab
//   2) 搜索「600519 评级」→ 截图结果列表
//   3) 点开第 1 个报告（高盛茅台）→ 截图详情
//   4) 点「获取 PDF 直链」→ 截图 PDF 下载区
//   5) 点「为持仓搜卖方」→ 截图分组结果
//   6) 折叠屏 832×741 · 同样跑一遍
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
  const consoleMsgs = [];
  sock.on('message', (data) => {
    const m = JSON.parse(data.toString());
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result || m.error);
      pending.delete(m.id);
    } else if (m.method === 'Runtime.consoleAPICalled') {
      const args = (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
      consoleMsgs.push(`[${m.params.type}] ${args}`);
    } else if (m.method === 'Runtime.exceptionThrown') {
      consoleMsgs.push(`[exception] ${m.params.exceptionDetails?.text || ''}`);
    }
  });
  await new Promise(r => sock.once('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const outDir = path.resolve(__dirname);

  async function goResearch() {
    await send('Page.navigate', { url: `${H5_BASE}/#/pages/research/index` });
    await send('Page.reload');
    await wait(5000);
  }
  async function clickFxTab() {
    // tab index 2 = 发现报告
    await send('Runtime.evaluate', {
      expression: `(()=>{ const t=document.querySelectorAll('.rs-tab')[2]; if(t) t.click(); })()`,
    });
    await wait(1500);
  }
  async function snapshotPng(name) {
    const png = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, name), Buffer.from(png.data, 'base64'));
    console.log('  saved:', name);
  }
  async function runSearch() {
    // 填关键词 + 点搜索
    await send('Runtime.evaluate', {
      expression: `(()=>{
        const i = document.querySelector('.rs-input');
        if (i) { i.value='600519 评级'; i.dispatchEvent(new Event('input', { bubbles:true })); }
        const btns = Array.from(document.querySelectorAll('.rs-btn'));
        const b = btns.find(x => x.textContent.includes('搜索') && !x.textContent.includes('为持仓'));
        if (b) b.click();
      })()`,
    });
    await wait(8000);
  }
  async function expandFirst() {
    // 选 fxbaogao pane 里的第一个报告卡（避开 hidden 的其他 tab）
    await send('Runtime.evaluate', {
      expression: `(()=>{
        const panes = document.querySelectorAll('.rs-pane');
        // fxbaogao pane 一定是可见的（active tab）
        for (const p of panes) {
          if (p.style.display === 'none' || p.offsetParent === null) continue;
          const h = p.querySelector('.rs-report-card .rs-report-head');
          if (h) { h.click(); return 'clicked: ' + (p.querySelector('.rs-report-title')?.textContent || ''); }
        }
        return 'NOT FOUND';
      })()`,
      returnByValue: true,
    });
    await wait(5000);
  }
  async function clickGetPdf() {
    await send('Runtime.evaluate', {
      expression: `(()=>{
        const panes = document.querySelectorAll('.rs-pane');
        for (const p of panes) {
          if (p.style.display === 'none' || p.offsetParent === null) continue;
          const btns = Array.from(p.querySelectorAll('.rs-btn'));
          const b = btns.find(x => x.textContent.includes('获取 PDF'));
          if (b) { b.click(); return 'clicked PDF'; }
        }
        return 'NOT FOUND';
      })()`,
      returnByValue: true,
    });
    await wait(4000);
  }
  async function runAutoSearch() {
    await send('Runtime.evaluate', {
      expression: `(()=>{ const btns=Array.from(document.querySelectorAll('.rs-btn')); const b=btns.find(x=>x.textContent.includes('为持仓')); if(b) b.click(); })()`,
    });
    await wait(25000); // 5 holdings × 5s
  }

  // === 1) iPhone 15 Pro Max ===
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 3, mobile: true });
  await goResearch();
  await clickFxTab();
  await snapshotPng('fxbaogao-r5-empty-iPhone.png');

  // 2) 搜索结果
  await runSearch();
  const searchInfo = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      tab: document.querySelector('.rs-tab--active')?.textContent.trim(),
      resultCount: document.querySelectorAll('.rs-report-card').length,
      firstThree: Array.from(document.querySelectorAll('.rs-report-title')).slice(0,3).map(t=>t.textContent.trim()),
      orgs: Array.from(document.querySelectorAll('.rs-fx-org')).slice(0,5).map(t=>t.textContent.trim()),
    })`,
    returnByValue: true,
  });
  console.log('iPhone search:', searchInfo.result.value);
  await snapshotPng('fxbaogao-r5-search-iPhone.png');

  // 3) 展开第 1 个
  await expandFirst();
  const detailInfo = await send('Runtime.evaluate', {
    expression: `(()=>{
      // scope 到可见的 pane
      const pane = Array.from(document.querySelectorAll('.rs-pane')).find(p => getComputedStyle(p).display !== 'none');
      if (!pane) return JSON.stringify({err:'no visible pane'});
      return JSON.stringify({
        paneTag: pane.querySelector('.rs-section-title')?.textContent.trim(),
        hasSummary: !!pane.querySelector('.rs-tldr-body'),
        summaryText: (pane.querySelector('.rs-tldr-body')?.textContent || '').slice(0, 100),
        hasPdfBtn: !!Array.from(pane.querySelectorAll('.rs-btn')).find(b=>b.textContent.includes('获取 PDF')),
        hasAiBtn: !!Array.from(pane.querySelectorAll('.rs-btn')).find(b=>b.textContent.includes('AI 精读入库')),
        pdfUrlLoaded: !!pane.querySelector('.rs-fx-download-url'),
        cardCount: pane.querySelectorAll('.rs-report-card').length,
        expandedCount: pane.querySelectorAll('.rs-report-body').length,
      });
    })()`,
    returnByValue: true,
  });
  console.log('iPhone detail:', detailInfo.result.value);
  await snapshotPng('fxbaogao-r5-detail-iPhone.png');

  // 4) 触发 PDF 直链
  await clickGetPdf();
  const pdfInfo = await send('Runtime.evaluate', {
    expression: `(()=>{
      const pane = Array.from(document.querySelectorAll('.rs-pane')).find(p => getComputedStyle(p).display !== 'none');
      if (!pane) return JSON.stringify({err:'no pane'});
      return JSON.stringify({
        pdfUrl: pane.querySelector('.rs-fx-download-url')?.textContent.slice(0, 100),
      });
    })()`,
    returnByValue: true,
  });
  console.log('iPhone pdf:', pdfInfo.result.value);
  await snapshotPng('fxbaogao-r5-pdf-iPhone.png');

  // 5) 为持仓搜
  await runAutoSearch();
  const autoInfo = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      groupCount: document.querySelectorAll('.rs-fx-group').length,
      groupHeads: Array.from(document.querySelectorAll('.rs-fx-group-name')).map(t=>t.textContent.trim()),
      groupCounts: Array.from(document.querySelectorAll('.rs-fx-group-count')).map(t=>t.textContent.trim()),
    })`,
    returnByValue: true,
  });
  console.log('iPhone auto:', autoInfo.result.value);
  await snapshotPng('fxbaogao-r5-auto-iPhone.png');

  // === 6) 折叠屏 ===
  console.log('\n--- folded 832x741 ---');
  await send('Emulation.setDeviceMetricsOverride', { width: 832, height: 741, deviceScaleFactor: 3, mobile: true });
  await goResearch();
  await clickFxTab();
  await snapshotPng('fxbaogao-r5-empty-folded.png');

  await runSearch();
  await snapshotPng('fxbaogao-r5-search-folded.png');
  await expandFirst();
  await snapshotPng('fxbaogao-r5-detail-folded.png');

  console.log('\n--- console (last 8) ---');
  consoleMsgs.slice(-8).forEach(m => console.log('  ', m));

  sock.close();
  process.exit(0);
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
