import sharp from 'sharp'
import fs from 'fs'

async function main() {
  const svg = fs.readFileSync('docs/logo/logo-ashare-pyramid.svg', 'utf8')
  // librsvg 会丢弃含 <animate> 的组；静态 PNG 去掉 animate，火焰才会显示
  const staticSvg = svg.replace(/<animate[^>]*\/>/g, '')
  await sharp(Buffer.from(staticSvg), { density: 384 })
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile('docs/logo/logo-ashare-pyramid-512.png')
  // 多尺寸
  await sharp(Buffer.from(staticSvg), { density: 384 })
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile('docs/logo/logo-ashare-pyramid-256.png')
  await sharp(Buffer.from(staticSvg), { density: 384 })
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile('docs/logo/logo-ashare-pyramid-1024.png')
  console.log('rendered', fs.statSync('docs/logo/logo-ashare-pyramid-512.png').size, 'bytes (512)')
}
main().catch((e) => { console.error(e); process.exit(1) })
