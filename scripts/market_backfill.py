"""One-off download of price, flow and generation-mix history.

  prices  day-ahead prices for France and its neighbours from 5 Jan 2015
          (ENTSO-E, one call per zone and year)
  flows   physical flows on each French border, both directions, from 2015
  mix     French generation by fuel: hourly 2015-16, 15-minute from 2017 (RTE)

Run by .github/workflows/backfill-market.yml. Safe to re-run: rows are merged.
"""

import argparse
import time
import traceback
from datetime import datetime, timedelta, timezone

from market_store import (
    BORDERS, PRICE_ZONES, fetch_flows, fetch_mix15, fetch_per_type, fetch_prices, paris_midnight,
    store_flows, store_mix, store_prices,
)
from rte_client import RteClient
from store import PARIS

UTC = timezone.utc


def year_windows(first_year, end):
    windows = []
    y = first_year
    while True:
        a = datetime(y, 1, 1, tzinfo=PARIS).astimezone(UTC)
        if a >= end:
            break
        b = min(datetime(y + 1, 1, 1, tzinfo=PARIS).astimezone(UTC), end)
        windows.append((a, b))
        y += 1
    return windows


def backfill_prices(first_year, zones):
    end = paris_midnight(datetime.now(PARIS).date() + timedelta(days=2)).astimezone(UTC)
    for zone in zones:
        total = 0
        for a, b in year_windows(first_year, end):
            points = fetch_prices(zone, a, b)
            total += store_prices(zone, points)
            print(f"  prices {zone} {a:%Y}: {len(points)} periods")
            time.sleep(1)
        print(f"Prices {zone}: {total} rows added or changed")


def backfill_flows(first_year, borders):
    end = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    for border in borders:
        total = 0
        for a, b in year_windows(first_year, end):
            points = fetch_flows(border, a, b)
            total += store_flows(border, points)
            print(f"  flows {border} {a:%Y}: {len(points)} periods")
            time.sleep(1)
        print(f"Flows {border}: {total} rows added or changed")


def backfill_mix(first_year):
    client = RteClient(api="generation", pause_seconds=1.2)
    today = datetime.now(PARIS).date()
    day = datetime(first_year, 1, 1).date()
    total = 0
    switch = datetime(2017, 1, 1).date()
    while day < min(switch, today):
        nxt = min(day + timedelta(days=150), switch)
        recs = fetch_per_type(client, paris_midnight(day), paris_midnight(nxt))
        total += store_mix(recs)
        print(f"  mix (hourly) {day} to {nxt}: {len(recs)} periods")
        day = nxt
    day = max(day, switch)
    while day <= today:
        nxt = min(day + timedelta(days=14), today + timedelta(days=1))
        recs = fetch_mix15(client, paris_midnight(day), paris_midnight(nxt))
        total += store_mix(recs)
        print(f"  mix (15-min) {day} to {nxt}: {len(recs)} periods")
        day = nxt
    print(f"Mix: {total} rows added or changed")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--datasets", default="prices,flows,mix")
    parser.add_argument("--first-year", type=int, default=2015)
    parser.add_argument("--zones", default=",".join(PRICE_ZONES))
    parser.add_argument("--borders", default=",".join(BORDERS))
    args = parser.parse_args()
    wanted = [d.strip() for d in args.datasets.split(",") if d.strip()]
    failures = []
    for name in wanted:
        print(f"== {name}")
        try:
            if name == "prices":
                backfill_prices(args.first_year, args.zones.split(","))
            elif name == "flows":
                backfill_flows(args.first_year, args.borders.split(","))
            elif name == "mix":
                backfill_mix(args.first_year)
        except Exception as error:
            traceback.print_exc()
            failures.append(f"{name}: {error}")
    if failures:
        print("FAILED:", failures)
        if len(failures) == len(wanted):
            raise SystemExit(1)


if __name__ == "__main__":
    main()
