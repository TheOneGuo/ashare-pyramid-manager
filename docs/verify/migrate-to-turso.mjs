// migrate-to-turso.mjs
// 从 dev.sqlite 复制所有非空表到 Turso
// 用法: 先把 server 停掉（防止 db 锁），再跑这个
//
// 步骤：
//   1) 读本地 dev.sqlite 各表 schema
//   2) 读各表行
//   3) 用 INSERT OR REPLACE 写到 Turso
//   4) 验证 Turso 行数

import 'dotenv/config'
import { createClient } from '@libsql/client/node'

const TURSO_URL = process.env.TURSO_DATABASE_URL
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN
if (!TURSO_URL || !TURSO_TOKEN) {
  console.error('TURSO_DATABASE_URL / TURSO_AUTH_TOKEN 未配置')
  process.exit(1)
}

// 跳过这些表（schema-only 或 sqlite 内部）
const SKIP = new Set(['sqlite_sequence'])

// 表的主键列（用于 INSERT OR IGNORE 推断 conflict target）
const PRIMARY_KEY = {
  news_items: 'id',
  news_sources: 'source_channel',
  research_items: 'id',
  research_reports: 'id',
  research_stock_reports: 'stock_code',
  portfolio_holdings: 'stock_code',
  portfolio_recommendations: '(role, stock_code)',
  portfolio_snapshots: 'id',
  portfolio_ledger_events: 'id',
  portfolio_plans: 'id',
  holding_profiles: 'stock_code',
}

const local = await createClient({ url: 'file:./dev.sqlite' })
const turso = await createClient({ url: TURSO_URL, authToken: TURSO_TOKEN })

const tables = (await local.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).rows
  .map(r => String(r.name))
  .filter(n => !SKIP.has(n))

console.log('=== found', tables.length, 'tables ===')
console.log(tables.join(', '))

for (const tname of tables) {
  // 1) 读 schema（建表 + 索引）
  const ddlRows = (await local.execute(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
    [tname]
  )).rows
  if (ddlRows.length === 0) continue
  const ddl = String(ddlRows[0].sql || '')
  if (ddl) {
    // Turso 已建好（server 启动时建过），但保险起见还是 noop 一下
    // try { await turso.execute(ddl); } catch {}
  }

  // 2) 读所有行
  const rows = (await local.execute(`SELECT * FROM ${tname}`)).rows
  if (rows.length === 0) {
    console.log(`  [skip] ${tname}: 0 rows`)
    continue
  }
  console.log(`  [copy] ${tname}: ${rows.length} rows`)

  // 3) 写 Turso
  const cols = Object.keys(rows[0])
  const colList = cols.map(c => `"${c}"`).join(', ')
  const placeholders = cols.map(() => '?').join(', ')
  // 主键冲突时保留 Turso 已有数据（避免覆盖线上已有）
  const pk = PRIMARY_KEY[tname] || cols[0]
  const sql = `INSERT OR IGNORE INTO ${tname} (${colList}) VALUES (${placeholders})`

  let ok = 0, fail = 0
  // 批量：100 行/批
  const BATCH = 50
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    try {
      const stmts = batch.map(row => ({
        sql,
        args: cols.map(c => row[c]),
      }))
      await turso.batch(stmts, 'write')
      ok += batch.length
    } catch (e) {
      // 失败时单条重试，定位哪条炸了
      for (const row of batch) {
        try {
          await turso.execute({ sql, args: cols.map(c => row[c]) })
          ok++
        } catch (e2) {
          fail++
          if (fail < 3) console.warn(`    [fail] ${tname} ${JSON.stringify(row).slice(0, 200)}: ${e2.message}`)
        }
      }
    }
  }
  console.log(`    ok=${ok} fail=${fail}`)

  // 4) 验证
  const cnt = (await turso.execute(`SELECT COUNT(*) AS n FROM ${tname}`)).rows[0].n
  console.log(`    Turso ${tname}: ${cnt} rows`)
}

await local.close()
await turso.close()
console.log('\n=== done ===')
