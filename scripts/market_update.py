"""Regular price, flow and generation-mix update, called from update.py.

  * Generation mix (RTE 15-minute): today and yesterday, every run.
  * Day-ahead prices (ENTSO-E): yesterday to the day after tomorrow, at most
    every 55 minutes, but every run between 12:00 and 15:00 Paris time while
    tomorrow's French prices are still missing (the auction publishes about
    12:45-13:00).
  * Physical flows (ENTSO-E): the past two days, at most every 55 minutes.
Then the website's market files are rebuilt.
"""

import os
import traceback
from datetime import datetime, timedelta, timezone

import market_summarise
from market_store import (
    BORDERS, PRICE_ZONES, PRICES_DIR, fetch_flows, fetch_mix15, fetch_prices, month_path, paris_midnight, read_rows,
    store_flows, store_mix, store_prices,
)
from power_store import load_state, save_state
from rte_client import RteClient
from store import PARIS, fmt_utc, parse_ts

UTC = timezone.utc


def due(state, key, minutes):
    last = state.get(key)
    return not last or datetime.now(UTC) - parse_ts(last) >= timedelta(minutes=minutes)


def has_prices_for(day):
    """True when France has a full set of prices for that Paris day."""
    start = paris_midnight(day).astimezone(UTC)
    end = paris_midnight(day + timedelta(days=1)).astimezone(UTC)
    rows = read_rows(month_path(PRICES_DIR / "FR", start))
    minutes = sum(int(r.get("min") or 60) for r in rows if fmt_utc(start) <= r["start_utc"] < fmt_utc(end))
    return minutes >= (end - start).total_seconds() / 60 - 1


def run():
    state = load_state()
    errors = []
    now = datetime.now(UTC)
    paris_now = now.astimezone(PARIS)
    today = paris_now.date()

    try:
        client = RteClient(api="generation", pause_seconds=1.5)
        recs = fetch_mix15(client, paris_midnight(today - timedelta(days=1)), paris_midnight(today + timedelta(days=1)))
        print(f"Generation mix: {store_mix(recs)} periods added or changed")
        state["mix_fetched_utc"] = fmt_utc(now)
    except Exception as error:
        traceback.print_exc()
        errors.append(f"generation mix: {error}")

    if not os.environ.get("ENTSOE_API_KEY"):
        errors.append("prices and flows: ENTSOE_API_KEY is not set")
    else:
        tomorrow_missing = not has_prices_for(today + timedelta(days=1))
        auction_window = 12 <= paris_now.hour < 15 or (paris_now.hour >= 15 and tomorrow_missing)
        if due(state, "prices_fetched_utc", 55) or (auction_window and tomorrow_missing):
            start = paris_midnight(today - timedelta(days=1)).astimezone(UTC)
            end = paris_midnight(today + timedelta(days=3)).astimezone(UTC)
            done = 0
            for zone in PRICE_ZONES:
                try:
                    done += store_prices(zone, fetch_prices(zone, start, end))
                except Exception as error:
                    traceback.print_exc()
                    errors.append(f"prices {zone}: {error}")
            print(f"Prices: {done} periods added or changed")
            state["prices_fetched_utc"] = fmt_utc(now)
        if due(state, "flows_fetched_utc", 55):
            start = paris_midnight(today - timedelta(days=2)).astimezone(UTC)
            end = now.replace(minute=0, second=0, microsecond=0)
            done = 0
            for border in BORDERS:
                try:
                    done += store_flows(border, fetch_flows(border, start, end))
                except Exception as error:
                    traceback.print_exc()
                    errors.append(f"flows {border}: {error}")
            print(f"Flows: {done} periods added or changed")
            state["flows_fetched_utc"] = fmt_utc(now)

    try:
        market_summarise.main(now)
    except Exception as error:
        traceback.print_exc()
        errors.append(f"market summaries: {error}")

    save_state(state)
    return {"updated_utc": fmt_utc(now), "errors": errors}
