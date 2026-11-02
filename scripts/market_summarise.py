"""Builds the price, generation and flow files the website reads, plus records
and the alerts behind the notification bell.

Definitions
  * Baseload: average of every period of the Paris day. Peak: Monday-Friday
    08:00-20:00 Paris time (the French and German market standard).
    Off-peak: every other period. Averages weight each period by its length.
  * Negative hours: time (in hours) with a price below zero; zero-price hours
    are counted separately. Negative-price depth: the sum of |price| x hours
    over negative periods (EUR/MWh.h), so 1,000 hours at -10 and 500 hours at
    -20 weigh the same.
  * Parity with a neighbour: share of French periods (at 15 minutes, hourly
    prices repeated) where the two prices differ by less than EUR 0.01/MWh.
  * Capture price of a technology: output-weighted average French price.
  * Residual demand: demand (RTE, excluding pumping) minus wind and solar.

Files
  data/prices/daily.csv          one row per Paris day, columns per zone
  data/generation/daily.csv      daily mean MW by fuel and shares
  data/flows/daily.csv           daily mean export, import and net MW by border
  data/market/hourly/YYYY/YYYY-MM.csv   hourly table joining price, demand,
                                 generation, nuclear availability and flows
  data/market/capture.csv        daily capture prices and energy by technology
  data/records.json              records (all-time and by calendar month)
  data/alerts.json               notable events for the notification bell
"""

import csv
import json
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from market_store import BORDERS, FLOWS_DIR, MIX_COLUMNS, MIX_DIR, PRICE_ZONES, PRICES_DIR, read_rows, write_rows  # noqa: E402
from store import DATA_DIR, PARIS, fmt_utc, parse_ts  # noqa: E402

UTC = timezone.utc
NEIGHBOURS = [z for z in PRICE_ZONES if z != "FR"]
MARKET_DIR = DATA_DIR / "market"
GEN_FUELS = ["nuclear", "hydro", "wind", "solar", "gas", "coal", "oil", "bio"]
LOW_CARBON = ["nuclear", "hydro", "wind", "solar", "bio"]
RENEWABLE = ["hydro", "wind", "solar", "bio"]
CAPTURE_TECH = ["solar", "wind", "nuclear", "hydro", "gas"]
MIX_MIN_TOTAL = 20000  # MW; French generation never falls this low

_paris_cache = {}


def paris_of(t):
    """(Paris date, hour, weekday) of a UTC datetime; cached per UTC hour."""
    key = t.replace(minute=0)
    if key not in _paris_cache:
        p = key.astimezone(PARIS)
        _paris_cache[key] = (p.date(), p.hour, p.weekday())
    d, h, wd = _paris_cache[key]
    return d, h, wd


def is_peak(t):
    _, h, wd = paris_of(t)
    return wd < 5 and 8 <= h < 20


def load_series(base, value_cols):
    """{t: {col: float}} from every monthly file under base."""
    out = {}
    for path in sorted(base.glob("*/*.csv")):
        for row in read_rows(path):
            t = parse_ts(row["start_utc"])
            rec = {"min": int(row.get("min") or 60)}
            for c in value_cols:
                v = row.get(c)
                if v not in (None, ""):
                    rec[c] = float(v)
            out[t] = rec
    return out


def quarters(t, minutes):
    return [t + timedelta(minutes=15 * k) for k in range(max(1, minutes // 15))]


def r2(v, d=2):
    return "" if v is None else round(v, d)


# --------------------------------------------------------------------------
# Prices
# --------------------------------------------------------------------------

def price_daily(prices):
    """prices: {zone: {t: {eur, min}}} -> rows by date."""
    days = defaultdict(dict)
    for zone, series in prices.items():
        acc = defaultdict(lambda: {"sum": 0.0, "h": 0.0, "psum": 0.0, "ph": 0.0, "osum": 0.0, "oh": 0.0,
                                   "min": None, "max": None, "neg": 0.0, "zero": 0.0, "negd": 0.0, "n": 0, "sq": 0.0})
        for t, rec in series.items():
            if "eur" not in rec:
                continue
            p = rec["eur"]
            h = rec["min"] / 60
            d = paris_of(t)[0]
            a = acc[d]
            a["sum"] += p * h
            a["sq"] += p * p * h
            a["h"] += h
            if is_peak(t):
                a["psum"] += p * h
                a["ph"] += h
            else:
                a["osum"] += p * h
                a["oh"] += h
            a["min"] = p if a["min"] is None else min(a["min"], p)
            a["max"] = p if a["max"] is None else max(a["max"], p)
            if p < 0:
                a["neg"] += h
                a["negd"] += -p * h
            elif abs(p) < 0.005:
                a["zero"] += h
            a["n"] += 1
        for d, a in acc.items():
            if a["h"] < 20:  # incomplete day
                continue
            row = days[d]
            row[f"{zone}_base"] = r2(a["sum"] / a["h"])
            row[f"{zone}_peak"] = r2(a["psum"] / a["ph"]) if a["ph"] else ""
            row[f"{zone}_off"] = r2(a["osum"] / a["oh"]) if a["oh"] else ""
            row[f"{zone}_min"] = r2(a["min"])
            row[f"{zone}_max"] = r2(a["max"])
            row[f"{zone}_neg"] = r2(a["neg"], 2)
            row[f"{zone}_zero"] = r2(a["zero"], 2)
            row[f"{zone}_negd"] = r2(a["negd"], 1)
            mean = a["sum"] / a["h"]
            row[f"{zone}_std"] = r2(max(0.0, a["sq"] / a["h"] - mean * mean) ** 0.5)

    # Parity and spreads against France.
    fr = prices.get("FR", {})
    fr_q = {}
    for t, rec in fr.items():
        if "eur" in rec:
            for q in quarters(t, rec["min"]):
                fr_q[q] = rec["eur"]
    for zone in NEIGHBOURS:
        other = {}
        for t, rec in prices.get(zone, {}).items():
            if "eur" in rec:
                for q in quarters(t, rec["min"]):
                    other[q] = rec["eur"]
        same = defaultdict(lambda: [0, 0])
        for q, p in fr_q.items():
            o = other.get(q)
            if o is None:
                continue
            s = same[paris_of(q)[0]]
            s[1] += 1
            if abs(p - o) < 0.01:
                s[0] += 1
        for d, (eq, n) in same.items():
            if n >= 80 and d in days:
                days[d][f"par_{zone}"] = r2(100 * eq / n, 1)
                fb = days[d].get("FR_base")
                ob = days[d].get(f"{zone}_base")
                if fb not in (None, "") and ob not in (None, ""):
                    days[d][f"spr_{zone}"] = r2(fb - ob)
    fields = ["date"]
    for zone in PRICE_ZONES:
        fields += [f"{zone}_{k}" for k in ("base", "peak", "off", "min", "max", "neg", "zero", "negd", "std")]
    fields += [f"par_{z}" for z in NEIGHBOURS] + [f"spr_{z}" for z in NEIGHBOURS]
    rows = [{"date": d.isoformat(), **days[d]} for d in sorted(days)]
    write_rows(PRICES_DIR / "daily.csv", fields, rows)
    return rows


# --------------------------------------------------------------------------
# Generation and flows
# --------------------------------------------------------------------------

def gen_daily(mix):
    acc = defaultdict(lambda: defaultdict(float))
    hours = defaultdict(float)
    for t, rec in mix.items():
        h = rec["min"] / 60
        d = paris_of(t)[0]
        hours[d] += h
        for c in MIX_COLUMNS:
            if c in rec:
                acc[d][c] += rec[c] * h
                acc[d][f"_{c}_h"] += h
    rows = []
    for d in sorted(acc):
        if hours[d] < 20:
            continue
        a = acc[d]
        row = {"date": d.isoformat()}
        for c in MIX_COLUMNS:
            if a.get(f"_{c}_h"):
                row[c] = round(a[c] / a[f"_{c}_h"])
        total = sum(row.get(f, 0) for f in GEN_FUELS)
        if total > 0:
            row["total"] = round(total)
            row["low_carbon_pct"] = round(100 * sum(row.get(f, 0) for f in LOW_CARBON) / total, 2)
            row["renewable_pct"] = round(100 * sum(row.get(f, 0) for f in RENEWABLE) / total, 2)
            for f in GEN_FUELS:
                if f in row:
                    row[f"{f}_pct"] = round(100 * row[f] / total, 2)
        row["hours"] = round(hours[d], 2)
        rows.append(row)
    fields = ["date", *MIX_COLUMNS, "total", "low_carbon_pct", "renewable_pct", *[f"{f}_pct" for f in GEN_FUELS], "hours"]
    write_rows(DATA_DIR / "generation" / "daily.csv", fields, rows)
    return rows


def flows_daily(flows):
    acc = defaultdict(lambda: defaultdict(float))
    for border, series in flows.items():
        for t, rec in series.items():
            h = rec["min"] / 60
            d = paris_of(t)[0]
            acc[d][f"{border}_exp"] += rec.get("export_mw", 0) * h
            acc[d][f"{border}_imp"] += rec.get("import_mw", 0) * h
            acc[d][f"{border}_h"] += h
    rows = []
    for d in sorted(acc):
        a = acc[d]
        row = {"date": d.isoformat()}
        net_total = 0.0
        complete = True
        for b in BORDERS:
            h = a.get(f"{b}_h", 0)
            if h < 20:
                complete = False
                continue
            e = a[f"{b}_exp"] / h
            i = a[f"{b}_imp"] / h
            row[f"{b}_exp"] = round(e)
            row[f"{b}_imp"] = round(i)
            row[f"{b}_net"] = round(e - i)
            net_total += e - i
        if complete:
            row["net"] = round(net_total)
        if len(row) > 1:
            rows.append(row)
    fields = ["date"] + [f"{b}_{k}" for b in BORDERS for k in ("exp", "imp", "net")] + ["net"]
    write_rows(FLOWS_DIR / "daily.csv", fields, rows)
    return rows


# --------------------------------------------------------------------------
# Hourly joined table and capture prices
# --------------------------------------------------------------------------

def hourly_mean(series, col):
    """{hour_start: mean} from {t: rec} at any resolution."""
    acc = defaultdict(lambda: [0.0, 0.0])
    for t, rec in series.items():
        if col not in rec:
            continue
        h = t.replace(minute=0)
        w = rec["min"] / 60
        acc[h][0] += rec[col] * w
        acc[h][1] += w
    return {h: s / w for h, (s, w) in acc.items() if w >= 0.99}


def load_demand_hourly():
    acc = defaultdict(lambda: [0.0, 0])
    for path in sorted((DATA_DIR / "archive" / "realised").glob("*/*.csv")):
        if path.stem < "2014-12":
            continue
        for row in read_rows(path):
            t = parse_ts(row["start_utc"])
            h = t.replace(minute=0)
            acc[h][0] += float(row["mw"])
            acc[h][1] += 1
    return {h: s / n for h, (s, n) in acc.items() if n >= 3}


def load_nuclear_available():
    out = {}
    for path in sorted((DATA_DIR / "nuclear" / "hourly").glob("*/*.csv")):
        for row in read_rows(path):
            if row.get("available_mw"):
                out[parse_ts(row["start_utc"])] = float(row["available_mw"])
    return out


def build_hourly(prices, mix, flows):
    price_h = hourly_mean(prices.get("FR", {}), "eur")
    demand_h = load_demand_hourly()
    avail_h = load_nuclear_available()
    cols = {c: hourly_mean(mix, c) for c in ["nuclear", "wind", "solar", "gas", "hydro", "coal", "oil", "bio"]}
    net_h = defaultdict(float)
    net_n = defaultdict(int)
    for b, series in flows.items():
        e = hourly_mean(series, "export_mw")
        i = hourly_mean(series, "import_mw")
        for h in e:
            net_h[h] += e[h] - i.get(h, 0)
            net_n[h] += 1
    by_month = defaultdict(list)
    hours = sorted(set(price_h) | set(cols["nuclear"]))
    for h in hours:
        if h.year < 2015:
            continue
        row = {"start_utc": fmt_utc(h), "price": r2(price_h.get(h))}
        d = demand_h.get(h)
        row["demand"] = round(d) if d is not None else ""
        for c, m in cols.items():
            row[c] = round(m[h]) if h in m else ""
        if d is not None and h in cols["wind"] and h in cols["solar"]:
            row["residual"] = round(d - cols["wind"][h] - cols["solar"][h])
        a = avail_h.get(h)
        row["nuc_avail"] = round(a) if a is not None else ""
        if a is not None and h in cols["nuclear"]:
            row["nuc_unused"] = round(max(0, a - cols["nuclear"][h]))
        row["net_exports"] = round(net_h[h]) if net_n.get(h) == len(BORDERS) else ""
        by_month[h.astimezone(PARIS).strftime("%Y-%m")].append(row)
    fields = ["start_utc", "price", "demand", "residual", "nuclear", "nuc_avail", "nuc_unused", "wind", "solar", "gas",
              "hydro", "coal", "oil", "bio", "net_exports"]
    for month, rows in by_month.items():
        write_rows(MARKET_DIR / "hourly" / month[:4] / f"{month}.csv", fields, rows)
    market_daily(by_month)
    return sorted(by_month)


def market_daily(by_month):
    """Daily residual demand, nuclear headroom and net exports from the hourly table."""
    acc = defaultdict(lambda: defaultdict(list))
    for rows in by_month.values():
        for row in rows:
            d = paris_of(parse_ts(row["start_utc"]))[0]
            for c in ("residual", "demand", "nuc_unused", "nuc_avail", "net_exports", "price"):
                if row.get(c) not in (None, ""):
                    acc[d][c].append(float(row[c]))
    out = []
    for d in sorted(acc):
        a = acc[d]
        row = {"date": d.isoformat()}
        if len(a["residual"]) >= 20:
            row.update(residual=round(sum(a["residual"]) / len(a["residual"])), residual_min=round(min(a["residual"])),
                       residual_max=round(max(a["residual"])))
        if len(a["demand"]) >= 20:
            row["demand"] = round(sum(a["demand"]) / len(a["demand"]))
        if len(a["nuc_unused"]) >= 20:
            row["nuc_unused"] = round(sum(a["nuc_unused"]) / len(a["nuc_unused"]))
            row["nuc_avail"] = round(sum(a["nuc_avail"]) / len(a["nuc_avail"]))
        if len(a["net_exports"]) >= 20:
            row["net_exports"] = round(sum(a["net_exports"]) / len(a["net_exports"]))
        if len(row) > 1:
            out.append(row)
    write_rows(MARKET_DIR / "daily.csv", ["date", "residual", "residual_min", "residual_max", "demand", "nuc_unused",
                                          "nuc_avail", "net_exports"], out)


def capture_daily(prices, mix):
    """Daily output-weighted French price per technology, at 15-minute detail."""
    fr_q = {}
    for t, rec in prices.get("FR", {}).items():
        if "eur" in rec:
            for q in quarters(t, rec["min"]):
                fr_q[q] = rec["eur"]
    acc = defaultdict(lambda: defaultdict(float))
    for t, rec in mix.items():
        for q in quarters(t, rec["min"]):
            p = fr_q.get(q)
            if p is None:
                continue
            d = paris_of(q)[0]
            a = acc[d]
            a["_n"] += 1
            a["_p"] += p
            for tech in CAPTURE_TECH:
                g = rec.get(tech)
                if g is not None and g > 0:
                    mwh = g * 0.25
                    a[f"{tech}_pm"] += p * mwh
                    a[f"{tech}_mwh"] += mwh
    rows = []
    for d in sorted(acc):
        a = acc[d]
        if a["_n"] < 80:
            continue
        row = {"date": d.isoformat(), "base": r2(a["_p"] / a["_n"])}
        for tech in CAPTURE_TECH:
            mwh = a.get(f"{tech}_mwh", 0)
            row[f"{tech}_eur"] = r2(a[f"{tech}_pm"] / mwh) if mwh > 0 else ""
            row[f"{tech}_mwh"] = round(mwh)
        rows.append(row)
    fields = ["date", "base"] + [f"{t}_{k}" for t in CAPTURE_TECH for k in ("eur", "mwh")]
    write_rows(MARKET_DIR / "capture.csv", fields, rows)
    return rows


# --------------------------------------------------------------------------
# Records and alerts
# --------------------------------------------------------------------------

METRICS = [
    # key, file, column, label, unit, higher/lower records, min gap days for "since" alerts, page link
    ("solar", "gen", "solar", "solar output (daily average)", "GW", ["high"], 30, "generation/explorer?subject=solar"),
    ("wind", "gen", "wind", "wind output (daily average)", "GW", ["high", "low"], 30, "generation/explorer?subject=wind"),
    ("nuclear_out", "gen", "nuclear", "nuclear output (daily average)", "GW", ["high", "low"], 30, "generation/explorer?subject=nuclear"),
    ("gas", "gen", "gas", "gas-fired output (daily average)", "GW", ["high", "low"], 30, "generation/explorer?subject=gas"),
    ("hydro", "gen", "hydro", "hydro output (daily average)", "GW", ["high", "low"], 30, "generation/explorer?subject=hydro"),
    ("low_carbon", "gen", "low_carbon_pct", "low-carbon share of generation", "%", ["high", "low"], 30, "generation/explorer?subject=lowc&measure=share"),
    ("net_exports", "flows", "net", "net exports (daily average)", "GW", ["high", "low"], 30, "flows/explorer?subject=net"),
    ("fr_base", "prices", "FR_base", "French day-ahead baseload", "EUR/MWh", ["high", "low"], 7, "prices/explorer?subject=FR&measure=base"),
    ("fr_min", "prices", "FR_min", "single French day-ahead price", "EUR/MWh", ["low"], 7, "prices/explorer?subject=FR&measure=min"),
    ("fr_neg", "prices", "FR_neg", "negative-price hours in a day (France)", "h", ["high"], 7, "prices/explorer?subject=FR&measure=neg"),
    ("demand", "demand", "mean_mw", "demand (daily average)", "GW", ["high", "low"], 30, "demand/explorer"),
]


def fmt_value(v, unit):
    if unit == "GW":
        return f"{v / 1000:.1f} GW"
    if unit == "%":
        return f"{v:.1f}%"
    if unit == "EUR/MWh":
        return f"{'−' if v < 0 else ''}€{abs(v):,.2f}/MWh"
    if unit == "h":
        return f"{v:.2f} h"
    return f"{v}"


def cap(text):
    return text[0].upper() + text[1:]


def nice_date(d):
    return f"{d.day} {d.strftime('%b %Y')}"


def records_and_alerts(tables, now):
    today = now.astimezone(PARIS).date()
    records = []
    alerts = []
    for key, table, col, label, unit, kinds, gap, link in METRICS:
        rows = [(date.fromisoformat(r["date"]), float(r[col])) for r in tables.get(table, []) if r.get(col) not in (None, "")]
        if table != "prices":
            rows = [x for x in rows if x[0] < today]  # complete days only
        if len(rows) < 30:
            continue
        rows.sort()
        latest_d, latest_v = rows[-1]
        for kind in kinds:
            better = (lambda a, b: a > b) if kind == "high" else (lambda a, b: a < b)
            best = rows[0]
            for d, v in rows:
                if better(v, best[1]):
                    best = (d, v)
            records.append({"key": key, "kind": kind, "label": label, "unit": unit, "value": best[1], "date": best[0].isoformat(),
                            "text": f"{'Highest' if kind == 'high' else 'Lowest'} {label}: {fmt_value(best[1], unit)} on {nice_date(best[0])}",
                            "link": link})
            # Month records.
            month_rows = [x for x in rows if x[0].month == latest_d.month]
            # Alerts for the latest day.
            if latest_d < today - timedelta(days=2):
                continue
            previous = rows[:-1]
            if best[0] == latest_d and previous:
                alerts.append({"id": f"{key}-{kind}-rec-{latest_d}", "date": latest_d.isoformat(), "level": "record",
                               "title": f"Record {'high' if kind == 'high' else 'low'}: {label}",
                               "detail": f"{fmt_value(latest_v, unit)} on {nice_date(latest_d)}, beating {fmt_value(max(previous, key=lambda x: x[1])[1] if kind == 'high' else min(previous, key=lambda x: x[1])[1], unit)} (data from {rows[0][0].year}).",
                               "link": link})
                continue
            month_prev = [x for x in month_rows if x[0] != latest_d]
            if month_prev and all(better(latest_v, v) for _, v in month_prev):
                alerts.append({"id": f"{key}-{kind}-month-{latest_d}", "date": latest_d.isoformat(), "level": "month",
                               "title": f"{'Highest' if kind == 'high' else 'Lowest'} {label} for {latest_d.strftime('%B')}",
                               "detail": f"{fmt_value(latest_v, unit)} on {nice_date(latest_d)}, the {'highest' if kind == 'high' else 'lowest'} for any {latest_d.strftime('%B')} since {rows[0][0].year}.",
                               "link": link})
                continue
            # "Highest/lowest since ..." with a minimum gap.
            since = None
            for d, v in reversed(previous):
                if not better(latest_v, v) and v != latest_v:
                    since = d
                    break
                if v == latest_v:
                    since = d
                    break
            if since and (latest_d - since).days >= max(gap, 1) and (latest_d - since).days > 1:
                alerts.append({"id": f"{key}-{kind}-since-{latest_d}", "date": latest_d.isoformat(), "level": "since",
                               "title": f"{'Highest' if kind == 'high' else 'Lowest'} {label} since {nice_date(since)}",
                               "detail": f"{fmt_value(latest_v, unit)} on {nice_date(latest_d)}.",
                               "link": link})
    return records, alerts


def nuclear_alerts(now):
    live_path = DATA_DIR / "nuclear" / "live.json"
    if not live_path.exists():
        return []
    live = json.loads(live_path.read_text())
    cutoff = fmt_utc(now - timedelta(hours=24))
    out = []
    for c in live.get("changes", []):
        if c["published_utc"] < cutoff or c["status"] == "DISMISSED":
            continue
        unit = c["unit"].title().replace("St ", "Saint-")
        if c["version"] == 1 and c["type"] == "unplanned" and c["off_mw"] >= 1000:
            out.append({"id": f"nuc-new-{c['id']}", "date": c["published_utc"][:10], "level": "event",
                        "title": f"New unplanned outage: {unit}",
                        "detail": f"{c['off_mw']:,} MW off from {c['start_utc'][:16].replace('T', ' ')} UTC to {c['end_utc'][:16].replace('T', ' ')} UTC.",
                        "link": "nuclear/today"})
        if c.get("prev_end_utc") and c["end_utc"] > c["prev_end_utc"]:
            delay = (parse_ts(c["end_utc"]) - parse_ts(c["prev_end_utc"])).days
            if delay >= 7:
                out.append({"id": f"nuc-delay-{c['id']}-{c['version']}", "date": c["published_utc"][:10], "level": "event",
                            "title": f"Return pushed back {delay} days: {unit}",
                            "detail": f"Now due back {c['end_utc'][:10]} (was {c['prev_end_utc'][:10]}).",
                            "link": "nuclear/today"})
    return out


def price_alerts(price_rows, now):
    today = now.astimezone(PARIS).date()
    out = []
    for r in price_rows:
        d = date.fromisoformat(r["date"])
        if d < today or not r.get("FR_neg"):
            continue
        hours = float(r["FR_neg"])
        if hours > 0:
            out.append({"id": f"neg-{d}", "date": d.isoformat(), "level": "event",
                        "title": f"Negative French prices {'tomorrow' if d > today else 'today'}",
                        "detail": f"{hours:g} hours below zero on {nice_date(d)}; lowest €{float(r['FR_min']):,.2f}/MWh.",
                        "link": "prices/short"})
    return out


def read_table(path):
    return read_rows(path) if path.exists() else []


def main(now=None):
    now = now or datetime.now(UTC)
    prices = {z: load_series(PRICES_DIR / z, ["eur"]) for z in PRICE_ZONES}
    mix = load_series(MIX_DIR, MIX_COLUMNS)
    # RTE's mix has a few broken periods (e.g. 14 Apr 2024, 16 Aug 2025) with almost no output: treat as missing.
    mix = {t: r for t, r in mix.items() if sum(max(0.0, r.get(f, 0.0)) for f in GEN_FUELS) >= MIX_MIN_TOTAL}
    flows = {b: load_series(FLOWS_DIR / b, ["export_mw", "import_mw"]) for b in BORDERS}
    price_rows = price_daily(prices) if prices.get("FR") else []
    gen_rows = gen_daily(mix) if mix else []
    flow_rows = flows_daily(flows) if any(flows.values()) else []
    months = build_hourly(prices, mix, flows) if prices.get("FR") or mix else []
    capture_daily(prices, mix) if prices.get("FR") and mix else None

    tables = {
        "gen": [{k: v for k, v in r.items()} for r in read_table(DATA_DIR / "generation" / "daily.csv")],
        "prices": read_table(PRICES_DIR / "daily.csv"),
        "flows": read_table(FLOWS_DIR / "daily.csv"),
        "demand": read_table(DATA_DIR / "summary" / "daily.csv"),
    }
    records, alerts = records_and_alerts(tables, now)
    alerts += nuclear_alerts(now) + price_alerts(tables["prices"], now)
    alerts.sort(key=lambda a: (a["date"], {"record": 0, "month": 1, "event": 2, "since": 3}[a["level"]]), reverse=True)
    (DATA_DIR / "records.json").write_text(json.dumps({"generated_utc": fmt_utc(now), "records": records}, indent=1))
    (DATA_DIR / "alerts.json").write_text(json.dumps({"generated_utc": fmt_utc(now), "alerts": alerts[:40]}, indent=1))

    index = {
        "generated_utc": fmt_utc(now),
        "price_months": {z: sorted(p.stem for p in (PRICES_DIR / z).glob("*/*.csv")) for z in PRICE_ZONES},
        "flow_months": {b: sorted(p.stem for p in (FLOWS_DIR / b).glob("*/*.csv")) for b in BORDERS},
        "mix_months": sorted(p.stem for p in MIX_DIR.glob("*/*.csv")),
        "hourly_months": months,
        "latest_price_utc": max((fmt_utc(t) for t in prices.get("FR", {})), default=None),
        "latest_mix_utc": max((fmt_utc(t) for t in mix), default=None),
        "latest_flow_utc": {b: max((fmt_utc(t) for t in s), default=None) for b, s in flows.items()},
    }
    MARKET_DIR.mkdir(parents=True, exist_ok=True)
    (MARKET_DIR / "index.json").write_text(json.dumps(index, indent=1))
    print(f"Market: {len(price_rows)} price days, {len(gen_rows)} generation days, {len(flow_rows)} flow days, "
          f"{len(records)} records, {len(alerts)} alerts")
    return index


if __name__ == "__main__":
    main()
