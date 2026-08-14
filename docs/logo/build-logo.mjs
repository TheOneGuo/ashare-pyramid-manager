import fs from 'fs'

// 火焰单元：基部在 0,0，向上（局部 -y）至 0,-60，总长 60，半宽 ~19（大且厚，明显火舌）
const FLAME = 'M0,0 C-14,-6 -20,-26 -9,-48 C-5,-56 -2,-60 0,-64 C2,-60 5,-56 9,-48 C20,-26 14,-6 0,0 Z'
const CORE = 'M0,-4 C-6,-10 -8,-26 -4,-42 C-1,-49 1,-49 4,-42 C8,-26 6,-10 0,-4 Z'

// 把火焰路径的点绕原点旋转 ang 度（火焰默认指向 -y/上），返回新 path 字符串
function rotatePath(d, ang) {
  const r = Math.PI / 180 * ang
  const ca = Math.cos(r), sa = Math.sin(r)
  // 解析 M/C 命令中的数字对
  const out = d.replace(/([MLC])([^A-Z]*)/g, (m, cmd, rest) => {
    const pts = rest.trim().split(/[\s,]+/).map(Number)
    const np = []
    for (let k = 0; k < pts.length; k += 2) {
      const x = pts[k], y = pts[k + 1]
      np.push((x * ca - y * sa).toFixed(2), (x * sa + y * ca).toFixed(2))
    }
    return cmd + np.join(' ')
  })
  return out
}

// 14 簇大火焰：把火焰几何直接旋转朝外 + 平移到环上（全程仅用 translate，避开 Chromium 对 rotate 的异常）
let flames = ''
const N = 14
for (let i = 0; i < N; i++) {
  const a = (360 / N) * i
  const rad = Math.PI / 180 * a
  const baseR = 58 + (i % 2 === 0 ? 0 : 5)        // 58 / 63 基部骑在环内侧
  const bx = 128 + baseR * Math.sin(rad)
  const by = 128 - baseR * Math.cos(rad)
  const sy = 0.92 + ((i * 37) % 10) / 40          // 0.92~1.17 高度
  const sx = 1.05 + ((i * 53) % 8) / 36           // 1.05~1.27 宽度
  // 火焰需朝外：默认指向上(-y)，绕中心 a 度后向外；再叠加左右倾斜 sway
  const sway = (Math.sin(i * 1.7) * 0.5) * 8
  const rot = a + sway
  const flamePath = rotatePath(FLAME, rot)
  const corePath = rotatePath(CORE, rot)
  flames += `  <g transform="translate(${bx.toFixed(2)} ${by.toFixed(2)}) scale(${sx.toFixed(2)} ${sy.toFixed(2)})">\n`
  flames += `    <path d="${flamePath}" fill="url(#flameGrad)"/>\n`
  flames += `    <path d="${corePath}" fill="#FFF3B0" opacity="0.9"/>\n`
  flames += `    <animate attributeName="opacity" values="0.78;1;0.6;0.95;0.78" dur="${(0.85 + (i % 5) * 0.12).toFixed(2)}s" repeatCount="indefinite"/>\n`
  flames += `  </g>\n`
  flames += `    <path d="${FLAME}" fill="url(#flameGrad)"/>\n`
  flames += `    <path d="${CORE}" fill="#FFF3B0" opacity="0.9"/>\n`
  flames += `    <animate attributeName="opacity" values="0.78;1;0.6;0.95;0.78" dur="${(0.85 + (i % 5) * 0.12).toFixed(2)}s" repeatCount="indefinite"/>\n`
  flames += `  </g>\n`
}

// 金字塔 4 层坐标（apex 82, base 174, 半宽 44，置于金环内 r≤58）
const tiers = [
  { pts: '128,82 138.8,106 117.2,106', grad: 'url(#tierTop)', hl: '128,82 122.6,97 133.4,97' },
  { pts: '117.2,106 138.8,106 150,132 106,132', grad: 'url(#tier)', hl: '117.2,106 113,118 138.8,106' },
  { pts: '106,132 150,132 161.6,158 94.4,158', grad: 'url(#tier)', hl: '106,132 101.6,146 150,132' },
  { pts: '94.4,158 161.6,158 172,184 84,184', grad: 'url(#tier)', hl: '94.4,158 90,172 161.6,158' },
]
let polys = ''
let hls = ''
let lines = ''
const segLines = [
  '122.6,97 133.4,97', '112,118 145,118 114.4,127 142.6,127',
  '101.6,146 155.4,146 104.2,155 152.8,155', '90,172 166,172 92,180 164,180',
]
for (const t of tiers) {
  polys += `  <polygon points="${t.pts}" fill="${t.grad}" stroke="#6E4E10" stroke-width="1"/>\n`
  hls += `  <polygon points="${t.hl}" fill="#FFF1D0" opacity="0.22"/>\n`
}
for (const l of segLines) {
  const [a, b] = l.split(' ')
  lines += `  <line x1="${a.split(',')[0]}" y1="${a.split(',')[1]}" x2="${b.split(',')[0]}" y2="${b.split(',')[1]}" stroke="#6E4E10" stroke-width="0.8" opacity="0.5"/>\n`
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" fill="none">
  <defs>
    <linearGradient id="flameGrad" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#FFF6C2"/>
      <stop offset="32%" stop-color="#FFD23E"/>
      <stop offset="68%" stop-color="#F4380C"/>
      <stop offset="100%" stop-color="#B80E00"/>
    </linearGradient>
    <linearGradient id="goldRing" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFF4C0"/>
      <stop offset="0.25" stop-color="#FFE27A"/>
      <stop offset="0.5" stop-color="#F4C542"/>
      <stop offset="0.75" stop-color="#D89C1C"/>
      <stop offset="1" stop-color="#FBD968"/>
    </linearGradient>
    <linearGradient id="tier" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#FFE9B8"/>
      <stop offset="0.45" stop-color="#E9AE32"/>
      <stop offset="1" stop-color="#9C6F12"/>
    </linearGradient>
    <linearGradient id="tierTop" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#FFF4D6"/>
      <stop offset="0.5" stop-color="#F6D276"/>
      <stop offset="1" stop-color="#BD881F"/>
    </linearGradient>
  </defs>

  <!-- 火氛围红晕（弱化，让火焰更跳） -->
  <circle cx="128" cy="128" r="110" fill="#FF3B12" opacity="0.03"/>

  <!-- 火轮：14 簇火焰绕金环 -->
${flames}

  <!-- 加粗金属金环（r=70，外缘~84，明显更厚更抢眼） -->
  <circle cx="128" cy="128" r="70" stroke="url(#goldRing)" stroke-width="20" fill="none"/>
  <circle cx="128" cy="128" r="60" stroke="#6E4E10" stroke-width="1.4" opacity="0.55" fill="none"/>
  <circle cx="128" cy="128" r="80" stroke="#6E4E10" stroke-width="1.2" opacity="0.5" fill="none"/>
  <!-- 高光弧 -->
  <path d="M 58 80 A 80 80 0 0 1 150 40" stroke="#FFF6CE" stroke-width="4" opacity="0.85" fill="none" stroke-linecap="round"/>

  <!-- 4 层正金字塔 -->
${polys}${hls}${lines}</svg>
`

fs.writeFileSync('docs/logo/logo-ashare-pyramid.svg', svg)
console.log('wrote svg', svg.length, 'bytes')
