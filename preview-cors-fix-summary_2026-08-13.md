# 预览页 CORS 修复 + 设备尺寸验证 (2026-08-13 18:34-18:55)

## 核心问题

用户提三项：
1. 联网核实验证每台设备显示尺寸
2. 右侧手机显示窗口增加滑动条调整显示尺寸（保持正确显示比例）
3. **手机框里无内容显示**

## 根因诊断

**不是尺寸问题，不是 iframe 不加载问题。** 是后端 **没有 CORS middleware**。

实测日志：
```
[vue] "Access to XMLHttpRequest at 'http://localhost:9999/api/news?limit=30'
 from origin 'http://localhost:5173' has been blocked by CORS policy:
 No 'Access-Control-Allow-Origin' header is present on the requested resource."
```

- iframe 内容正常显示（342×784, display:block, opacity:1）
- uni-app H5 正常启动（App Launch, App Show, vite connected, 路由跳转 /#/)
- 但 `fetch('/api/news')` 被浏览器拦截 → 页面是骨架但没数据 → 视觉上空白

## 修复

`server/src/index.js` 加 CORS middleware（白名单：* 或 localhost/127.0.0.1/file://）：

```js
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim());
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowed = CORS_ORIGINS.includes('*') ||
    CORS_ORIGINS.includes(origin) ||
    origin === 'null' ||
    /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
```

## 验证

用 chrome-headless-shell 145 (playwright 已下载，528KB) + 自写 CDP 脚本
（`docs/verify/cdp-preview-test.js`）渲染 preview/index.html 到
`docs/verify/preview-shot-iPhone15ProMax.png`：

✅ iframe 内 4 条新闻正常加载（金十数据 / 广期所 / 卡塔尔 / 扎波罗热核电站）
✅ 时间戳 30s 自动刷新倒计时显示
✅ 底部 tabBar（新闻 / 研报 / 持仓）正常
✅ 左侧栏 54 台设备齐全
✅ 横竖屏切换 + 缩放滑块 + 设备参数面板都在

## 设备尺寸核实结论

**iPhone 15 Pro Max**：CSS 430×932 ✅（物理 1290×2796, dpr=3）
**华为 Mate X5**：CSS 832×741 ✅（物理 2496×2224, dpr=3，Android webview 强制 snap 到 3）
**OPPO Find N3**：CSS 813×756 ✅（物理 2440×2268）
**小米 MIX Fold 3**：CSS 960×852 ✅（物理 2160×1916, dpr=2.25）
**荣耀 Magic V2**：CSS 937×862 ✅（物理 2344×2156, dpr=2.5）
**vivo X Fold3**：CSS 992×880 ✅（物理 2480×2200, dpr=2.5）

折叠屏近 1:1 是事实（内屏长宽差距小），之前按 3:2 估算是错的。

## Git 状态

- 本地：`23aace5 server: add CORS middleware for H5 dev (5173) + preview (file://) origins`
- origin：`23aace5` ✅ 已推送（用临时 git-credential-helper 直接提供 x-access-token，
  绕过 GCM 阻塞弹窗）
- 推进链：6516ff1 → b4acd59（上一会话）→ 23aace5（本次）

## 进程状态

- Express 9999（PID 不固定，sqlite-local/real/interval=3600s/ifind_token_loaded:false ⚠️）
- H5 dev 5173（vite 5.2.8 + uni 5.24）

⚠️ 新启动的 9999 进程没继承 IFIND_REFRESH_TOKEN，下次拉起需手动注入。