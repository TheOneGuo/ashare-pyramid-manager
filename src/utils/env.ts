// 环境变量统一入口
// 实际值由 vite.config.ts 的 define / 编译期注入；这里给类型安全兜底。
// ⚠️ 真值绝对不要写进仓库，一律走 .env（被 .gitignore 拦掉）+ .env.example 占位。

export interface AppEnv {
  /** Turso (libsql) 数据库 URL，沿用 Foresig 项目 */
  TURSO_DATABASE_URL: string
  /** Turso 鉴权 token，敏感信息，仅运行时使用 */
  TURSO_AUTH_TOKEN: string
  /** 后端 API base URL（uniCloud / 自托管服务） */
  API_BASE_URL: string
}

function read(key: keyof AppEnv, fallback = ''): string {
  // H5 走 import.meta.env
  // #ifdef H5
  const v = (import.meta as any).env?.[key]
  if (typeof v === 'string' && v.length > 0) return v
  // #endif
  // 小程序/App 走 process.env / uni.getStorageSync('ENV')
  // #ifdef MP-WEIXIN || APP-PLUS
  try {
    const stored = uni.getStorageSync('ENV')
    if (stored && stored[key]) return stored[key]
  } catch {}
  // #endif
  return fallback
}

export const env: AppEnv = {
  TURSO_DATABASE_URL: read('TURSO_DATABASE_URL', ''),
  TURSO_AUTH_TOKEN: read('TURSO_AUTH_TOKEN', ''),
  API_BASE_URL: read('API_BASE_URL', ''),
}
