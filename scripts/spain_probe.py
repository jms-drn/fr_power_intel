"""Spain probe: checks what open data ESIOS (REE) and ENTSO-E supply for Spain,
before the Spain pipeline is built. Read-only: it never touches data/.

Run by .github/workflows/probe-spain.yml (start by hand from the Actions tab).

Writes:
  probe/out/spain_probe_report.md   what each source returned: latest value,
                                    time step, and whether history reaches 2015
  probe/out/esios_catalogue.csv     every ESIOS indicator (id, name), so the
                                    Spain indicators can be chosen from REE's
                                    own list rather than guessed
  probe/out/esios_matches.csv       catalogue entries matching each topic

ENTSO-E calls reuse entsoe_get and the EIC codes in market_store.py (the
same code that downloads France's prices and flows). Every call is wrapped,
so one failure is reported and the rest still run.
"""
import csv
import json
import os
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from market_store import EIC, entsoe_get, entsoe_param  # noqa: E402

UTC = timezone.utc
OUT = Path(__file__).resolve().parent.parent / "probe" / "out"
ESIOS_URL = "https://api.esios.ree.es"
PT_EIC = "10YPT-REN------W"

# Topics to look for in the ESIOS catalogue (Spanish names, lower case).
# These are search words, not indicator IDs: the probe reports what matches.
TOPICS = {
    "Demand (actual)": ["demanda real"],
    "Demand (forecast)": ["demanda prevista", "previsión de la demanda", "prevision de la demanda"],
    "Day-ahead price": ["precio mercado spot", "mercado diario"],
    "Nuclear": ["nuclear"],
    "Hydro": ["hidráulica", "hidraulica"],
    "Wind": ["eólica", "eolica"],
    "Solar": ["solar fotovoltaica", "solar térmica", "solar termica"],
    "Gas (combined cycle)": ["ciclo combinado"],
    "Cogeneration": ["cogeneración", "cogeneracion"],
    "Interconnections": ["intercambio", "interconexión", "interconexion", "saldo"],
    "Hydro reserves": ["embalse", "reservas hidr", "energía embalsada", "energia embalsada"],
    "Pumping": ["bombeo"],
}
MAX_TESTS_PER_TOPIC = 4  # matched indicators whose data is actually fetched

report = []


def say(line=""):
    print(line)
    report.append(line)


def minutes_between(times):
    if len(times) < 2:
        return None
    times = sorted(times)
    gaps = [(b - a).total_seconds() / 60 for a, b in zip(times, times[1:]) if b > a]
    return int(min(gaps)) if gaps else None


# --------------------------------------------------------------------------
# ESIOS
# --------------------------------------------------------------------------

def esios_get(path, params=None):
    key = os.environ.get("ESIOS_API_KEY")
    if not key:
        raise RuntimeError("ESIOS_API_KEY is not set")
    url = f"{ESIOS_URL}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={
        "Accept": "application/json; application/vnd.esios-api-v1+json",
        "Content-Type": "application/json",
        "x-api-key": key,
    })
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.loads(response.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", "replace")[:200]
            if (error.code == 429 or error.code >= 500) and attempt < 3:
                time.sleep(15 * attempt)
                continue
            raise RuntimeError(f"HTTP {error.code}: {body}") from error
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt < 3:
                time.sleep(15 * attempt)
                continue
            raise RuntimeError(str(error)) from error
    return None


def esios_values(ind_id, start, end):
    payload = esios_get(f"/indicators/{ind_id}", {
        "start_date": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "end_date": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
    })
    ind = (payload or {}).get("indicator") or {}
    return ind, ind.get("values") or []


def parse_esios_time(v):
    raw = v.get("datetime_utc") or v.get("datetime")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        return None


def probe_esios():
    say("## ESIOS (REE)")
    say()
    try:
        catalogue = esios_get("/indicators", {"locale": "es"})
    except Exception as error:  # noqa: BLE001
        say(f"**Catalogue request failed:** {error}")
        say()
        return
    items = (catalogue or {}).get("indicators") or []
    say(f"Catalogue: {len(items)} indicators. Top-level keys returned: {sorted((catalogue or {}).keys())}.")
    if items:
        say(f"Fields on each indicator: {sorted(items[0].keys())}.")
    say()
    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / "esios_catalogue.csv").open("w", newline="", encoding="utf-8") as handle:
        w = csv.writer(handle)
        w.writerow(["id", "name", "short_name"])
        for it in sorted(items, key=lambda x: x.get("id") or 0):
            w.writerow([it.get("id"), it.get("name", ""), it.get("short_name", "")])

    now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    recent = (now - timedelta(days=3), now + timedelta(days=2))
    early = (datetime(2015, 1, 5, tzinfo=UTC), datetime(2015, 1, 6, tzinfo=UTC))

    match_rows = []
    for topic, words in TOPICS.items():
        hits = [it for it in items if any(w in (it.get("name") or "").lower() for w in words)]
        for it in hits:
            match_rows.append([topic, it.get("id"), it.get("name", "")])
        say(f"### {topic}")
        say()
        say(f"{len(hits)} catalogue matches for {', '.join(repr(w) for w in words)}.")
        say()
        if not hits:
            continue
        say("| ID | Name | Latest value (UTC) | Step (min) | Values in last 3 days | Geo areas | Data on 5 Jan 2015 |")
        say("|---|---|---|---|---|---|---|")
        for it in hits[:MAX_TESTS_PER_TOPIC]:
            iid = it.get("id")
            name = (it.get("name") or "").replace("|", "/")
            try:
                ind, vals = esios_values(iid, *recent)
                times = [t for t in (parse_esios_time(v) for v in vals) if t]
                geos = sorted({str(v.get("geo_name") or v.get("geo_id")) for v in vals})
                latest = max(times) if times else None
                last_v = next((v.get("value") for v in vals if parse_esios_time(v) == latest), None)
                time.sleep(0.5)
                _, old = esios_values(iid, *early)
                say(f"| {iid} | {name} | {f'{latest:%Y-%m-%d %H:%M} = {last_v}' if latest else 'none'} | "
                    f"{minutes_between(times) or '–'} | {len(vals)} | {', '.join(geos)[:80] or '–'} | {'yes' if old else 'no'} |")
            except Exception as error:  # noqa: BLE001
                say(f"| {iid} | {name} | FAILED: {str(error)[:80]} | | | | |")
            time.sleep(0.5)
        if len(hits) > MAX_TESTS_PER_TOPIC:
            say()
            say(f"{len(hits) - MAX_TESTS_PER_TOPIC} more matches listed in esios_matches.csv (not fetched).")
        say()
    with (OUT / "esios_matches.csv").open("w", newline="", encoding="utf-8") as handle:
        w = csv.writer(handle)
        w.writerow(["topic", "id", "name"])
        w.writerows(match_rows)


# --------------------------------------------------------------------------
# ENTSO-E
# --------------------------------------------------------------------------

def summarise_xml(xml):
    """(number of TimeSeries, point times, last value, psrTypes) of an ENTSO-E document."""
    if not xml:
        return 0, [], None, []
    root = ET.fromstring(xml)
    ns = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""
    times, last, psr = [], None, set()
    series = root.findall(f".//{ns}TimeSeries")
    for ts in series:
        p = ts.find(f".//{ns}psrType")
        if p is not None and p.text:
            psr.add(p.text)
        for period in ts.findall(f"{ns}Period"):
            start = period.find(f"{ns}timeInterval/{ns}start").text
            res = period.find(f"{ns}resolution").text
            step = {"PT15M": 15, "PT30M": 30, "PT60M": 60, "P1D": 1440, "P7D": 10080}.get(res, 60)
            t0 = datetime.fromisoformat(start.replace("Z", "+00:00"))
            for pt in period.findall(f"{ns}Point"):
                pos = int(pt.find(f"{ns}position").text)
                t = t0 + timedelta(minutes=step * (pos - 1))
                times.append(t)
                for tag in ("quantity", "price.amount"):
                    el = pt.find(f"{ns}{tag}")
                    if el is not None and (not last or t >= last[0]):
                        last = (t, el.text)
    return len(series), times, last, sorted(psr)


def probe_entsoe():
    say("## ENTSO-E")
    say()
    es = EIC["ES"]
    fr = EIC["FR"]
    now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    recent = (now - timedelta(days=3), now + timedelta(days=1))
    week = (now - timedelta(days=7), now)
    early = (datetime(2015, 1, 5, tzinfo=UTC), datetime(2015, 1, 6, tzinfo=UTC))
    early_week = (datetime(2015, 1, 5, tzinfo=UTC), datetime(2015, 1, 19, tzinfo=UTC))
    checks = [
        ("Day-ahead prices (A44)", {"documentType": "A44", "in_Domain": es, "out_Domain": es}, recent, early),
        ("Actual total load (A65/A16)", {"documentType": "A65", "processType": "A16", "outBiddingZone_Domain": es}, recent, early),
        ("Day-ahead load forecast (A65/A01)", {"documentType": "A65", "processType": "A01", "outBiddingZone_Domain": es}, recent, early),
        ("Generation per type (A75/A16)", {"documentType": "A75", "processType": "A16", "in_Domain": es}, recent, early),
        ("Wind and solar forecast (A69/A01)", {"documentType": "A69", "processType": "A01", "in_Domain": es}, recent, early),
        ("Reservoir filling (A72/A16)", {"documentType": "A72", "processType": "A16", "in_Domain": es}, (now - timedelta(days=21), now), early_week),
        ("Physical flows ES to FR (A11)", {"documentType": "A11", "in_Domain": fr, "out_Domain": es}, week, early),
        ("Physical flows FR to ES (A11)", {"documentType": "A11", "in_Domain": es, "out_Domain": fr}, week, early),
        ("Physical flows ES to PT (A11)", {"documentType": "A11", "in_Domain": PT_EIC, "out_Domain": es}, week, early),
        ("Physical flows PT to ES (A11)", {"documentType": "A11", "in_Domain": es, "out_Domain": PT_EIC}, week, early),
    ]
    say("| Data set | Series | Latest point (UTC) | Last value | Step (min) | Production types | Data in Jan 2015 |")
    say("|---|---|---|---|---|---|---|")
    for label, params, win, old_win in checks:
        try:
            xml = entsoe_get({**params, "periodStart": entsoe_param(win[0]), "periodEnd": entsoe_param(win[1])})
            n, times, last, psr = summarise_xml(xml)
            time.sleep(1)
            old_xml = entsoe_get({**params, "periodStart": entsoe_param(old_win[0]), "periodEnd": entsoe_param(old_win[1])})
            old_n = summarise_xml(old_xml)[0]
            latest_txt = last[0].strftime("%Y-%m-%d %H:%M") if last else "none"
            last_val = last[1] if last else "–"
            say(f"| {label} | {n} | {latest_txt} | {last_val} | "
                f"{minutes_between(times) or '–'} | {', '.join(psr) or '–'} | {'yes' if old_n else 'no'} |")
        except Exception as error:  # noqa: BLE001
            say(f"| {label} | FAILED: {str(error)[:120]} | | | | | |")
        time.sleep(1)
    say()
    say("Production type codes (B01, B14 …) are ENTSO-E's own; they will be mapped to fuels when the pipeline is built.")
    say()


def main():
    started = datetime.now(UTC)
    say("# Spain probe report")
    say()
    say(f"Run at {started:%Y-%m-%d %H:%M} UTC. Read-only: nothing in data/ was changed.")
    say()
    for step in (probe_esios, probe_entsoe):
        try:
            step()
        except Exception:  # noqa: BLE001
            say("```")
            say(traceback.format_exc())
            say("```")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "spain_probe_report.md").write_text("\n".join(report) + "\n", encoding="utf-8")
    print(f"Report written to {OUT / 'spain_probe_report.md'}")


if __name__ == "__main__":
    main()
