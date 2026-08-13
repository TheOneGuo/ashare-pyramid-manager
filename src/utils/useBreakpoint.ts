// useBreakpoint — 折叠屏/横竖屏 断点检测
// 仅在 H5 / App 端可用；小程序端可用 uni.upx2px + 监听 onWindowResize 改造。
import { ref, onMounted, onBeforeUnmount } from 'vue'

export type Bp = 'base' | 'sm' | 'md' | 'lg' | 'xl'

const BP_THRESHOLDS: Array<[Bp, number]> = [
  ['xl', 1200],
  ['lg', 900],
  ['md', 600],
  ['sm', 400],
]

function pickBp(width: number): Bp {
  for (const [name, threshold] of BP_THRESHOLDS) {
    if (width >= threshold) return name
  }
  return 'base'
}

/** 简化版断点检测（仅 H5 / App 端）。 */
export function useBreakpoint() {
  const current = ref<Bp>('base')

  function update() {
    // #ifdef H5 || APP-PLUS
    const w = typeof window !== 'undefined' ? window.innerWidth : 375
    current.value = pickBp(w)
    // #endif
  }

  onMounted(() => {
    update()
    // #ifdef H5
    window.addEventListener('resize', update)
    // #endif
  })

  onBeforeUnmount(() => {
    // #ifdef H5
    window.removeEventListener('resize', update)
    // #endif
  })

  return { current }
}
