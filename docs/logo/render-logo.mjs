import sharp from 'sharp'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const svg = join(__dirname, 'logo-ashare-pyramid.svg')

for (const size of [512, 1024, 256]) {
  const out = join(__dirname, `logo-ashare-pyramid-${size}.png`)
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ alphaQuality: 100 })
    .toFile(out)
  console.log('rendered', out)
}
console.log('DONE')
