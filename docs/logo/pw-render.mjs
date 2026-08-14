import { chromium } from 'playwright'
import fs from 'fs'

const svg = fs.readFileSync('docs/logo/logo-ashare-pyramid.svg', 'utf8')
const html = `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 2 })
await page.setContent(html, { waitUntil: 'networkidle' })
// 截整页，避免 SVG 包围盒裁剪掉伸到边界的火焰
await page.screenshot({ path: 'docs/logo/_chromium-render.png', omitBackground: true })
await browser.close()
console.log('chromium full-page render done', fs.statSync('docs/logo/_chromium-render.png').size, 'bytes')
