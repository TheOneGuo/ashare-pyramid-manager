# AI 研报解读模块落地（2026-08-14）

## 结论
新 `portfolio` 页面补齐第四块「AI 研报解读结果展示」，照搬原项目 `ai-research-panel` 体例。
采用「展示壳 + 结构化 mock 报告」方案（用户确认：无需 API key 即可演示，后续接真 LLM）。

## 改动文件
- `server/src/research-report.ts`（新增）：定义 12 个研究模块 + `buildMockReport` + `handleResearch`。
  - 模块：公司概况/行业空间/竞争格局/商业模式/产业链/客户/产能订单/财务质量/估值/催化剂/风险/管理层
  - 返回结构含 overall、rating、modules[].{title,summary,points,verdict}、disclaimer。
- `server/src/index.js`：新增 `POST /api/portfolio/research` 路由。
- `src/api/portfolio.ts`：新增 `ResearchReport` 接口 + `researchReport()` 调用。
- `src/pages/portfolio/index.vue`：新增「⑤ AI 研报解读」卡片（输入代码/名称/问题 → 生成 → 渲染十二模块 + 总评 + 评级）。
- `docs/verify/research-utf8-test.mjs`：UTF-8 端到端验证脚本。

## 验证
- vite H5 5173 编译 SFC 无 error marker；`vue-tsc --noEmit` 通过（exit 0）。
- `POST /api/portfolio/research` 返回 2209 字节合法 JSON，12 模块齐全。
- UTF-8 确认：PowerShell Invoke-WebRequest 测试出现 `????` 是 PS 编码假象；用 node fetch 发 UTF-8 请求，`stock_name=宁德时代` / `query` 中文均正确 → 后端无编码问题（`uni.request` 发 JS 对象体同样安全）。

## 遗留 / 后续
- 接真 LLM：仅需在 `handleResearch` 按 env 的 AI 配置切换 `buildMockReport` / `buildLlmReport`，保持返回结构不变即可。
- 原项目研报为「十二模块 Markdown 长文 + 历史研报库」，本版为结构化模块卡片；若需完全忠实 Markdown 长文风格可再调整。
