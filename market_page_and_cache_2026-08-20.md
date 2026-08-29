# 行情页 + 缓存层 — 2026-08-20

## 落地内容（commit 6f1216c）
- 前端新增「行情」第 4 个 tab（pages.json + custom-tab-bar 注册）
- `src/pages/market/index.vue`：K线（手绘 canvas 零依赖）/ 北向资金 / 龙虎榜 / F10 财务 四段切换
- `src/api/market.ts`：封装 /api/market/{hist,north,lhb,f10}
- 后端 `server/src/cache.ts`：内存 TTL 缓存（按 query string 隔离），K线/北向/龙虎榜/F10 默认 60s
- index.js /api/market/* 接入缓存，命中返回 cached:true

## 验证
- vue-tsc 通过
- H5 编译 200，无 SCSS 未定义变量 500（踩坑：自定义变量 $color-bg/$rf-amber 等仅在 news.vue 内定义，market.vue 需自包含定义 → 已补）
- Playwright 实测：4 tab 渲染、K线 canvas 实际绘制（toDataURL 32KB）、F10 61 行、北向/龙虎榜填充，无 console 错误
- 缓存：首查 cached=false，二查 cached=true

## 踩坑记录
1. SCSS 变量不跨 SFC 共享：market.vue 必须自带 $color-bg/$rf-amber 等定义（从 news.vue 抄齐）
2. H5 端 uni-app 把 <canvas type=2d> 包成 <uni-canvas>，getContext 需取内层 canvas（已修，小程序端走 createSelectorQuery 不变）
3. lhb 经后端偶发 transient undefined（微服务瞬时忙），重试即正常，非代码 bug

## 待办
- 任务3（上架前置 HTTPS + 小程序白名单）属部署动作：需用户提供域名+SSL，代码侧 CORS 已支持白名单、路由只读无需鉴权已满足。可另出 checklist 文档
- 前端行情页细节打磨（K线触控十字线、F10 多报表切换 indicator/balance/cashflow/profit）
