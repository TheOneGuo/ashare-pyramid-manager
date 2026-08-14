import { chromium } from 'playwright'
import fs from 'fs'

const svg = fs.readFileSync('docs/logo/logo-ashare-pyramid.svg', 'utf8')
const html = `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 2 })
await page.setContent(html, { waitUntil: 'networkidle' })
await page.screenshot({ path: 'docs/logo/_big-render.png', omitBackground: true })
await browser.close()
console.log('big render', fs.statSync('docs/logo/_big-render.png').size)
