#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""将 Turso 远程数据库(ashare-pyramid-server)的最新内容拉到本地 SQLite 副本。

用法: python3 scripts/pull_turso.py [输出路径]
默认输出到 workspace 根目录下 turso_pull.sqlite3

── 2026-09-24 重写（原版两个硬伤）──
1) 原版对每张表执行 `SELECT * FROM t` 一次性全量拉取。大表（fxbaogao_reports 1.3w+ 行，
   含体积巨大的 raw_text 全文列）单次响应过大，实测会超时/中断，导致整库拉不下来。
   → 改为按 LIMIT/OFFSET 分块拉取（默认 500 行/块）。
2) 原版 `os.remove(out)` 先把旧镜像删掉再写。一旦中途失败，本地副本直接归零，
   「只读镜像」变成「没有镜像」。
   → 改为先写 <out>.tmp，全部成功后原子替换；失败保留旧镜像。

其它要点：
- Turso HTTP API 只接受 v2 格式 {"requests":[{"type":"execute","stmt":{"sql":...}}]}，
  返回结构 rows 为 [{type,value}] 列表。
- 代理：Turso 在东京，国内直连经常 SSL 断流（UNEXPECTED_EOF_WHILE_READING），
  且沙箱内 urllib 直连 DNS 偶发 gaierror。故默认**优先走代理**
  （TURSO_PROXY_URL > HTTPS_PROXY/https_proxy > ALL_PROXY），代理失败才回落直连。
- 单表失败不中断整库（记 [warn] 继续），最后按「远程 COUNT vs 本地行数」逐表对账，
  不一致时以退出码 2 结束（便于 CI/人工发现）。
"""
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
CHUNK = 500
MAX_RETRY = 3


def load_env():
    """server/.env 存真实凭据；root .env 可能为空。前者优先，后者不覆盖。"""
    candidates = [BASE / "server" / ".env", BASE / ".env"]
    env = {}
    for p in candidates:
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            if k and k not in env:
                env[k] = v.strip()
    return env


def _cell_value(cell):
    """把 v2 返回的 {type, value} 单元转成原生 Python 值。"""
    if cell is None:
        return None
    t = cell.get("type")
    v = cell.get("value")
    if t == "null" or v is None:
        return None
    if t == "integer":
        return int(v)
    if t == "float":
        return float(v)
    return v


def resolve_proxy(env):
    for key in ("TURSO_PROXY_URL", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"):
        v = (env.get(key) or os.environ.get(key) or "").strip()
        if v:
            return v
    return None


def _make_opener(proxy):
    if proxy:
        handler = urllib.request.ProxyHandler({"http": proxy, "https": proxy})
        return urllib.request.build_opener(handler)
    # 显式禁用代理：环境里的 http_proxy 可能拦截 localhost/内网，直连时不应继承
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def query(url, token, sql, proxy=None, tries=MAX_RETRY):
    """执行一条 SQL，返回 (cols, rows)。

    优先走代理（东京直连在国内不稳定），代理失败回落直连；
    每条路径各重试 tries 次，退避 1s/2s/3s。
    """
    body = json.dumps({"requests": [{"type": "execute", "stmt": {"sql": sql}}]}).encode()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    last_err = None

    paths = [proxy, None] if proxy else [None]
    for use_proxy in paths:
        for i in range(tries):
            try:
                req = urllib.request.Request(url, data=body, method="POST", headers=headers)
                with _make_opener(use_proxy).open(req, timeout=60) as resp:
                    data = json.loads(resp.read().decode())
                res = data["results"][0]
                if res.get("type") != "ok":
                    raise RuntimeError(f"Turso 返回非 ok: {str(res)[:200]}")
                result = res["response"]["result"]
                cols = [c["name"] for c in result.get("cols", [])]
                rows = [[_cell_value(cell) for cell in row] for row in result.get("rows", [])]
                return cols, rows
            except (urllib.error.URLError, OSError, RuntimeError, KeyError, ValueError) as e:
                last_err = e
                if i < tries - 1:
                    time.sleep(i + 1)
                    continue
                break  # 换路径重试
    raise RuntimeError(f"查询失败（{len(paths)} 条路径 × {tries} 次）: {last_err}")


def iter_table(url, token, name, proxy, chunk=CHUNK):
    """分块读取整张表，逐块 yield (cols, rows)。"""
    _, crows = query(url, token, f'SELECT COUNT(*) FROM "{name}"', proxy)
    total = int(crows[0][0] or 0)
    if total == 0:
        return
    offset = 0
    while offset < total:
        try:
            cols, rows = query(
                url, token,
                f'SELECT * FROM "{name}" ORDER BY rowid LIMIT {chunk} OFFSET {offset}',
                proxy,
            )
        except Exception:
            # 无 rowid 的表（WITHOUT ROWID）不支持 ORDER BY rowid，回落单块全量
            cols, rows = query(url, token, f'SELECT * FROM "{name}"', proxy)
            yield cols, rows
            return
        if not rows:
            break
        yield cols, rows
        offset += len(rows)


def main():
    env = load_env()
    host = env["TURSO_DATABASE_URL"].replace("libsql://", "https://", 1)
    url = host.rstrip("/") + "/v2/pipeline"  # libSQL HTTP API 端点
    token = env["TURSO_AUTH_TOKEN"]
    proxy = resolve_proxy(env)
    out = sys.argv[1] if len(sys.argv) > 1 else str(BASE / "turso_pull.sqlite3")

    print(f"Turso 目标: {url}")
    print(f"代理: {proxy or '未配置（直连）'}")
    print(f"输出: {out}\n")

    tmp = str(out) + ".tmp"
    if os.path.exists(tmp):
        os.remove(tmp)

    conn = sqlite3.connect(tmp)
    cur = conn.cursor()
    cur.execute("PRAGMA foreign_keys=OFF")

    _, objs_rows = query(
        url, token,
        "SELECT name, sql FROM sqlite_master "
        "WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' "
        "ORDER BY type, name",
        proxy,
    )
    tables = []
    for name, sql in objs_rows:
        if sql and sql.lstrip().lower().startswith("create table"):
            tables.append(name)
        if sql:
            try:
                cur.execute(sql)
            except sqlite3.OperationalError as e:
                print(f"  [skip 建表] {name}: {e}")

    print(f"共 {len(tables)} 张表，开始分块拉取（{CHUNK} 行/块）\n")
    report = []
    for name in tables:
        t0 = time.time()
        try:
            for cols, rows in iter_table(url, token, name, proxy):
                col_sql = ",".join(f'"{c}"' for c in cols)
                ph = ",".join("?" * len(cols))
                cur.executemany(f'INSERT INTO "{name}" ({col_sql}) VALUES ({ph})', rows)
            local_n = cur.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
            _, rc = query(url, token, f'SELECT COUNT(*) FROM "{name}"', proxy)
            remote_n = int(rc[0][0] or 0)
            flag = "OK " if local_n == remote_n else "差异"
            print(f"  [{flag}] {name}: 本地 {local_n} / 远程 {remote_n}  ({time.time() - t0:.1f}s)")
            report.append((name, local_n, remote_n))
        except Exception as e:
            print(f"  [warn] {name} 拉取失败，跳过: {type(e).__name__}: {str(e)[:120]}")
            report.append((name, -1, -1))

    _, ix_rows = query(
        url, token,
        "SELECT sql FROM sqlite_master WHERE type IN ('index','trigger') AND sql IS NOT NULL",
        proxy,
    )
    for (sql,) in ix_rows:
        try:
            cur.execute(sql)
        except sqlite3.Error:
            pass

    conn.commit()
    conn.close()

    # 全部成功后才原子替换；中途失败则保留旧镜像
    os.replace(tmp, out)

    print(f"\n已写入本地副本: {out}  ({os.path.getsize(out) / 1024 / 1024:.1f} MB)")
    bad = [r for r in report if r[1] != r[2]]
    if bad:
        print("以下表本地/远程行数不一致:")
        for name, a, b in bad:
            print(f"   {name}: 本地 {a} / 远程 {b}")
        sys.exit(2)
    print("所有表行数与远程一致")


if __name__ == "__main__":
    main()
