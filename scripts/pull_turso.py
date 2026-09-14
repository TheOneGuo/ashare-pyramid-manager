#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""将 Turso 远程数据库(ashare-pyramid-server)的最新内容拉到本地 SQLite 副本。
用法: python3 scripts/pull_turso.py [输出路径]
默认输出到 workspace 根目录下 turso_pull.sqlite3

注意: Turso HTTP API 已弃用旧的 {"statements":[...]} 格式，
现仅接受 v2 的 {"requests":[{"type":"execute","stmt":{"sql":...}}]} 格式。
本脚本已对齐到 v2 格式及其返回结构（rows 为 [{type,value}] 列表）。

代理: Turso 在东京，国内直连经常 SSL 断流（UNEXPECTED_EOF_WHILE_READING）。
      若 server/.env 配了 TURSO_PROXY_URL（或环境变量 TURSO_PROXY_URL /
      HTTPS_PROXY），本脚本会自动经代理请求，并在直连失败时自动重试一次代理。
"""
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent


def load_env():
    # server/.env 存有真实的 Turso 凭据；root .env 可能为空。
    # 优先读取 server/.env，再回退到根目录 .env，后者不覆盖前者。
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
            if k and k not in env:  # 前者优先，后者不覆盖
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
    """取代理地址：TURSO_PROXY_URL > HTTPS_PROXY/https_proxy > ALL_PROXY > TURSO_PROXY_URL 默认值。
    未配置则返回 None（走直连，与改造前行为一致）。"""
    for key in ("TURSO_PROXY_URL", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"):
        v = (env.get(key) or os.environ.get(key) or "").strip()
        if v:
            return v
    return None


def _make_opener(proxy):
    """构造带（或不带）代理的 opener。"""
    if proxy:
        handler = urllib.request.ProxyHandler({"http": proxy, "https": proxy})
        return urllib.request.build_opener(handler)
    # 显式禁用代理：环境里的 http_proxy 可能拦截 localhost/内网，直连时不应继承
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def query(url, token, sql, proxy=None):
    """执行一条 SQL，返回 (cols, rows)。
    cols: [列名...]; rows: [[值,...], ...]
    直连失败（SSL 断流/超时）且配了代理时，自动改用代理重试一次。
    """
    body = json.dumps({"requests": [{"type": "execute", "stmt": {"sql": sql}}]}).encode()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def _once(use_proxy):
        req = urllib.request.Request(url, data=body, method="POST", headers=headers)
        with _make_opener(use_proxy).open(req, timeout=60) as resp:
            return json.loads(resp.read().decode())

    try:
        data = _once(None)
    except (urllib.error.URLError, OSError) as e:
        if not proxy:
            raise
        print(f"  [warn] 直连失败({type(e).__name__}) → 改用代理 {proxy} 重试", file=sys.stderr)
        data = _once(proxy)

    res = data["results"][0]
    if res.get("type") != "ok":
        raise RuntimeError(f"Turso 返回非 ok: {res}")
    result = res["response"]["result"]
    cols = [c["name"] for c in result.get("cols", [])]
    rows = [[_cell_value(cell) for cell in row] for row in result.get("rows", [])]
    return cols, rows


def main():
    env = load_env()
    host = env["TURSO_DATABASE_URL"].replace("libsql://", "https://", 1)
    # libSQL HTTP API 端点必须带 /v2/pipeline 路径
    url = host.rstrip("/") + "/v2/pipeline"
    token = env["TURSO_AUTH_TOKEN"]
    proxy = resolve_proxy(env)
    print(f"Turso 目标: {url}")
    print(f"代理: {proxy or '直连'}")
    out = sys.argv[1] if len(sys.argv) > 1 else str(BASE / "turso_pull.sqlite3")
    if os.path.exists(out):
        os.remove(out)
    conn = sqlite3.connect(out)
    cur = conn.cursor()
    cur.execute("PRAGMA foreign_keys=OFF")

    objs_cols, objs_rows = query(
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

    for name in tables:
        cols, rows = query(url, token, f'SELECT * FROM "{name}"', proxy)
        col_sql = ",".join(f'"{c}"' for c in cols)
        ph = ",".join("?" * len(cols))
        inserted = 0
        for row in rows:
            try:
                cur.execute(f'INSERT INTO "{name}" ({col_sql}) VALUES ({ph})', row)
                inserted += 1
            except sqlite3.Error:
                pass
        print(f"  {name}: {len(rows)} 行(插入 {inserted})")

    ix_cols, ix_rows = query(
        url, token,
        "SELECT sql FROM sqlite_master "
        "WHERE type IN ('index','trigger') AND sql IS NOT NULL",
        proxy,
    )
    for (sql,) in ix_rows:
        try:
            cur.execute(sql)
        except sqlite3.Error:
            pass

    conn.commit()
    conn.close()
    print(f"已写入本地副本: {out}")


if __name__ == "__main__":
    main()
