# A股正金字塔仓位管理器-节节高 · A-Share Pyramid Position Manager

> **一句话定位**：A 股正金字塔加仓法移动端管理器，AI 研报解读 + 30 秒新闻刷新 + 金字塔仓位算法一体化。

[![Stars](https://img.shields.io/github/stars/TheOneGuo/ashare-pyramid-manager)](https://github.com/TheOneGuo/ashare-pyramid-manager)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 📱 多端覆盖

| 平台 | 端 | 框架 |
|---|---|---|
| 微信小程序 | 微信 | uni-app (Vue 3) |
| Android | App | uni-app 编译原生 |
| iOS | App | uni-app 编译原生 |

**自适应布局**：直板机 / 折叠屏 / 横竖屏自动重排，UI 自适应窗口宽度与折叠状态。

## 🎯 核心功能

### 1. 新闻（30 秒自动刷新）
进入新闻 Tab 自动每 30 秒拉取一次财经快讯，支持多源（财联社 / 金十数据 / 华尔街见闻 / 新浪财经）。

### 2. AI 研报解读
每日定时抓取券商研报，调用大模型提炼：
- 📌 当日重点（≤300 字）
- ⚠️ 风险点
- 🎯 目标价 / 估值结论

### 3. AI 持仓分析 + 正金字塔仓位算法
- 持仓截图一键 OCR 提取（代码/成本/数量）
- 基于 ATR 自适应（PRD V4.1）：
  - 首笔止损 = 基准价 - 3×ATR
  - 加仓间隔 [10%~12%]（科创/创业板上浮到 15%~20%）
  - 四档止盈 [1.58×, 1.68×, 1.78×, 1.88×]
  - 高价降级手数比例 4:3:2
- 完整 A 股费率（佣金 + 过户费 + 印花税）

## 🏗️ 项目结构

```
ashare-pyramid-manager/
├── src/                  # uni-app 客户端（Vue 3）
│   ├── pages/            # 三 Tab：news / research / portfolio
│   ├── components/       # 自适应卡片 + 金字塔可视化
│   ├── utils/            # pyramid.js（算法 JS 移植版）+ fee.js
│   └── stores/           # pinia
├── server/               # 后端（uniCloud / Express）
│   ├── news-collector/   # 移植自 telegram_news.py
│   ├── research-ai/      # LLM 研报解读
│   └── portfolio-analyzer/  # 持仓分析编排
├── docs/                 # 文档 + 项目备忘
├── .github/workflows/    # CI/CD（lint + build + release）
└── android/ ios/         # uni-app 编译产物
```

## 📊 数据源

| 数据 | 来源 |
|---|---|
| 实时行情 | akshare / 新浪财经 / 东方财富 |
| 新闻 | 财联社 RSS / 金十数据 / 华尔街见闻 |
| 研报 | 东方财富研报中心 / 慧博投研 |
| OCR | 百度 OCR / 腾讯云 OCR |

## ⚠️ 免责声明

本项目所有 AI 解读内容**不构成投资建议**。投资有风险，入市需谨慎。

## 🚧 当前状态

🚧 **v0.1.0-dev** — 项目初始化阶段

进度：
- [x] 项目结构搭建
- [x] 金字塔算法文档化
- [ ] 算法 Python→JS 翻译 + 单测
- [ ] uni-app 三 Tab 骨架
- [ ] 折叠屏自适应栅格
- [ ] uniCloud 后端
- [ ] 三端打包上架

详细进度见 [`docs/项目备忘_v2.md`](docs/)

## 📜 License

MIT © 2026 TheOneGuo

算法源自 [A 股景气捕手 (Ashare Heatmap Horizon)](https://github.com/TheOneGuo/ashare-heatmap-horizon-platform)，遵循原项目许可。