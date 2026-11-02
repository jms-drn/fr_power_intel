# CLAUDE.md — France Power Intelligence

Briefing for any Claude session working on this repository. It records what
the project is, how it is built, the data decisions behind it, how the owner
likes to work and what has been planned. Read it fully before changing
anything. Keep it up to date when something here changes.

Live site: https://jms-drn.github.io/fr_power_intel/ (GitHub Pages, repo
`jms-drn/fr_power_intel`; renamed from `fr_demand_tooling` on 29 Oct 2026 —
the old address was deliberately not redirected).

---

## 1. The owner and how to work with him

- **James** (byline **jms-drn**), a reporter at Argus covering the Spanish
  power market and European energy markets. He uses the site for his own
  analysis and shares the live page with colleagues. His team focuses on
  **nuclear unavailability** more than availability.
- **Not a technical developer.** Explain in plain language, no jargon about
  internal tooling. Say what he will see and what he needs to do, step by step
  (e.g. exactly which Cloudflare/GitHub menu to open).
- **Think in stages, ask before starting a job** when the scope is unclear;
  offer analytical views and extra ideas ("think outside the box"), but ask
  rather than assume when a choice is his to make.
- **Large releases, not drip-fed edits.** The established rhythm: James sends
  a numbered list of changes → Claude replies point by point with views,
  questions and extra suggestions (often with a quick visual for colour or
  layout choices) → James answers → Claude builds everything in one release,
  tests it, updates the changelog and reports back briefly.
- **Precision.** He values source precision and primary documents, pushes
  back on stale or invented information, and will not tolerate arithmetic
  errors: double-check every figure, date and calculation (ideally with an
  independent recomputation) before stating it. Never share a URL that has not
  been verified. If something is uncertain, say so.
- **On mistakes:** just say sorry and fix it — no "you're right to flag that"
  patter.
- **Writing style for the site and replies:** British spelling, plain and
  direct, short sentences, numbers with units (GW, TWh, pp), sentence case.
  Headline sentences on each page are written to be copied straight into
  articles (each has a Copy button), so they must read as clean prose.
- Commit and push directly to `main` (he chose to have Claude commit for him).
  Releases are announced in the in-app "What's new" panel (`js/changelog.js`).

---

## 2. What the site is

A static, dark-by-default web tool on French power-system data from RTE and
ENTSO-E, each dataset compared with earlier years. Header style:
"France Power **<Accent> Intelligence**" with italic "by jms-drn" byline;
the accent part changes per page:

| Page (sidebar) | Header | Tabs |
|---|---|---|
| Overview | France Power **Intelligence** | — (tiles + "Main points" list with Copy all) |
| Demand | France Power **Demand Intelligence** | Today · Explorer · Forecast accuracy · Outlook |
| Nuclear availability | France Power **Nuclear Availability Intelligence** | Today · Explorer · Outages · Outlook |
| Hydro reserves | France Power **Hydro Intelligence** | — (single page) |
| Prices | France Power **Price Intelligence** | 1 Short term · 2 Explorer · 3 Spreads · 4 Mix & Price · 5 Negative Prices · 6 Capture Prices · 7 Residual Demand · 8 Nuclear Modulation (numbered tabs + Previous/Next links at the foot; order chosen by James) |
| Generation | France Power **Generation Intelligence** | Today · Explorer · Records |
| Flows | France Power **Flows Intelligence** (icon: two arrows in opposite directions) | Live map · Explorer · Flows and prices |

Sidebar groups: "Data" (Demand, Nuclear, Hydro) and "Markets" (Prices,
Generation, Flows). Header: status pill "Last updated HH:MM CET/CEST",
notification bell, Refresh, Display.

Navigation: sleek left sidebar (collapsible to an icon rail, remembered in
the browser; slide-out drawer on phones with a menu button). Sidebar footer:
What's new (with a "new" dot), About the data (glossary drawer), Other
projects (links to https://github.com/jms-drn), Collapse.

URLs: `#page/tab?settings` (e.g. `#nuclear/explorer?measure=off&...`); pages
without tabs are `#hydro`. Every view writes its settings into the address so
links can be shared. Old links `#today`, `#explorer?...`, `#accuracy`,
`#outlook` open the Demand tabs (handled in `readHash` in `js/util.js`).

### Features by page (current state, v4.0)

**Overview** — "Today's market" paragraph, then six live tiles (Demand now +
month to date vs 3-year average with a 60-day sparkline; Nuclear available
now, reactors offline, today vs same day last year, past 90 days + next 60
from notices; Hydro TWh and % full vs 5-year average with range; Prices
baseload today/tomorrow vs 30-day average; Generation low-carbon share today;
Flows net exports latest hour), each with a one-line explainer, and an
auto-written "Main points" list. Overview and nuclear Today lead with
*availability*; Explorer and Outlook default to *unavailability* (James's
explicit choice).

**Demand** (RTE consumption API; history from 17 Dec 2012)
- *Today:* actual vs intraday, D-1, D-2; optional same-weekday last year /
  3-year average; forecast-minus-actual chart.
- *Explorer:* any period at 15-min/hourly/daily/weekly/monthly; average, peak,
  minimum or energy; compare with last year, average of previous 2–5 years and
  min–max range (each toggled); align by calendar date or weekday; public
  holidays ignore/mark/exclude; daily (diurnal) profile view; difference view
  (% or GW); event markers; periods can run into RTE's forecasts (intraday →
  D-1 → D-2 → week-ahead) as a dashed "Forecast ahead" line with a projection
  card; ranking of the same period in every year since 2013.
- *Forecast accuracy:* D-1, D-2 and week-ahead errors (MAE, MAPE, bias, peak
  error) over time, by lead time, weekday, hour and season; distribution;
  biggest misses.
- *Outlook:* next ~10 days timeline, week-ahead peaks with RTE temperature
  assumptions, RTE annual forecast band vs actual weekly min/peak, year-ahead
  margin by year.

**Nuclear availability** (RTE Unavailability Additional Information v7 +
Actual Generation APIs; availability history from 1 Jan 2015, output from
15 Dec 2014)
- *Today:* headline sentence; cards in three labelled rows — **Availability**
  (available now, vs same hour last year, today's availability vs 5-year
  average, unavailable now planned/unplanned), **Output** (average today so
  far, last 7 days, each vs same hours last year; output as share of
  available), **Reactors** (offline planned/unplanned, partially available,
  modulating, due back in 7 days). Map of France with every reactor (ring
  around each site, sized by capacity), colour mode: Status / Time offline so
  far / Time until return; hover tooltip with notices and how far the return
  date moved since first announced. Side list "Reactors not at full capacity"
  with progress bars and a sort menu (back soonest / offline longest / most
  recent / largest); clicking a reactor opens its outage history. Available
  capacity chart with Past (week…year, custom) and Next (none…3 months) menus,
  5-year average and range, last year, output, expected availability (hourly
  up to ~6 weeks, daily beyond or >14 days ahead). Output-by-reactor heat map
  (7 days). Notice changes in the past 72 hours: sortable columns, "Delays
  only" switch, type filter, CSV.
- *Explorer:* **Unavailable ⇄ Available switch** (iOS-style; default
  Unavailable) + measure family (Capacity GW, Rate % of installed, Output,
  Load factor, Reactors offline); hourly to monthly; whole fleet or a site or
  reactor series; compare with last year, average and range of 2–10 previous
  years; calendar/weekday alignment; expected ahead from current notices;
  planned/unplanned stacked split; events; ranking of the same period across
  years ("3rd highest unavailable capacity of 12 years"). James calls this the
  focal point of the nuclear section.
- *Outages:* Gantt timeline per reactor + sortable table of every outage
  (latest notice version) with the change against the first announced end;
  filters: window, type, length, size (default: ≥1 day and ≥ a quarter of the
  reactor), status (ongoing / not started / ended / ran past first announced
  end / ended early), "offline for" (ongoing for over a week/month/3/6 months),
  site, search, and a "Show all outages" one-click switch. Headline gives the
  share of ended planned outages that overran and the average change.
- *Outlook:* expected unavailability (or availability via the same switch)
  for any period up to 540 days ahead "as of" any date since 2015; compare
  with this year's outlook a week/month earlier, the same point 1–3 years
  earlier, the **5-year average** (outlook and outcome), or any chosen date;
  "What actually happened". **Chart convention, shown in a key above the
  chart: colour = which year; solid = what the notices said at the time;
  dashed = this year's outlook at an earlier date; dotted = what actually
  happened.** Legend names read like "Nov 2025: expected on 29 Oct 2025".
  Cards include the expected planned/unplanned split. Second chart: how the
  outlook for the period moved by date read. Third: outlook vs outcome at the
  same lead time in every year (shows the usual optimism of outlooks).

**Hydro reserves** (RTE weekly `water_reserves`, from Dec 2014)
- "Measure in" switch: Stored energy (TWh) / **Fill level (% of 3,591 GWh)**;
  in fill level every comparison is in **percentage points** (cards, charts).
- Year against earlier years by ISO week (calendar or Oct-start hydro year),
  last year, average of 3/5/10/all years, min–max range, every year; difference
  view; full history; ranking of the latest week; headline includes the
  four-week trend vs the usual change and whether the gap to average widens.

**Prices** (ENTSO-E day-ahead, from 5 Jan 2015; zones FR, DE, BE, CH,
IT_NORD, ES — neighbours only, James's choice; €/MWh; peak = Mon–Fri
08:00–20:00 Paris, the market standard)
- *Short term:* today/tomorrow chart FR + chosen neighbour; tile rows Price
  (baseload with "highest/lowest since", vs yesterday/today, vs 7- and 30-day
  averages, vs same weekday last year), Shape of the day (peak, off-peak,
  spread, highest/lowest quarter-hour, intraday range, negative hours),
  Against the neighbour (baseload, spread, parity); baseload-by-country bars.
- *Explorer:* the shared `TimeExplorer` (js/time-explorer.js): presets
  (today…gas year, winter/summer, custom), resolutions 15 min–yearly
  (pre-Oct-2025 hourly prices repeated across quarter-hours), measures base,
  peak, off-peak, daily min/max, range, volatility, negative hours,
  negative-price depth; compare last year, N-year average, range, a chosen
  year, a second zone; alignment weekday for ≤ daily, calendar for weekly+
  (switch); views over time / daily profile (weekday/weekend split) /
  duration curve; difference view; ranking; headline + cards; CSV.
- *Spreads:* FR minus each neighbour; parity share by month; most divergent.
- *Mix & Price:* linked price + stacked mix charts (echarts.connect); average
  price by condition band; scatter coloured by year.
- *Negative Prices:* hours, "Negative-price depth" (James's name; €/MWh·h),
  cumulative vs last year and N-year average, any threshold below/above, a
  switch to include zero-priced periods, month bars, histogram, hour×month
  heat map.
- *Capture Prices:* TimeExplorer on daily capture prices (output-weighted
  for weekly+), capture rate, discount; "when it earns" by hour.
- *Residual Demand:* TimeExplorer (demand − wind − solar) + price by band.
- *Nuclear Modulation:* fleet unused available capacity (available − output)
  in negative / low (under threshold €10–50, default €20) / normal price
  hours, with a caveat that it is not all price-led; then "Reactor by
  reactor" (v4.1): sortable ranking, map, reactor × month heat map, by
  series, one-reactor hourly chart; modulating cut-off menu 70/80/90/95%
  (James: 80% default) from `data/nuclear/modulation/`.

**Generation** (RTE: hourly per-type 2015–16, 15-minute mix from 2017)
- *Today:* 15-min stacked mix, fuel tiles vs same hours on the same weekday
  last year, shares; headline picks the most notable change.
- *Explorer:* TimeExplorer in multi mode: tick fuels (All fuels / Clear,
  Split hydro), side by side or stacked; one fuel keeps the comparisons;
  several fuels get a minimal table (avg, vs last year GW and %, vs N-yr avg
  GW and %, share) and, for two, a gap row + "Show gap over time" (GW only,
  James's choice). Hydro split = run-of-river, reservoir, pumped storage,
  unassigned (on Today too).
- *Records:* all-time highs/lows (records.json), each linking to the data.

**Flows** (ENTSO-E physical flows A11, both directions; borders BE, DE, CH,
IT_NORD, ES, GB — GB flows do exist; captioned "latest from ENTSO-E")
- *Live map:* nuclear-map style, an arrow per border (width = size, teal
  export, amber import); cards; past-7-days chart.
- *Explorer:* net exports / exports / imports, all borders or one.
- *Flows and prices:* average flow by price-gap band, scatter, share of
  hours flowing from the dearer to the cheaper market (GB left out: no
  price).

**v4.1 interface:** "Show daily profile" / "Duration curve" tick boxes swap
the chart (James: swap, not add below); page bar under the tabs with a
minimal freshness line, "Same period on every tab" (Prices only), Pin
(localStorage, per browser) and Excel (all charts on the tab, js/xlsx.js);
Link button by every headline; flags (js/flags.js, inline SVG — emoji flags
fail on Windows); no sidebar section labels; toolbars fold behind
"Settings" on phones; shimmer while loading; market event markers
(`MARKET_EVENTS` in js/events.js).

**Notification bell:** count + soft glow (no sound, no pop-up); panel lists
the past 4 days of `data/alerts.json` with click-through; seen ids in
localStorage. "Highest/lowest since" needs a gap of ≥ 7 days for prices and
≥ 30 days for generation/flows/demand (James's rule).

**Overview:** "Today's market" paragraph (prices, generation, nuclear,
flows; Copy), six tiles each with a one-line page explainer, Main points.

**Every chart** (`ChartPanel` in `js/chart.js`): hover tooltips with all
series, drag to zoom (double-click resets), overview strip on main charts,
legend with averages for the period in view (click to hide/show), data table,
CSV, PNG export with title/legend/source footer naming the page ("Source: RTE
(French TSO) · France Power … Intelligence by jms-drn · Exported …"; the
source comes from `spec.source` / the panel's `source` option, e.g. ENTSO-E), copy
image to clipboard. Time axes are in Paris wall-clock time; lines break at
gaps. Custom charts (map, Gantt, heat map) go through `spec.custom`.

**Display menu** (header): dark/light theme; seven line palettes — Teal
(default), Ocean, Sunset, Nordic, Vivid, High contrast, **Colourblind-friendly**
(Okabe–Ito plus dash patterns); line thickness; data-point markers. Saved in
the browser.

**Header actions:** status pill (time of last data update, problems in the
tooltip), Refresh button (calls the Cloudflare worker for live RTE data and
triggers an update), Display menu.

---

## 3. Design language and preferences

- Clean, minimal, "Grafana-like" dark dashboard; light mode equally polished.
  Fonts: Inter (UI), JetBrains Mono (numbers). Colours are CSS variables on
  `:root` with `[data-theme="light"]` overrides (`style.css`).
- Big, bold headers on one line; the hero line on each tab is two-tone
  ("Nuclear fleet, **right now.**").
- Controls must stay unobtrusive: dropdowns, chips (toggle buttons), segmented
  controls, and **iPhone-style on/off switches** for two-way choices
  (Unavailable ⇄ Available). Make it obvious how to toggle things (short hint
  lines where needed). Click-to-sort table headers with a small arrow.
- **Nuclear status colours (agreed):** online green; partially available amber;
  **offline planned red**; **offline unplanned red-and-yellow diagonal
  stripes** (blue was rejected as "too positive"). Labels "Offline / planned"
  and "Offline / unplanned" on two lines in legends. Overruns beyond the first
  announced end are **purple** in the Outages timeline. Where stripes are
  impossible (stacked areas) unplanned is solid yellow.
- **Duration scales (time offline / time until return), option B:** yellow
  `#ffe066` → `#ffb347` → orange `#ff7f3f` → red `#e8453c` → crimson `#9e1b32`
  for <1 week, 1–4 weeks, 1–3 months, 3–6 months, 6+ months; online stays
  green; stepped buckets, not continuous.
- **Output heat map:** soft red (0%) → amber (50%) → green (100%), muted tones
  tuned per theme (James found saturated colours "garish"); a blue-to-yellow
  scale when the colourblind palette is chosen; no cell borders.
- Cards: label, big mono value, small detail line; grouped with row labels
  where there are many (nuclear Today).
- Charts: comparisons as last year (lime), average (dashed grey), range (grey
  band); "expected/forecast ahead" as dashed; shaded "Expected" area after now.
- Every view has a copyable headline sentence summarising the numbers.
- Preview image (`og-image.png`, 1200×630): "France Power Intelligence", tags
  for live demand, nuclear outages map, outlook comparisons, hydro, history.

---

## 4. Architecture

Static site (no build step) on GitHub Pages + Python data pipeline in GitHub
Actions + a Cloudflare Worker scheduler.

```
index.html, style.css            shell: sidebar, header, tabs, drawers
js/main.js                       page/tab registry (PAGES), routing, status, refresh, Display menu, About text
js/config.js                     worker URL, site URL, repo URL, update interval
js/util.js                       Paris-time helpers, formatting, holidays, URL hash, CSV, DOM helpers
js/data.js                       demand data loading; data version (?v=generated_utc) and caches
js/power-data.js                 nuclear and hydro loaders (fleet, live, daily, hourly, outlooks, outages, reserves)
js/chart.js                      ChartPanel (ECharts 5.6 wrapper, exports, legend, custom charts)
js/settings.js                   palettes, thickness, markers, theme
js/changelog.js                  VERSION and What's new entries (newest first)
js/events.js                     event markers (Covid lockdowns, Feb 2018 cold snap, stress corrosion, Ukraine invasion, sobriety plan)
js/today.js explorer.js accuracy.js outlook.js           Demand tabs
js/nuclear-common.js             labels, colours, durations, stripe pattern, switch helpers
js/nuclear-today.js explorer.js outages.js outlook.js    Nuclear tabs
js/hydro.js  js/overview.js      Hydro page, Overview
js/market-data.js                prices/flows/mix/market loaders (old monthly files cached across updates), zones, fuels, formatters
js/time-explorer.js              shared explorer engine (presets, comparisons, profile, duration, ranking)
js/market-common.js              period picker, card markup
js/prices-short.js prices-explorer.js (Explorer, Capture, Residual) prices-analysis.js (Spreads, Mix, Negative, Modulation)
js/generation.js  js/flows.js    Generation and Flows pages
js/vendor/echarts.min.js, europe-fr.json (Natural Earth outline, cropped)
scripts/rte_client.py            RTE OAuth client for three APIs (consumption, generation, unavailability)
scripts/store.py, summarise.py, update.py, backfill.py   demand pipeline
scripts/power_store.py           nuclear/hydro raw storage and fetchers
scripts/power_summarise.py       builds every nuclear file the site reads
scripts/power_update.py          regular nuclear/hydro update (called from update.py)
scripts/power_backfill.py        one-off history download
scripts/market_store.py          ENTSO-E client + parsing, RTE mix fetchers, monthly CSV storage
scripts/market_summarise.py      daily tables, hourly join, capture, records.json, alerts.json, market/index.json
scripts/market_update.py         regular price/flow/mix update (called from update.py)
scripts/market_backfill.py       one-off history download (backfill-market.yml)
worker/worker.js, worker/SETUP.md   Cloudflare Worker (deployed separately)
```

### Data flow and schedule
- **Cloudflare Worker `fr-demand-refresh`** (https://fr-demand-refresh.james-doran.workers.dev):
  cron `*/15 * * * *` dispatches the GitHub workflow *Update RTE data*
  (`update-rte.yml`) unless one is already queued/running; `POST /refresh`
  (site Refresh button) returns live RTE short-term data and dispatches at
  most every 5 minutes; `GET /latest`. Secrets in Cloudflare:
  `RTE_CLIENT_ID`, `RTE_CLIENT_SECRET`, `GITHUB_TOKEN` (fine-grained, Actions
  read/write, this repo only). `const REPO = "jms-drn/fr_power_intel"` (line
  20) — updated by James after the rename. Lesson learnt: Cloudflare cron
  changes must be *saved/deployed*; verify by looking for `workflow_dispatch`
  runs at :00/:15/:30/:45 in the Actions tab.
- **GitHub schedule** `47 * * * *` is only an hourly backup (GitHub skips many
  scheduled runs).
- `update.py`: demand (latest, past 7 days re-check, week-ahead, annual) →
  `power_update.run()` → `market_update.run()` (mix every run; prices
  hourly and every run 12:00–15:00 Paris until tomorrow's FR prices exist;
  flows hourly; then `market_summarise.main()`, ~20–40 s) (nuclear notices every run; fleet and per-reactor
  output at most every 55 min; reservoirs every 12 h; then
  `power_summarise.main()`) → `summarise.main()` writes `data/status.json`
  (its `generated_utc` is the site's data version). Power errors never block
  demand (`power` key in status.json).
- All data-writing workflows share the concurrency group `rte-data`. On a
  push rejection the update resets to `origin/main` and reruns.
- Repository secrets: `RTE_CLIENT_ID/SECRET` (consumption),
  `RTE_GENERATION_CLIENT_ID/SECRET`, `RTE_UNAVAILABILITY_CLIENT_ID/SECRET`,
  `ENTSOE_API_KEY` (added by James 2 Nov 2026).

### Data files (times stored in UTC as `YYYY-MM-DDTHH:MMZ`)
Demand: `data/archive/{realised,d1,d2,weekly}/YYYY/YYYY-MM.csv` (split by
Paris month), `weekly_peaks.csv`, `annual_forecasts.csv`, `data/latest.json`,
`data/summary/{daily,weekly_errors,error_profile}.csv`, `data/status.json`.

Nuclear: `data/nuclear/notices/YYYY/YYYY-MM.csv` (every version of every
notice, by publication month, ~70k versions/17k notices since Dec 2010),
`output/YYYY/YYYY-MM.csv` (fleet hourly), `unit_output.json` (per reactor,
8 days), `fleet.json` (reactor register + file index), `hourly/` (fleet hourly
installed/available/planned/unplanned/output), `unit_daily/YYYY.csv`,
`data/summary/nuclear_daily.csv`, `outlook/YYYY/YYYY-MM.csv` (per as-of day:
`mw10` = expected daily availability for the next 540 days, `unplanned10` =
unplanned part, both in units of 10 MW), `outages/YYYY.csv` (latest version
per notice by start year), `live.json` (reactor status, next 14 days hourly,
72-hour notice changes, current outlook). Hydro: `data/hydro/reserves.csv`.
`data/power_state.json` records last fetch times. Markets: `data/prices/<ZONE>/`,
`data/flows/<BORDER>/`, `data/generation/mix/` (monthly), `data/prices/daily.csv`,
`data/flows/daily.csv`, `data/generation/daily.csv`, `data/market/hourly/`,
`data/market/{daily,capture}.csv`, `data/market/index.json`, `data/records.json`,
`data/alerts.json`. See README for columns.

---

## 5. Data rules and decisions (do not change without discussing)

**RTE APIs** (guides are in the claude.ai Project): OAuth2 client
credentials per API application. Unavailability v7
`generation_unavailabilities`: query by `PUBLICATION_DATE`, UTC timestamps,
`end_date` **must be in the past** (use now − 1 min); HTTP 206 +
`continuation_token` header for paging (expires in 60 s); RTE asks ≤ 20 calls
an hour. Actual generation: per production type ≤155 days per call (no
production_type filter parameter), per unit ≤7 days, one call an hour
advised; time changes are not handled (24 values a day). `water_reserves`
returns an object (not a list) and rejects an end date of today (use last
Monday).

**Demand**
- Forecast vintage: keep the latest version published *before* the interval;
  D-1 historically time-stamped after the day, so ex-ante confirmation only
  from 26 Oct 2026. Forecasts compared half-hourly. D-1 values ~0.7 GW on
  2–14 Oct 2019 are corrupt and excluded (plausibility ≥ 15 GW). RTE has no
  data for 14 Oct 2023. Annual forecast weekly average only exists for 2015–16.

**Nuclear**
- Notice versions replace each other; "as known at P" = latest version per
  identifier published at or before P (outlooks: end of Paris day P).
  DISMISSED = cancelled (counts as no outage); ACTIVE/INACTIVE are valid.
- Availability = installed − max unavailable across overlapping notices on a
  reactor (never summed); 15-minute grid; planned/unplanned split: overlap
  counts as planned.
- **History starts 1 Jan 2015**: notices before then are far from complete
  (~100 versions/yr in 2011–12, ~1,000 in 2013–14, 4,000+ from 2015).
- Fleet register in `power_summarise.py`: Fessenheim 1 out from
  2020-02-22T01:00Z, Fessenheim 2 from 2020-06-29T21:30Z (EDF filed their
  closure as an outage to 2099, later DISMISSED); Flamanville 3 joins at first
  grid connection 2024-12-21T10:48Z. Capacities from the latest notice
  (installed now 62,970 MW). Reactor series (CP0, CP1, CP2, P4, P'4, N4, EPR)
  and site coordinates (Wikipedia "List of power stations in France") are
  hard-coded.
- **Output filter:** fleet output below 15,000 MW is treated as missing —
  RTE's per-type data is near zero on most days of 16 Sep–13 Oct 2024; since
  v4.1 those hours are filled from the sum of per-reactor output (≥ 40
  reactors reporting), so 2024 = 360.1 TWh.
- In parts of 2016–17 output exceeds notice-implied availability by up to
  2.5 GW (notices overstated outages): flagged in the Explorer.
- Offline < 10% of capacity available; partially available 10–90%;
  modulating = online but output < 80% of available in the latest hour;
  "since" = last time ≥ 90% available; "expected back" = first time ≥ 90%
  again in current notices.
- EDF often files `COMPLEMENTARY_INFORMATION`; the real reason is in the
  bilingual remark (French/English, separated by dashes, order varies) — the
  English half is extracted, and short remarks are shown as the reason.
- Outages list excludes DISMISSED notices and placeholder outages ≥ 50 years.
- Checks done: yearly fleet output sums looked consistent with RTE's
  published annual totals (compared from memory, not against the documents —
  verify before quoting); 2024 is low only because of the RTE data error
  above; outlook figures were recomputed independently from the files (e.g.
  Nov 2025 outlook as of 29 Oct 2025: 54.4 GW available; actual 49.2 GW).

**Prices, generation, flows**
- ENTSO-E: `https://web-api.tp.entsoe.eu/api`, `securityToken`; about a
  year per request, 2–10 s each; HTTP 599 gateway timeouts happen — the
  backfill retries year windows in three-month pieces. Prices A44 (keep
  contract A01 and classification sequence 1: DE-LU sequence 2 is EXAA; ES
  A07 series are intraday auctions); flows A11 (in_Domain = to). Curve A03 =
  forward-fill omitted positions. EICs in `market_store.py`. DE = DE-AT-LU
  before 2018-09-30T22:00Z. 15-minute prices from 2025-09-29T22:00Z.
- RTE `generation_mix_15min_time_scale` (≤ 14 days per call; no EXCHANGE
  series, so net exports come from ENTSO-E flows); hydro subtypes do not add
  up to the hydro total — show the total. Mix periods totalling < 20 GW are
  treated as missing (broken days 14 Apr 2024, 16 Aug 2025).
- **Lesson (2 Nov 2026):** the first storage code stripped trailing zeros
  from whole numbers (49240 → 4924), making yearly nuclear ~9% low. Caught by
  comparing yearly sums with RTE's annual totals (fleet hourly series matches
  them: 2015 415.7 TWh, 2024 361.3 TWh). Always run that check after a
  backfill.

**Hydro**
- Capacity 3,591 GWh (from RTE, confirmed by James). Highest week on record
  3,179 GWh (week of 14 Oct 2024). Weeks matched by ISO week; values labelled
  "week to <Sunday>".

---

## 6. Development history

- **Stage 1** — data pipeline and backfill of demand history from Dec 2012.
- **v1.1** — four demand tabs (Today, Explorer, Forecast accuracy, Outlook).
- **v1.2** — reliable updates (stale-checkout and push-race fixes).
- **v2.0** (29 Oct 2026) — forecast-extended Explorer, ranking, difference
  view, events, palettes, light/dark, thickness, markers, PNG footer, copy
  image, What's new with version history, "Other projects" link, byline,
  preview image and icons, Cloudflare refresh service + Refresh button.
- **v3.0** (29 Oct 2026) — rebrand to France Power Intelligence: sidebar,
  Overview, Nuclear (Today map, Explorer, Outages, Outlook) and Hydro pages;
  nuclear notices backfilled from Dec 2010, output from Dec 2014, reservoirs
  from Dec 2014; update pipeline extended.
- **v3.1** (29 Oct 2026) — James's 16-point review: unavailability default +
  switch, Outlook line convention + 5-year averages + planned/unplanned split,
  reworked nuclear Today (grouped cards, output tiles, modulating, new map
  colours, list sort, Past/Next menus, softer heat map, sortable notices with
  Delays only), hydro fill level in pp + trend sentence, Colourblind-friendly
  rename, Prices "coming soon", knob-centred switches, repo renamed to
  `fr_power_intel`.
- **v4.1** (2 Nov 2026) — per-reactor modulation, multi-fuel generation
  explorer with change table and gap, hydro split, profile tick box, page
  bar (freshness, shared period, pin, Excel), Link buttons, flags, bell
  filters/mute, phone settings fold, market events, 2024 output gap filled.
- **v4.0** (2 Nov 2026) — Prices (8 tabs), Generation, Flows, notification
  bell, Overview "Today's market" + explainers, shared TimeExplorer engine,
  ENTSO-E pipeline; v3.1 tweaks: CET/CEST in the status pill and the Outages
  switch "Since first notice / Only after it began" (default: after it
  began; uses `start_end_utc`, the end in force when the outage started).

---

## 7. Future plans and ideas discussed

1. **Per-reactor output history since Dec 2014** — download started 2 Nov
   2026 at James's go-ahead (`scripts/unit_backfill.py`, workflow
   `backfill-units.yml`; writes `data/nuclear/unit_hourly/YYYY/YYYY-MM.csv`
   wide by reactor EIC + `units.json`, and `data/nuclear/unit_output_daily/`).
   Done 2 Nov (620 calls, 59 reactors, no failed weeks); reactor sums match
   the fleet series within 0.4% a year, and cover RTE's 16 Sep–13 Oct 2024
   fleet gap (37–39 GW then), so they could replace the fleet figure there.
   Used since v4.1 (Nuclear Modulation, reactor by reactor); kept up to date
   by every update run (`store_unit_hourly` in power_store.py).
1b. **Logins for team members** — parked by James (2 Nov). Plan if revived:
   Cloudflare Pages + Cloudflare Access (free to 50 users), site/code
   private, data in a separate public repo (private-repo Actions minutes —
   2,000/month free — would not cover ~6,000–8,000 a month of updates).
1c. **v5: Spain and Germany** — one site with a country switch (agreed
   direction); stages: probe, country-aware groundwork (parallel updates,
   incremental summaries, history off the main repo), Spain, Germany,
   Compare page. Open questions to James: Portugal with Spain, ESIOS token,
   Germany's plant-availability and gas-storage pages.
2. **Interconnector capacity / utilisation (NTC, ENTSO-E)** — proposed in the
   v4 brainstorm, not built in v4.0.
2b. Possible: commercial (scheduled) exchanges A09 alongside physical flows;
   NL as an extra zone.
3. **Other countries** — possible expansion to Spain and Germany "with
   similar tabs". Suggested approach: one site with a country switch; France
   keeps RTE depth; ENTSO-E gives a common core (load and forecasts,
   generation, prices, flows, unit outages, weekly hydro) for others; Spain
   could later add Red Eléctrica's esios API (needs its own key). Spain is
   James's beat, so it has the strongest case.
4. **Temperature / weather adjustment of demand** — long-standing request,
   parked; Météo-France open data preferred over Open-Meteo (non-commercial
   free tier).
5. Smaller ideas raised: per-reactor output history beyond 7 days (≈53 RTE
   calls for a year, daily averages for longer views); showing offline
   reactors in neutral grey on the heat map instead of red (offered, not
   chosen); "weeks back to normal" for hydro (declined for now).

Housekeeping: the old branches `probe` and `v3-site` could not be deleted
from Claude's session; James may delete them in GitHub → Branches.

---

## 8. Working checklist for changes

- Test in a headless browser (Playwright/Chromium) on every affected page, in
  dark and light themes and at phone width; check the console for errors.
- Recompute key numbers independently (Python on the data files) before
  quoting them to James.
- Run `node --check` on edited JS and keep Python standard-library-only
  except numpy (used by `power_summarise.py`; installed in the workflows).
- Pull before committing (data commits land every 15 minutes); push to
  `main`; GitHub Pages deploys in a minute or two.
- Update `js/changelog.js` (bump `VERSION`), README and this file with the
  release. Keep the About drawer glossary (`aboutHtml` in `js/main.js`) in
  step with new terms.
