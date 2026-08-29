# 阶段三 · 2026-08-13 收尾

## 完成清单

### 1. 预览页 v2（单选 + 下拉控制）
- 24 个设备：iOS(4) + Android 直板(14) + Android 折叠(6) + 微信小程序(9)
- 左侧栏：单选 + 按品牌子分组折叠展开
- 控制条：横竖屏下拉 + 分辨率下拉（含 auto/跟随/custom/8 个预设）
- 微信小程序：禁用横竖屏切换（按需求），但折叠屏内屏仍可预览
- 微信小程序外壳按微信设计文档还原：状态栏+87×24 胶囊+44px 导航栏+49px tabbar
- iframe 指向真 `http://localhost:9000/` H5 dev
- 端口 9999

### 2. Turso 真实接通 ✅
- DB: `libsql://ashare-pyramid-server-theoneguo.aws-ap-northeast-1.turso.io`
- `libsql` 客户端直连（token 通过 OS env 注入，**不入仓**）
- schema init bug fix：拆 batch → 逐条 + 容错
- upsert 类型 bug fix：每条 try-catch + 字段类型防御
- /api/health 返回 `"db": "turso-remote"`

### 3. 真实新闻源 ✅
- Yahoo Finance 4 个 topic feed + BBC Business + HN（部分失败）
- 实测 40+ 条/批，55 条成功 upsert 到 Turso
- RSS 解析带 CDATA / 实体 / 命名空间（dc:date）兼容
- news-collector.js 模式：`mock` / `real` 二选一
- 详细源说明：`docs/news-sources.md`

### 4. Git 状态
- main 已推至 `19ade2f`（领先 origin 之前的 5a0ea95 共 7 commits）
- 已推送 commit：fd0638d, 41802c3, 19ade2f
- 工作树 clean

### 5. 文档
- README.md 更新（Turso + 真实源 + 预览说明）
- docs/news-sources.md（真实源调研笔记 + 已废弃源）
- docs/A股正金字塔仓位管理器_节节高_项目备忘_v2_2026-08-13.md

## 修复记录

| 问题 | 根因 | 解决 |
|---|---|---|
| Bing/Google RSS 中文乱码 | 服务端把 URL-encoded query 当 raw 字节塞 title | 弃用，改用 Yahoo/BBC |
| Turso init schema 400 | 多语句 batch 模式不被支持 | 拆分单条 + 容错 |
| Turso upsert 失败 | 某字段类型严格 + 数组不支持 | 逐条 try-catch + 字段类型 String() 防御 |
| 端口 9999 占用 | 旧 server 进程没杀干净 | Get-NetTCPConnection + Stop-Process |

## 待办（用户决策后继续）

### 用户给新 GitHub PAT（带 workflow scope）→ 立即激活 CI
- 配置已在 `docs/ci/ci.yml.example`（从 .github/ 移过来）
- 启用方式：用户给新 token → 创建 PAT workflow scope → 恢复 `.github/workflows/ci.yml` → push

### ② 实现 portfolio-analysis 后端
- /api/portfolio POST：传 holdings 截图 or 手动输入 → 服务端调用 pyramid.ts 算加仓表/止损序列/止盈表
- 服务端推荐用 Node.js 调用 TS 算法（已 transpile）
- 或独立 Python 微服务复用原 `pyramid_atr_engine.py`

### ③ uniCloud 适配（省 Express）
- 当前 server 可平移：uniCloud 云函数跑同一份 Node 代码
- 数据库改用 uniCloud DB / 仍可连 Turso
- 优点：免运维 + 与小程序免鉴权
- 触发：用户给阿里云/腾讯云 uniCloud 控制台后

### 真实新闻源（中文）
- Yahoo/BBC 是英文为主，已抓到但需要中文源
- 路线：付费 API（雪球/choice）或网页爬虫（注意合规）

## 进程状态

| 端口 | 内容 | PID |
|---|---|---|
| 9000 | uni-app H5 dev | — |
| 9999 | Express + Turso + preview | vivid-tidepool session |

## 关键决策记录

- **预览页控制**：从「全选/全清/推荐」改成「横屏/竖屏/分辨率下拉」 ✅
- **微信小程序无横竖屏切换** ✅
- **Turso token 仅在 OS env 注入**，从不写入 .env / commit / 截图
- **GitHub Actions 配置**改 docs/ci/，等用户给新 PAT 再激活

## 当前最新 commits

```
19ade2f chore(server): add .gitignore (node_modules, .env, *.sqlite, logs)
41802c3 docs: news-sources investigation + README updated for Turso+real RSS
fd0638d feat: real news sources (Yahoo/BBC RSS) + Turso stable + multi-device preview v2
c0ec2d6 chore: remove .github/ (token lacks workflow scope; CI config saved to docs/ci/)
7516c72 chore: move ci.yml to docs/ (token lacks workflow scope; need PAT with workflow scope to enable)
467403b chore: temporarily rename ci.yml (token lacks workflow scope)
b83fa5c feat: 9999 多端预览 + Express+Turso+news-collector + CI workflow
5a0ea95 feat(utils): port pyramid_atr_engine.py to TS with Jest tests (37/37 pass)
8c15154 chore: initial commit - project scaffolding
```