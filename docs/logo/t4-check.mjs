import { chromium } from 'playwright'
import sharp from 'sharp'

const FLAME = 'M0,0 C-7,-3 -10,-12 -4,-21 C-2,-25 -1,-27 0,-30 C1,-27 3,-25 5,-21 C10,-12 7,-3 0,0 Z'

// 变体1: rotate(a 128 128) translate(0 -90)
// 变体2: translate(128 128) rotate(a) translate(0 -90) translate(-128 -128)
// 变体3: 预计算终点坐标直接 translate（不用 rotate）
function place(angleDeg, mode) {
  if (mode === 1) return `rotate(${angleDeg} 128 128) translate(0 -90)`
  if (mode === 2) return `translate(128 128) rotate(${angleDeg}) translate(0 -90) translate(-128 -128)`
  if (mode === 3) {
    const r = Math.PI / 180 * angleDeg
    const x = 128 + 90 * Math.sin(r)
    const y = 128 - 90 * Math.cos(r)
    return `translate(${x.toFixed(1)} ${y.toFixed(1)})`
  }
}
let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">'
// 左上角放 mode1，右上角 mode2，下方 mode3
s += `<g transform="translate(0 0)"><g transform="${place(0,1)}"><path d="${FLAME}" fill="#F4380C"/></g></g>`
s += `<g transform="translate(120 0)"><g transform="${place(0,2)}"><path d="${FLAME}" fill="#00BFFF"/></g></g>`
s += `<g transform="translate(0 120)"><g transform="${place(0,3)}"><path d="${FLAME}" fill="#00FF00"/></g></g>`
s += '</svg>'
const html = `<!doctype html><html><body style="margin:0;background:#222">${s}</body></html>`
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 })
await p.setContent(html, { waitUntil: 'networkidle' })
const buf = await p.screenshot({ omitBackground: false })
await b.close()

const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
function count(x0, y0, x1, y1, r, g, bl) {
  let c = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * info.width + x) * 4
    if (data[i] > r && data[i + 1] < g && data[i + 2] < bl) c++
  }
  return c
}
// 左上(0,0)红, 右上(120,0)蓝, 下(0,120)绿
console.log('mode1 rotate(0 128 128) red@(0..120,0..120):', count(0, 0, 120, 120, 150, 120, 120))
console.log('mode2 translate-rotate red/blue@(120..240,0..120):', count(120, 0, 240, 120, 120, 200, 200))
console.log('mode3 precomputed green@(0..120,120..240):', count(0, 120, 120, 240, 120, 200, 120))
