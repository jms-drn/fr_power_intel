# fr_power_intel

**France Power Intelligence**: a web tool for the French power system from RTE and ENTSO-E data — electricity demand, nuclear availability and outages, hydro reservoirs, day-ahead prices, generation by fuel and cross-border flows — each compared with earlier years.

## The site

A left sidebar switches between pages; each page keeps its own tabs. Links from before v3 (`#today`, `#explorer?...`) still open the Demand page.

| Page | What it shows |
|---|---|
| **Overview** | One tile per dataset with the latest figure, the main comparison and a trend line, plus a copyable list of main points |
| **Demand** | The four tabs below |
| **Nuclear availability** | *Today*: availability now, map of every reactor coloured by status, time offline so far or time until return, next 14 days, output by reactor over the past week, notice changes in the past 72 hours. *Explorer*: availability, unavailable capacity (planned/unplanned), availability rate, output, load factor and reactors offline for any period since 2011, by fleet, site or reactor series, compared with earlier years, ranking, outlook extension. *Outages*: timeline per reactor and sortable table of every outage, with the change against the first announced end date. *Outlook*: expected availability for any period up to 540 days ahead, compared with the outlook a week or month earlier or on the same date in earlier years, and with what actually happened |
| **Hydro reserves** | Weekly stored energy since Dec 2014 against earlier years (average, range, every year), difference view, ranking of the week, full history |
| **Prices** | Eight numbered tabs with previous/next links. *Short term*: today's and tomorrow's day-ahead prices with stats tiles (vs 7- and 30-day averages, same weekday last year, peak/off-peak, extremes, negative hours, parity and spread with a chosen neighbour). *Explorer*: FR, DE, BE, CH, IT-North, ES from 15 minutes to yearly; baseload, peak, off-peak, daily low/high, range, volatility, negative hours, negative-price depth; comparisons, alignment, profile, duration curve, difference, ranking. *Spreads*, *Mix & Price*, *Negative Prices*, *Capture Prices*, *Residual Demand*, *Nuclear Modulation* |
| **Generation** | *Today*: 15-minute mix against the same hours last year, shares. *Explorer* by fuel (output, share, energy). *Records* with links to the data |
| **Flows** | *Live map* of physical flows on each border (incl. GB), *Explorer* (net exports, exports, imports), *Flows and prices* (flow against the price gap) |

### Demand tabs

| Tab | What it shows |
|---|---|
| **Today** | Actual demand against RTE's intraday, D-1 and D-2 forecasts, with optional same-weekday references from earlier years |
| **Explorer** | Any period from Dec 2012 at 15-minute to monthly resolution; average, peak, minimum or energy. Periods can run past today into RTE's forecasts (to the end of the week-ahead horizon), with a projection for the whole period. Comparisons with last year, the average of the previous 2–5 years and their min–max range (each toggled), aligned by calendar date or weekday; difference view in % or GW; public holidays marked or excluded; event markers; average daily (diurnal) profile; ranking of the period across every year since 2013 |
| **Forecast accuracy** | D-1, D-2 and week-ahead (3–9 days) error over time, by lead time, weekday, hour and season, distribution of daily errors, and the biggest misses |
| **Outlook** | Next 10 days (actual, intraday, D-1, D-2, latest week-ahead) with a timeline of which forecast covers which day, week-ahead peaks with RTE's temperature assumptions, RTE's annual forecast range against actual weekly peaks and minimums, and the year-ahead supply margin by year |

On every chart: hover for values, drag across the chart to zoom (overview strip on the main charts), double-click to reset; the legend shows each series' average for the period in view and hides or shows series; PNG (with source footer), copy-to-clipboard and CSV export. The address bar stores the settings, so links can be shared. The Display menu offers dark/light mode, seven line colour schemes (including high contrast and colour-blind safe), line thickness and data-point markers. "What's new" lists every version; "About the data" has a glossary.

The site is static (GitHub Pages) and reads the CSV files below. Code: `index.html`, `style.css`, `js/` (ECharts 5.6 is included in `js/vendor/`). Site settings, including the refresh service address, are in `js/config.js`; the version history is in `js/changelog.js`.

## How the data is collected

| Process | When | What it does |
|---|---|---|
| **Refresh service** (Cloudflare Worker, `worker/`) | Every 15 minutes, and when someone presses Refresh (at most every 5 minutes) | Starts the *Update RTE data* workflow; also serves the latest RTE data directly to the Refresh button. Setup: [`worker/SETUP.md`](worker/SETUP.md) |
| **Update RTE data** (GitHub workflow) | When started by the refresh service, hourly as a backup, or by hand | Fetches the latest actuals and forecasts, re-checks the past 7 days, fetches week-ahead and annual forecasts, rebuilds the summaries. Safe to re-run |
| **Backfill RTE history (one-off)** | By hand only | Fetches history in chunks (from 17 Dec 2012 for actuals/D-1/D-2). Safe to re-run |

| **Backfill nuclear and hydro history (one-off)** | By hand only | Downloads every nuclear unavailability notice version since Dec 2010 (at most 20 calls an hour, as RTE asks), fleet nuclear output since Dec 2014 and hydro reservoirs since Dec 2014. Safe to re-run |

| **Backfill prices, flows and generation history (one-off)** | By hand only | Day-ahead prices (ENTSO-E, from 5 Jan 2015), physical flows on every border (ENTSO-E) and the generation mix (RTE: hourly 2015–16, 15-minute from 2017). Year-long ENTSO-E requests that time out are retried in three-month pieces. Safe to re-run |

Each update run also fetches new nuclear notices (every run), nuclear output fleet and per reactor (at most hourly) and reservoir levels (every 12 hours), then rebuilds the nuclear files (`scripts/power_update.py`, `scripts/power_summarise.py`). It then fetches the generation mix for today and yesterday (every run), prices from yesterday to the day after tomorrow (hourly, and every run between 12:00 and 15:00 Paris time until tomorrow's French prices appear) and flows for the past two days (hourly), and rebuilds the market files (`scripts/market_update.py`, `scripts/market_summarise.py`).

The workflows use the `RTE_CLIENT_ID` / `RTE_CLIENT_SECRET` (consumption), `RTE_GENERATION_CLIENT_ID` / `RTE_GENERATION_CLIENT_SECRET` (actual generation) and `RTE_UNAVAILABILITY_CLIENT_ID` / `RTE_UNAVAILABILITY_CLIENT_SECRET` (unavailability) and `ENTSOE_API_KEY` (ENTSO-E Transparency Platform) repository secrets, and never write data at the same time. The site checks for new data every two minutes.

## Data files

All times are stored in UTC (`2026-10-23T22:00Z`). Files are split by month in Paris time.

| Path | Contents |
|---|---|
| `data/latest.json` | Raw latest RTE response (used by the "today" view) |
| `data/archive/realised/YYYY/YYYY-MM.csv` | Actual demand, 15-minute: `start_utc,mw` |
| `data/archive/d1/YYYY/YYYY-MM.csv` | Day-ahead forecast, 15-minute: `start_utc,mw,updated_utc` |
| `data/archive/d2/YYYY/YYYY-MM.csv` | Two-day-ahead forecast, 30-minute: `start_utc,mw,updated_utc` |
| `data/archive/weekly/YYYY/YYYY-MM.csv` | Every published week-ahead forecast (D+3 to D+9), 30-minute: `updated_utc,start_utc,mw` |
| `data/archive/weekly_peaks.csv` | Week-ahead forecast peaks with RTE's reference temperature and deviation |
| `data/archive/annual_forecasts.csv` | RTE's annual forecast by week, with the forecast supply margin |
| `data/summary/daily.csv` | One row per Paris day: actual mean/min/max/energy and D-1/D-2 forecast errors |
| `data/summary/weekly_errors.csv` | One row per week-ahead forecast vintage and target day, with lead time and errors |
| `data/summary/error_profile.csv` | Forecast errors summed by month and hour of day / weekday, for D-1, D-2 and week-ahead leads 3–9 |
| `data/status.json` | Coverage, list of monthly files, last update times and any errors |
| `data/nuclear/notices/YYYY/YYYY-MM.csv` | Every version of every nuclear unavailability notice, by publication month |
| `data/nuclear/output/YYYY/YYYY-MM.csv` | Fleet nuclear output, hourly: `start_utc,mw` |
| `data/nuclear/unit_output.json` | Output per reactor, hourly, past 8 days |
| `data/nuclear/fleet.json` | Reactor list (site, series, capacity, location, in-service dates) and file index |
| `data/nuclear/hourly/YYYY/YYYY-MM.csv` | Fleet hourly: installed, available, planned and unplanned unavailable, output |
| `data/nuclear/unit_daily/YYYY.csv` | Daily mean available MW per reactor |
| `data/summary/nuclear_daily.csv` | Daily fleet summary: availability, unavailability, reactors offline, output, load factor |
| `data/nuclear/outlook/YYYY/YYYY-MM.csv` | For each day: the expected daily availability for the next 540 days as known at the end of that day (values in units of 10 MW) |
| `data/nuclear/outages/YYYY.csv` | One row per notice (latest version), by start year, with the first announced dates |
| `data/nuclear/live.json` | Live reactor status, next 14 days, notice changes in the past 72 hours, current outlook |
| `data/hydro/reserves.csv` | Weekly reservoir levels (MWh) |
| `data/prices/<ZONE>/YYYY/YYYY-MM.csv` | Day-ahead prices (ENTSO-E): `start_utc,eur,min` (`min` = period length, 60 or 15). Zones FR, DE, BE, CH, IT_NORD, ES |
| `data/prices/daily.csv` | Per Paris day and zone: base, peak, off-peak, min, max, negative hours, zero-price hours, negative-price depth, volatility; parity (`par_`) and spread (`spr_`) of FR against each neighbour |
| `data/flows/<BORDER>/YYYY/YYYY-MM.csv` | Physical flows (ENTSO-E): `start_utc,export_mw,import_mw,min`. Borders BE, DE, CH, IT_NORD, ES, GB |
| `data/flows/daily.csv` | Daily mean exports, imports and net per border, and the net total |
| `data/generation/mix/YYYY/YYYY-MM.csv` | RTE generation by fuel and subtype (MW), hourly 2015–16, 15-minute from 2017 |
| `data/generation/daily.csv` | Daily mean MW by fuel, total, low-carbon/renewable shares and share by fuel |
| `data/market/hourly/YYYY/YYYY-MM.csv` | Hourly table joining FR price, demand, residual demand, nuclear output and availability (and unused available capacity), output by fuel and net exports |
| `data/market/daily.csv`, `data/market/capture.csv` | Daily residual demand, nuclear headroom, net exports; daily capture prices and energy by technology |
| `data/records.json`, `data/alerts.json`, `data/market/index.json` | Records, notable events for the bell, and the list of monthly market files |

## Methodology notes

- **Forecast error = forecast − actual.** Positive means RTE over-forecast demand.
- **Which forecast version is kept.** RTE can republish forecasts. For D-1 and D-2 the archive keeps the latest version published *before* the interval it forecasts; a version published afterwards never replaces it. `updated_utc` records when the stored version was published, and the daily summary's `*_ex_ante_pct` column shows the share of a day's values published in advance. All week-ahead versions are kept, so accuracy can be measured by lead time.
- **Resolution.** All forecasts are compared at 30 minutes, against the average of the two matching 15-minute actuals. D-2 and week-ahead forecasts are published half-hourly; D-1 is published at 15 minutes but is natively half-hourly for most of its history (quarter-hour values are interpolated in 2012–22 and repeated in 2024), so its two quarter-hours are averaged.
- **Values below 15 GW** are treated as data errors and not stored (RTE's D-1 history for 2–14 Oct 2019 contains ~0.7 GW values).
- **Daily energy** is average demand × hours in the Paris day, so a missing quarter-hour (RTE's 2025 data lacks 23:45 on many days, and October clock-change days lack the repeated hour) doesn't understate it.
- **Annual forecast.** RTE's weekly average forecast is only populated for 2015–16; later years have the weekly min/max and the margin.
- **Peak error** is the forecast day's maximum minus the actual day's maximum, calculated only when at least 90% of the day's intervals have both values.
- **Clock-change days** have 92 (March) or 100 (October) quarter-hours. Daily rows show `intervals` against `expected_intervals` so incomplete days are visible.
- **Actuals** are overwritten when RTE revises them; the hourly run re-checks the last 7 days.
- The undocumented `CORRECTED` block sometimes returned by the API is ignored.


### Nuclear

- **Availability** = installed capacity − unavailable capacity in the latest version of each notice covering that moment. Overlapping notices on one reactor are not added: the largest reduction counts. Cancelled (DISMISSED) versions count as no outage. Times are rounded to 15 minutes.
- **As-of outlooks** use, for each notice, the latest version published by the end of that Paris day.
- **Fleet changes**: Fessenheim 1 and 2 leave the fleet at their closures in 2020; Flamanville 3 joins at its first grid connection (21 Dec 2024).

### Prices, generation and flows

- **Day-ahead prices**: ENTSO-E document A44, keeping the SDAC result (contract type A01, classification sequence 1; DE-LU also publishes EXAA). Curve type A03 points that repeat are filled forward. Germany is DE-AT-LU before 1 Oct 2018 and DE-LU after. 15-minute prices from delivery 30 Sep 2025 (Switzerland stays hourly).
- **Peak** is Monday–Friday 08:00–20:00 Paris time. Daily averages weight each period by its length; days with fewer than 20 hours of prices are left out.
- **Parity** is measured on a 15-minute grid (hourly prices repeated): the two prices differ by less than €0.01/MWh.
- **Negative-price depth** = Σ |price| × hours over negative periods (€/MWh·h).
- **Capture price** = Σ(price × output) / Σ output on a 15-minute grid, per day; longer periods are output-weighted.
- **Generation mix** periods where all fuels add up to less than 20 GW are treated as missing (RTE's mix has a few broken periods, e.g. 14 Apr 2024).
- **Unused available nuclear capacity** = available capacity (notices) − output, floored at zero, hourly.
- **Flows** are ENTSO-E physical flows (document A11) in both directions per border; net = France→neighbour minus neighbour→France.
- **Alerts**: records over the whole history, month records, and "highest/lowest since" with a minimum gap of 7 days (prices) or 30 days (generation, flows, demand); new unplanned nuclear outages ≥ 1 GW and return dates pushed back ≥ 7 days in the past 24 hours; negative French prices today or tomorrow.
