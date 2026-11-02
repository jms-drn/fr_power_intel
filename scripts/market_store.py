"""Day-ahead prices and cross-border flows (ENTSO-E) and the generation mix (RTE).

Raw storage (times in UTC, minute precision; files split by Paris-time month):

  data/prices/<ZONE>/YYYY/YYYY-MM.csv     start_utc,eur,min
      day-ahead price (EUR/MWh) of each period; "min" is the period length in
      minutes (60 before the move to 15-minute products on 30 Sep 2025, 15
      after; Switzerland stays hourly).
  data/flows/<BORDER>/YYYY/YYYY-MM.csv    start_utc,export_mw,import_mw,min
      physical flows France -> neighbour (export) and neighbour -> France.
  data/generation/mix/YYYY/YYYY-MM.csv    start_utc,min,<one column per fuel>
      French generation by fuel and sub-type (MW): 15-minute from 2017
      (RTE generation_mix_15min_time_scale), hourly in 2015-16 (RTE
      actual_generations_per_production_type).
"""

import csv
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from store import DATA_DIR, PARIS, fmt_utc, parse_ts

UTC = timezone.utc
ENTSOE_URL = "https://web-api.tp.entsoe.eu/api"

PRICES_DIR = DATA_DIR / "prices"
FLOWS_DIR = DATA_DIR / "flows"
MIX_DIR = DATA_DIR / "generation" / "mix"

# Bidding zones (EIC codes). Germany was one zone with Austria until
# 30 Sep 2018 (DE-AT-LU) and DE-LU from 1 Oct 2018.
EIC = {
    "FR": "10YFR-RTE------C", "DE_LU": "10Y1001A1001A82H", "DE_AT_LU": "10Y1001A1001A63L",
    "BE": "10YBE----------2", "CH": "10YCH-SWISSGRIDZ", "IT_NORD": "10Y1001A1001A73I",
    "ES": "10YES-REE------0", "GB": "10YGB----------A",
}
DE_SPLIT = datetime(2018, 9, 30, 22, tzinfo=UTC)  # 1 Oct 2018 00:00 Paris

PRICE_ZONES = ["FR", "DE", "BE", "CH", "IT_NORD", "ES"]
BORDERS = ["BE", "DE", "CH", "IT_NORD", "ES", "GB"]

MIX_COLUMNS = [
    "nuclear", "hydro", "hydro_ror", "hydro_res", "hydro_pump", "wind", "wind_on", "wind_off", "solar",
    "gas", "gas_ccgt", "gas_chp", "gas_ct", "gas_other", "coal", "oil", "bio", "bio_biomass", "bio_biogas",
    "bio_waste", "pumping",
]
MIX15_MAP = {
    ("NUCLEAR", "TOTAL"): "nuclear", ("HYDRO", "TOTAL"): "hydro",
    ("HYDRO", "HYDRO_RUN_OF_RIVER_AND_POUNDAGE"): "hydro_ror", ("HYDRO", "HYDRO_WATER_RESERVOIR"): "hydro_res",
    ("HYDRO", "HYDRO_PUMPED_STORAGE"): "hydro_pump", ("WIND", "TOTAL"): "wind", ("SOLAR", "TOTAL"): "solar",
    ("FOSSIL_GAS", "TOTAL"): "gas", ("FOSSIL_GAS", "FOSSIL_GAS_CCGT"): "gas_ccgt",
    ("FOSSIL_GAS", "FOSSIL_GAS_CHP"): "gas_chp", ("FOSSIL_GAS", "FOSSIL_GAS_CT"): "gas_ct",
    ("FOSSIL_GAS", "FOSSIL_GAS_OTHER"): "gas_other", ("FOSSIL_HARD_COAL", "TOTAL"): "coal",
    ("FOSSIL_OIL", "TOTAL"): "oil", ("BIOENERGY", "TOTAL"): "bio", ("BIOENERGY", "BIOMASS"): "bio_biomass",
    ("BIOENERGY", "BIOGAS"): "bio_biogas", ("BIOENERGY", "WASTE"): "bio_waste", ("PUMPING", "TOTAL"): "pumping",
}
PER_TYPE_MAP = {
    "NUCLEAR": "nuclear", "HYDRO_RUN_OF_RIVER_AND_POUNDAGE": "hydro_ror", "HYDRO_WATER_RESERVOIR": "hydro_res",
    "HYDRO_PUMPED_STORAGE": "hydro_pump", "WIND_ONSHORE": "wind_on", "WIND_OFFSHORE": "wind_off", "SOLAR": "solar",
    "FOSSIL_GAS": "gas", "FOSSIL_HARD_COAL": "coal", "FOSSIL_OIL": "oil", "BIOMASS": "bio_biomass", "WASTE": "bio_waste",
}


# --------------------------------------------------------------------------
# ENTSO-E
# --------------------------------------------------------------------------

class EntsoeError(RuntimeError):
    pass


def entsoe_get(params, attempts=5):
    token = os.environ.get("ENTSOE_API_KEY")
    if not token:
        raise EntsoeError("ENTSOE_API_KEY is not set")
    url = f"{ENTSOE_URL}?{urllib.parse.urlencode({'securityToken': token, **params})}"
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(urllib.request.Request(url), timeout=240) as response:
                return response.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", "replace")
            if error.code == 400 and "No matching data" in body:
                return ""
            if (error.code == 429 or error.code >= 500) and attempt < attempts:
                wait = 20 * attempt
                print(f"  ENTSO-E HTTP {error.code}, waiting {wait}s", file=sys.stderr)
                time.sleep(wait)
                continue
            raise EntsoeError(f"HTTP {error.code}: {re.sub(r'\s+', ' ', body)[:300]}") from error
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt < attempts:
                time.sleep(20 * attempt)
                continue
            raise EntsoeError(str(error)) from error
    return ""


def entsoe_param(value):
    return value.astimezone(UTC).strftime("%Y%m%d%H%M")


def parse_series(xml, value_tag):
    """Points of an ENTSO-E document as {start_utc_datetime: (value, minutes)}.

    Keeps day-ahead results only (contract type A01, classification sequence 1
    where several auctions are published) and expands curve type A03, where a
    point is omitted when it repeats the previous value.
    """
    out = {}
    if not xml or "<TimeSeries>" not in xml:
        return out
    for ts in re.findall(r"<TimeSeries>(.*?)</TimeSeries>", xml, re.S):
        contract = re.search(r"<contract_MarketAgreement\.type>([^<]+)<", ts)
        if contract and contract.group(1) != "A01":
            continue
        seq = re.search(r"<classificationSequence_AttributeInstanceComponent\.position>(\d+)<", ts)
        if seq and seq.group(1) != "1":
            continue
        for period in re.findall(r"<Period>(.*?)</Period>", ts, re.S):
            start = parse_ts(re.search(r"<start>([^<]+)</start>", period).group(1))
            end = parse_ts(re.search(r"<end>([^<]+)</end>", period).group(1))
            res = re.search(r"<resolution>PT(\d+)M</resolution>", period)
            minutes = int(res.group(1)) if res else 60
            points = {int(p): float(v) for p, v in re.findall(
                rf"<position>(\d+)</position>\s*<{value_tag}>([^<]+)</{value_tag}>", period)}
            if not points:
                continue
            n = int((end - start).total_seconds() // 60 // minutes)
            last = None
            for pos in range(1, n + 1):
                if pos in points:
                    last = points[pos]
                if last is None:
                    continue
                out[start + timedelta(minutes=minutes * (pos - 1))] = (last, minutes)
    return out


def fetch_prices(zone, start, end):
    """Day-ahead prices for a zone between two UTC datetimes (at most a year)."""
    out = {}
    parts = [(zone, start, end)]
    if zone == "DE":
        parts = []
        if start < DE_SPLIT:
            parts.append(("DE_AT_LU", start, min(end, DE_SPLIT)))
        if end > DE_SPLIT:
            parts.append(("DE_LU", max(start, DE_SPLIT), end))
    for code, a, b in parts:
        xml = entsoe_get({"documentType": "A44", "in_Domain": EIC[code], "out_Domain": EIC[code],
                          "periodStart": entsoe_param(a), "periodEnd": entsoe_param(b)})
        for t, v in parse_series(xml, "price.amount").items():
            if a <= t < b:
                out[t] = v
    return out


def border_code(border, when_start):
    if border == "DE":
        return "DE_AT_LU" if when_start < DE_SPLIT else "DE_LU"
    return border


def fetch_flows(border, start, end):
    """Physical flows FR->border and border->FR: {t: (export, import, minutes)}."""
    parts = [(start, end)]
    if border == "DE" and start < DE_SPLIT < end:
        parts = [(start, DE_SPLIT), (DE_SPLIT, end)]
    out = {}
    for a, b in parts:
        code = EIC[border_code(border, a)]
        exp = parse_series(entsoe_get({"documentType": "A11", "in_Domain": code, "out_Domain": EIC["FR"],
                                       "periodStart": entsoe_param(a), "periodEnd": entsoe_param(b)}), "quantity")
        time.sleep(0.5)
        imp = parse_series(entsoe_get({"documentType": "A11", "in_Domain": EIC["FR"], "out_Domain": code,
                                       "periodStart": entsoe_param(a), "periodEnd": entsoe_param(b)}), "quantity")
        for t in sorted(set(exp) | set(imp)):
            if not (a <= t < b):
                continue
            e = exp.get(t)
            i = imp.get(t)
            minutes = (e or i)[1]
            out[t] = (e[0] if e else 0.0, i[0] if i else 0.0, minutes)
    return out


# --------------------------------------------------------------------------
# Monthly CSV storage
# --------------------------------------------------------------------------

def month_path(base, t):
    paris = t.astimezone(PARIS)
    return base / f"{paris:%Y}" / f"{paris:%Y-%m}.csv"


def read_rows(path):
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def write_rows(path, fields, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n", extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    tmp.replace(path)


def num(value, decimals=2):
    if value is None or value == "":
        return ""
    text = f"{value:.{decimals}f}"
    if "." in text:  # strip trailing decimal zeros only (never from whole numbers)
        text = text.rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def upsert(base, fields, records):
    """records: {t: {field: value}}; merged into the monthly files."""
    by_file = {}
    for t, rec in records.items():
        by_file.setdefault(month_path(base, t), {})[fmt_utc(t)] = rec
    changed = 0
    for path, recs in by_file.items():
        rows = {r["start_utc"]: r for r in read_rows(path)}
        for key, rec in recs.items():
            row = dict(rows.get(key, {"start_utc": key}))
            row.update({k: v for k, v in rec.items() if v != ""})
            if rows.get(key) != row:
                rows[key] = row
                changed += 1
        write_rows(path, fields, [rows[k] for k in sorted(rows)])
    return changed


def store_prices(zone, points):
    recs = {t: {"eur": num(v, 2), "min": str(m)} for t, (v, m) in points.items()}
    return upsert(PRICES_DIR / zone, ["start_utc", "eur", "min"], recs)


def store_flows(border, points):
    recs = {t: {"export_mw": num(e, 0), "import_mw": num(i, 0), "min": str(m)} for t, (e, i, m) in points.items()}
    return upsert(FLOWS_DIR / border, ["start_utc", "export_mw", "import_mw", "min"], recs)


# --------------------------------------------------------------------------
# RTE generation mix
# --------------------------------------------------------------------------

def paris_param(value):
    return value.astimezone(PARIS).isoformat(timespec="seconds")


def fetch_mix15(client, start, end):
    payload = client.get("generation_mix_15min_time_scale",
                         {"start_date": paris_param(start), "end_date": paris_param(end)})
    recs = {}
    for block in (payload or {}).get("generation_mix_15min_time_scale") or []:
        col = MIX15_MAP.get((block.get("production_type"), block.get("production_subtype")))
        if not col:
            continue
        for v in block.get("values") or []:
            if v.get("value") is None:
                continue
            t = parse_ts(v["start_date"])
            recs.setdefault(t, {"min": "15"})[col] = num(float(v["value"]), 0)
    return recs


def fetch_per_type(client, start, end):
    """Hourly mix from the per-type resource (used for 2015-16, before the 15-minute mix)."""
    payload = client.get("actual_generations_per_production_type",
                         {"start_date": paris_param(start), "end_date": paris_param(end)})
    raw = {}
    for block in (payload or {}).get("actual_generations_per_production_type") or []:
        col = PER_TYPE_MAP.get(block.get("production_type"))
        if not col:
            continue
        for v in block.get("values") or []:
            if v.get("value") is None:
                continue
            raw.setdefault(parse_ts(v["start_date"]), {})[col] = float(v["value"])
    recs = {}
    for t, vals in raw.items():
        rec = {"min": "60"}
        for k, v in vals.items():
            rec[k] = num(v, 0)
        hydro = [vals.get(k) for k in ("hydro_ror", "hydro_res", "hydro_pump") if vals.get(k) is not None]
        if hydro:
            rec["hydro"] = num(sum(hydro), 0)
        wind = [vals.get(k) for k in ("wind_on", "wind_off") if vals.get(k) is not None]
        if wind:
            rec["wind"] = num(sum(wind), 0)
        bio = [vals.get(k) for k in ("bio_biomass", "bio_waste") if vals.get(k) is not None]
        if bio:
            rec["bio"] = num(sum(bio), 0)
        recs[t] = rec
    return recs


def store_mix(recs):
    return upsert(MIX_DIR, ["start_utc", "min", *MIX_COLUMNS], recs)


def paris_midnight(day):
    return datetime(day.year, day.month, day.day, tzinfo=PARIS)

