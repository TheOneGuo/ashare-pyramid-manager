import { chromium } from 'playwright'
import sharp from 'sharp'

const FLAME = 'M0,0 C-9,-4 -13,-16 -5,-28 C-3,-33 -1,-36 0,-39 C1,-36 4,-33 6,-28 C13,-16 9,-4 0,0 Z'

// 4 个变体放在画布四角附近，静态 translate（不 rotate）
const cases = {
  TL: { transform: 'translate(128 24)' },          // 顶部，无 rotate
  TR: { transform: 'translate(232 128)' },         // 右侧
  BL: { transform: 'translate(24 128)' },          // 左侧
  BR: { transform: 'rotate(0 128 128) translate(0 -104)' }, // 顶部带 rotate+translate
}
let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">'
for (const k in cases) {
  s += `<g transform="${cases[k].transform}"><path d="${FLAME}" fill="#F4380C"/></g>`
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
console.log('TL translate top red:', redCount(108, 0, 148, 60))
console.log('TR translate right red:', redCount(212, 108, 252, 148))
console.log('BL translate left red:', redCount(4, 108, 44, 148))
console.log('BR rotate+translate top red:', redCount(108, 0, 148, 60))
