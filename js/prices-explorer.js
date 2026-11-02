// Prices Explorer, Capture prices and Residual demand tabs: each is the shared
// time explorer with its own data description, plus a few extra panels.

import { ChartPanel } from "./chart.js";
import {
  ENTSOE, PRICE_FIRST, QH_SWITCH, ZONES, fmtByUnit, fmtEur, fmtMw, getCaptureDaily, getMarketDaily,
  getMarketHourly, getMix, getPriceDaily, getPrices, isPeak
} from "./market-data.js";
import { TimeExplorer, meanOf } from "./time-explorer.js";
import { addDays, dateKey, daysBetween, fmtNumber, fmtPeriod, toWall } from "./util.js";

const zoneSubjects = Object.entries(ZONES).map(([value, z]) => ({ value, label: z.name }));

const priceMeasure = (key, label, short, extra = {}) => ({
  label, short, unit: "€/MWh", decimals: 2, agg: "mean", zeroLine: true,
  daily: (row, z) => row[`${z}_${key}`], ...extra
});

const PRICE_MEASURES = {
  base: priceMeasure("base", "Baseload price", "baseload price"),
  peak: priceMeasure("peak", "Peak price (Mon–Fri 08:00–20:00)", "peak price", { peak: "peak" }),
  off: priceMeasure("off", "Off-peak price", "off-peak price", { peak: "off" }),
  min: priceMeasure("min", "Lowest price in each day", "lowest price", { agg: "min", intraday: false }),
  max: priceMeasure("max", "Highest price in each day", "highest price", { agg: "max", intraday: false }),
  range: { label: "Daily price range (high minus low)", short: "daily price range", unit: "€/MWh", decimals: 2, agg: "mean", intraday: false, daily: (r, z) => (r[`${z}_max`] != null && r[`${z}_min`] != null ? r[`${z}_max`] - r[`${z}_min`] : null) },
  std: { label: "Volatility (standard deviation within the day)", short: "intraday volatility", unit: "€/MWh", decimals: 2, agg: "mean", intraday: false, daily: (r, z) => r[`${z}_std`] },
  neg: { label: "Hours with negative prices", short: "negative-price hours", unit: "h", decimals: 2, agg: "sum", intraday: false, daily: (r, z) => r[`${z}_neg`] },
  negd: { label: "Negative-price depth (€/MWh·h)", short: "negative-price depth", unit: "€/MWh·h", decimals: 0, agg: "sum", intraday: false, daily: (r, z) => r[`${z}_negd`] }
};

export function priceExplorer(root) {
  return new TimeExplorer(root, {
    key: "prices/explorer",
    hero: ["Explore day-ahead prices,", "since 2015.", "Day-ahead prices for France and its neighbours at any resolution from 15 minutes to a year, against last year, the average and range of earlier years, a chosen year or another country. Switch to a daily profile or a duration curve, or show the difference."],
    firstDate: PRICE_FIRST, source: ENTSO, fine: "15m",
    subjects: zoneSubjects, subjectLabel: "Bidding zone", compareSubjects: true, compareLabel: "Another zone…",
    measures: PRICE_MEASURES,
    defaults: { measure: "base", subject: "FR", preset: "last30", res: "1d" },
    loadDaily: getPriceDaily,
    loadRaw: async (z, from, to) => (await getPrices(z, from, to)).map(p => ({ t: p.t, v: p.eur, min: p.min })),
    isPeak, hasQuarters: t => t >= QH_SWITCH, step: true,
    quarterNote: "Day-ahead prices were hourly until 30 Sep 2025; earlier hourly prices are repeated across their four quarter-hours.",
    fmt: (v, m) => fmtByUnit(v, m),
    sentenceSubject: (m, subj) => `${subj === "France" ? "French" : `${subj}'s`} day-ahead ${m.short}`,
    notes: (s, from, to) => [
      s.subject === "DE" || s.cmp === "DE" ? "Germany: the DE-LU bidding zone since 1 Oct 2018; DE-AT-LU before." : "",
      s.subject === "CH" || s.cmp === "CH" ? "Switzerland is not part of EU market coupling and its day-ahead auction stays hourly." : "",
      from < "2025-10-01" && to >= "2025-09-30" && ["15m"].includes(s.res) ? "The European day-ahead market moved to 15-minute products on 30 Sep 2025." : "",
      "Peak is Monday–Friday 08:00–20:00 Paris time (the market standard); off-peak is every other period. Daily averages weight each period by its length."
    ].filter(Boolean)
  });
}
const ENTSO = ENTSOE;

// ---------- Capture prices ----------

const TECHS = [
  { value: "solar", label: "Solar" }, { value: "wind", label: "Wind" }, { value: "nuclear", label: "Nuclear" },
  { value: "hydro", label: "Hydro" }, { value: "gas", label: "Gas" }
];

export class CapturePrices {
  constructor(root) {
    this.root = root;
    this.writesHash = true;
    const top = document.createElement("div");
    const extra = document.createElement("div");
    root.append(top, extra);
    this.explorer = new TimeExplorer(top, {
      key: "prices/capture",
      hero: ["What each technology", "earned.", "Capture price: the French day-ahead price weighted by each technology's output, so it shows the average price a megawatt-hour of solar, wind or nuclear actually sold at. The capture rate divides it by the baseload price. Generation data from RTE (hourly in 2015–16, 15-minute from 2017)."],
      firstDate: "2015-01-05", source: `${ENTSOE} (prices) and RTE (generation)`,
      subjects: TECHS, subjectLabel: "Technology", compareSubjects: true, compareLabel: "Another technology…",
      resolutions: ["1d", "1w", "1M", "1y"],
      measures: {
        eur: { label: "Capture price", short: "capture price", unit: "€/MWh", decimals: 2, agg: "wmean", intraday: false, zeroLine: true, daily: (r, t) => r[`${t}_eur`], weight: (r, t) => r[`${t}_mwh`] },
        rate: { label: "Capture rate (% of baseload)", short: "capture rate", unit: "%", decimals: 1, agg: "mean", intraday: false, daily: (r, t) => (r[`${t}_eur`] != null && r.base > 5 ? 100 * r[`${t}_eur`] / r.base : null) },
        disc: { label: "Discount to baseload", short: "discount to baseload", unit: "€/MWh", decimals: 2, agg: "mean", intraday: false, zeroLine: true, daily: (r, t) => (r[`${t}_eur`] != null ? r.base - r[`${t}_eur`] : null) }
      },
      defaults: { measure: "eur", subject: "solar", preset: "ytd", res: "1M" },
      loadDaily: getCaptureDaily,
      loadRaw: async () => [],
      fmt: (v, m) => fmtByUnit(v, m),
      sentenceSubject: (m, subj) => `the ${subj.toLowerCase()} ${m.short}`,
      notes: s => [
        s.measure === "eur" ? "Weekly, monthly and yearly capture prices are weighted by each day's output, as a generator would see them." : "",
        s.measure === "rate" ? "Rates are averaged day by day; days with a baseload below €5/MWh are left out because the ratio becomes meaningless." : "",
        "The time-of-day chart below shows when each technology produced and what the price was then."
      ].filter(Boolean)
    });
    this.hourPanel = new ChartPanel(extra, { title: "When it earns: price and output by hour of day", size: "short", source: `${ENTSOE} and RTE` });
  }

  setParams(p) { this.explorer.setParams(p); }

  async activate() {
    await this.explorer.update();
    await this.renderHours();
  }

  async renderHours() {
    const s = this.explorer.state;
    let from = s.from < "2017-01-01" ? "2017-01-01" : s.from;
    let to = s.to;
    if (daysBetween(from, to) > 365) from = addDays(to, -364);
    const rows = await getMarketHourly(from, to);
    const tech = s.subject;
    const acc = Array.from({ length: 24 }, () => ({ pg: 0, g: 0, p: 0, n: 0 }));
    for (const r of rows) {
      if (r.price == null) continue;
      const h = new Date(toWall(r.t)).getUTCHours();
      const a = acc[h];
      a.p += r.price; a.n += 1;
      const g = r[tech];
      if (g != null && g > 0) { a.pg += r.price * g; a.g += g; }
    }
    const days = new Set(rows.map(r => dateKey(r.t))).size || 1;
    const label = TECHS.find(t => t.value === tech)?.label || tech;
    this.hourPanel.setTitle(`When ${label.toLowerCase()} earns: price and output by hour of day`, `${fmtPeriod(from, to)} · Paris time`);
    this.hourPanel.render({
      xType: "category", categories: acc.map((_, h) => `${String(h).padStart(2, "0")}:00`), xLabel: x => x, xHeader: "Hour (Paris)",
      yName: "€/MWh", yAxis2: { name: "GW", format: v => fmtNumber(v, 0) }, source: `${ENTSOE} and RTE`,
      series: [
        { name: `Average ${label.toLowerCase()} output`, colour: `--f-${tech}`, type: "bar", data: acc.map((a, h) => [h, a.g / Math.max(1, a.n) / 1000]), yAxis: 1, unit: "GW", decimals: 2, avg: false, barWidth: 14 },
        { name: "Average price", colour: "--s-avg", type: "line", data: acc.map((a, h) => [h, a.n ? a.p / a.n : null]), unit: "€/MWh", decimals: 2, dashed: true },
        { name: `Price when ${label.toLowerCase()} produced (output-weighted)`, colour: "--s-actual", type: "line", data: acc.map((a, h) => [h, a.g ? a.pg / a.g : null]), unit: "€/MWh", decimals: 2, width: 2.4 }
      ],
      notes: [`Hourly data for ${days} days. Bars: average output in each hour; lines: the average day-ahead price and the output-weighted price in that hour.`]
    });
  }

  refreshTheme() { this.explorer.refreshTheme(); this.hourPanel.refreshTheme(); }
}

// ---------- Residual demand ----------

const RESIDUAL_SUBJECTS = [
  { value: "residual", label: "Residual demand" }, { value: "demand", label: "Demand" }, { value: "vre", label: "Wind and solar output" }
];

export class ResidualDemand {
  constructor(root) {
    this.root = root;
    this.writesHash = true;
    const top = document.createElement("div");
    const extra = document.createElement("div");
    root.append(top, extra);
    this.explorer = new TimeExplorer(top, {
      key: "prices/residual",
      hero: ["Demand left for", "the rest of the fleet.", "Residual demand is French demand minus wind and solar output: what nuclear, hydro, gas and imports have to cover. It drives prices more closely than demand itself. Hourly, from RTE data."],
      firstDate: "2015-01-01", source: "RTE (demand and generation) and ENTSO-E (prices)", fine: "1h",
      subjects: RESIDUAL_SUBJECTS, subjectLabel: "Series", compareSubjects: true, compareLabel: "Another series…",
      resolutions: ["1h", "1d", "1w", "1M", "1y"],
      measures: {
        mean: { label: "Average", short: "average", unit: "GW", scale: 1000, decimals: 2, agg: "mean", daily: (r, k) => (k === "vre" ? (r.demand != null && r.residual != null ? r.demand - r.residual : null) : r[k]) },
        min: { label: "Daily minimum", short: "daily minimum", unit: "GW", scale: 1000, decimals: 2, agg: "min", intraday: false, daily: (r, k) => (k === "residual" ? r.residual_min : null) },
        max: { label: "Daily maximum", short: "daily maximum", unit: "GW", scale: 1000, decimals: 2, agg: "max", intraday: false, daily: (r, k) => (k === "residual" ? r.residual_max : null) }
      },
      defaults: { measure: "mean", subject: "residual", preset: "last30", res: "1d" },
      loadDaily: getMarketDaily,
      loadRaw: async (k, from, to) => (await getMarketHourly(from, to)).map(r => ({ t: r.t, min: 60, v: k === "vre" ? (r.wind != null && r.solar != null ? r.wind + r.solar : null) : r[k] })),
      fmt: (v, m) => fmtByUnit(v, m),
      sentenceSubject: (m, subj) => subj.toLowerCase(),
      notes: s => [s.measure !== "mean" && s.subject !== "residual" ? "Daily minimum and maximum are only kept for residual demand." : "", "Demand is RTE's realised consumption; wind and solar are RTE's actual generation."].filter(Boolean)
    });
    this.bandPanel = new ChartPanel(extra, { title: "Price by level of residual demand", size: "short", source: "RTE and ENTSO-E" });
  }

  setParams(p) { this.explorer.setParams(p); }

  async activate() {
    await this.explorer.update();
    await this.renderBands();
  }

  async renderBands() {
    const s = this.explorer.state;
    let from = s.from;
    const to = s.to;
    if (daysBetween(from, to) > 730) from = addDays(to, -729);
    const rows = (await getMarketHourly(from, to)).filter(r => r.price != null && r.residual != null);
    const bands = [];
    for (let lo = 0; lo < 90000; lo += 5000) bands.push({ lo, hi: lo + 5000, p: [], label: `${lo / 1000}–${(lo + 5000) / 1000}` });
    const neg = { lo: -Infinity, hi: 0, p: [], label: "<0" };
    for (const r of rows) {
      const b = r.residual < 0 ? neg : bands[Math.min(bands.length - 1, Math.floor(r.residual / 5000))];
      b.p.push(r.price);
    }
    const used = [neg, ...bands].filter(b => b.p.length >= 3);
    this.bandPanel.setTitle("Average French price by level of residual demand", `${fmtPeriod(from, to)} · hourly · GW bands`);
    this.bandPanel.render({
      xType: "category", categories: used.map(b => b.label), xLabel: x => `${x} GW`, xHeader: "Residual demand (GW)", yName: "€/MWh", source: "RTE and ENTSO-E",
      series: [
        { name: "Average price", colour: "--s-actual", type: "bar", data: used.map((b, i) => [i, meanOf(b.p)]), unit: "€/MWh", decimals: 2, avg: false, barWidth: 22, colourFn: v => (v < 0 ? "--neg" : "--s-actual") },
        { name: "Hours", colour: "--s-avg", type: "line", data: used.map((b, i) => [i, b.p.length]), yAxis: 1, decimals: 0, avg: false, dashed: true }
      ],
      yAxis2: { name: "hours", format: v => fmtNumber(v, 0) },
      notes: [`${fmtNumber(rows.length, 0)} hours with both a price and residual demand. Bands of 5 GW; bands with fewer than 3 hours are left out.`]
    });
  }

  refreshTheme() { this.explorer.refreshTheme(); this.bandPanel.refreshTheme(); }
}

export { fmtEur, fmtMw, getMix };
