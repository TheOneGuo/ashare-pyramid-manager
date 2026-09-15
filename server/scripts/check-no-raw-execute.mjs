#!/usr/bin/env node
/**
 * 校验 1：禁止裸写 client.execute(...)，必须统一走 db.js 的 exec() 包装器。
 *   背景（2026-09-15 实测）：@libsql/client 内部 stmtToHrana 会 Object.entries(stmt.args)，
 *   以对象形式 client.execute({ sql }) 调用却漏传 args 时抛
 *   "TypeError: Cannot convert undefined or null to object"；
 *   这类异常常被 try/catch 静默吞掉，使迁移/清理语句长期失效却无人察觉。
 *   exec() 对漏传 args 天然免疫（兜底 []），因此本校验强制所有调用改走 exec()。
 *   允许的唯一例外：db.js 中 exec() 包装器自身那一次真实调用。
 *
 * 校验 2：禁止 new URL(import.meta.url).pathname 求目录，必须用 fileURLToPath。
 *   背景（2026-09-15 实测）：.pathname 保留 %20 等百分号编码，配合
 *   mkdirSync({ recursive: true }) 会在真实目录之外另建一张「字面量 %20」幽灵目录树，
 *   曾把写路径 spool 写到 ~/Library/Application%20Support/... 而非项目内 server/.spool，
 *   使「写失败不丢数据」的兜底落到开发者看不见的位置。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 注意：必须用 fileURLToPath 而非 URL.pathname，否则路径含空格时会保留 %20 导致读不到文件
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const ALLOWED_FILE = 'db.js';

const offenders = [];
const pathOffenders = [];
let total = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'node_modules') walk(p);
      continue;
    }
    if (!/\.(js|ts)$/.test(name)) continue;
    const lines = readFileSync(p, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const t = line.trim();
      // 跳过注释行（文档里会举例说明「禁止的写法」，不应被判为违规）
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;

      // 规则 2：new URL(import.meta.url).pathname —— 路径含空格/中文时会保留 %20
      if (/new\s+URL\([^)]*import\.meta\.url\)\.pathname/.test(line)) {
        pathOffenders.push(`${p}:${i + 1}\n    ${t.slice(0, 120)}`);
      }

      // 规则 1：裸 execute()
      if (!/\.execute\(/.test(line)) return;
      total += 1;
      // db.js 内允许包装器自身那一次调用
      if (name === ALLOWED_FILE && /return\s+client\.execute\(/.test(line)) return;
      offenders.push(`${p}:${i + 1}\n    ${t.slice(0, 120)}`);
    });
  }
}

walk(SRC);

let bad = false;

if (offenders.length) {
  console.error('[check-no-raw-execute] 发现裸 execute() 调用，请改用 exec()：\n');
  offenders.forEach((o) => console.error('  ' + o));
  console.error(`\n共 ${offenders.length} 处违规（扫描到 ${total} 处 .execute(）。\n`);
  bad = true;
}

if (pathOffenders.length) {
  console.error('[check-no-raw-execute] 发现 new URL(import.meta.url).pathname，请改用 fileURLToPath：\n');
  pathOffenders.forEach((o) => console.error('  ' + o));
  console.error(`\n共 ${pathOffenders.length} 处违规。\n`);
  bad = true;
}

if (bad) process.exit(1);

console.log(
  `[check-no-raw-execute] OK：无裸 execute()（扫描 ${total} 处）、无 URL.pathname 取目录写法`,
);
