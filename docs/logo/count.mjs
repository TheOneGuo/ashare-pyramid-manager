import sharp from 'sharp'
const { data, info } = await sharp('docs/logo/_chromium-render.png').raw().toBuffer({ resolveWithObject: true })
const cx = info.width / 2, cy = info.height / 2
const quad = [0, 0, 0, 0] // TL, TR, BR, BL
for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
  const i = (y * info.width + x) * 4
  if (data[i + 3] < 40) continue
  const r = data[i], g = data[i + 1], b = data[i + 2]
  const isFire = r > 150 && g < 170 && b < 120 && (r - b) > 60
  if (!isFire) continue
  const dx = x - cx, dy = y - cy
  const rad = Math.sqrt(dx * dx + dy * dy) / (info.width / 2) * 128
  if (rad < 50 || rad > 120) continue
  const q = (dy < 0 ? 0 : 2) + (dx >= 0 ? 1 : 0)
  quad[q]++
}
console.log('fire pixels per quadrant (TL,TR,BR,BL):', quad)
console.log('balanced?', Math.max(...quad) / Math.min(...quad) < 2.5)
