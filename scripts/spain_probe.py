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


def minutes_
