import pkg from 'file:///C:/Users/TheOne/node_modules/playwright/index.js';
const { chromium } = pkg;

const base = 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

// 持仓页
await page.goto(base + '/#/pages/portfolio/index', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const pfBody = await page.evaluate(() => document.querySelector('.pf-body')?.innerText || '');
const cards = await page.evaluate(() => {
  const order = ['.pf-import', '.pf-ledger', '.pf-proposed', '.pf-report', '.pf-track'].map(s => {
    const el = document.querySelector(s);
    if (!el) return null;
    return { sel: s, order: getComputedStyle(el).order, title: el.querySelector('.pf-section-title,.pf-import-head')?.innerText || '' };
  }).filter(Boolean);
  return order;
});
console.log('PORTFOLIO cards order:');
cards.forEach(c => console.log('  ', c.sel, 'order=' + c.order, '|', c.title.replace(/\n/g,' ')));
console.log('PORTFOLIO has 可用保证金:', pfBody.includes('可用保证金'));
console.log('PORTFOLIO has 确认并加入跟踪 text:', pfBody.includes('确认并加入跟踪'));
console.log('PORTFOLIO has 当前聚焦/相关新闻 link:', pfBody.includes('相关新闻'));

// 新闻页 - 切到持仓相关
await page.goto(base + '/#/pages/news/index', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
// 点击持仓标的相关
const chips = await page.$$('.news-source-chip');
for (const c of chips) { const t = await c.innerText(); if (t.includes('持仓')) { await c.click(); break; } }
await page.waitForTimeout(1500);
const newsBody = await page.evaluate(() => document.querySelector('.news-body')?.innerText || '');
console.log('NEWS holding tab has 持仓标的关键词 card:', newsBody.includes('持仓标的关键词'));
console.log('NEWS console errors:', errors.length ? errors.slice(0,5) : 'none');

await browser.close();
console.log('DONE');
