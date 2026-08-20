#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AnySearch CLI（带 API Key 自动轮换）。

子命令:
  search "query" [options]   联网搜索（自动轮换 key）
  keys                        查看轮换池状态（key 脱敏显示）

search 选项:
  --max_results N          返回结果数 1-20，默认 5
  --tag TAG                垂直域标签，如 finance.quote
  --zone cn|intl           地区
  --language LANG          偏好语言，如 zh-CN / en
  --params JSON            透传扩展参数，JSON 字符串，如 '{"symbol":"AAPL"}'
  --format json|markdown   API 输出格式，默认 json
  --api_key KEY            显式指定 key（绕过轮换，优先级最高）

Key 来源优先级: --api_key > 环境变量 ANYSEARCH_API_KEYS > 环境变量 ANYSEARCH_API_KEY > <skill_dir>/.env
轮换策略: round-robin + 每日计数（默认每 key 1000 次/天，可用环境变量 ANYSEARCH_DAILY_LIMIT 覆盖）；
          401/402/429 自动切换下一个 key 重试；全部 key 失败时自动尝试匿名调用（低限额）。

输出: stdout 恒为 JSON（API 原始响应 + _rotation 元信息），退出码 0 = 成功，1 = 失败，2 = 用法错误。
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.path.join(SKILL_DIR, ".env")
STATE_FILE = os.path.join(SKILL_DIR, ".rotation_state.json")
API_URL = "https://api.anysearch.com/v1/search"
DEFAULT_DAILY_LIMIT = 1000
TIMEOUT = 30
ROTATE_ON_HTTP = (401, 402, 429)


def load_keys():
    keys = []

    def add(val):
        for k in val.replace("\n", ",").split(","):
            k = k.strip().strip('"').strip("'")
            if k and k not in keys:
                keys.append(k)

    for var in ("ANYSEARCH_API_KEYS", "ANYSEARCH_API_KEY"):
        val = os.environ.get(var, "")
        if val:
            add(val)
    if os.path.isfile(ENV_FILE):
        try:
            with open(ENV_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    name, val = line.split("=", 1)
                    if name.strip() in ("ANYSEARCH_API_KEYS", "ANYSEARCH_API_KEY"):
                        add(val)
        except OSError:
            pass
    return keys


def mask(key):
    return (key[:11] + "..." + key[-4:]) if len(key) > 16 else key[:6] + "..."


def load_state():
    today = date.today().isoformat()
    default = {"date": today, "index": 0, "counts": {}, "failed": {}}
    if not os.path.isfile(STATE_FILE):
        return default
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            st = json.load(f)
        if not isinstance(st, dict) or st.get("date") != today:
            return default
        st.setdefault("counts", {})
        st.setdefault("failed", {})
        try:
            st["index"] = int(st.get("index", 0))
        except (TypeError, ValueError):
            st["index"] = 0
        return st
    except (OSError, ValueError):
        return default


def save_state(st):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(st, f, ensure_ascii=False, indent=2)
    except OSError:
        pass


def do_request(query, payload, api_key):
    body = dict(payload)
    body["query"] = query
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    req = urllib.request.Request(
        API_URL, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST"
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        raw = resp.read().decode("utf-8", "replace")
    try:
        return json.loads(raw)
    except ValueError:
        return {"code": -1, "message": "non-JSON response", "raw": raw[:500]}


def daily_limit():
    try:
        return int(os.environ.get("ANYSEARCH_DAILY_LIMIT", str(DEFAULT_DAILY_LIMIT)))
    except ValueError:
        return DEFAULT_DAILY_LIMIT


def emit(obj, code):
    print(json.dumps(obj, ensure_ascii=False, indent=2))
    return code


def build_payload(opts):
    payload = {}
    if "max_results" in opts:
        try:
            mr = int(opts["max_results"])
        except (TypeError, ValueError):
            return None, "--max_results 需要整数"
        if not 1 <= mr <= 20:
            return None, "--max_results 范围 1-20"
        payload["max_results"] = mr
    for src, dst in (("tag", "tag"), ("zone", "zone"), ("language", "language"), ("format", "format")):
        if opts.get(src):
            payload[dst] = opts[src]
    if opts.get("params"):
        try:
            payload["params"] = json.loads(opts["params"])
        except ValueError:
            return None, "--params 需要 JSON 字符串，如 '{\"symbol\":\"AAPL\"}'"
    return payload, None


def cmd_search(args):
    opts, err = parse_opts(args)
    if err:
        return emit({"code": 2, "message": err}, 2)
    if not opts.get("positional"):
        return emit({"code": 2, "message": "缺少查询词: search \"query\" [options]"}, 2)
    query = " ".join(opts["positional"])
    payload, err = build_payload(opts)
    if err:
        return emit({"code": 2, "message": err}, 2)

    keys = load_keys()
    limit = daily_limit()
    st = load_state()

    if opts.get("api_key"):
        try:
            data = do_request(query, payload, opts["api_key"])
        except urllib.error.HTTPError as e:
            return emit({"code": -1, "message": "HTTP %d" % e.code}, 1)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            return emit({"code": -1, "message": str(e)}, 1)
        return emit(data, 0 if data.get("code") == 0 else 1)

    errors = []
    n = len(keys)
    if n:
        for i in range(n):
            key = keys[(st["index"] + i) % n]
            m = mask(key)
            used = int(st["counts"].get(m, 0))
            if used >= limit:
                errors.append({"key": m, "reason": "daily_limit_reached"})
                continue
            try:
                data = do_request(query, payload, key)
            except urllib.error.HTTPError as e:
                st["failed"][m] = e.code
                if e.code in ROTATE_ON_HTTP:
                    errors.append({"key": m, "http_status": e.code, "action": "rotated"})
                    continue
                save_state(st)
                return emit({"code": -1, "message": "HTTP %d" % e.code, "key": m, "errors": errors}, 1)
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                errors.append({"key": m, "error": str(e)})
                continue
            if data.get("code") != 0:
                save_state(st)
                return emit(data, 1)
            st["counts"][m] = used + 1
            idx = keys.index(key)
            st["index"] = (idx + 1) % n
            st["failed"] = {}  # 成功后清除失败标记，避免瞬时故障把 key 永久拉黑
            save_state(st)
            data["_rotation"] = {
                "key": m,
                "used_today": st["counts"][m],
                "daily_limit": limit,
                "pool_size": n,
            }
            return emit(data, 0)

    # 全部 key 不可用 → 匿名兜底（低限额）
    try:
        data = do_request(query, payload, None)
        data["_rotation"] = {
            "mode": "anonymous",
            "note": "所有 key 已用尽或失败，已降级为匿名访问（限额较低）",
            "errors": errors,
        }
        return emit(data, 0 if data.get("code") == 0 else 1)
    except Exception as e:  # noqa: BLE001
        return emit(
            {
                "code": -1,
                "message": "所有 API key 失败，匿名访问也失败",
                "errors": errors,
                "last_error": str(e),
            },
            1,
        )


def cmd_keys():
    keys = load_keys()
    st = load_state()
    limit = daily_limit()
    n = len(keys)
    pool = []
    for i, k in enumerate(keys):
        m = mask(k)
        used = int(st["counts"].get(m, 0))
        pool.append(
            {
                "index": i,
                "key": m,
                "used_today": used,
                "remaining_today": max(limit - used, 0),
                "daily_limit": limit,
                "next_up": bool(n) and i == st["index"] % n,
                "failed_today": st["failed"].get(m),
            }
        )
    return emit(
        {
            "date": st["date"],
            "pool_size": n,
            "next_index": st["index"] % n if n else None,
            "keys": pool,
        },
        0,
    )


def parse_opts(args):
    opts = {"positional": []}
    value_flags = {
        "--max_results": "max_results",
        "--tag": "tag",
        "--zone": "zone",
        "--language": "language",
        "--params": "params",
        "--format": "format",
        "--api_key": "api_key",
    }
    i = 0
    while i < len(args):
        a = args[i]
        if a in value_flags:
            if i + 1 >= len(args):
                return None, "%s 缺少参数值" % a
            opts[value_flags[a]] = args[i + 1]
            i += 2
            continue
        if a in ("-h", "--help"):
            opts["help"] = True
        else:
            opts["positional"].append(a)
        i += 1
    return opts, None


def main():
    argv = sys.argv[1:]
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0
    cmd = argv[0]
    if cmd == "search":
        return cmd_search(argv[1:])
    if cmd == "keys":
        return cmd_keys()
    print("未知命令: %s" % cmd, file=sys.stderr)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
