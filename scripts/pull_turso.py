#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""将 Turso 远程数据库(ashare-pyramid-server)的最新内容拉到本地 SQLite 副本。
用法: python3 scripts/pull_turso.py [输出路径]
默认输出到 workspace 根目录下 turso_pull.sqlite3
"""
import json
import os
import sqlite3
import sys
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent


def load_env():
    env = {}
    for line in (BASE / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip()
    return env


def query(url, token, q, params=None):
    body = json.dumps({"statements": [{"q": q, "params": params or []}]}).encode()
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def main():
    env = load_env()
    url = env["TURSO_DATABASE_URL"].replace("libsql://", "https://", 1)
    token = env["TURSO_AUTH_TOKEN"]
    out = sys.argv[1] if len(sys.argv) > 1 else str(BASE / "turso_pull.sqlite3")
    if os.path.exists(out):
        os.remove(out)
    conn = sqlite3.connect(out)
    cur = conn.cursor()
    cur.execute("PRAGMA foreign_keys=OFF")

    objs = query(
        url, token,
        "SELECT name, sql FROM sqlite_master "
        "WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' "
        "ORDER BY type, name",
    )[0]["results"]["rows"]
    tables = [n for n, s in objs if s and s.lstrip().lower().startswith(("create table",))]

    for name, sql in objs:
        if sql:
            try:
                cur.execute(sql)
            except sqlite3.OperationalError as e:
                print(f"  [skip 建表] {name}: {e}")

    for name in tables:
        res = query(url, token, f'SELECT * FROM "{name}"')[0]["results"]
        cols = res["columns"]
        rows = res["rows"]
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

    extras = query(
        url, token,
        "SELECT sql FROM sqlite_master "
        "WHERE type IN ('index','trigger') AND sql IS NOT NULL",
    )[0]["results"]["rows"]
    for (sql,) in extras:
        try:
            cur.execute(sql)
        except sqlite3.Error:
            pass

    conn.commit()
    conn.close()
    print(f"已写入本地副本: {out}")


if __name__ == "__main__":
    main()