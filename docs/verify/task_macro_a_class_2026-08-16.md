# 持仓相关新闻：主动源拉取 + A类直接源 调研（2026-08-16）

## 一、本次已落地（已提交 4d9a353）

### 茅台公告「只有标题/来源t/看不了内容」— 已修复（前一轮 71adcb2）
实测 DB 现状：10 条茅台公告 `source_name="东方财富·公告·600519"`、正文 `content` 1285–5000 字、标题已去冗余前缀、脏数据 `source_name='t'` = 0 行。
前端 `news/index.vue` 卡片渲染 `item.summary`（= `raw.content || raw.summary`），含 `white-space:pre-wrap`，正文完整显示。
结论：用户此前看到的旧现象是**旧代码/旧数据残留**，现服务端重启后已干净。

### 主动拉取源（BDI 运价 + 证监会政策）
- `macro-news.js` 新增 `fetchBdiIndex`（东方财富 `secid=100.BDI` 实时指数，已验证返回 `f43=2863` 点、涨跌幅）+ `fetchCsrcPolicy`（证监会 `csrc.gov.cn/csrc/c100039/common_list` 列表标题抓取，已验证 6 条）。
- `news-collector.js` 经 `fetchAllMacro()` 统一管理（商品期货100 + 新浪滚动 + BDI + 政策），refresh 实测累计 107 条入库。
- `db.js` 持仓间接扫描 `indirectChannels` 扩为 `['...','macro_commodity','macro_sina_roll','macro_bdi','macro_policy_csrc']`。
- `holding-profiles.ts` 各持仓补 航运/运价/禁运/BDI/证监会/银保监 命中词。
- 验证：`/api/news?holding=1` 现含 BDI 指数（命中 5 持仓）+ 证监会政策（6 条）。

### 产业链画像可编辑（前一轮 71adcb2）
- 新增 `holding_profiles` 表 + CRUD + `/api/portfolio/holding-profiles` 路由；DB 优先、静态 `holding-profiles.ts` 兜底。
- 持仓页新增「🔗 产业链画像」可编辑卡片（各维度逗号/换行分隔，保存入库）。
- 验证：接口返回 5 持仓画像，前端编辑器已接入。

## 二、A 类直接源（订单/合同/客户认证/电话会）调研结论

**无免费公开 JSON API 可用**，实测结果：
- 互动易（深交所 irm.cninfo.com.cn）：`getQuestionList` 等接口返回登录页 HTML，无匿名 JSON。
- 上证 e 互动（sns.sseinfo.com）：ajax 接口 404。
- 东财互动问答 `RPT_DMS_INTERACT`：缺参 9501，需特定字段。
- 新浪/东财个股新闻：东财 np-listapi 死、RPT 报表不存在；Sina `getNewsBySymbol` 报 `Service not valid`；同花顺 404；QQ 无 dispatch。

**可行路径（需付费或抓网页，均非 Node 后端直连免费源）**：
1. Tushare `irm_qa_sh`/`irm_qa_sz`（互动易问答，需积分/权限）— 最正路，但需 token。
2. 抓 e互动/互动易 网页解析 — 脆弱、易变。
3. 公告关键词近似：现有东财公告已覆盖「中标/合同/分红/并购」类（标题含关键词），可在画像 `extra_keywords` 里加「中标/合同/订单/分红/收购」让公告/新闻命中，作为轻量替代。

## 三、其余未做（待用户决策）
- BDI/SMM 实时现货：BDI 已接；SMM `cj.smm.cn` 仅 HTML 页面（脆弱未接），`api.smm.cn` 不通。
- A 类真实直连：待确认是否接 Tushare（需 token）或暂以公告关键词近似。
- 政策源仅证监会，发改委/国务院未接（页面 404/需另寻）。
- 大量调试 debris 未清理（`docs/verify/*`、`server/probe_*`、`*.md` 总结）— 建议另开清理任务。
