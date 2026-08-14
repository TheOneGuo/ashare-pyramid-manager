import { chromium } from 'playwright'
import sharp from 'sharp'

const FLAME = 'M0,0 C-14,-6 -20,-26 -9,-48 C-5,-56 -2,-60 0,-64 C2,-60 5,-56 9,-48 C20,-26 14,-6 0,0 Z'
let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">'
// 顶部(a=0),右(a=90),下(a=180),左(a=270) 各一簇，同款 transform
const cfg = [
  { a: 0, c: '#FF0000' },
  { a: 90, c: '#00FF00' },
  { a: 180, c: '#0000FF' },
  { a: 270, c: '#FF00FF' },
]
for (const { a, c } of cfg) {
  s += `<g transform="rotate(${a} 128 128) translate(0 -66)"><path d="${FLAME}" fill="${c}"/></g>`
}
s += '</svg>'
const html = `<!doctype html><html><body style="margin:0;background:#222">${s}</body></html>`
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 })
await p.setContent(html, { waitUntil: 'networkidle' })
const buf = await p.screenshot({ omitBackground: false })
await b.close()

const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
function cnt(x0, y0, x1, y1, pred) {
  let c = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * info.width + x) * 4
    if (pred(data[i], data[i + 1], data[i + 2])) c++
  }
  return c
}
const red = (r, g, bl) => r > 150 && g < 100 && bl < 100
const green = (r, g, bl) => r < 100 && g > 150 && bl < 100
const blue = (r, g, bl) => r < 100 && g < 100 && bl > 150
const mag = (r, g, bl) => r > 150 && g < 100 && bl > 150
console.log('TOP red   (y0-66):', cnt(0, 0, 256, 66, red))
console.log('BOTTOM blue(y190-256):', cnt(0, 190, 256, 256, blue))
console.log('LEFT mag  (x0-66):', cnt(0, 0, 66, 256, mag))
console.log('RIGHT green(x190-256):', cnt(190, 0, 256, 256, green))
