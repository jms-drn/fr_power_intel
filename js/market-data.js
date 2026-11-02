// Loading price, flow and generation data (built by scripts/market_summarise.py
// from ENTSO-E and RTE). Monthly files more than six weeks old never change,
// so they are kept across data updates instead of being downloaded again.

import { cached, fetchText, parseUtc } from "./data.js";
import { DAY, HOUR, QUARTER, addDays, monthKey, parisMidnight, toWall, todayParis } from "./util.js";

export const ZONES = {
  FR: { name: "France", short: "FR", colour: "--z-fr" },
  DE: { name: "Germany", short: "DE", colour: "--z-de", note: "DE-LU bidding zone (DE-AT-LU before 1 Oct 2018)" },
  BE: { name: "Belgium", short: "BE", colour: "--z-be" },
  CH: { name: "Switzerland", short: "CH", colour: "--z-ch", note: "Switzerland is not coupled with the EU day-ahead market and stays hourly" },
  IT_NORD: { name: "Italy North", short: "IT-N", colour: "--z-it" },
  ES: { name: "Spain", short: "ES", colour: "--z-es" }
};
export const NEIGHBOURS = ["DE", "BE", "CH", "IT_NORD", "ES"];
export const BORDERS = {
  BE: { name: "Belgium", short: "BE" },
  DE: { name: "Germany", short: "DE" },
  CH: { name: "Switzerland", short: "CH" },
  IT_NORD: { name: "Italy", short: "IT" },
  ES: { name: "Spain", short: "ES" },
  GB: { name: "Great Britain", short: "GB" }
};
export const FUELS = {
  nuclear: { name: "Nuclear", colour: "--f-nuclear" },
  hydro: { name: "Hydro", colour: "--f-hydro" },
  wind: { name: "Wind", colour: "--f-wind" },
  solar: { name: "Solar", colour: "--f-solar" },
  gas: { name: "Gas", colour: "--f-gas" },
  bio: { name: "Bioenergy", colour: "--f-bio" },
  coal: { name: "Coal", colour: "--f-coal" },
  oil: { name: "Oil", colour: "--f-oil" }
};
export const FUEL_ORDER = ["nuclear", "hydro", "bio", "wind", "solar", "gas", "coal", "oil"];
export const PRICE_FIRST = "2015-01-05";
export const MIX_FIRST = "2015-01-01";
export const QH_SWITCH = Date.parse("2025-09-29T22:00:00Z"); // 15-minute day-ahead prices from delivery 30 Sep 2025

const num = text => (text === "" || text == null ? null : Number(text));
const stable = new Map(); // old monthly files, kept across data updates

function csvRows(text) {
  const lines = text.trim().split("\n");
  if (!lines[0]) return { header: [], rows: [] };
  return { header: lines[0].split(","), rows: lines.slice(1).map(l => l.split(",")) };
}

async function monthText(path, ym) {
  const old = ym < monthKey(Date.now() - 42 * DAY);
  if (!old) return fetchText(path, { optional: true });
  if (!stable.has(path)) {
    const p = fetch(`${path}?v=m`).then(r => (r.ok ? r.text() : ""));
    stable.set(path, p);
    p.catch(() => stable.delete(path));
  }
  return stable.get(path);
}

function monthsOf(from, to) {
  const out = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export function getMarketIndex() {
  return cached("market-index", async () => JSON.parse((await fetchText("data/market/index.json", { optional: true })) || "{}"));
}

/** Raw points between two Paris dates (inclusive): [{t, min, ...cols}] sorted by t. */
async function monthly(base, from, to, cols, pick) {
  const lo = parisMidnight(from);
  const hi = parisMidnight(addDays(to, 1));
  const index = await getMarketIndex().catch(() => ({}));
  const known = pick ? pick(index) : null;
  const months = monthsOf(from, to).filter(ym => !known || known.includes(ym) || ym >= monthKey(Date.now() - 3 * DAY));
  const texts = await Promise.all(months.map(ym => monthText(`${base}/${ym.slice(0, 4)}/${ym}.csv`, ym)));
  const out = [];
  for (const text of texts) {
    if (!text) continue;
    const { header, rows } = csvRows(text);
    const idx = Object.fromEntries(header.map((h, i) => [h, i]));
    for (const r of rows) {
      const t = parseUtc(r[0]);
      if (t < lo || t >= hi) continue;
      const rec = { t, min: idx.min != null ? Number(r[idx.min]) || 60 : 60 };
      for (const c of cols) rec[c] = idx[c] != null ? num(r[idx[c]]) : null;
      out.push(rec);
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

export const getPrices = (zone, from, to) => cached(`prices-${zone}-${from}-${to}`, () => monthly(`data/prices/${zone}`, from, to, ["eur"], i => i.price_months?.[zone]));
export const getFlows = (border, from, to) => cached(`flows-${border}-${from}-${to}`, () => monthly(`data/flows/${border}`, from, to, ["export_mw", "import_mw"], i => i.flow_months?.[border]));
export const MIX_COLS = ["nuclear", "hydro", "hydro_ror", "hydro_res", "hydro_pump", "wind", "wind_on", "wind_off", "solar", "gas", "coal", "oil", "bio", "pumping"];
export const getMix = (from, to) => cached(`mix-${from}-${to}`, () => monthly("data/generation/mix", from, to, MIX_COLS, i => i.mix_months));
export const HOURLY_COLS = ["price", "demand", "residual", "nuclear", "nuc_avail", "nuc_unused", "wind", "solar", "gas", "hydro", "coal", "oil", "bio", "net_exports"];
export const getMarketHourly = (from, to) => cached(`mh-${from}-${to}`, () => monthly("data/market/hourly", from, to, HOURLY_COLS, i => i.hourly_months));

function dailyTable(key, path) {
  return cached(key, async () => {
    const text = await fetchText(path, { optional: true });
    const { header, rows } = csvRows(text || "date");
    const out = rows.map(r => {
      const o = { date: r[0] };
      for (let i = 1; i < header.length; i++) o[header[i]] = num(r[i]);
      return o;
    });
    return { header, rows: out, byDate: new Map(out.map(r => [r.date, r])) };
  });
}
export const getPriceDaily = () => dailyTable("price-daily", "data/prices/daily.csv");
export const getGenDaily = () => dailyTable("gen-daily", "data/generation/daily.csv");
export const getFlowDaily = () => dailyTable("flow-daily", "data/flows/daily.csv");
export const getCaptureDaily = () => dailyTable("capture-daily", "data/market/capture.csv");
export const getMarketDaily = () => dailyTable("market-daily", "data/market/daily.csv");
export const getRecords = () => cached("records", async () => JSON.parse((await fetchText("data/records.json", { optional: true })) || "{\"records\":[]}"));
export const getAlerts = () => cached("alerts", async () => JSON.parse((await fetchText("data/alerts.json", { optional: true })) || "{\"alerts\":[]}"));

/** Expand points to a 15-minute grid: Map(t -> value). */
export function toQuarters(points, col = "eur") {
  const out = new Map();
  for (const p of points) {
    const v = p[col];
    if (v == null) continue;
    for (let k = 0; k < Math.max(1, p.min / 15); k++) out.set(p.t + k * QUARTER, v);
  }
  return out;
}

/** Hourly averages from points at any resolution: [{t, v}] (needs a full hour). */
export function toHours(points, col = "eur") {
  const acc = new Map();
  for (const p of points) {
    const v = p[col];
    if (v == null) continue;
    const h = Math.floor(p.t / HOUR) * HOUR;
    const a = acc.get(h) || [0, 0];
    a[0] += v * p.min;
    a[1] += p.min;
    acc.set(h, a);
  }
  return [...acc].filter(([, a]) => a[1] >= 59).map(([t, a]) => ({ t, v: a[0] / a[1] })).sort((a, b) => a.t - b.t);
}

/** Peak period (market standard): Monday-Friday 08:00-20:00 Paris time. */
export function isPeak(t) {
  const local = new Date(toWall(t));
  const wd = (local.getUTCDay() + 6) % 7;
  const h = local.getUTCHours();
  return wd < 5 && h >= 8 && h < 20;
}

export function zoneName(z) { return ZONES[z]?.name || z; }

export { todayParis };

// ---------- Formatting ----------

import { fmtNumber } from "./util.js";

export function fmtEur(v, decimals = 2) {
  if (v == null || !Number.isFinite(v)) return "–";
  return `${v < 0 ? "−" : ""}€${fmtNumber(Math.abs(v), decimals)}/MWh`;
}

/** Signed difference in EUR/MWh: "+€3.20" / "−€1.05". */
export function fmtEurDelta(v, decimals = 2) {
  if (v == null || !Number.isFinite(v)) return "–";
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}€${fmtNumber(Math.abs(v), decimals)}`;
}

export function fmtHours(h) {
  if (h == null || !Number.isFinite(h)) return "–";
  return `${fmtNumber(h, h % 1 === 0 ? 0 : h < 10 ? 2 : 1)} h`;
}

export function fmtMw(mw, decimals = 1) {
  return mw == null || !Number.isFinite(mw) ? "–" : `${fmtNumber(mw / 1000, decimals)} GW`;
}

/** Shared value formatter for explorers: by unit. */
export function fmtByUnit(v, m) {
  if (v == null || !Number.isFinite(v)) return "–";
  switch (m.unit) {
    case "€/MWh": return fmtEur(v);
    case "GW": return `${fmtNumber(v / (m.scale || 1), 2)} GW`;
    case "GWh": return Math.abs(v) >= 1000 ? `${fmtNumber(v / 1000, 2)} TWh` : `${fmtNumber(v, 0)} GWh`;
    case "TWh": return `${fmtNumber(v, 2)} TWh`;
    case "%": return `${fmtNumber(v, 1)}%`;
    case "pp": return `${fmtNumber(v, 1)} pp`;
    case "h": return fmtHours(v);
    case "€/MWh·h": return `${fmtNumber(v, 0)} €/MWh·h`;
    default: return `${fmtNumber(v, m.decimals ?? 1)}${m.unit ? ` ${m.unit}` : ""}`;
  }
}

export const ENTSOE = "ENTSO-E Transparency Platform";
