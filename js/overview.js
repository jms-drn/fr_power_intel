// Overview: one tile per dataset with the latest figure, the key comparison
// and a small trend chart, plus a copyable list of the main points.

import { getDaily, getLatest, getRange, latestSeries } from "./data.js";
import { RESERVOIR_CAPACITY_MWH, isoWeek } from "./hydro.js";
import { getLive, getNuclearDaily, getReserves } from "./power-data.js";
import { BORDERS, fmtEur, getFlowDaily, getFlows, getGenDaily, getMix, getPriceDaily, toHours } from "./market-data.js";
import { parseUtc } from "./data.js";
import {
  QUARTER, addDays, alignDate, copyText, cssVar, dateKey, fmtDayTime, fmtGW, fmtLongDate, fmtNumber, fmtShortDate,
  fmtTime, heroHtml, mean, todayParis
} from "./util.js";

const ICONS = {
  demand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13h3.5l2.5-6 4 11 2.8-7H21"/></svg>',
  nuclear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="1.7"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)"/></svg>',
  hydro: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2c3.3 4.2 6 7.6 6 10.8a6 6 0 0 1-12 0c0-3.2 2.7-6.6 6-10.8Z"/></svg>',
  prices: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 6.5A6.5 6.5 0 1 0 17.5 17.5"/><path d="M4.5 10.5h9M4.5 13.5h9"/></svg>',
  generation: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8Z"/></svg>',
  flows: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h14M14.5 5l3.5 3.5-3.5 3.5M20 15.5H6M9.5 12 6 15.5 9.5 19"/></svg>'
};

const ABOUT = {
  demand: "Live demand, RTE's forecasts and their accuracy, history since 2012.",
  nuclear: "Reactor map, outages and return dates, availability against earlier years, outlooks.",
  hydro: "Weekly energy stored in reservoirs against every year since 2014.",
  prices: "Day-ahead prices for France and its neighbours: spreads, negative prices, capture prices.",
  generation: "Output by fuel every 15 minutes, shares, records.",
  flows: "Physical flows on every border, live map, flows against price gaps."
};

/** Small SVG trend line: series = [{ values: [[x, y]], colour, dashed?, width? }]. */
function sparkline(series, { band } = {}) {
  const all = series.flatMap(s => s.values).concat(band ? band.flatMap(b => [[b[0], b[1]], [b[0], b[2]]]) : []);
  if (!all.length) return "";
  const xs = all.map(p => p[0]);
  const ys = all.map(p => p[1]);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const pad = (y1 - y0) * 0.12 || 1;
  y0 -= pad; y1 += pad;
  const W = 300; const H = 70;
  const sx = x => ((x - x0) / (x1 - x0 || 1)) * W;
  const sy = y => H - ((y - y0) / (y1 - y0)) * H;
  const path = values => values.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join("");
  const bandPath = band?.length ? `${band.map((b, i) => `${i ? "L" : "M"}${sx(b[0]).toFixed(1)},${sy(b[2]).toFixed(1)}`).join("")}${[...band].reverse().map(b => `L${sx(b[0]).toFixed(1)},${sy(b[1]).toFixed(1)}`).join("")}Z` : "";
  return `<svg class="tile-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    ${bandPath ? `<path d="${bandPath}" fill="${cssVar("--s-band")}" stroke="none"/>` : ""}
    ${series.map(s => `<path d="${path(s.values)}" fill="none" stroke="${cssVar(s.colour)}" stroke-width="${s.width || 2}" vector-effect="non-scaling-stroke" ${s.dashed ? 'stroke-dasharray="5 4"' : ""} stroke-linejoin="round" stroke-linecap="round"/>`).join("")}
  </svg>`;
}

const dir = (v, up = "up", down = "down") => (v >= 0 ? up : down);

export class Overview {
  constructor(root) {
    this.root = root;
    this.root.innerHTML = `
      ${heroHtml("France's power system,", "at a glance.", "The latest on French electricity demand, nuclear availability, hydro reservoirs, prices, generation and cross-border flows, each against earlier years, from RTE and ENTSO-E data. Open a tile for the full page with charts, comparisons and downloads.")}
      <section class="brief market-brief">
        <h2>Today's market <button class="btn ghost small" type="button" data-copy-market>Copy</button></h2>
        <p data-market class="muted">Loading…</p>
      </section>
      <div class="tiles" data-tiles>${'<div class="tile skeleton"></div>'.repeat(6)}</div>
      <section class="brief">
        <h2>Main points <button class="btn ghost small" type="button" data-copy>Copy all</button></h2>
        <ul data-points><li class="muted">Loading…</li></ul>
      </section>`;
    this.tiles = this.root.querySelector("[data-tiles]");
    this.market = this.root.querySelector("[data-market]");
    this.root.querySelector("[data-copy-market]").addEventListener("click", () => copyText(this.market.textContent));
    this.points = this.root.querySelector("[data-points]");
    this.root.querySelector("[data-copy]").addEventListener("click", () =>
      copyText([...this.points.querySelectorAll("li")].map(li => `• ${li.textContent}`).join("\n")));
  }

  activate() {
    this.update();
  }

  async update() {
    const keys = ["demand", "nuclear", "hydro", "prices", "generation", "flows"];
    const titles = ["Demand", "Nuclear availability", "Hydro reserves", "Prices", "Generation", "Flows"];
    const hrefs = ["#demand/today", "#nuclear/today", "#hydro", "#prices/short", "#generation/today", "#flows/today"];
    const results = await Promise.allSettled([this.demand(), this.nuclear(), this.hydro(), this.prices(), this.generation(), this.flows()]);
    const tiles = results.map((r, i) => (r.status === "fulfilled" ? r.value : {
      html: this.tile(keys[i], titles[i], hrefs[i], "–", "", [`<span class="muted">Couldn't load (${r.reason?.message || "error"})</span>`], ""),
      points: []
    }));
    this.tiles.innerHTML = tiles.map(t => t.html).join("");
    const points = tiles.flatMap(t => t.points);
    this.points.innerHTML = points.length ? points.map(p => `<li>${p}</li>`).join("") : `<li class="muted">No data available.</li>`;
    const market = [3, 4, 1, 5].map(i => tiles[i]?.market).filter(Boolean);
    this.market.classList.toggle("muted", !market.length);
    this.market.textContent = market.length ? market.join(" ") : "Market data is not available yet.";
  }

  tile(key, title, href, value, small, lines, spark) {
    return `<a class="tile" href="${href}">
      <div class="tile-head"><span class="tile-title">${ICONS[key]}${title}</span><span class="tile-go">Open →</span></div>
      <div class="tile-value">${value}${small ? `<small>${small}</small>` : ""}</div>
      <div class="tile-lines">${lines.map(l => `<span>${l}</span>`).join("")}</div>
      ${spark}
      <div class="tile-about">${ABOUT[key]}</div>
    </a>`;
  }

  async demand() {
    const [latest, daily] = await Promise.all([getLatest(), getDaily()]);
    let realised = [...latestSeries(latest, "REALISED")].sort((a, b) => a[0] - b[0]);
    if (!realised.length) {
      // Just after midnight the live feed has no values for the new day yet.
      realised = [...(await getRange("realised", addDays(todayParis(), -1), todayParis()))].sort((a, b) => a[0] - b[0]);
    }
    const last = realised.at(-1);
    const today = todayParis();
    const monthStart = `${today.slice(0, 7)}-01`;
    const lastFull = addDays(today, -1);
    const days = [];
    for (let d = monthStart; d <= lastFull; d = addDays(d, 1)) days.push(d);
    const mtd = mean(days.map(d => daily.byDate.get(d)?.mean_mw));
    const prev = mean([1, 2, 3].map(k => mean(days.map(d => daily.byDate.get(alignDate(d, k, "cal"))?.mean_mw))));
    const pct = mtd != null && prev ? (mtd / prev - 1) * 100 : null;
    const spark = [];
    const lyLine = [];
    for (let i = 59; i >= 1; i--) {
      const d = addDays(today, -i);
      const v = daily.byDate.get(d)?.mean_mw;
      if (v != null) spark.push([i * -1, v / 1000]);
      const l = daily.byDate.get(alignDate(d, 1, "cal"))?.mean_mw;
      if (l != null) lyLine.push([i * -1, l / 1000]);
    }
    const lines = [];
    if (last) lines.push(`Latest: ${fmtTime(last[0])}–${fmtTime(last[0] + QUARTER)} Paris time`);
    if (pct != null) lines.push(`Month to date ${fmtGW(mtd)}, <b class="${dir(pct)}">${pct >= 0 ? "+" : "−"}${fmtNumber(Math.abs(pct), 1)}%</b> vs the 3-year average`);
    lines.push(`<span class="muted">Last 60 days, daily average · last year dashed</span>`);
    const points = [];
    if (last) points.push(`Demand was ${fmtGW(last[1])} at ${fmtTime(last[0])} Paris time.`);
    if (pct != null) points.push(`Demand so far in ${new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "Europe/Paris" }).format(Date.now())} (to ${fmtShortDate(lastFull)}) averages ${fmtGW(mtd)}, ${fmtNumber(Math.abs(pct), 1)}% ${pct >= 0 ? "above" : "below"} the average of the same dates in the previous three years.`);
    return {
      html: this.tile("demand", "Demand", "#demand/today", last ? fmtGW(last[1]) : "–", "now", lines,
        sparkline([{ values: lyLine, colour: "--s-ly", dashed: true, width: 1.4 }, { values: spark, colour: "--s-actual" }])),
      points
    };
  }

  async nuclear() {
    const [live, daily] = await Promise.all([getLive(), getNuclearDaily()]);
    const f = live.fleet;
    const now = parseUtc(live.generated_utc);
    const offline = live.units.filter(u => u.state === "offline").length;
    const today = todayParis();
    const todayRow = daily.byDate.get(today);
    const lyRow = daily.byDate.get(alignDate(today, 1, "cal"));
    const past = [];
    const ly = [];
    for (let i = 89; i >= 0; i--) {
      const d = addDays(today, -i);
      const v = daily.byDate.get(d)?.available_mw;
      if (v != null) past.push([-i, v / 1000]);
      const l = daily.byDate.get(alignDate(d, 1, "cal"))?.available_mw;
      if (l != null) ly.push([-i, l / 1000]);
    }
    const ahead = live.outlook.mw10.split(" ").slice(0, 60).map((v, i) => [i + 1, Number(v) / 100]);
    for (let i = 1; i <= 60; i++) {
      const l = daily.byDate.get(alignDate(addDays(today, i), 1, "cal"))?.available_mw;
      if (l != null) ly.push([i, l / 1000]);
    }
    const next30 = mean(ahead.slice(0, 30).map(p => p[1] * 1000));
    const ly30 = mean(Array.from({ length: 30 }, (_, i) => daily.byDate.get(alignDate(addDays(today, i + 1), 1, "cal"))?.available_mw));
    const diff = todayRow && lyRow ? todayRow.available_mw - lyRow.available_mw : null;
    const lines = [
      `${fmtNumber(100 * f.available_mw / f.installed_mw, 0)}% of ${fmtGW(f.installed_mw)} · ${offline} reactors offline`,
      diff != null ? `Today <b class="${dir(diff)}">${diff >= 0 ? "+" : "−"}${fmtNumber(Math.abs(diff) / 1000, 1)} GW</b> vs the same day last year` : "",
      `<span class="muted">Past 90 days and next 60 (dashed, from notices) · last year thin</span>`
    ].filter(Boolean);
    const points = [`Nuclear availability is ${fmtGW(f.available_mw)} (${fmtNumber(100 * f.available_mw / f.installed_mw, 0)}% of installed capacity) at ${fmtTime(now)}, with ${offline} reactors offline.`];
    if (diff != null) points.push(`Today's average nuclear availability of ${fmtGW(todayRow.available_mw)} is ${fmtGW(Math.abs(diff))} ${diff >= 0 ? "higher" : "lower"} than on the same day last year.`);
    if (next30 != null && ly30 != null) points.push(`Notices published so far point to ${fmtGW(next30)} available on average over the next 30 days, against ${fmtGW(ly30)} in the same period last year.`);
    const delays = (live.changes || []).filter(c => c.version > 1 && c.prev_end_utc && parseUtc(c.end_utc) - parseUtc(c.prev_end_utc) > 3600000);
    if (delays.length) points.push(`${delays.length} notice${delays.length === 1 ? "" : "s"} pushed back a return date in the past 72 hours (latest: ${delays[0].unit.replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase())}, ${fmtDayTime(parseUtc(delays[0].published_utc))}).`);
    const market = `Nuclear availability is ${fmtGW(f.available_mw)} with ${offline} reactors offline.`;
    return {
      market,
      html: this.tile("nuclear", "Nuclear availability", "#nuclear/today", fmtGW(f.available_mw), "available", lines,
        sparkline([{ values: ly, colour: "--s-ly", width: 1.2 }, { values: past, colour: "--s-actual" }, { values: [past.at(-1), ...ahead].filter(Boolean), colour: "--s-fcst", dashed: true }])),
      points
    };
  }

  async hydro() {
    const rows = await getReserves();
    const r = rows.at(-1);
    const [iy, w] = isoWeek(r.start);
    const same = rows.filter(x => isoWeek(x.start)[1] === w && isoWeek(x.start)[0] < iy && isoWeek(x.start)[0] >= iy - 5).map(x => x.mwh);
    const avg5 = mean(same);
    const ly = rows.find(x => isoWeek(x.start)[0] === iy - 1 && isoWeek(x.start)[1] === w);
    const pct = avg5 ? (r.mwh / avg5 - 1) * 100 : null;
    const year = rows.filter(x => isoWeek(x.start)[0] === iy).map(x => [isoWeek(x.start)[1], x.mwh / 1e6]);
    const band = [];
    for (let k = 1; k <= 53; k++) {
      const vals = rows.filter(x => isoWeek(x.start)[1] === k && isoWeek(x.start)[0] < iy && isoWeek(x.start)[0] >= iy - 5).map(x => x.mwh / 1e6);
      if (vals.length >= 2) band.push([k, Math.min(...vals), Math.max(...vals)]);
    }
    const lines = [
      `${fmtNumber(100 * r.mwh / RESERVOIR_CAPACITY_MWH, 1)}% full · week ${w}, to ${fmtShortDate(addDays(r.end, -1))}`,
      pct != null ? `<b class="${dir(pct)}">${pct >= 0 ? "+" : "−"}${fmtNumber(Math.abs(pct), 1)}%</b> vs the 5-year average for this week` : "",
      `<span class="muted">${iy} by week, against the range of the previous 5 years</span>`
    ].filter(Boolean);
    const points = [`Hydro reservoirs held ${fmtNumber(r.mwh / 1e6, 2)} TWh (${fmtNumber(100 * r.mwh / RESERVOIR_CAPACITY_MWH, 1)}% full) in the week to ${fmtLongDate(addDays(r.end, -1))}${pct != null ? `, ${fmtNumber(Math.abs(pct), 1)}% ${pct >= 0 ? "above" : "below"} the five-year average for the week` : ""}${ly ? ` and ${fmtNumber(Math.abs((r.mwh / ly.mwh - 1) * 100), 1)}% ${r.mwh >= ly.mwh ? "above" : "below"} last year` : ""}.`];
    return {
      html: this.tile("hydro", "Hydro reserves", "#hydro", `${fmtNumber(r.mwh / 1e6, 2)} TWh`, "stored", lines,
        sparkline([{ values: year, colour: "--s-actual" }], { band })),
      points
    };
  }

  async prices() {
    const daily = await getPriceDaily();
    const today = todayParis();
    const tomorrow = addDays(today, 1);
    const t = daily.byDate.get(today);
    const n = daily.byDate.get(tomorrow);
    if (!t?.FR_base && !n?.FR_base) throw new Error("no prices yet");
    const main = n?.FR_base != null ? n : t;
    const label = main === n ? "tomorrow" : "today";
    const prev30 = mean(daily.rows.filter(r => r.date < today && r.date >= addDays(today, -30)).map(r => r.FR_base));
    const spark = [];
    const ly = [];
    for (let i = 59; i >= 0; i--) {
      const d = addDays(today, -i);
      const v = daily.byDate.get(d)?.FR_base;
      if (v != null) spark.push([-i, v]);
      const l = daily.byDate.get(addDays(d, -364))?.FR_base;
      if (l != null) ly.push([-i, l]);
    }
    const de = main.DE_base;
    const lines = [
      main === n && t?.FR_base != null ? `Today ${fmtEur(t.FR_base)}` : "",
      prev30 != null ? `<b class="${dir(main.FR_base - prev30)}">${main.FR_base >= prev30 ? "+" : "−"}€${fmtNumber(Math.abs(main.FR_base - prev30), 2)}</b> vs the previous 30-day average` : "",
      `<span class="muted">Last 60 days, daily baseload · last year dashed</span>`
    ].filter(Boolean);
    const neg = main.FR_neg > 0 ? ` with ${fmtNumber(main.FR_neg, main.FR_neg % 1 ? 2 : 0)} hours below zero` : "";
    const points = [`The French day-ahead baseload price for ${label} is ${fmtEur(main.FR_base)}${prev30 != null ? `, €${fmtNumber(Math.abs(main.FR_base - prev30), 2)} ${main.FR_base >= prev30 ? "above" : "below"} the average of the previous 30 days` : ""}${neg}.`];
    if (de != null) points.push(`Germany's baseload for ${label} is ${fmtEur(de)}, so France is ${main.FR_base <= de ? "cheaper" : "dearer"} by €${fmtNumber(Math.abs(main.FR_base - de), 2)}/MWh.`);
    return {
      market: `French day-ahead baseload is ${fmtEur(main.FR_base)} for ${label}${de != null ? ` (Germany ${fmtEur(de)})` : ""}${neg}.`,
      html: this.tile("prices", "Prices", "#prices/short", fmtEur(main.FR_base).replace("/MWh", ""), `€/MWh baseload ${label}`, lines,
        sparkline([{ values: ly, colour: "--s-ly", dashed: true, width: 1.4 }, { values: spark, colour: "--s-actual" }])),
      points
    };
  }

  async generation() {
    const today = todayParis();
    const [mix, daily] = await Promise.all([getMix(today, today), getGenDaily()]);
    const rows = mix.filter(r => r.nuclear != null);
    if (!rows.length) throw new Error("no generation data yet today");
    const fuels = ["nuclear", "hydro", "wind", "solar", "gas", "coal", "oil", "bio"];
    const sum = fs => rows.reduce((a, r) => a + fs.reduce((x, f) => x + Math.max(0, r[f] || 0), 0), 0);
    const tot = sum(fuels);
    const low = 100 * sum(["nuclear", "hydro", "wind", "solar", "bio"]) / tot;
    const vre = sum(["wind", "solar"]) / rows.length;
    const spark = [];
    const ly = [];
    for (let i = 60; i >= 1; i--) {
      const d = addDays(today, -i);
      const r = daily.byDate.get(d);
      if (r?.wind != null && r?.solar != null) spark.push([-i, (r.wind + r.solar) / 1000]);
      const l = daily.byDate.get(addDays(d, -364));
      if (l?.wind != null && l?.solar != null) ly.push([-i, (l.wind + l.solar) / 1000]);
    }
    const lines = [
      `Wind and solar ${fmtGW(vre)} on average today so far`,
      `Nuclear ${fmtGW(sum(["nuclear"]) / rows.length)} · gas ${fmtGW(sum(["gas"]) / rows.length)}`,
      `<span class="muted">Wind plus solar, daily average, last 60 days · last year dashed</span>`
    ];
    const upTo = fmtTime(rows.at(-1).t + QUARTER);
    return {
      market: `Low-carbon sources have supplied ${fmtNumber(low, 1)}% of French generation today, with wind and solar averaging ${fmtGW(vre)}.`,
      html: this.tile("generation", "Generation", "#generation/today", `${fmtNumber(low, 1)}%`, "low-carbon today", lines,
        sparkline([{ values: ly, colour: "--s-ly", dashed: true, width: 1.4 }, { values: spark, colour: "--s-actual" }])),
      points: [`Low-carbon sources supplied ${fmtNumber(low, 1)}% of French generation today to ${upTo}; wind and solar averaged ${fmtGW(vre)}.`]
    };
  }

  async flows() {
    const today = todayParis();
    const borders = Object.keys(BORDERS);
    const [daily, ...pts] = await Promise.all([getFlowDaily(), ...borders.map(b => getFlows(b, addDays(today, -1), today))]);
    const hourly = pts.map(p => ({ e: new Map(toHours(p, "export_mw").map(x => [x.t, x.v])), i: new Map(toHours(p, "import_mw").map(x => [x.t, x.v])) }));
    const common = [...hourly[0].e.keys()].filter(t => hourly.every(h => h.e.has(t))).sort((a, b) => a - b);
    if (!common.length) throw new Error("no recent flow data");
    const t = common.at(-1);
    const net = hourly.reduce((a, h) => a + h.e.get(t) - (h.i.get(t) ?? 0), 0);
    const spark = [];
    const ly = [];
    for (let i = 60; i >= 1; i--) {
      const d = addDays(today, -i);
      const v = daily.byDate.get(d)?.net;
      if (v != null) spark.push([-i, v / 1000]);
      const l = daily.byDate.get(addDays(d, -364))?.net;
      if (l != null) ly.push([-i, l / 1000]);
    }
    const lines = [`${fmtTime(t)}–${fmtTime(t + 3600000)} Paris time, all ${borders.length} borders`, `<span class="muted">Net exports, daily average, last 60 days · last year dashed</span>`];
    return {
      market: `France is ${net >= 0 ? "exporting" : "importing"} a net ${fmtGW(Math.abs(net))} across its borders.`,
      html: this.tile("flows", "Flows", "#flows/today", fmtGW(Math.abs(net)), net >= 0 ? "net exports" : "net imports", lines,
        sparkline([{ values: ly, colour: "--s-ly", dashed: true, width: 1.4 }, { values: spark, colour: "--s-actual" }])),
      points: [`France was ${net >= 0 ? "exporting" : "importing"} a net ${fmtGW(Math.abs(net))} in the hour from ${fmtTime(t)} Paris time (physical flows, latest from ENTSO-E).`]
    };
  }

  refreshTheme() {
    this.update();
  }
}

