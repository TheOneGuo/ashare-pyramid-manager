import { chromium } from 'playwright'
import sharp from 'sharp'

const FLAME = 'M0,0 C-8,-3 -11,-13 -4,-23 C-2,-27 -1,-29 0,-31 C1,-29 3,-27 5,-23 C11,-13 8,-3 0,0 Z'
const v = {
  A: '<g transform="rotate(90 128 128)"><g transform="translate(0 -100)"><path d="' + FLAME + '" fill="#F4380C"/></g></g>',
  B: '<g transform="translate(0 -100) rotate(90 128 128)"><path d="' + FLAME + '" fill="#F4380C"/></g>',
  C: '<g transform="rotate(90,128,128) translate(0,-100)"><path d="' + FLAME + '" fill="#F4380C"/></g>',
}
let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">'
s += '<g transform="translate(40 40)">' + v.A + '</g>'
s += '<g transform="translate(140 40)">' + v.B + '</g>'
s += '<g transform="translate(90 150)">' + v.C + '</g>'
s += '</svg>'
const html = `<!doctype html><html><body style="margin:0;background:#222">${s}</body></html>`
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 })
await p.setContent(html, { waitUntil: 'networkidle' })
const buf = await (await p.$('svg')).screenshot({ omitBackground: true })
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
console.log('A translate(40,40) redCount:', redCount(20, 20, 90, 110))
console.log('B translate(140,40) redCount:', redCount(120, 20, 200, 110))
console.log('C translate(90,150) redCount:', redCount(70, 130, 150, 230))
