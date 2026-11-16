#!/usr/bin/env python3
"""Fetch latest 500 排列5 (Pailie 5) draws from the China Sports Lottery
official public endpoint and write them to data/draws.json atomically.

- 官方来源：中国体彩网（国家体育总局体育彩票管理中心）
- 接口：webapi.sporttery.cn ... gameNo=350133
- 仅使用标准库；不绕过验证码/登录/WAF/频率限制；失败时旧文件保持不变。
- number 为完整五位开奖号码（字符串，保留前导零）。
- --check 模式：仅拉取第 1 页比较最新期号，不写文件，供轮询使用。
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
PAGE_SIZE = int(os.getenv("SPORTTERY_PAGE_SIZE", "100"))
TARGET = int(os.getenv("SPORTTERY_TARGET", "500"))
MAX_PAGES = int(os.getenv("SPORTTERY_MAX_PAGES", "6"))
MAX_RETRIES = int(os.getenv("SPORTTERY_MAX_RETRIES", "4"))
OUT = Path(os.getenv("OUT_PATH", "data/draws.json"))


def request_page(page: int):
    params = f"?gameNo={GAME_NO}&provinceId=0&pageSize={PAGE_SIZE}&isVerify=1&pageNo={page}"
    req = Request(URL + params, headers={
        "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.lottery.gov.cn/",
    })
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urlopen(req, timeout=25) as resp:
                raw = resp.read().decode("utf-8", "replace")
            return json.loads(raw)
        except (HTTPError, URLError) as exc:
            if attempt < MAX_RETRIES:
                wait = 10 * attempt
                print(f"[retry {attempt}/{MAX_RETRIES}] page {page}: {exc}; sleep {wait}s", flush=True)
                time.sleep(wait)
                continue
            raise RuntimeError(f"page {page} 连续 {MAX_RETRIES} 次失败: {exc}") from exc
    raise RuntimeError(f"page {page} retries exhausted")


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
        digits = re.findall(r"\d", str(raw))  # 逐位取数字，保留前导零
        if len(digits) != 5:
            digits = list(re.sub(r"\D", "", str(raw)))
        if len(digits) != 5:
            print(f"[skip] period={period} 号码位数异常: {raw!r}", flush=True)
            continue
        found[str(period)] = {
            "period": str(period),
            "date": str(date)[:10],
            "number": "".join(digits),
        }
    return list(found.values())


def check_mode():
    """轻量检查：拉取第 1 页，比较最新期号是否变化。不写文件。
    exit 0 = 无变化; exit 2 = 有新数据需全量拉取; exit 1 = 错误
    """
    try:
        payload = request_page(1)
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
    errors = []
    for page in range(1, MAX_PAGES + 1):
        try:
            payload = request_page(page)
            batch = parse_records(payload)
            if not batch:
                if page == 1:
                    raise RuntimeError("接口响应中未找到期号及开奖号码字段，需核对官方响应结构。")
                break
            records.extend(batch)
            print(f"page {page}: +{len(batch)} (累计 {len(records)})", flush=True)
            if len(records) >= TARGET:
                break
            time.sleep(1.5)
        except Exception as exc:
            errors.append(f"page {page}: {exc}")
            if page == 1:
                raise
            break

    unique = {x["period"]: x for x in records}
    records = sorted(unique.values(), key=lambda x: (int(x["period"]), x["date"]), reverse=True)[:TARGET]

    if len(records) < 100:
        raise RuntimeError(
            f"仅取得 {len(records)} 期，少于最低 100 期阈值；拒绝覆盖旧数据。错误：{errors}"
        )

    # 自检
    for r in records:
        assert re.fullmatch(r"\d{5}", r["number"]), f"号码非五位: {r}"
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", r["date"]), f"日期异常: {r}"
    assert len({r["period"] for r in records}) == len(records), "存在重复期号"

    OUT.parent.mkdir(parents=True, exist_ok=True)
    result = {
        "meta": {
            "source": f"{URL}?gameNo={GAME_NO}",
            "game_no": GAME_NO,
            "game_name": "排列5",
            "records": len(records),
            "latest_issue": records[0]["period"],
            "latest_date": records[0]["date"],
            "status": "official endpoint fetch; verify against official publication",
            "note": "号码为官方五位开奖号码字符串（保留前导零）；按期号新→旧排序。",
        },
        "draws": records,
    }
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(OUT)
    print(f"Saved {len(records)} draws to {OUT} | latest={records[0]['period']} {records[0]['date']} {records[0]['number']}", flush=True)
    if errors:
        print("Warnings:", "; ".join(errors), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="排列5 开奖数据抓取")
    parser.add_argument("--check", action="store_true",
                        help="轻量检查模式：仅比较最新期号，不写文件")
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
