#!/usr/bin/env python3
"""Fetch latest 500 排列5 (Pailie 5) draws from the China Sports Lottery
official public endpoint and write them to data/draws.json atomically.

- 官方来源：中国体彩网（国家体育总局体育彩票管理中心）
- 接口：webapi.sporttery.cn ... gameNo=350133（腾讯 EdgeOne CDN，海外可达）
- pageSize=500 一次请求取全部 500 期，无需分页
- 仅使用标准库；不绕过验证码/登录/WAF/频率限制；失败时旧文件保持不变
- number 为完整五位开奖号码（字符串，保留前导零）
- --check 模式：仅拉取 1 条比较最新期号，不写文件，供轮询使用
- PROXY_URL 环境变量（可选）：直连失败时走中继兜底
"""
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

URL = os.getenv("SPORTTERY_API_URL",
               "https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry")
GAME_NO = os.getenv("SPORTTERY_GAME_NO", "350133")
PAGE_SIZE = int(os.getenv("SPORTTERY_PAGE_SIZE", "100"))  # API 每页上限 100
TARGET = int(os.getenv("SPORTTERY_TARGET", "500"))
MAX_PAGES = int(os.getenv("SPORTTERY_MAX_PAGES", "6"))  # 6×100=600，去重后取 500
MAX_RETRIES = int(os.getenv("SPORTTERY_MAX_RETRIES", "3"))
OUT = Path(os.getenv("OUT_PATH", "data/draws.json"))
PROXY_URL = os.getenv("PROXY_URL", "")  # 可选中继，直连失败时兜底


def build_url(page: int, size: int = PAGE_SIZE) -> str:
    params = f"?gameNo={GAME_NO}&provinceId=0&pageSize={size}&isVerify=1&pageNo={page}"
    if PROXY_URL:
        return PROXY_URL.rstrip("/") + params
    return URL + params


def request_page(page: int, size: int = PAGE_SIZE):
    """请求一页数据。优先直连；设了 PROXY_URL 则走中继。"""
    full_url = build_url(page, size)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": "https://www.lottery.gov.cn/",
    }
    label = "proxy" if PROXY_URL else "direct"
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            req = Request(full_url, headers=headers)
            with urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8", "replace")
            data = json.loads(raw)
            if not isinstance(data, dict) or not data.get("value"):
                print(f"[warn:{label}] 响应缺少 value 字段, 前200字符: {raw[:200]}", flush=True)
            return data
        except (HTTPError, URLError) as exc:
            if attempt < MAX_RETRIES:
                wait = 3 * attempt
                print(f"[{label} retry {attempt}/{MAX_RETRIES}] page {page}: {exc}; sleep {wait}s", flush=True)
                time.sleep(wait)
                continue
            raise RuntimeError(f"page {page} [{label}] 连续 {MAX_RETRIES} 次失败: {exc}") from exc
    raise RuntimeError(f"page {page} [{label}] retries exhausted")


def parse_records(payload):
    """从官方响应中抽取 {period, date, number(五位)} 记录。"""
    found = {}
    value = payload.get("value") or {}
    items = value.get("list") or []
    for item in items:
        period = item.get("lotteryDrawNum") or item.get("lotteryDrawNo") or item.get("expect")
        raw = item.get("lotteryDrawResult") or item.get("lotteryDrawResultDesc") or ""
        date = item.get("lotteryDrawTime") or item.get("openTime") or ""
        if not period or raw is None:
            continue
        digits = re.findall(r"\d", str(raw))
        if len(digits) != 5:
            digits = list(re.sub(r"\D", "", str(raw)))
        if len(digits) != 5:
            continue
        found[str(period)] = {
            "period": str(period),
            "date": str(date)[:10],
            "number": "".join(digits),
        }
    return list(found.values())


def check_mode():
    """轻量检查：拉取 1 条比较最新期号。不写文件。
    exit 0 = 无变化; exit 2 = 有新数据; exit 1 = 错误
    """
    try:
        payload = request_page(1, size=1)
        batch = parse_records(payload)
        if not batch:
            print("CHECK: API 无数据", flush=True)
            sys.exit(1)
        api_latest = batch[0]["period"]
        api_date = batch[0]["date"]
        api_number = batch[0]["number"]

        if not OUT.exists():
            print(f"CHECK: 文件不存在, 需全量拉取 (API latest={api_latest})", flush=True)
            sys.exit(2)

        existing = json.loads(OUT.read_text(encoding="utf-8"))
        file_latest = str(existing.get("meta", {}).get("latest_issue", ""))

        if api_latest != file_latest:
            print(f"CHECK: 新数据! API={api_latest}({api_date} {api_number}) vs FILE={file_latest}", flush=True)
            sys.exit(2)
        else:
            print(f"CHECK: 无变化 latest={api_latest}", flush=True)
            sys.exit(0)
    except SystemExit:
        raise
    except Exception as exc:
        print(f"CHECK: 错误 {exc}", flush=True)
        sys.exit(1)


def main():
    records = []
    for page in range(1, MAX_PAGES + 1):
        try:
            payload = request_page(page)
            batch = parse_records(payload)
            if not batch:
                if page == 1:
                    raise RuntimeError("接口响应中未找到开奖号码字段")
                break
            records.extend(batch)
            print(f"page {page}: +{len(batch)} (累计 {len(records)})", flush=True)
            if len(records) >= TARGET:
                break
            time.sleep(1)
        except Exception as exc:
            if page == 1:
                raise
            print(f"[warn] page {page}: {exc}", flush=True)
            break

    unique = {x["period"]: x for x in records}
    records = sorted(unique.values(), key=lambda x: (int(x["period"]), x["date"]), reverse=True)[:TARGET]

    if len(records) < 100:
        raise RuntimeError(f"仅取得 {len(records)} 期，少于 100 期阈值，拒绝覆盖")

    for r in records:
        assert re.fullmatch(r"\d{5}", r["number"]), f"号码非五位: {r}"
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", r["date"]), f"日期异常: {r}"
    assert len({r["period"] for r in records}) == len(records), "重复期号"

    OUT.parent.mkdir(parents=True, exist_ok=True)
    result = {
        "meta": {
            "source": f"{URL}?gameNo={GAME_NO}",
            "game_no": GAME_NO,
            "game_name": "排列5",
            "records": len(records),
            "latest_issue": records[0]["period"],
            "latest_date": records[0]["date"],
            "status": "official endpoint fetch",
            "note": "号码为官方五位开奖号码字符串（保留前导零）；按期号新→旧排序",
        },
        "draws": records,
    }
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(OUT)
    print(f"Saved {len(records)} draws | latest={records[0]['period']} {records[0]['date']} {records[0]['number']}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="排列5 开奖数据抓取")
    parser.add_argument("--check", action="store_true", help="轻量检查模式")
    args = parser.parse_args()
    try:
        if args.check:
            check_mode()
        else:
            main()
    except SystemExit:
        raise
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
