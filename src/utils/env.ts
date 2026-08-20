// 环境变量统一入口
// 实际值由 vite.config.ts �?define / 编译期注入；这里给类型安全兜底�?// ⚠️ 真值绝对不要写进仓库，一律走 .env（被 .gitignore 拦掉�? .env.example 占位�?
export interface AppEnv {
  /** 后端 API base URL（uniCloud / 自托管服务）
   *  ⚠️ 默认值只用于本地 dev（H5 dev �?5173 �?9999）。生产环境必须经 vite define / 小程�?getStorageSync 显式注入�?   */
  API_BASE_URL: string
}

function read(key: keyof AppEnv, fallback = ''): string {
  // H5 �?import.meta.env
  // #ifdef H5
  const v = (import.meta as any).env?.[key]
  if (typeof v === 'string' && v.length > 0) return v
  // #endif
  // 小程�?App �?process.env / uni.getStorageSync('ENV')
  // #ifdef MP-WEIXIN || APP-PLUS
  try {
    const stored = uni.getStorageSync('ENV')
    if (stored && stored[key]) return stored[key]
  } catch {}
  // #endif
  return fallback
}

export const env: AppEnv = {
  // 本地默认 dev 后端；小程序/App 端需要经 getStorageSync('ENV').API_BASE_URL 覆盖
  API_BASE_URL: read('API_BASE_URL', 'http://localhost:9999'),
}
