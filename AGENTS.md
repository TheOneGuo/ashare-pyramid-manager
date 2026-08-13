# AGENTS.md — A 股正金字塔仓位管理器 · 节节高

> 给未来进场的 agent（包括 Mavis 自己）看的项目速记。
> 仓库：https://github.com/TheOneGuo/ashare-pyramid-manager

## 一句话定位

A 股正金字塔加仓法移动端管理器，AI 研报解读 + 30 秒新闻刷新 + 金字塔仓位算法一体化。

## 出货节奏（已拍板 · 不要再问）

- **一码三端**：uni-app + Vue 3 + Vite + TypeScript
- **三端同时出**，**先发小程序商店**（审核最快，5 天内能上线）
- 端配置见 `src/manifest.json`

## 起步里程碑

| 状态 | 任务 |
|---|---|
| ✅ | 项目结构 + 主题 + 断点 |
| ✅ | 三 Tab 骨架（news / research / portfolio） |
| ✅ | 自适应栅格 + 主题色（深蓝 #0D1B2A + 金 #D4AF37） |
| ✅ | `.env.example` / `.env` 管理（数据库沿用 Foresig 项目的 Turso） |
| ⏳ | pyramid 算法 Python → JS 翻译 + Jest 单测（核心） |
| ⏳ | 新闻模块接后端 |
| ⏳ | 研报 LLM 解读 |
| ⏳ | 持仓 OCR + 金字塔计算 |
| ⏳ | 三端打包 + 上架材料 |

## 目录约定

```
src/
├── pages/          # 三 Tab：news / research / portfolio
├── components/     # ResponsiveGrid（折叠屏自适应栅格）等
├── utils/          # pyramid.js（算法）、fee.js（A 股费率）、adaptive.js、env.ts
├── styles/         # theme.scss、breakpoints.scss（uni.scss 是全局入口）
├── api/            # 后端调用层
├── stores/         # 状态管理（pinia，待引入）
├── static/         # 静态资源（tabbar 图标等）
├── App.vue         # 应用根
├── main.ts         # 入口
├── manifest.json   # 三端 appid / 打包配置
├── pages.json      # 页面路由 + tabBar
└── uni.scss        # 全局 SCSS 变量入口
```

## 关键约束

- **数据源**：akshare 仅作开发参考，不可商用；商用前要换合规数据源
- **数据库**：沿用 Foresig 项目的 Turso (libsql)；token 走 `.env`，**绝对不能 commit / 截图**
- **AI 免责声明**：APP 内显眼位置标注「AI 生成内容不构成投资建议」
- **算法版权**：原 `pyramid_atr_engine.py` PRD V4.0/4.1 是自有资产，迁移没问题；商用前保留原项目链接致谢

## 原项目源码定位

`C:\Users\TheOne\WorkBuddy\2026-06-13-12-43-21\ashare-heatmap-horizon-platform\heatmap_app\`

| 节节高功能 | 原文件 | 行数 |
|---|---|---|
| 新闻（30 秒刷新） | `telegram_news.py` | 806 |
| AI 研报解读 | `analytics/report_parser.py` | 197 |
| 研报后台任务 | `analytics/research_task_runner.py` | 138 |
| AI 持仓分析 | `position_strategy.py` | 183 |
| **正金字塔算法（核心）** | `pyramid_atr_engine.py` | **544** |
| 数据源采集 | `collectors/*.py` | 7 文件 |
| 持仓服务编排 | `analytics/portfolio_service.py` | — |

## 跑通方式

```bash
# 1. 装依赖
npm install

# 2. H5 调试
npm run dev:h5

# 3. 微信小程序调试（需要微信开发者工具配合）
npm run dev:mp-weixin
# 然后用微信开发者工具打开 dist/dev/mp-weixin

# 4. 类型检查
npm run type-check
```

## 别忘了的细节

- **折叠屏**：H5 用 `@media` + `useBreakpoint()`；小程序端要监听 `onWindowResize`
- **30 秒刷新**：uni-app 小程序切后台后 `setInterval` 会失效，要在 `onShow` 立即拉一次
- **环境变量**：H5 走 `import.meta.env`；小程序 / App 走 `uni.getStorageSync('ENV')` 兜底
- **图标占位**：tabBar iconPath 暂未配，等图标素材到位再补
