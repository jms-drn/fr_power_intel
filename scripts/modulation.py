"""Per-reactor nuclear modulation against the French day-ahead price.

For every reactor, month and price band, counts the hours the reactor was
running, the energy it left unused (available minus output) and the hours it
was modulating, i.e. producing less than 70 / 80 / 90 / 95% of its available
capacity. Called from market_summarise.py (after prices are updated).

A reactor counts as running in an hour when both its available capacity and
its output are at least 10% of its capacity, so outages and start-ups are
left out.

Inputs  data/nuclear/unit_avail/YYYY/YYYY-MM.csv   (hourly available MW, by EIC)
        data/nuclear/unit_hourly/YYYY/YYYY-MM.csv  (hourly output MW, by EIC)
        data/prices/FR/YYYY/YYYY-MM.csv            (day-ahead prices)
Output  data/nuclear/modulation/YYYY.csv
        month, eic, band, hours, unused_mwh, m70, m80, m90, m95
"""

import csv
import json
from collections import defaultdict
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from store import DATA_DIR, PARIS, fmt_utc, parse_ts  # noqa: E402

NUC = DATA_DIR / "nuclear"
OUT_DIR = NUC / "modulation"
CUTS = [70, 80, 90, 95]
# Price bands (EUR/MWh): below 0, then 0-10, 10-20, 20-30, 30-40, 40-50, above 50.
BANDS = ["neg", "0-10", "10-20", "20-30", "30-40", "40-50", "50+"]
RUNNING_SHARE = 0.1


def band_of(p):
    if p < 0:
        return "neg"
    if p >= 50:
        return "50+"
    lo = int(p // 10) * 10
    return f"{lo}-{lo + 10}"


def read(path):
    if not path.exists():
        return []
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def hourly_prices(month):
    acc = defaultdict(lambda: [0.0, 0])
    for r in read(DATA_DIR / "prices" / "FR" / month[:4] / f"{month}.csv"):
        t = parse_ts(r["start_utc"])
        h = fmt_utc(t.replace(minute=0))
        m = int(r.get("min") or 60)
        acc[h][0] += float(r["eur"]) * m
        acc[h][1] += m
    return {h: s / m for h, (s, m) in acc.items() if m >= 59}


def month_rows(month, caps):
    avail = {r["start_utc"]: r for r in read(NUC / "unit_avail" / month[:4] / f"{month}.csv")}
    output = {r["start_utc"]: r for r in read(NUC / "unit_hourly" / month[:4] / f"{month}.csv")}
    prices = hourly_prices(month)
    acc = defaultdict(lambda: [0, 0.0, 0, 0, 0, 0])
    for t, orow in output.items():
        p = prices.get(t)
        arow = avail.get(t)
        if p is None or arow is None:
            continue
        b = band_of(p)
        for eic, ov in orow.items():
            if eic == "start_utc" or ov == "" or arow.get(eic, "") == "":
                continue
            cap = caps.get(eic)
            if not cap:
                continue
            a = float(arow[eic])
            o = float(ov)
            if a < RUNNING_SHARE * cap or o < RUNNING_SHARE * cap:
                continue
            x = acc[(eic, b)]
            x[0] += 1
            x[1] += max(0.0, a - o)
            for i, c in enumerate(CUTS):
                if o < c / 100 * a:
                    x[2 + i] += 1
    return [{"month": month, "eic": eic, "band": b, "hours": x[0], "unused_mwh": round(x[1]),
             **{f"m{c}": x[2 + i] for i, c in enumerate(CUTS)}} for (eic, b), x in sorted(acc.items())]


def main(full=False):
    fleet = json.loads((NUC / "fleet.json").read_text())
    caps = {r["eic"]: r["mw"] for r in fleet["reactors"] if r.get("eic")}
    months = sorted(p.stem for p in (NUC / "unit_hourly").glob("*/*.csv"))
    months = [m for m in months if m >= "2015-01"]
    if not months:
        return 0
    existing = sorted(OUT_DIR.glob("*.csv"))
    redo = months if full or not existing else months[-2:]
    fields = ["month", "eic", "band", "hours", "unused_mwh", *[f"m{c}" for c in CUTS]]
    by_year = defaultdict(list)
    for m in redo:
        by_year[m[:4]].extend(month_rows(m, caps))
    for year, rows in by_year.items():
        path = OUT_DIR / f"{year}.csv"
        redone = {m for m in redo if m.startswith(year)}
        keep = [r for r in read(path) if r["month"] not in redone]
        all_rows = sorted(keep + rows, key=lambda r: (r["month"], r["eic"], BANDS.index(r["band"])))
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="") as handle:
            w = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
            w.writeheader()
            w.writerows(all_rows)
    print(f"Modulation: {len(redo)} months rebuilt")
    return len(redo)


if __name__ == "__main__":
    import sys
    main(full="--full" in sys.argv)
