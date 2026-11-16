#!/usr/bin/env python3
"""镜像源抓取：500.com 排列5 开奖 XML（境外可直连）。

背景：官方接口 webapi.sporttery.cn 在腾讯 EdgeOne 上，会对 GitHub Actions
等境外数据中心 IP 返回 HTTP 567（WAF 拦截页），因此境外自动化改为：
  1) 先尝试官方接口（fetch_data.py）；
  2) 官方被拦时，用本脚本从 500.com 的静态 XML 镜像取数；
  3) 写入前必须与本地已有的官方数据做「重叠期逐条校验」，任何一条号码/日期
     不一致就拒绝写入（宁可停在旧数据，也不写错数据）。

镜像地址（静态 XML，非接口，仅公开开奖信息）：
  https://kaijiang.500.com/static/info/kaijiang/xml/plw/list.xml
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen

MIRROR_URL = os.getenv("MIRROR_URL",
                       "https://kaijiang.500.com/static/info/kaijiang/xml/plw/list.xml")
TARGET = int(os.getenv("MIRROR_TARGET", "500"))
OUT = Path(os.getenv("OUT_PATH", "data/draws.json"))
TIMEOUT = int(os.getenv("MIRROR_TIMEOUT", "25"))

ROW_RE = re.compile(r'<row\s+expect="(\d+)"\s+opencode="([\d,]+)"\s+opentime="([^"]*)"')
MIN_OVERLAP = 50          # 至少要有 50 期重叠样本才校验
MAX_MISMATCH = 0          # 允许的不一致条数（严格为 0）


def fetch_xml() -> str:
    req = Request(MIRROR_URL, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/xml,text/xml,*/*",
        "Referer": "https://kaijiang.500.com/plw.shtml",
    })
    with urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read().decode("utf-8", "replace")


def parse_rows(xml: str):
    out = []
    for period, opencode, opentime in ROW_RE.findall(xml):
        digits = "".join(re.findall(r"\d", opencode))
        if len(digits) != 5:
            continue
        out.append({
            "period": period,
            "date": opentime[:10],
            "number": digits,
        })
    out.sort(key=lambda x: int(x["period"]), reverse=True)
    return out


def load_existing():
    if not OUT.exists():
        return None
    try:
        return json.loads(OUT.read_text(encoding="utf-8"))
    except Exception:
        return None


def validate(records, existing):
    """与本地已有数据做重叠期校验，返回 (overlap, mismatch_list)。"""
    if not existing:
        return 0, []
    old = {str(d["period"]): d for d in existing.get("draws", [])}
    overlap, mism = 0, []
    for r in records:
        o = old.get(r["period"])
        if not o:
            continue
        overlap += 1
        if o.get("number") != r["number"] or o.get("date") != r["date"]:
            mism.append((r["period"], o.get("number"), r["number"], o.get("date"), r["date"]))
    return overlap, mism


def check_mode():
    """exit 0 = 无新数据；exit 2 = 有新数据；exit 1 = 失败"""
    try:
        records = parse_rows(fetch_xml())
        if not records:
            print("MIRROR CHECK: 解析不到记录", flush=True)
            sys.exit(1)
        latest = records[0]
        existing = load_existing()
        if not existing:
            print(f"MIRROR CHECK: 本地无数据, 需全量写入 (latest={latest['period']})", flush=True)
            sys.exit(2)
        file_latest = str(existing.get("meta", {}).get("latest_issue", ""))
        overlap, mism = validate(records, existing)
        if overlap < MIN_OVERLAP or len(mism) > MAX_MISMATCH:
            print(f"MIRROR CHECK: 校验未通过 overlap={overlap} mismatch={len(mism)} {mism[:3]}", flush=True)
            sys.exit(1)
        if latest["period"] != file_latest:
            print(f"MIRROR CHECK: 新数据! mirror={latest['period']}({latest['date']} {latest['number']}) "
                  f"vs file={file_latest} | 重叠校验 {overlap} 期全部一致", flush=True)
            sys.exit(2)
        print(f"MIRROR CHECK: 无变化 latest={latest['period']} (重叠校验 {overlap} 期一致)", flush=True)
        sys.exit(0)
    except SystemExit:
        raise
    except Exception as exc:
        print(f"MIRROR CHECK: 错误 {exc}", flush=True)
        sys.exit(1)


def main():
    records = parse_rows(fetch_xml())
    if not records:
        raise RuntimeError("镜像 XML 解析失败")
    records = records[:TARGET]

    for r in records:
        assert re.fullmatch(r"\d{5}", r["number"]), f"号码非五位: {r}"
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", r["date"]), f"日期异常: {r}"
    assert len({r["period"] for r in records}) == len(records), "重复期号"

    existing = load_existing()
    overlap, mism = validate(records, existing)
    if existing:
        if overlap < MIN_OVERLAP:
            raise RuntimeError(f"与本地数据重叠仅 {overlap} 期，样本不足，拒绝写入")
        if len(mism) > MAX_MISMATCH:
            raise RuntimeError(f"与本地数据存在 {len(mism)} 条不一致，拒绝写入: {mism[:3]}")

    result = {
        "meta": {
            "source": f"{MIRROR_URL}（500.com 静态镜像；官方接口对境外数据中心 IP 返回 567，改由境外可达镜像取数）",
            "official_source": "https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry?gameNo=350133",
            "game_no": "350133",
            "game_name": "排列5",
            "records": len(records),
            "latest_issue": records[0]["period"],
            "latest_date": records[0]["date"],
            "status": "mirror fetch (mirror 与官方历史数据逐条校验通过)",
            "verification": (f"与本地官方数据重叠 {overlap} 期，号码/日期不一致 {len(mism)} 条"
                             if existing else "本地暂无历史数据，未做重叠校验"),
            "note": "号码为五位开奖号码字符串（保留前导零）；按期号新→旧排序",
        },
        "draws": records,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(OUT)
    print(f"Saved {len(records)} draws (mirror) | latest={records[0]['period']} "
          f"{records[0]['date']} {records[0]['number']} | 校验重叠 {overlap} 期/不一致 {len(mism)}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="排列5 镜像源抓取（500.com XML）")
    parser.add_argument("--check", action="store_true", help="轻量检查模式（不写文件）")
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
