/**
 * migrate-ai-from-tradefi.js · 一次性脚本
 * 把「源库(TradeFi 专用库)」里已完成 AI 精读的 fxbaogao_ai 记录，迁移到「目标库(ashare-pyramid-server)」，
 * 避免切换数据库后重复做 LLM 精读。
 *
 * 规则：
 *  - 只迁移 status IN ('refined-llm','refined-mock') 的行（忽略 pdf_failed）。
 *  - 只迁移「目标库 fxbaogao_reports 里已存在的 report_id」，不做孤儿插入。
 *  - 迁移后同步回填目标库 fxbaogao_reports.ai_status=2、report_type（LLM 权威值）。
 *  - 幂等：重复执行不会重复插入。
 *
 * 凭据不入仓，全部走环境变量：
 *   SRC_TURSO_URL    源库(TradeFi) URL
 *   SRC_TURSO_TOKEN  源库(TradeFi) auth token
 *   目标库(ashare) URL/TOKEN 从 server/.env 里的 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN 读取。
 *
 * 运行（在 server/ 目录）：
 *   SRC_TURSO_URL=libsql://... SRC_TURSO_TOKEN=xxxx npx tsx scripts/migrate-ai-from-tradefi.js
 */
import { createClient } from '@libsql/client';
import 'dotenv/config';

const SRC_URL = process.env.SRC_TURSO_URL?.trim();
const SRC_TOKEN = process.env.SRC_TURSO_TOKEN?.trim();
const DST_URL = process.env.TURSO_DATABASE_URL?.trim();
const DST_TOKEN = process.env.TURSO_AUTH_TOKEN?.trim();

if (!SRC_URL || !SRC_TOKEN || !DST_URL) {
  console.error('[migrate] 缺少必要环境变量：SRC_TURSO_URL / SRC_TURSO_TOKEN / TURSO_DATABASE_URL');
  process.exit(1);
}

const src = createClient({ url: SRC_URL, authToken: SRC_TOKEN });
const dst = createClient({ url: DST_URL, authToken: DST_TOKEN || undefined });

function jsonArr(v) { try { return JSON.parse(String(v || '[]')); } catch { return []; } }
function safeJson(v) { try { return JSON.parse(String(v || '{}')); } catch { return {}; } }

async function exec(retrySql, prepare) {
  let lastErr;
  for (let i = 0; i < 6; i++) {
    try {
      return await dst.execute(prepare());
    } catch (e) {
      lastErr = e;
      if (/fetch failed|timeout|ECONNRESET|network/i.test(String(e?.message || ''))) {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function main() {
  // 1) 读源库已精读记录（源库读取也加重试）
  let rows = [];
  let srcErr;
  for (let i = 0; i < 6; i++) {
    try {
      const rowsRes = await src.execute(`SELECT report_id,title,broker,source_url,raw_text,tldr,key_points,opportunities,risks,status,model,report_type,extract_json
            FROM fxbaogao_ai
            WHERE status IN ('refined-llm','refined-mock')`);
      rows = rowsRes.rows || [];
      srcErr = null;
      break;
    } catch (e) {
      srcErr = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  if (srcErr) throw srcErr;
  console.log(`[migrate] 源库已精读记录 ${rows.length} 条`);

  if (!rows.length) {
    console.log('[migrate] 无待迁移数据，退出');
    return;
  }

  // 2) 探测目标库 fxbaogao_ai 是否存在（不存在则跳过，避免报错）
  let dstHasAiTable = true;
  try {
    await exec(`SELECT report_id FROM fxbaogao_ai LIMIT 1`, (s) => s);
  } catch {
    dstHasAiTable = false;
  }

  let migrated = 0;
  let skippedNoReport = 0;
  const now = Date.now();

  for (const row of rows) {
    const reportId = Number(row.report_id);
    // 3) 校验目标库存在该研报
    const exist = await exec(null, () => ({ sql: `SELECT 1 FROM fxbaogao_reports WHERE report_id=?`, args: [reportId] }));
    if (!exist.rows.length) { skippedNoReport++; continue; }

    if (dstHasAiTable) {
      const type = String(row.report_type || '').slice(0, 20);
      await exec(null, () => ({
        sql: `INSERT INTO fxbaogao_ai(report_id,title,broker,source_url,raw_text,tldr,key_points,opportunities,risks,status,model,report_type,extract_json,created_at,updated_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(report_id) DO UPDATE SET
                title=excluded.title, broker=excluded.broker, source_url=excluded.source_url, raw_text=excluded.raw_text,
                tldr=excluded.tldr, key_points=excluded.key_points, opportunities=excluded.opportunities,
                risks=excluded.risks, status=excluded.status, model=excluded.model, report_type=excluded.report_type,
                extract_json=excluded.extract_json, updated_at=excluded.updated_at`,
        args: [
          reportId,
          String(row.title || '').slice(0, 300),
          String(row.broker || '').slice(0, 80),
          String(row.source_url || '').slice(0, 500),
          String(row.raw_text || '').slice(0, 60000),
          String(row.tldr || '').slice(0, 2000),
          JSON.stringify(jsonArr(row.key_points)),
          JSON.stringify(jsonArr(row.opportunities)),
          JSON.stringify(jsonArr(row.risks)),
          String(row.status || 'refined-llm'),
          String(row.model || '').slice(0, 40),
          type,
          JSON.stringify(safeJson(row.extract_json)).slice(0, 20000),
          now,
          now,
        ],
      }));
    }

    // 4) 回填索引表 ai_status=2 + report_type
    await exec(null, () => ({
      sql: `UPDATE fxbaogao_reports SET ai_status=2, report_type=? WHERE report_id=?`,
      args: [String(row.report_type || '').slice(0, 20), reportId],
    }));
    migrated++;
    if (migrated % 20 === 0) console.log(`[migrate] 已迁移 ${migrated} 条...`);
  }

  console.log(`[migrate] 完成：迁移 ${migrated} 条，跳过目标库无对应研报 ${skippedNoReport} 条`);
}

main()
  .catch((e) => {
    console.error('[migrate] 失败:', e?.stack || e?.message || e);
    process.exit(1);
  });