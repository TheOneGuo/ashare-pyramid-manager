import { chromium } from 'playwright'
import sharp from 'sharp'

const FLAME = 'M0,0 C-7,-3 -10,-12 -4,-21 C-2,-25 -1,-27 0,-30 C1,-27 3,-25 5,-21 C10,-12 7,-3 0,0 Z'
let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">'
// 顶部、右、下、左 各一簇，用 build-logo 同款 transform
const angles = [0, 90, 180, 270]
for (const a of angles) {
  const baseR = 90
  s += `<g transform="rotate(${a} 128 128) translate(0 -${baseR})"><path d="${FLAME}" fill="#F4380C"/><path d="M0,-2 C-3,-5 -4,-11 -2,-16 C-1,-19 1,-19 2,-16 C4,-11 3,-5 0,-2 Z" fill="#FFF3B0"/></g>`
}
s += '</svg>'
const html = `<!doctype html><html><body style="margin:0;background:#222">${s}</body></html>`
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 })
await p.setContent(html, { waitUntil: 'networkidle' })
const buf = await p.screenshot({ omitBackground: false })
await b.close()

const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
function redCount(x0, y0, x1, y1) {
  let c = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * info.width + x) * 4
    if (data[i] > 150 && data[i + 1] < 120 && data[i + 2] < 120) c++
  }
  return c
}
console.log('TOP (y 0-60):', redCount(0, 0, 256, 60))
console.log('BOTTOM (y 196-256):', redCount(0, 196, 256, 256))
console.log('LEFT (x 0-60):', redCount(0, 0, 60, 256))
console.log('RIGHT (x 196-256):', redCount(196, 0, 256, 256))
console.log('CENTER (80-176):', redCount(80, 80, 176, 176))
