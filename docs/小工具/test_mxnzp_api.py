#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
测试脚本：MXNZP 节假日/万年历 API
==================================

从 config/.env 读取 MXNZP_APP_ID 和 MXNZP_APP_SECRET，
调用 https://www.mxnzp.com/api/holiday/single/{date} 接口，
验证 API 可正常返回数据。

用法：
    python scripts/test_mxnzp_api.py                     # 测试今天
    python scripts/test_mxnzp_api.py --date 20260101     # 测试指定日期
    python scripts/test_mxnzp_api.py --verbose           # 显示完整响应
"""

import argparse
import json
import os
import sys
from datetime import datetime, date
from pathlib import Path

# ── 项目路径 ──────────────────────────────────────────────
_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

# ── 加载 .env ────────────────────────────────────────────
ENV_PATH = _ROOT / "config" / ".env"
try:
    from dotenv import load_dotenv

    load_dotenv(ENV_PATH)
except ImportError:
    # 手动解析 .env 文件
    if ENV_PATH.exists():
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    os.environ.setdefault(key, value)

# ── 从环境变量读取凭据 ────────────────────────────────────
APP_ID = os.getenv("MXNZP_APP_ID")
APP_SECRET = os.getenv("MXNZP_APP_SECRET")

BASE_URL = "https://www.mxnzp.com/api/holiday/single"


def test_single_date(date_str: str, ignore_holiday: bool = False, verbose: bool = False) -> dict:
    """
    测试获取指定日期的节假日及万年历信息。

    API: GET https://www.mxnzp.com/api/holiday/single/{date}
    参数:
        date:          日期，格式 yyyyMMdd
        ignoreHoliday: 是否忽略节假日，仅仅获取万年历，默认 false
        app_id:        应用 ID
        app_secret:    应用密钥
    """
    import requests

    params = {
        "app_id": APP_ID,
        "app_secret": APP_SECRET,
        "ignoreHoliday": str(ignore_holiday).lower(),
    }
    url = f"{BASE_URL}/{date_str}"

    print(f"\n{'=' * 60}")
    print(f"📅 测试日期: {date_str}")
    print(f"🌐 请求 URL: {url}")
    print(f"🔑 app_id:   {APP_ID[:4]}...{APP_ID[-4:]}")
    print(f"🔒 参数:     ignoreHoliday={ignore_holiday}")
    print(f"{'=' * 60}")

    resp = requests.get(url, params=params, timeout=15)
    data = resp.json()

    print(f"\n📋 响应状态码: {resp.status_code}")
    print(f"📋 code:       {data.get('code')}")
    print(f"📋 msg:        {data.get('msg')}")

    if data.get("code") == 1:
        d = data.get("data", {})
        print(f"\n✅ 请求成功！返回数据:")
        print(f"  日期:          {d.get('date')}")
        print(f"  星期:          {d.get('weekDay')} (1=周一 … 7=周日)")
        print(f"  农历:          {d.get('lunarCalendar')}")
        print(f"  天干地支:      {d.get('yearTips')}")
        print(f"  属相:          {d.get('chineseZodiac')}")
        print(f"  节气:          {d.get('solarTerms')}")
        print(f"  星座:          {d.get('constellation')}")
        print(f"  类型:          {d.get('typeDes', '未返回')}")
        print(f"  宜:            {d.get('suit', '无')}")
        print(f"  忌:            {d.get('avoid', '无')}")
        print(f"  一年第几天:    {d.get('dayOfYear')}")
        print(f"  一年第几周:    {d.get('weekOfYear')}")

        if verbose:
            print(f"\n📦 完整响应:")
            print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print(f"\n❌ 请求失败！")
        print(f"   完整响应: {json.dumps(data, ensure_ascii=False, indent=2)}")

    return data


def test_today(verbose: bool = False):
    """测试今天的日期"""
    today_str = date.today().strftime("%Y%m%d")
    print(f"\n{'#' * 60}")
    print(f"#  测试 1：获取今天的节假日/万年历信息")
    print(f"{'#' * 60}")
    return test_single_date(today_str, ignore_holiday=False, verbose=verbose)


def test_verbose_date(verbose: bool = False):
    """测试一个已知的日期（包含更丰富的信息）"""
    print(f"\n{'#' * 60}")
    print(f"#  测试 2：测试指定日期 (ignoreHoliday=false)")
    print(f"{'#' * 60}")
    return test_single_date("20260101", ignore_holiday=False, verbose=verbose)


def test_ignore_holiday(verbose: bool = False):
    """测试忽略节假日，仅获取万年历"""
    print(f"\n{'#' * 60}")
    print(f"#  测试 3：测试 ignoreHoliday=true (仅万年历)")
    print(f"{'#' * 60}")
    return test_single_date("20261001", ignore_holiday=True, verbose=verbose)


def main():
    parser = argparse.ArgumentParser(description="MXNZP 节假日/万年历 API 测试脚本")
    parser.add_argument(
        "--date", type=str, default="",
        help="指定日期 (格式: yyyyMMdd)，不指定则测试今天"
    )
    parser.add_argument(
        "--ignore-holiday", action="store_true",
        help="是否忽略节假日，仅获取万年历"
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
        help="显示完整 JSON 响应"
    )
    parser.add_argument(
        "--all", action="store_true",
        help="运行所有测试"
    )
    args = parser.parse_args()

    # ── 验证凭据 ──────────────────────────────────────
    if not APP_ID or not APP_SECRET:
        print("❌ 错误：未找到 MXNZP_APP_ID 或 MXNZP_APP_SECRET")
        print(f"   请确保 config/.env 文件中包含以下内容：")
        print(f"   MXNZP_APP_ID=your_app_id")
        print(f"   MXNZP_APP_SECRET=your_app_secret")
        print(f"\n   当前读取的 .env 路径: {ENV_PATH}")
        print(f"   文件存在: {ENV_PATH.exists()}")
        sys.exit(1)

    print(f"🔑 凭据加载成功:")
    print(f"   MXNZP_APP_ID:     {APP_ID[:4]}...{APP_ID[-4:]}")
    print(f"   MXNZP_APP_SECRET: {APP_SECRET[:4]}...{APP_SECRET[-4:]}")
    print(f"   路径: {ENV_PATH}")

    try:
        import requests
    except ImportError:
        print("❌ 错误：需要 requests 库，请运行: pip install requests")
        sys.exit(1)

    if args.all:
        # 运行所有测试
        results = []
        results.append(test_today(verbose=args.verbose))
        results.append(test_verbose_date(verbose=args.verbose))
        results.append(test_ignore_holiday(verbose=args.verbose))

        print(f"\n{'=' * 60}")
        print(f"📊 测试汇总")
        print(f"{'=' * 60}")
        for i, r in enumerate(results, 1):
            status = "✅ 通过" if r.get("code") == 1 else "❌ 失败"
            print(f"  测试 {i}: {status}")

        all_passed = all(r.get("code") == 1 for r in results)
        if all_passed:
            print(f"\n🎉 所有测试通过！API 调用正常。")
        else:
            print(f"\n⚠️  部分测试未通过，请检查返回信息。")
    elif args.date:
        test_single_date(args.date, ignore_holiday=args.ignore_holiday, verbose=args.verbose)
    else:
        test_today(verbose=args.verbose)


if __name__ == "__main__":
    main()
