import { chromium } from 'playwright'
import fs from 'fs'

const FLAME = 'M0,0 C-8,-3 -11,-13 -4,-23 C-2,-27 -1,-29 0,-31 C1,-29 3,-27 5,-23 C11,-13 8,-3 0,0 Z'
let flames = ''
for (let i = 0; i < 8; i++) {
  const a = 45 * i
  flames += `<g transform="rotate(${a} 128 128) translate(0 -100)"><path d="${FLAME}" fill="#F4380C"/></g>\n`
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><circle cx="128" cy="128" r="96" stroke="#D4AF37" stroke-width="12" fill="none"/>${flames}</svg>`
const html = `<!doctype html><html><body style="margin:0;background:#222">${svg}</body></html>`
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 2 })
await page.setContent(html, { waitUntil: 'networkidle' })
const el = await page.$('svg')
await el.screenshot({ path: 'docs/logo/_ring-test.png' })
await browser.close()
console.log('done')
