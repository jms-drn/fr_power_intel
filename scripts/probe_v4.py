"""One-off probe of ENTSO-E prices and flows and RTE's 15-minute generation mix.

Saves raw samples and a summary to probe/ (pushed to the "probe" branch) so the
data shapes can be checked before building v4.0.
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rte_client import RteClient  # noqa: E402

OUT = Path("probe")
OUT.mkdir(exist_ok=True)
ENTSOE = "https://web-api.tp.entsoe.eu/api"
TOKEN = os.environ.get("ENTSOE_API_KEY", "")
AREAS = {
    "FR": "10YFR-RTE------C", "DE_LU": "10Y1001A1001A82H", "DE_AT_LU": "10Y1001A1001A63L",
    "BE": "10YBE----------2", "NL": "10YNL----------L", "CH": "10YCH-SWISSGRIDZ",
    "IT_NORD": "10Y1001A1001A73I", "ES": "10YES-REE------0", "GB": "10YGB----------A",
    "PT": "10YPT-REN------W",
}
summary = {"token_set": bool(TOKEN)}


def entsoe(name, params):
    query = {"securityToken": TOKEN, **params}
    url = f"{ENTSOE}?{urllib.parse.urlencode(query)}"
    entry = {"params": params}
    started = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "application/xml"}), timeout=180) as r:
            body = r.read().decode("utf-8", "replace")
            entry["status"] = r.status
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        entry["status"] = e.code
    entry["seconds"] = round(time.time() - started, 1)
    entry["bytes"] = len(body)
    entry["timeseries"] = body.count("<TimeSeries>")
    entry["resolutions"] = sorted(set(re.findall(r"<resolution>(\w+)</resolution>", body)))
    entry["curve_types"] = sorted(set(re.findall(r"<curveType>(\w+)</curveType>", body)))
    entry["sequences"] = sorted(set(re.findall(r"<classificationSequence_AttributeInstanceComponent\.position>(\d+)<", body)))
    entry["points"] = body.count("<Point>")
    starts = re.findall(r"<timeInterval>\s*<start>([^<]+)</start>\s*<end>([^<]+)</end>", body)
    entry["first_interval"] = starts[0] if starts else None
    entry["last_interval"] = starts[-1] if starts else None
    if entry["status"] != 200 or "<Reason>" in body:
        entry["reason"] = re.sub(r"\s+", " ", body)[:600]
    summary[name] = entry
    (OUT / f"{name}.xml").write_text(body[:400000])
    time.sleep(1)


def main():
    if TOKEN:
        A = AREAS
        # Day-ahead prices: recent (15-minute era, including tomorrow) and history.
        for zone in ["FR", "DE_LU", "BE", "NL", "CH", "IT_NORD", "ES", "PT", "GB"]:
            entsoe(f"price_{zone}_recent", {"documentType": "A44", "in_Domain": A[zone], "out_Domain": A[zone],
                                            "periodStart": "202610282300", "periodEnd": "202611032300"})
        entsoe("price_FR_2015", {"documentType": "A44", "in_Domain": A["FR"], "out_Domain": A["FR"],
                                 "periodStart": "201412312300", "periodEnd": "201501072300"})
        entsoe("price_DE_AT_LU_2015", {"documentType": "A44", "in_Domain": A["DE_AT_LU"], "out_Domain": A["DE_AT_LU"],
                                       "periodStart": "201412312300", "periodEnd": "201501072300"})
        entsoe("price_FR_year_2024", {"documentType": "A44", "in_Domain": A["FR"], "out_Domain": A["FR"],
                                      "periodStart": "202312312300", "periodEnd": "202412312300"})
        entsoe("price_FR_sep_oct_2025", {"documentType": "A44", "in_Domain": A["FR"], "out_Domain": A["FR"],
                                         "periodStart": "202509272200", "periodEnd": "202510042200"})
        # Physical flows across each French border, both directions.
        for other in ["BE", "DE_LU", "CH", "IT_NORD", "ES", "GB"]:
            for frm, to in ((other, "FR"), ("FR", other)):
                entsoe(f"flow_{frm}_to_{to}", {"documentType": "A11", "in_Domain": A[to], "out_Domain": A[frm],
                                               "periodStart": "202610302300", "periodEnd": "202611022300"})
        entsoe("flow_FR_to_DE_AT_LU_2015", {"documentType": "A11", "in_Domain": A["DE_AT_LU"], "out_Domain": A["FR"],
                                            "periodStart": "201412312300", "periodEnd": "201501072300"})
        entsoe("flow_FR_to_GB_2019", {"documentType": "A11", "in_Domain": A["GB"], "out_Domain": A["FR"],
                                      "periodStart": "201901012300", "periodEnd": "201901072300"})
        # Scheduled commercial exchanges (day-ahead) FR->ES as a sample.
        entsoe("sched_FR_to_ES", {"documentType": "A09", "in_Domain": A["ES"], "out_Domain": A["FR"],
                                  "contract_MarketAgreement.Type": "A01",
                                  "periodStart": "202610302300", "periodEnd": "202611022300"})

    # RTE 15-minute generation mix (from 2017) and hourly by type.
    try:
        gen = RteClient(api="generation", pause_seconds=1.5)
        for name, params in (
            ("mix15_recent", {"start_date": "2026-10-30T00:00:00+01:00", "end_date": "2026-11-02T00:00:00+01:00"}),
            ("mix15_2017", {"start_date": "2017-01-01T00:00:00+01:00", "end_date": "2017-01-03T00:00:00+01:00"}),
        ):
            payload = gen.get("generation_mix_15min_time_scale", params)
            blocks = (payload or {}).get("generation_mix_15min_time_scale") or []
            summary[name] = {
                "series": sorted({f"{b.get('production_type')}/{b.get('production_subtype')}" for b in blocks}),
                "values_per_series": max((len(b.get("values") or []) for b in blocks), default=0),
                "first": (blocks[0]["values"][0] if blocks and blocks[0].get("values") else None),
                "last_updated": max((v.get("updated_date", "") for b in blocks for v in b.get("values") or []), default=None),
            }
            (OUT / f"{name}.json").write_text(json.dumps(payload)[:2_000_000])
        payload = gen.get("actual_generations_per_production_type",
                          {"start_date": "2015-01-01T00:00:00+01:00", "end_date": "2015-01-03T00:00:00+01:00"})
        blocks = (payload or {}).get("actual_generations_per_production_type") or []
        summary["per_type_2015"] = sorted({b.get("production_type") for b in blocks})
    except Exception as error:  # report, don't stop
        summary["rte_error"] = str(error)

    (OUT / "summary.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1)[:20000])


if __name__ == "__main__":
    main()
