import { chromium } from 'playwright'
import fs from 'fs'

const FLAME = 'M0,0 C-8,-3 -11,-13 -4,-23 C-2,-27 -1,-29 0,-31 C1,-29 3,-27 5,-23 C11,-13 8,-3 0,0 Z'
const variants = {
  A: '<g transform="rotate(90 128 128)"><g transform="translate(0 -100)"><path d="'+FLAME+'" fill="#F4380C"/></g></g>',
  B: '<g transform="translate(0 -100) rotate(90 128 128)"><path d="'+FLAME+'" fill="#F4380C"/></g>',
  C: '<g transform="rotate(90,128,128) translate(0,-100)"><path d="'+FLAME+'" fill="#F4380C"/></g>',
}
let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">'
// 放3个变体在画布不同位置便于观察
s += '<g transform="translate(40 40)">' + variants.A + '</g>'
s += '<g transform="translate(140 40)">' + variants.B + '</g>'
s += '<g transform="translate(90 150)">' + variants.C + '</g>'
s += '</svg>'
const html = `<!doctype html><html><body style="margin:0;background:#222">${s}</body></html>`
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 2 })
await page.setContent(html, { waitUntil: 'networkidle' })
const el = await page.$('svg')
await el.screenshot({ path: 'docs/logo/_t-test.png' })
await browser.close()
console.log('done')
