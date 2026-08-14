import { chromium } from 'playwright'
import fs from 'fs'

const test = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <radialGradient id="fg" cx="50%" cy="86%" r="82%">
      <stop offset="0%" stop-color="#FFF6C2"/>
      <stop offset="34%" stop-color="#FFD23E"/>
      <stop offset="70%" stop-color="#F4380C"/>
      <stop offset="100%" stop-color="#B80E00"/>
    </radialGradient>
  </defs>
  <g transform="translate(50 95)">
    <path d="M0,0 C-8,-3 -11,-13 -4,-23 C-2,-27 -1,-29 0,-31 C1,-29 3,-27 5,-23 C11,-13 8,-3 0,0 Z" fill="url(#fg)"/>
  </g>
</svg>`

const html = `<!doctype html><html><body style="margin:0;background:transparent">${test}</body></html>`
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 100, height: 100 }, deviceScaleFactor: 2 })
await page.setContent(html, { waitUntil: 'networkidle' })
const el = await page.$('svg')
await el.screenshot({ path: 'docs/logo/_flame-test.png', omitBackground: true })
await browser.close()
console.log('done', fs.statSync('docs/logo/_flame-test.png').size)
