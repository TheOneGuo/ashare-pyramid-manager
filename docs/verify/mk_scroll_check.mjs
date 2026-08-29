import pkg from 'file:///C:/Users/TheOne/node_modules/playwright/index.js';
const { chromium } = pkg;

const BASE = 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', m => { errors.push(m.type()+':'+m.text()); });
await page.goto(BASE + '/#/pages/market/index', { waitUntil: 'networkidle' }).catch(()=>{});
await page.waitForTimeout(3000);

const info = await page.evaluate(() => {
  const mk = document.querySelector('.mk-page');
  const head = document.querySelector('.mk-head');
  const body = document.querySelector('.mk-body');
  const h5mode = mk ? mk.classList.contains('h5-mode') : false;
  return {
    hasMk: !!mk, hasHead: !!head, hasBody: !!body, h5mode,
    headFixed: head ? getComputedStyle(head).position : null,
    bodyOverflow: body ? getComputedStyle(body).overflowY : null,
    bodyScrollbarW: body ? getComputedStyle(body).scrollbarWidth : null,
  };
});
console.log('STRUCT', JSON.stringify(info));

// Inspect chips
const chipTxt = await page.evaluate(() => [...document.querySelectorAll('.mk-source-chip')].map(e=>e.textContent.trim()));
console.log('CHIPS', JSON.stringify(chipTxt));
// Click F10 tab by index (3rd)
const tabs = await page.$$('.mk-source-chip');
if (tabs[3]) { await tabs[3].click(); }
await page.waitForTimeout(3000);
const f10 = await page.evaluate(() => {
  const years = [...document.querySelectorAll('.mk-f10-year')].map(e=>e.textContent.trim());
  const rows = document.querySelectorAll('.mk-f10-table tr, .mk-table tr, table tr').length;
  const hasTable = !!document.querySelector('.mk-f10-table, .mk-table');
  const err = document.querySelector('.mk-err') ? document.querySelector('.mk-err').textContent.trim() : null;
  return { years, rowCount: rows, hasTable, err };
});
console.log('F10', JSON.stringify(f10));
console.log('CONSOLE', JSON.stringify(errors.slice(0,12)));
console.log('ERRORS', JSON.stringify(errors.slice(0,5)));
await browser.close();
