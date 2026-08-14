import { chromium } from 'playwright'
import fs from 'fs'

const svg = fs.readFileSync('docs/logo/logo-ashare-pyramid.svg', 'utf8')
const html = `<!doctype html><html><body style="margin:0;background:transparent;width:512px;height:512px">${svg}</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 })
await page.setContent(html, { waitUntil: 'networkidle' })

for (const size of [256, 512, 1024]) {
  const p2 = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await p2.setContent(html, { waitUntil: 'networkidle' })
  await p2.screenshot({ path: `docs/logo/logo-ashare-pyramid-${size}.png`, omitBackground: true })
  await p2.close()
}
// 512 透明预览（用于快速查看）
await page.screenshot({ path: 'docs/logo/_chromium-render.png', omitBackground: true })
await browser.close()
console.log('rendered 256/512/1024 PNGs (transparent)')
