// Prices > Spreads, Mix & Price, Negative Prices and Nuclear Modulation.

import { ChartPanel } from "./chart.js";
import { setSwitch, switchHtml } from "./nuclear-common.js";
import {
  ENTSOE, FUELS, FUEL_ORDER, NEIGHBOURS, PRICE_FIRST, ZONES, fmtEur, fmtEurDelta, fmtHours, fmtMw, getMarketHourly, getMix,
  getPriceDaily, getPrices, toQuarters
} from "./market-data.js";
import { bindPeriod, card, periodHtml, readParams } from "./market-common.js";
import { meanOf } from "./time-explorer.js";
import {
  DAY, HOUR, addDays, copyText, cssVar, dateKey, dateRange, daysBetween, fmtDate, fmtDateTime, fmtFromTo, fmtLongDate, fmtMonth,
  fmtNumber, fmtPeriod, heroHtml, parisMidnight, toWall, todayParis, weekStart, writeHash
} from "./util.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const amt = v => `€${fmtNumber(Math.abs(v), 2)}`;
const headlineHtml = `<div class="headline"><p data-headline>Loading…</p><button class="btn ghost small" type="button" data-copy title="Copy this sentence">Copy</button></div>`;

class Base {
  constructor(root, key, defaults) {
    this.root = root;
    this.key = key;
    this.writesHash = true;
    this.state = { preset: "last90", from: "", to: "", ...defaults };
    this.renderId = 0;
  }

  wire() {
    this.headline = this.root.querySelector("[data-headline]");
    this.root.querySelector("[data-copy]")?.addEventListener("click", () => copyText(this.headline.textContent));
    this.period = bindPeriod(this.root, this.state, () => this.update());
    this.root.querySelectorAll("[data-k]").forEach(input => input.addEventListener("change", () => {
      this.state[input.dataset.k] = input.value;
      this.update();
    }));
  }

  sync() {
    this.period.sync();
    this.root.querySelectorAll("[data-k]").forEach(i => { i.value = this.state[i.dataset.k]; });
  }

  setParams(p) {
    readParams(this.state, p);
    if (this.state.preset !== "custom") this.period.apply();
    this.sync();
  }

  activate() { this.update(); }

  async update() {
    const id = ++this.renderId;
    writeHash(this.key, this.state);
    this.sync();
    try {
      await this.render(id);
    } catch (error) {
      console.error(error);
      if (id === this.renderId) this.headline.textContent = `The data could not be loaded (${error.message}).`;
    }
  }

  refreshTheme() { for (const p of this.panels || []) p.refreshTheme(); }
}

// ---------- Spreads ----------

export class PriceSpreads extends Base {
  constructor(root) {
    super(root, "prices/spreads", { preset: "last90", res: "1d", measure: "base" });
    root.innerHTML = `
      ${heroHtml("France against", "its neighbours.", "The gap between the French day-ahead price and each neighbour (France minus neighbour, so a positive spread means France was dearer), and how often prices were identical, which happens when interconnectors are not congested and markets clear together.")}
      <div class="toolbar"><div class="toolbar-row">${periodHtml(PRICE_FIRST)}
        <label class="field"><span>Resolution</span><select data-k="res"><option value="1d">Daily</option><option value="1w">Weekly</option><option value="1M">Monthly</option></select></label>
        <label class="field"><span>Price</span><select data-k="measure"><option value="base">Baseload</option><option value="peak">Peak</option><option value="off">Off-peak</option></select></label>
      </div></div>
      ${headlineHtml}
      <div class="cards" data-cards></div>
      <div data-a></div><div data-b></div>`;
    this.wire();
    this.spreadPanel = new ChartPanel(root.querySelector("[data-a]"), { title: "Spread", size: "tall", overview: true, source: ENTSOE });
    this.parityPanel = new ChartPanel(root.querySelector("[data-b]"), { title: "Price parity", size: "short", source: ENTSOE });
    this.panels = [this.spreadPanel, this.parityPanel];
  }

  async render(id) {
    const s = this.state;
    const daily = await getPriceDaily();
    if (id !== this.renderId) return;
    const dates = dateRange(s.from < PRICE_FIRST ? PRICE_FIRST : s.from, s.to).filter(d => daily.byDate.get(d)?.FR_base != null);
    const key = d => (s.res === "1w" ? weekStart(d) : s.res === "1M" ? `${d.slice(0, 7)}-01` : d);
    const series = [];
    const stats = [];
    for (const z of NEIGHBOURS) {
      const acc = new Map();
      const all = [];
      const par = [];
      for (const d of dates) {
        const r = daily.byDate.get(d);
        const a = r[`FR_${s.measure}`];
        const b = r[`${z}_${s.measure}`];
        if (a == null || b == null) continue;
        const k = key(d);
        if (!acc.has(k)) acc.set(k, []);
        acc.get(k).push(a - b);
        all.push(a - b);
        if (r[`par_${z}`] != null) par.push(r[`par_${z}`]);
      }
      series.push({ name: ZONES[z].name, colour: ZONES[z].colour, type: "line", data: [...acc].sort().map(([k, vs]) => [parisMidnight(k), meanOf(vs)]), unit: "€/MWh", decimals: 2, width: 1.8, symbols: s.res !== "1d" ? true : undefined });
      stats.push({ z, spread: meanOf(all), abs: meanOf(all.map(Math.abs)), parity: meanOf(par), days: all.length });
    }
    const valid = stats.filter(x => x.spread != null);
    if (!valid.length) throw new Error("no prices in this period");
    const divergent = [...valid].sort((a, b) => b.abs - a.abs)[0];
    const closest = [...valid].filter(x => x.parity != null).sort((a, b) => b.parity - a.parity)[0];
    const label = { base: "baseload", peak: "peak", off: "off-peak" }[s.measure];
    const span = fmtFromTo(dates[0], dates.at(-1));
    const typical = Math.abs(divergent.abs - Math.abs(divergent.spread)) > 0.1 * divergent.abs ? ` (${amt(divergent.abs)}/MWh apart on a typical day, in either direction)` : "";
    this.headline.textContent = `${span[0].toUpperCase() + span.slice(1)}, French ${label} prices were furthest from ${ZONES[divergent.z].name}'s, ${amt(divergent.spread)}/MWh ${divergent.spread >= 0 ? "above" : "below"} on average${typical}${closest ? `, and most often identical to ${ZONES[closest.z].name}'s (${fmtNumber(closest.parity, 0)}% of the time)` : ""}.`;
    this.root.querySelector("[data-cards]").innerHTML = valid.map(x => card(`France minus ${ZONES[x.z].name}`, fmtEurDelta(x.spread), `${x.parity != null ? `${fmtNumber(x.parity, 0)}% at parity · ` : ""}avg gap ${amt(x.abs)}`, x === divergent ? " accent" : "")).join("");
    this.spreadPanel.setTitle(`France minus each neighbour, ${label} price`, `${fmtPeriod(dates[0], dates.at(-1))} · €/MWh · positive = France dearer`);
    this.spreadPanel.render({
      xType: "time", xLabel: s.res === "1M" ? fmtMonth : s.res === "1w" ? x => `Week of ${fmtDate(x)}` : fmtDate, axisLabel: s.res === "1M" ? fmtMonth : undefined,
      xHeader: "Date", yName: "€/MWh", series, zeroLine: true, source: ENTSOE,
      notes: [s.res !== "1d" ? "Each point is the average of the daily spreads in that period." : "", "Germany: DE-LU since 1 Oct 2018, DE-AT-LU before."].filter(Boolean)
    });
    // Parity by month.
    const months = [...new Set(dates.map(d => d.slice(0, 7)))];
    this.parityPanel.setTitle("Share of time at the same price as France, by month", `${fmtPeriod(dates[0], dates.at(-1))} · % of periods`);
    this.parityPanel.render({
      xType: "category", categories: months.map(m => fmtMonth(parisMidnight(`${m}-01`))), xLabel: x => x, xHeader: "Month", yName: "%", yMin: 0, yScale: false, source: ENTSOE,
      series: NEIGHBOURS.map(z => ({ name: ZONES[z].name, colour: ZONES[z].colour, type: months.length > 18 ? "line" : "bar", barWidth: 8, data: months.map((m, i) => [i, meanOf(dates.filter(d => d.startsWith(m)).map(d => daily.byDate.get(d)[`par_${z}`]).filter(v => v != null))]), unit: "%", decimals: 1 })),
      notes: ["Parity: the two day-ahead prices differ by less than €0.01/MWh. Measured on a 15-minute grid (hourly prices repeated), so Swiss hourly prices can still match."]
    });
  }
}

// ---------- Mix & Price ----------

const CONDITIONS = {
  solar_share: { label: "Solar share of generation (%)", unit: "%", width: 5, get: r => share(r, "solar") },
  wind_share: { label: "Wind share of generation (%)", unit: "%", width: 5, get: r => share(r, "wind") },
  vre_share: { label: "Wind and solar share (%)", unit: "%", width: 5, get: r => (total(r) ? 100 * ((r.wind || 0) + (r.solar || 0)) / total(r) : null) },
  wind: { label: "Wind output (GW)", unit: "GW", width: 2, get: r => (r.wind == null ? null : r.wind / 1000) },
  solar: { label: "Solar output (GW)", unit: "GW", width: 2, get: r => (r.solar == null ? null : r.solar / 1000) },
  nuclear: { label: "Nuclear output (GW)", unit: "GW", width: 2.5, get: r => (r.nuclear == null ? null : r.nuclear / 1000) },
  gas: { label: "Gas-fired output (GW)", unit: "GW", width: 1, get: r => (r.gas == null ? null : r.gas / 1000) },
  residual: { label: "Residual demand (GW)", unit: "GW", width: 5, get: r => (r.residual == null ? null : r.residual / 1000) },
  net_exports: { label: "Net exports (GW)", unit: "GW", width: 2, get: r => (r.net_exports == null ? null : r.net_exports / 1000) },
  hour: { label: "Hour of day (Paris)", unit: "h", width: 1, get: r => new Date(toWall(r.t)).getUTCHours() }
};
function total(r) { return ["nuclear", "hydro", "wind", "solar", "gas", "coal", "oil", "bio"].reduce((a, k) => a + (r[k] || 0), 0); }
function share(r, k) { const t = total(r); return t && r[k] != null ? 100 * r[k] / t : null; }

export class MixPrice extends Base {
  constructor(root) {
    super(root, "prices/mix", { preset: "last365", cond: "solar_share", days: "7" });
    root.innerHTML = `
      ${heroHtml("How the mix", "sets the price.", "The French day-ahead price above the generation mix that produced it, then the average price under different conditions (solar share, wind output, nuclear, gas, net exports, time of day), and every hour as a point coloured by year.")}
      <div class="toolbar"><div class="toolbar-row">${periodHtml(PRICE_FIRST)}
        <label class="field"><span>Condition</span><select data-k="cond">${Object.entries(CONDITIONS).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join("")}</select></label>
        <label class="field"><span>Linked charts show</span><select data-k="days"><option value="2">Last 2 days</option><option value="7">Last 7 days</option><option value="14">Last 14 days</option><option value="31">Last 31 days</option></select></label>
      </div><p class="hint">The two linked charts show the last days of the period; hover one and the other follows. The band chart and scatter use the whole period (up to three years).</p></div>
      ${headlineHtml}
      <div data-a></div><div data-b></div><div class="grid-2"><div data-c></div><div data-d></div></div>`;
    this.wire();
    this.pricePanel = new ChartPanel(root.querySelector("[data-a]"), { title: "Price", size: "short", source: ENTSOE });
    this.mixPanel = new ChartPanel(root.querySelector("[data-b]"), { title: "Generation mix", size: "", source: "RTE (French TSO)" });
    this.bandPanel = new ChartPanel(root.querySelector("[data-c]"), { title: "Price by condition", size: "short", source: "ENTSO-E and RTE" });
    this.scatterPanel = new ChartPanel(root.querySelector("[data-d]"), { title: "Every hour", size: "short", source: "ENTSO-E and RTE" });
    this.panels = [this.pricePanel, this.mixPanel, this.bandPanel, this.scatterPanel];
  }

  async render(id) {
    const s = this.state;
    const to = s.to > todayParis() ? todayParis() : s.to;
    const linkFrom = addDays(to, -(Number(s.days) - 1));
    const [prices, mix] = await Promise.all([getPrices("FR", linkFrom, addDays(to, 1)), getMix(linkFrom, to)]);
    if (id !== this.renderId) return;
    const q = toQuarters(prices);
    const xs = [...q.keys()].filter(t => t < parisMidnight(addDays(to, 1))).sort((a, b) => a - b);
    this.pricePanel.setTitle("French day-ahead price", `${fmtPeriod(linkFrom, to)} · €/MWh`);
    this.pricePanel.render({ xType: "time", xLabel: fmtDateTime, yName: "€/MWh", zeroLine: true, source: ENTSOE, series: [{ name: "Day-ahead price", colour: "--s-actual", type: "line", step: "start", data: xs.map(t => [t, q.get(t)]), unit: "€/MWh", decimals: 2, width: 2 }], xMin: parisMidnight(linkFrom), xMax: parisMidnight(addDays(to, 1)) });
    const fuels = FUEL_ORDER.filter(f => mix.some(r => r[f] > 0));
    this.mixPanel.setTitle("French generation by fuel", `${fmtPeriod(linkFrom, to)} · GW, stacked`);
    this.mixPanel.render({
      xType: "time", xLabel: fmtDateTime, yName: "GW", yMin: 0, source: "RTE (French TSO)", xMin: parisMidnight(linkFrom), xMax: parisMidnight(addDays(to, 1)),
      series: fuels.map(f => ({ name: FUELS[f].name, colour: FUELS[f].colour, type: "line", stack: "mix", data: mix.map(r => [r.t, r[f] == null ? null : Math.max(0, r[f]) / 1000]), unit: "GW", decimals: 2, width: 0.6, areaOpacity: 0.85, symbols: false }))
    });
    echarts.connect([this.pricePanel.chart, this.mixPanel.chart]);

    // Bands and scatter over the whole period (at most three years).
    let from = s.from < "2015-01-05" ? "2015-01-05" : s.from;
    if (daysBetween(from, to) > 1095) from = addDays(to, -1094);
    const rows = (await getMarketHourly(from, to)).filter(r => r.price != null);
    if (id !== this.renderId) return;
    const c = CONDITIONS[s.cond];
    const pairs = rows.map(r => [c.get(r), r.price, r.t]).filter(p => p[0] != null && Number.isFinite(p[0]));
    if (!pairs.length) throw new Error("no hours with both a price and this condition");
    const bands = new Map();
    for (const [x, p] of pairs) {
      const b = Math.floor(x / c.width) * c.width;
      if (!bands.has(b)) bands.set(b, []);
      bands.get(b).push(p);
    }
    const keys = [...bands.keys()].filter(k => bands.get(k).length >= 5).sort((a, b) => a - b);
    const fmtB = k => (s.cond === "hour" ? `${String(k).padStart(2, "0")}:00` : `${fmtNumber(k, c.width % 1 ? 1 : 0)}–${fmtNumber(k + c.width, c.width % 1 ? 1 : 0)}`);
    this.bandPanel.setTitle(`Average price by ${c.label.replace(/ \(.*\)/, "").toLowerCase()}`, `${fmtPeriod(from, to)} · hourly · €/MWh`);
    this.bandPanel.render({
      xType: "category", categories: keys.map(fmtB), xLabel: x => `${x} ${c.unit === "h" ? "" : c.unit}`, xHeader: c.label, yName: "€/MWh", source: "ENTSO-E and RTE",
      yAxis2: { name: "hours", format: v => fmtNumber(v, 0) },
      series: [
        { name: "Average price", colour: "--s-actual", type: "bar", data: keys.map((k, i) => [i, meanOf(bands.get(k))]), unit: "€/MWh", decimals: 2, avg: false, barWidth: 18, colourFn: v => (v < 0 ? "--neg" : "--s-actual") },
        { name: "Hours in band", colour: "--s-avg", type: "line", data: keys.map((k, i) => [i, bands.get(k).length]), yAxis: 1, decimals: 0, avg: false, dashed: true }
      ],
      notes: ["Bands with fewer than 5 hours are left out."]
    });
    // Headline: compare the top and bottom bands with enough hours.
    const big = keys.filter(k => bands.get(k).length >= 50);
    if (big.length >= 2) {
      const lo = big[0]; const hi = big.at(-1);
      const pl = meanOf(bands.get(lo)); const ph = meanOf(bands.get(hi));
      this.headline.textContent = `${fmtFromTo(from, to).replace(/^f/, "F")}, the French day-ahead price averaged ${fmtEur(pl)} in hours with ${c.label.replace(/ \(.*\)/, "").toLowerCase()} of ${fmtB(lo)}${c.unit === "h" ? "" : ` ${c.unit}`} and ${fmtEur(ph)} at ${fmtB(hi)}${c.unit === "h" ? "" : ` ${c.unit}`}, a gap of ${amt(ph - pl)}/MWh.`;
    } else this.headline.textContent = `Not enough hours in this period to compare conditions.`;

    // Scatter coloured by year.
    const years = [...new Set(pairs.map(p => dateKey(p[2]).slice(0, 4)))].sort();
    const palette = ["--seq-1", "--seq-2", "--seq-3", "--seq-4", "--seq-5", "--s-actual", "--s-ly", "--s-id"];
    const step = Math.max(1, Math.floor(pairs.length / 15000));
    const byYear = years.map((y, i) => ({ y, colour: cssVar(palette[(palette.length - years.length + i + palette.length) % palette.length]), data: pairs.filter((p, j) => j % step === 0 && dateKey(p[2]).startsWith(y)).map(p => [p[0], p[1], p[2]]) }));
    this.scatterPanel.setTitle(`Every hour: price against ${c.label.replace(/ \(.*\)/, "").toLowerCase()}`, `${fmtPeriod(from, to)} · coloured by year`);
    this.scatterPanel.render({
      source: "ENTSO-E and RTE",
      custom: {
        legend: byYear.map(b => ({ name: b.y, colour: b.colour, shape: "dot" })),
        option: t => ({
          backgroundColor: "transparent", animation: false,
          grid: { left: 56, right: 20, top: 30, bottom: 40 },
          tooltip: { trigger: "item", backgroundColor: t.tooltip, borderColor: t.border, textStyle: { color: t.text, fontSize: 12 }, formatter: p => `${fmtDateTime(p.value[2])}<br>${c.label}: <b>${fmtNumber(p.value[0], 1)}</b><br>Price: <b>${fmtEur(p.value[1])}</b>` },
          xAxis: { type: "value", name: c.label, nameLocation: "middle", nameGap: 26, nameTextStyle: { color: t.muted }, scale: true, axisLabel: { color: t.muted, fontFamily: "JetBrains Mono", fontSize: 11 }, splitLine: { lineStyle: { color: t.grid } } },
          yAxis: { type: "value", name: "€/MWh", nameTextStyle: { color: t.muted }, scale: true, axisLabel: { color: t.muted, fontFamily: "JetBrains Mono", fontSize: 11 }, splitLine: { lineStyle: { color: t.grid } } },
          series: byYear.map(b => ({ name: b.y, type: "scatter", symbolSize: 3, large: true, itemStyle: { color: b.colour, opacity: 0.55 }, data: b.data }))
        }),
        table: () => ({ headers: ["Time (Paris)", c.label, "Price (€/MWh)"], rows: pairs.slice(0, 50000).map(p => [fmtDateTime(p[2]), fmtNumber(p[0], 2), fmtNumber(p[1], 2)]) })
      },
      notes: [step > 1 ? `Showing every ${step}th hour of ${fmtNumber(pairs.length, 0)} for speed.` : `${fmtNumber(pairs.length, 0)} hours.`]
    });
  }
}

// ---------- Negative prices ----------

export class NegativePrices extends Base {
  constructor(root) {
    const y = todayParis().slice(0, 4);
    super(root, "prices/negative", { zone: "FR", year: y, mode: "below", thr: "0", zero: "0", n: "5" });
    root.innerHTML = `
      ${heroHtml("When prices", "go below zero.", "How often, how deep and when day-ahead prices fall below zero (or any threshold you set), year to date against earlier years. Negative-price depth weighs depth by time: the sum of how far below the threshold each period was, times its length, in €/MWh·h.")}
      <div class="toolbar"><div class="toolbar-row">
        <label class="field"><span>Bidding zone</span><select data-k="zone">${Object.entries(ZONES).map(([k, z]) => `<option value="${k}">${z.name}</option>`).join("")}</select></label>
        <label class="field"><span>Year</span><select data-k="year">${Array.from({ length: Number(y) - 2014 }, (_, i) => Number(y) - i).map(v => `<option value="${v}">${v}</option>`).join("")}</select></label>
        <label class="field"><span>Count prices</span><select data-k="mode"><option value="below">Below</option><option value="above">Above</option></select></label>
        <label class="field"><span>Threshold (€/MWh)</span><input type="number" step="1" data-k="thr" style="width:96px"></label>
        <div class="field"><span>Zero-priced periods</span>${switchHtml("data-zero", "Leave out", "Include")}</div>
        <label class="field"><span>Average of previous</span><select data-k="n">${[3, 5, 8, 10].map(n => `<option value="${n}">${n} years</option>`).join("")}</select></label>
      </div><p class="hint">Default: prices below €0/MWh. Switch on “Include” to count periods priced at exactly the threshold as well (for example zero-priced hours).</p></div>
      ${headlineHtml}
      <div class="cards" data-cards></div>
      <div data-a></div><div class="grid-2"><div data-b></div><div data-c></div></div><div data-d></div>`;
    this.headline = root.querySelector("[data-headline]");
    root.querySelector("[data-copy]").addEventListener("click", () => copyText(this.headline.textContent));
    root.querySelectorAll("[data-k]").forEach(input => input.addEventListener("change", () => { this.state[input.dataset.k] = input.value; this.update(); }));
    root.querySelector("[data-zero]").addEventListener("click", () => { this.state.zero = this.state.zero === "1" ? "0" : "1"; this.update(); });
    this.period = { sync: () => setSwitch(root.querySelector("[data-zero]"), this.state.zero === "1"), apply: () => {} };
    this.cumPanel = new ChartPanel(root.querySelector("[data-a]"), { title: "Cumulative hours", size: "tall", source: ENTSOE });
    this.monthPanel = new ChartPanel(root.querySelector("[data-b]"), { title: "By month", size: "short", source: ENTSOE });
    this.histPanel = new ChartPanel(root.querySelector("[data-c]"), { title: "Distribution", size: "short", source: ENTSOE });
    this.heatPanel = new ChartPanel(root.querySelector("[data-d]"), { title: "Time of day by month", size: "", source: ENTSOE });
    this.panels = [this.cumPanel, this.monthPanel, this.histPanel, this.heatPanel];
  }

  async render(id) {
    const s = this.state;
    const year = Number(s.year);
    const n = Number(s.n);
    const thr = Number(s.thr) || 0;
    const incl = s.zero === "1";
    const below = s.mode === "below";
    const hit = v => (below ? (incl ? v <= thr : v < thr) : (incl ? v >= thr : v > thr));
    const depth = v => Math.abs(v - thr);
    const today = todayParis();
    const first = `${Math.max(2015, year - n)}-01-01`;
    const pts = await getPrices(s.zone, first, `${year}-12-31`);
    if (id !== this.renderId) return;
    const byYear = new Map();
    for (const p of pts) {
      const d = dateKey(p.t);
      const y = Number(d.slice(0, 4));
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push({ ...p, d });
    }
    const doy = d => daysBetween(`${d.slice(0, 4)}-01-01`, d);
    const cutoffDoy = year === Number(today.slice(0, 4)) ? doy(addDays(today, 1)) : 366;
    const stats = y => {
      const list = byYear.get(y) || [];
      const cum = new Array(366).fill(0);
      let hours = 0; let dep = 0; let lowest = null; const days = new Set(); let total = 0; let ytdH = 0; let ytdD = 0;
      const months = new Array(12).fill(0);
      for (const p of list) {
        const h = p.min / 60;
        total += h;
        if (!hit(p.eur)) continue;
        hours += h; dep += depth(p.eur) * h; days.add(p.d);
        cum[doy(p.d)] += h;
        months[Number(p.d.slice(5, 7)) - 1] += h;
        if (doy(p.d) <= cutoffDoy) { ytdH += h; ytdD += depth(p.eur) * h; }
        if (!lowest || (below ? p.eur < lowest.eur : p.eur > lowest.eur)) lowest = p;
      }
      for (let i = 1; i < 366; i++) cum[i] += cum[i - 1];
      return { hours, dep, lowest, days: days.size, total, cum, months, ytdH, ytdD, list };
    };
    const cur = stats(year);
    const last = byYear.has(year - 1) ? stats(year - 1) : null;
    const prev = [];
    for (let k = 1; k <= n; k++) if (byYear.has(year - k) && year - k >= 2015) prev.push(stats(year - k));
    const avgYtd = prev.length ? meanOf(prev.map(p => p.ytdH)) : null;
    const zone = ZONES[s.zone].name;
    const cond = `${below ? "below" : "above"} ${fmtEur(thr, 0).replace("/MWh", "")}/MWh${incl ? " (including periods at exactly that price)" : ""}`;
    const ytd = year === Number(today.slice(0, 4));
    const avgNeg = cur.hours ? cur.dep / cur.hours : null;
    const yrsLabel = prev.length ? `${year - prev.length}–${String(year - 1).slice(-2)}` : "";
    const hrs = h => (h === 1 ? "1 hour" : fmtHours(h).replace(" h", " hours"));
    this.headline.textContent = `${zone}'s day-ahead price was ${cond} for ${hrs(cur.hours)} ${ytd ? `in ${year} so far` : `in ${year}`}${last ? `, against ${hrs(last.ytdH)} by the same date in ${year - 1}` : ""}${avgYtd != null ? ` and a ${yrsLabel} average of ${hrs(avgYtd)}` : ""}.${avgNeg != null && cur.hours ? ` The negative-price depth was ${fmtNumber(cur.dep, 0)} €/MWh·h, an average of ${amt(avgNeg)}/MWh ${below ? "below" : "above"} the threshold.` : ""}`;
    const pctTime = cur.total ? 100 * cur.hours / cur.total : null;
    this.root.querySelector("[data-cards]").innerHTML = [
      card(`Hours ${below ? "below" : "above"} ${fmtNumber(thr, 0)}`, fmtHours(cur.hours), `${ytd ? "Year to date" : year}${pctTime != null ? ` · ${fmtNumber(pctTime, 1)}% of the time` : ""}`, " accent"),
      last ? card(`vs ${year - 1} to the same date`, `${cur.ytdH - last.ytdH >= 0 ? "+" : "−"}${fmtHours(Math.abs(cur.ytdH - last.ytdH))}`, `${fmtHours(last.ytdH)} by this date in ${year - 1}`) : "",
      avgYtd != null ? card(`vs ${yrsLabel} average`, `${cur.ytdH - avgYtd >= 0 ? "+" : "−"}${fmtHours(Math.abs(cur.ytdH - avgYtd))}`, `${fmtHours(avgYtd)} by this date`) : "",
      card("Negative-price depth", `${fmtNumber(cur.dep, 0)} €/MWh·h`, last ? `${fmtNumber(last.ytdD, 0)} by this date in ${year - 1}` : ""),
      card(`Average ${below ? "depth" : "excess"}`, avgNeg != null ? amt(avgNeg) : "–", "Per hour counted"),
      card(below ? "Lowest price" : "Highest price", cur.lowest ? fmtEur(cur.lowest.eur) : "–", cur.lowest ? fmtDateTime(cur.lowest.t) : ""),
      card("Days affected", fmtNumber(cur.days, 0), "Days with at least one period counted")
    ].join("");

    // Cumulative chart by day of year (x = date in the selected year).
    const x0 = parisMidnight(`${year}-01-01`);
    const toX = i => parisMidnight(addDays(`${year}-01-01`, i));
    const curve = (st, limit = 366) => st.cum.slice(0, limit).map((v, i) => [toX(i), v]);
    const series = [];
    const prevCurves = prev.map(p => p.cum);
    if (prevCurves.length) series.push({ name: `Average ${yrsLabel}`, colour: "--s-avg", type: "line", data: Array.from({ length: 365 }, (_, i) => [toX(i), meanOf(prevCurves.map(c => c[i]))]), dashed: true, width: 1.6, unit: "h", decimals: 1, avg: false });
    if (last) series.push({ name: String(year - 1), colour: "--s-ly", type: "line", data: curve(last, 365), width: 1.6, unit: "h", decimals: 1, avg: false });
    series.push({ name: String(year), colour: "--s-actual", type: "line", data: curve(cur, ytd ? cutoffDoy : 366), width: 2.6, unit: "h", decimals: 1, z: 20, avg: false });
    this.cumPanel.setTitle(`Cumulative hours ${cond}, ${zone}`, `${year} against earlier years · hours`);
    this.cumPanel.render({ xType: "time", xLabel: x => fmtLongDate(dateKey(x)).replace(/ \d{4}$/, ""), axisLabel: x => MONTHS[new Date(toWall(x)).getUTCMonth()], yName: "hours", yMin: 0, series, source: ENTSOE, legendCaption: null, xMin: x0, xMax: toX(365),
      notes: ["Earlier years are drawn on the same calendar dates.", s.zone === "FR" || s.zone === "DE" || s.zone === "BE" || s.zone === "IT_NORD" || s.zone === "ES" ? "From 30 Sep 2025 prices are set every 15 minutes, so a negative quarter-hour counts as 0.25 hours." : ""].filter(Boolean) });

    this.monthPanel.setTitle("Hours counted by month", `${year}${last ? ` and ${year - 1}` : ""} · hours`);
    this.monthPanel.render({ xType: "category", categories: MONTHS, xLabel: x => x, xHeader: "Month", yName: "hours", yMin: 0, yScale: false, source: ENTSOE,
      series: [
        ...(last ? [{ name: String(year - 1), colour: "--s-ly", type: "bar", data: last.months.map((v, i) => [i, v]), unit: "h", decimals: 1, barWidth: 10, avg: v => v.reduce((a, b) => a + b, 0) }] : []),
        { name: String(year), colour: "--s-actual", type: "bar", data: cur.months.map((v, i) => [i, v]), unit: "h", decimals: 1, barWidth: 10, avg: v => v.reduce((a, b) => a + b, 0) }
      ], legendCaption: "Total for the months in view" });

    // Histogram of prices in the year.
    const vals = cur.list.map(p => [p.eur, p.min / 60]);
    const lo = Math.max(-200, Math.floor(Math.min(...vals.map(v => v[0]), 0) / 10) * 10);
    const hi = Math.min(400, Math.ceil(Math.max(...vals.map(v => v[0]), 10) / 10) * 10);
    const bins = [];
    for (let b = lo; b < hi; b += 10) bins.push([b, 0]);
    for (const [v, h] of vals) { const i = Math.min(bins.length - 1, Math.max(0, Math.floor((v - lo) / 10))); bins[i][1] += h; }
    this.histPanel.setTitle(`How often each price level occurred, ${year}`, `${zone} · hours in €10/MWh bands`);
    this.histPanel.render({ xType: "category", categories: bins.map(b => `${b[0]}`), xLabel: x => `€${x} to €${Number(x) + 10}/MWh`, xHeader: "Band from (€/MWh)", yName: "hours", yMin: 0, yScale: false, source: ENTSOE,
      series: [{ name: "Hours", colour: "--s-actual", type: "bar", data: bins.map((b, i) => [i, b[1]]), unit: "h", decimals: 1, avg: false, barWidth: 12, colourFn: (v, i) => (hit(bins[i][0] + (below ? 0 : 9.99)) ? "--neg" : "--s-avg"), barColours: i => (hit(bins[i][0] + (below ? 0 : 9.99)) ? "--neg" : "--s-avg") }],
      notes: [`Prices below €${lo} or above €${hi}/MWh are counted in the end bands. Highlighted bands are the ones counted.`], legendCaption: null });

    // Heat map: hours counted by month and hour of day.
    const grid = Array.from({ length: 12 }, () => new Array(24).fill(0));
    for (const p of cur.list) if (hit(p.eur)) grid[Number(p.d.slice(5, 7)) - 1][new Date(toWall(p.t)).getUTCHours()] += p.min / 60;
    const data = [];
    let max = 0;
    grid.forEach((row, m) => row.forEach((v, h) => { data.push([h, m, v]); max = Math.max(max, v); }));
    this.heatPanel.setTitle(`When it happens: hours counted by time of day and month, ${year}`, `${zone} · Paris time`);
    this.heatPanel.render({ source: ENTSOE,
      custom: {
        exportSize: 520,
        legend: [{ name: "None", colour: "var(--panel-2)" }, { name: `Most (${fmtNumber(max, 1)} h)`, colour: "--neg" }],
        option: t => ({
          backgroundColor: "transparent", animation: false, grid: { left: 50, right: 16, top: 10, bottom: 34 },
          tooltip: { backgroundColor: t.tooltip, borderColor: t.border, textStyle: { color: t.text, fontSize: 12 }, formatter: p => `${MONTHS[p.value[1]]} ${year}, ${String(p.value[0]).padStart(2, "0")}:00–${String(p.value[0] + 1).padStart(2, "0")}:00<br><b>${fmtNumber(p.value[2], 2)} h</b> counted` },
          xAxis: { type: "category", data: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`), axisLabel: { color: t.muted, fontSize: 10, fontFamily: "JetBrains Mono", interval: 2 }, axisLine: { lineStyle: { color: t.axis } } },
          yAxis: { type: "category", data: MONTHS, inverse: true, axisLabel: { color: t.muted, fontSize: 11 }, axisLine: { show: false } },
          visualMap: { show: false, min: 0, max: Math.max(1, max), inRange: { color: [cssVar("--panel-2"), cssVar("--neg")] } },
          series: [{ type: "heatmap", data, itemStyle: { borderWidth: 0 } }]
        }),
        table: () => ({ headers: ["Month", ...Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`)], rows: grid.map((r, m) => [MONTHS[m], ...r.map(v => fmtNumber(v, 2))]) })
      } });
  }
}

// ---------- Nuclear modulation ----------

export class NuclearModulation extends Base {
  constructor(root) {
    super(root, "prices/modulation", { preset: "last365", low: "20" });
    root.innerHTML = `
      ${heroHtml("Nuclear capacity", "held back.", "Unused available nuclear capacity: what EDF's notices say was available minus what the fleet actually produced, hour by hour, compared across negative, low and normal price hours. When prices drop, reactors modulate down; this shows by how much.")}
      <div class="toolbar"><div class="toolbar-row">${periodHtml("2015-01-05")}
        <label class="field"><span>“Low” price up to (€/MWh)</span><input type="number" step="1" min="1" data-k="low" style="width:96px"></label>
      </div><p class="hint">Negative: below €0/MWh. Low: from €0 up to the threshold. Normal: above it. Fleet-level hourly data; a per-reactor breakdown is planned.</p></div>
      ${headlineHtml}
      <div class="cards" data-cards></div>
      <div data-a></div><div class="grid-2"><div data-b></div><div data-c></div></div>`;
    this.wire();
    this.dailyPanel = new ChartPanel(root.querySelector("[data-a]"), { title: "Unused available capacity", size: "tall", overview: true, source: "RTE and ENTSO-E" });
    this.monthPanel = new ChartPanel(root.querySelector("[data-b]"), { title: "By price band", size: "short", source: "RTE and ENTSO-E" });
    this.hourPanel = new ChartPanel(root.querySelector("[data-c]"), { title: "By hour of day", size: "short", source: "RTE and ENTSO-E" });
    this.panels = [this.dailyPanel, this.monthPanel, this.hourPanel];
  }

  async render(id) {
    const s = this.state;
    const low = Number(s.low) || 20;
    const from = s.from < "2015-01-05" ? "2015-01-05" : s.from;
    const to = s.to > todayParis() ? todayParis() : s.to;
    const rows = (await getMarketHourly(from, to)).filter(r => r.nuc_unused != null && r.price != null);
    if (id !== this.renderId) return;
    if (!rows.length) throw new Error("no hours with nuclear output, availability and a price in this period");
    const band = p => (p < 0 ? "neg" : p <= low ? "low" : "norm");
    const NAMES = { neg: "Negative prices", low: `Low prices (€0–${low})`, norm: `Normal prices (above €${low})` };
    const COL = { neg: "--neg", low: "--s-d1", norm: "--s-avg" };
    const acc = { neg: [], low: [], norm: [] };
    for (const r of rows) acc[band(r.price)].push(r);
    const avgU = list => meanOf(list.map(r => r.nuc_unused));
    const share = list => meanOf(list.filter(r => r.nuc_avail > 0).map(r => 100 * r.nuc_unused / r.nuc_avail));
    const st = Object.fromEntries(Object.entries(acc).map(([k, l]) => [k, { hours: l.length, u: avgU(l), pct: share(l), gwh: l.reduce((a, r) => a + r.nuc_unused, 0) / 1000 }]));
    const extra = st.neg.u != null && st.norm.u != null ? st.neg.u - st.norm.u : null;
    this.headline.textContent = !st.neg.hours ? `There were no hours of negative French prices ${fmtFromTo(from, to)}. ${st.low.hours ? `The nuclear fleet left an average of ${fmtMw(st.low.u)} of available capacity unused in ${fmtNumber(st.low.hours, 0)} hours priced from €0 to €${low}/MWh, against ${fmtMw(st.norm.u)} at higher prices.` : `The nuclear fleet left an average of ${fmtMw(st.norm.u)} of available capacity unused.`}` : `${fmtFromTo(from, to).replace(/^f/, "F")}, the French nuclear fleet left an average of ${fmtMw(st.neg.u)} of available capacity unused in ${fmtNumber(st.neg.hours, 0)} hours of negative prices, against ${fmtMw(st.norm.u)} when prices were above €${low}/MWh${extra != null ? `, ${fmtMw(Math.abs(extra))} ${extra >= 0 ? "more" : "less"}` : ""}.`;
    this.root.querySelector("[data-cards]").innerHTML = ["neg", "low", "norm"].map(k => card(NAMES[k], fmtMw(st[k].u), `${fmtNumber(st[k].hours, 0)} hours · ${st[k].pct != null ? `${fmtNumber(st[k].pct, 1)}% of available` : "–"}`, k === "neg" ? " accent" : "")).join("")
      + card("Unused energy in negative hours", st.neg.gwh >= 1000 ? `${fmtNumber(st.neg.gwh / 1000, 2)} TWh` : `${fmtNumber(st.neg.gwh, 0)} GWh`, "Available but not produced");

    // Daily average unused capacity and negative hours.
    const days = new Map();
    for (const r of rows) {
      const d = dateKey(r.t);
      if (!days.has(d)) days.set(d, { u: [], neg: 0 });
      days.get(d).u.push(r.nuc_unused);
      if (r.price < 0) days.get(d).neg += 1;
    }
    const dk = [...days.keys()].sort();
    this.dailyPanel.setTitle("Unused available nuclear capacity, daily average", `${fmtPeriod(from, to)} · GW (bars: hours of negative prices)`);
    this.dailyPanel.render({ xType: "time", xLabel: fmtDate, csvLabel: d => dateKey(d), yName: "GW", yMin: 0, source: "RTE and ENTSO-E", yAxis2: { name: "hours", format: v => fmtNumber(v, 0) },
      series: [
        { name: "Hours of negative prices", colour: "--neg", type: "bar", data: dk.map(d => [parisMidnight(d), days.get(d).neg]).filter(p => p[1] > 0), yAxis: 1, unit: "h", decimals: 0, barWidth: 4, avg: v => v.reduce((a, b) => a + b, 0) },
        { name: "Unused available capacity", colour: "--f-nuclear", type: "line", data: dk.map(d => [parisMidnight(d), meanOf(days.get(d).u) / 1000]), unit: "GW", decimals: 2, width: 2 }
      ],
      notes: ["Unused available capacity = available capacity in the outage notices minus measured output, never below zero. Besides price-led modulation it includes frequency-control reserves, reactors coasting down at the end of a fuel cycle, ramp limits after restarts and outages not (yet) declared, so it is not all a response to prices."] });

    // Monthly by band.
    const months = [...new Set(rows.map(r => dateKey(r.t).slice(0, 7)))].sort();
    const mAcc = new Map(months.map(m => [m, { neg: [], low: [], norm: [] }]));
    for (const r of rows) mAcc.get(dateKey(r.t).slice(0, 7))[band(r.price)].push(r.nuc_unused);
    this.monthPanel.setTitle("Average unused capacity by price band and month", "GW");
    this.monthPanel.render({ xType: "category", categories: months.map(m => fmtMonth(parisMidnight(`${m}-01`))), xLabel: x => x, xHeader: "Month", yName: "GW", yMin: 0, yScale: false, source: "RTE and ENTSO-E",
      series: ["norm", "low", "neg"].map(k => ({ name: NAMES[k], colour: COL[k], type: months.length > 18 ? "line" : "bar", barWidth: 7, data: months.map((m, i) => [i, mAcc.get(m)[k].length >= 3 ? meanOf(mAcc.get(m)[k]) / 1000 : null]), unit: "GW", decimals: 2 })),
      notes: ["Months with fewer than 3 hours in a band are left blank for that band."] });

    // By hour of day.
    const hours = Array.from({ length: 24 }, () => ({ u: [], p: [] }));
    for (const r of rows) { const h = new Date(toWall(r.t)).getUTCHours(); hours[h].u.push(r.nuc_unused); hours[h].p.push(r.price); }
    this.hourPanel.setTitle("Unused capacity and price by hour of day", "GW and €/MWh · Paris time");
    this.hourPanel.render({ xType: "category", categories: hours.map((_, h) => `${String(h).padStart(2, "0")}:00`), xLabel: x => x, xHeader: "Hour", yName: "GW", yMin: 0, yScale: false, source: "RTE and ENTSO-E", yAxis2: { name: "€/MWh", format: v => fmtNumber(v, 0) },
      series: [
        { name: "Unused available capacity", colour: "--f-nuclear", type: "bar", data: hours.map((h, i) => [i, meanOf(h.u) / 1000]), unit: "GW", decimals: 2, barWidth: 12 },
        { name: "Average price", colour: "--s-actual", type: "line", data: hours.map((h, i) => [i, meanOf(h.p)]), yAxis: 1, unit: "€/MWh", decimals: 2 }
      ] });
  }
}

export { DAY, HOUR };
