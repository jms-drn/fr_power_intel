"""One-off download of hourly output per nuclear reactor since Dec 2014.

RTE's actual_generations_per_unit allows at most 7 days per call, so a run
makes about 52 calls a year (about 620 since Dec 2014). Each call is spaced
out and retried on errors; failed weeks are listed at the end and the run can
simply be repeated to fill them (stored data is merged).

Writes
  data/nuclear/unit_hourly/YYYY/YYYY-MM.csv   start_utc, one column per reactor EIC (MW)
  data/nuclear/unit_hourly/units.json         EIC -> reactor name as RTE gives it
  data/nuclear/unit_output_daily/YYYY.csv     date, daily mean MW per reactor EIC
"""

import argparse
import csv
import json
import sys
import time
import traceback
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from power_store import fetch_unit_output, paris_midnight_dt  # noqa: E402
from rte_client import RteClient  # noqa: E402
from store import DATA_DIR, PARIS, parse_ts  # noqa: E402

UTC = timezone.utc
BASE = DATA_DIR / "nuclear" / "unit_hourly"
DAILY = DATA_DIR / "nuclear" / "unit_output_daily"
NAMES = BASE / "units.json"


def month_of(key):
    return parse_ts(key).astimezone(PARIS).strftime("%Y-%m")


def flush(month, rows):
    """Merge {start_utc: {eic: mw}} into the month's wide CSV."""
    path = BASE / month[:4] / f"{month}.csv"
    stored = {}
    if path.exists():
        with path.open(newline="") as handle:
            for r in csv.DictReader(handle):
                stored[r["start_utc"]] = {k: v for k, v in r.items() if k != "start_utc" and v != ""}
    for t, vals in rows.items():
        stored.setdefault(t, {}).update({k: str(v) for k, v in vals.items()})
    eics = sorted({e for vals in stored.values() for e in vals})
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as handle:
        w = csv.writer(handle, lineterminator="\n")
        w.writerow(["start_utc", *eics])
        for t in sorted(stored):
            w.writerow([t, *[stored[t].get(e, "") for e in eics]])


def build_daily():
    """Daily mean output per reactor from the hourly files (days with at least 20 hours)."""
    by_year = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    for path in sorted(BASE.glob("*/*.csv")):
        with path.open(newline="") as handle:
            for r in csv.DictReader(handle):
                d = parse_ts(r["start_utc"]).astimezone(PARIS).date().isoformat()
                for eic, v in r.items():
                    if eic != "start_utc" and v != "":
                        by_year[d[:4]][d][eic].append(float(v))
    DAILY.mkdir(parents=True, exist_ok=True)
    for year, days in by_year.items():
        eics = sorted({e for vals in days.values() for e in vals})
        with (DAILY / f"{year}.csv").open("w", newline="") as handle:
            w = csv.writer(handle, lineterminator="\n")
            w.writerow(["date", *eics])
            for d in sorted(days):
                w.writerow([d, *[round(sum(days[d][e]) / len(days[d][e])) if len(days[d].get(e, [])) >= 20 else "" for e in eics]])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2014-12-15")
    parser.add_argument("--end", default="")
    parser.add_argument("--pause", type=float, default=3.0)
    args = parser.parse_args()
    client = RteClient(api="generation", pause_seconds=args.pause)
    day = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end) if args.end else datetime.now(PARIS).date()
    names = json.loads(NAMES.read_text()) if NAMES.exists() else {}
    buffer = defaultdict(dict)  # month -> {t: {eic: mw}}
    failures = []
    calls = 0
    while day < end:
        nxt = min(day + timedelta(days=7), end)
        units = None
        for attempt in range(1, 5):
            try:
                units = fetch_unit_output(client, paris_midnight_dt(day), paris_midnight_dt(nxt))
                break
            except Exception as error:  # noqa: BLE001
                print(f"  {day}: attempt {attempt} failed: {error}", file=sys.stderr)
                time.sleep(30 * attempt)
        calls += 1
        if units is None:
            failures.append(day.isoformat())
        else:
            n = 0
            for eic, entry in units.items():
                names[eic] = entry["name"]
                for t, v in entry["values"].items():
                    buffer[month_of(t)].setdefault(t, {})[eic] = v
                    n += 1
            print(f"  {day} to {nxt}: {len(units)} reactors, {n} values")
        # Write months that are complete.
        current = day.strftime("%Y-%m")
        for month in [m for m in buffer if m < current]:
            flush(month, buffer.pop(month))
        day = nxt
    for month in list(buffer):
        flush(month, buffer.pop(month))
    BASE.mkdir(parents=True, exist_ok=True)
    NAMES.write_text(json.dumps(names, indent=1, sort_keys=True))
    build_daily()
    print(f"Done: {calls} calls, {len(names)} reactors, {len(failures)} failed weeks")
    if failures:
        print("Failed weeks (re-run with --start to fill):", ", ".join(failures))
        if len(failures) > calls / 2:
            sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise
