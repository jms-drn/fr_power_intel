// Generation page: today's mix (RTE 15-minute data), an explorer by fuel and
// a records list.

import { ChartPanel } from "./chart.js";
import { marketEventsBetween } from "./events.js";
import { FUELS, FUEL_ORDER, MIX_FIRST, fmtByUnit, getGenDaily, getMix, getRecords } from "./market-data.js";
import { card } from "./market-common.js";
import { TimeExplorer, meanOf } from "./time-explorer.js";
import {
  QUARTER, addDays, copyText, dateKey, fmtDateTime, fmtLongDate, fmtNumber, fmtPct, fmtTime, heroHtml, parisMidnight,
  todayParis, writeHash
} from "./util.js";

const RTE = "RTE (French TSO)";
const LOW = ["nuclear", "hydro", "wind", "solar", "bio"];
const REN = ["hydro", "wind", "solar", "bio"];
const MAIN = ["nuclear", "hydro", "wind", "solar", "gas", "bio"];
const totalOf = r => FUEL_ORDER.reduce((a, f) => a + Math.max(0, r[f] || 0), 0);

export class GenToday {
  constructor(root) {
    this.root = root;
    this.writesHash = true;
    this.state = { days: "2", hs: "0" };
    root.innerHTML = `
      ${heroHtml("French generation,", "right now.", "Output by fuel every 15 minutes from RTE, today so far against the same hours on the same weekday last year. RTE publishes the mix within about an hour.")}
      <div class="toolbar"><div class="toolbar-row">
        <label class="field"><span>Chart shows</span><select data-days><option value="1">Today</option><option value="2">Yesterday and today</option><option value="7">Last 7 days</option></select></label>
        <div class="field"><span>Hydro</span><label class="check"><input type="checkbox" data-hs> Split hydro</label></div>
      </div></div>
      <div class="headline"><p data-headline>Loading…</p><button class="btn ghost small" type="button" data-copy>Copy</button></div>
      <div class="card-row-label">Today so far, against the same hours last year</div>
      <div class="cards" data-cards-a></div>
      <div class="card-row-label">Shares of generation today</div>
      <div class="cards" data-cards-b></div>
      <div data-chart></div><div data-share></div>`;
    this.headline = root.querySelector("[data-headline]");
    root.querySelector("[data-copy]").addEventListener("click", () => copyText(this.headline.textContent));
    root.querySelector("[data-days]").addEventListener("change", e => { this.state.days = e.target.value; this.update(); });
    root.querySelector("[data-hs]").addEventListener("change", e => { this.state.hs = e.target.checked ? "1" : "0"; this.update(); });
    this.panel = new ChartPanel(root.querySelector("[data-chart]"), { title: "Generation mix", size: "tall", source: RTE });
    this.sharePanel = new ChartPanel(root.querySelector("[data-share]"), { title: "Shares", size: "short", source: RTE });
  }

  setParams(p) { if (p.has("days")) this.state.days = p.get("days"); }
  activate() { this.update(); }

  async update() {
    writeHash("generation/today", this.state);
    this.root.querySelector("[data-days]").value = this.state.days;
    this.root.querySelector("[data-hs]").checked = this.state.hs === "1";
    try {
      const today = todayParis();
      const lyDay = addDays(today, -364);
      const [mix, ly] = await Promise.all([getMix(addDays(today, -(Number(this.state.days) - 1)), today), getMix(lyDay, lyDay)]);
      const todayRows = mix.filter(r => dateKey(r.t) === today && r.nuclear != null);
      let day = today;
      let rows = todayRows;
      if (rows.length < 4) {
        day = addDays(today, -1);
        rows = (await getMix(day, day)).filter(r => r.nuclear != null);
      }
      if (!rows.length) throw new Error("no generation data yet");
      const lastT = rows.at(-1).t;
      const offset = lastT - parisMidnight(day);
      const lyRows = (day === today ? ly : await getMix(addDays(day, -364), addDays(day, -364))).filter(r => r.t - parisMidnight(addDays(day, -364)) <= offset);
      const avg = (list, f) => meanOf(list.map(r => r[f]).filter(v => v != null));
      const label = day === today ? "today" : "yesterday";
      const changes = [];
      const cardsA = MAIN.map(f => {
        const a = avg(rows, f);
        const b = avg(lyRows, f);
        const pct = a != null && b ? 100 * (a / b - 1) : null;
        if (pct != null && Math.max(a, b) >= 1000) changes.push({ f, a, b, pct });
        return card(FUELS[f].name, a != null ? `${fmtNumber(a / 1000, 1)} GW` : "–", b != null ? `${fmtPct(pct, 0)} vs ${fmtNumber(b / 1000, 1)} GW last year` : "");
      });
      const solarPeak = rows.reduce((m, r) => (r.solar != null && (!m || r.solar > m.solar) ? r : m), null);
      cardsA.push(card("Solar peak", solarPeak ? `${fmtNumber(solarPeak.solar / 1000, 1)} GW` : "–", solarPeak ? `at ${fmtTime(solarPeak.t)}` : ""));
      this.root.querySelector("[data-cards-a]").innerHTML = cardsA.join("");
      const sum = (list, fs) => list.reduce((a, r) => a + fs.reduce((x, f) => x + Math.max(0, r[f] || 0), 0), 0);
      const tot = sum(rows, FUEL_ORDER);
      const totLy = sum(lyRows, FUEL_ORDER);
      const lowPct = tot ? 100 * sum(rows, LOW) / tot : null;
      const renPct = tot ? 100 * sum(rows, REN) / tot : null;
      const lowLy = totLy ? 100 * sum(lyRows, LOW) / totLy : null;
      const vrePct = tot ? 100 * sum(rows, ["wind", "solar"]) / tot : null;
      const fossil = tot ? 100 * sum(rows, ["gas", "coal", "oil"]) / tot : null;
      const pp = (a, b) => (a != null && b != null ? `${a - b >= 0 ? "+" : "−"}${fmtNumber(Math.abs(a - b), 1)} pp vs last year` : "");
      this.root.querySelector("[data-cards-b]").innerHTML = [
        card("Low-carbon share", lowPct != null ? `${fmtNumber(lowPct, 1)}%` : "–", pp(lowPct, lowLy), " accent"),
        card("Renewable share", renPct != null ? `${fmtNumber(renPct, 1)}%` : "–", "Hydro, wind, solar and bioenergy"),
        card("Wind and solar share", vrePct != null ? `${fmtNumber(vrePct, 1)}%` : "–", ""),
        card("Fossil share", fossil != null ? `${fmtNumber(fossil, 1)}%` : "–", "Gas, coal and oil"),
        card("Total generation", `${fmtNumber(tot / rows.length / 1000, 1)} GW`, `Average ${label} so far`)
      ].join("");
      // Headline: the most notable change against last year.
      changes.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
      const top = changes[0];
      const upTo = fmtTime(lastT + QUARTER);
      let text = top ? `French ${FUELS[top.f].name.toLowerCase()} output averaged ${fmtNumber(top.a / 1000, 1)} GW ${label} to ${upTo}, ${fmtNumber(Math.abs(top.pct), 0)}% ${top.pct >= 0 ? "above" : "below"} the same hours on the same weekday last year (${fmtNumber(top.b / 1000, 1)} GW).` : "";
      if (lowPct != null) text += ` Low-carbon sources supplied ${fmtNumber(lowPct, 1)}% of generation${lowLy != null ? `, against ${fmtNumber(lowLy, 1)}% a year earlier` : ""}.`;
      this.headline.textContent = text.trim();

      // Stacked mix chart.
      const split = this.state.hs === "1";
      const PARTS = HYDRO_PARTS.map(x => x.value);
      const fuels = FUEL_ORDER.flatMap(f => (split && f === "hydro" ? PARTS : [f])).filter(f => mix.some(r => (f === "hydro_other" ? hydroOther(r) : r[f]) > 0));
      const nameOf = f => FUELS[f]?.name || HYDRO_PARTS.find(x => x.value === f).label;
      const colourOf = f => FUELS[f]?.colour || HYDRO_PARTS.find(x => x.value === f).colour;
      const val = (r, f) => (f === "hydro_other" ? hydroOther(r) : r[f]);
      const all = mix.filter(r => r.nuclear != null);
      this.panel.setTitle("Generation by fuel, every 15 minutes", `${fmtLongDate(dateKey(all[0]?.t ?? Date.now()))} – ${fmtLongDate(day)} · GW, stacked`);
      this.panel.render({
        xType: "time", xLabel: fmtDateTime, yName: "GW", yMin: 0, source: RTE,
        series: fuels.map(f => ({ name: nameOf(f), colour: colourOf(f), type: "line", stack: "mix", data: all.map(r => [r.t, val(r, f) == null ? null : Math.max(0, val(r, f)) / 1000]), unit: "GW", decimals: 2, width: 0.6, areaOpacity: 0.85, symbols: false })),
        markAreas: [{ from: parisMidnight(today), to: parisMidnight(addDays(today, 1)), label: "Today", colour: "--today" }],
        notes: ["Pumped-storage consumption is not shown. Hydro includes run-of-river, reservoirs and pumped-storage generation."]
      });
      this.sharePanel.setTitle("Low-carbon and wind-and-solar shares", "% of generation, every 15 minutes");
      this.sharePanel.render({
        xType: "time", xLabel: fmtDateTime, yName: "%", source: RTE,
        series: [
          { name: "Wind and solar", colour: "--f-wind", type: "line", data: all.map(r => { const t = totalOf(r); return [r.t, t ? 100 * ((r.wind || 0) + (r.solar || 0)) / t : null]; }), unit: "%", decimals: 1, width: 1.6 },
          { name: "Low-carbon", colour: "--s-actual", type: "line", data: all.map(r => { const t = totalOf(r); return [r.t, t ? 100 * LOW.reduce((a, f) => a + Math.max(0, r[f] || 0), 0) / t : null]; }), unit: "%", decimals: 1, width: 2.2 }
        ]
      });
    } catch (error) {
      console.error(error);
      this.headline.textContent = `Generation data could not be loaded (${error.message}).`;
    }
  }

  refreshTheme() { this.panel.refreshTheme(); this.sharePanel.refreshTheme(); }
}

// ---------- Explorer ----------

const HYDRO_PARTS = [
  { value: "hydro_ror", label: "Run-of-river", colour: "--f-hydro-ror", sub: true },
  { value: "hydro_res", label: "Reservoir", colour: "--f-hydro-res", sub: true },
  { value: "hydro_pump", label: "Pumped storage", colour: "--f-hydro-pump", sub: true },
  { value: "hydro_other", label: "Hydro, unassigned", colour: "--f-hydro-other", sub: true }
];
const GEN_SUBJECTS = [
  ...FUEL_ORDER.map(f => ({ value: f, label: FUELS[f].name, colour: FUELS[f].colour })),
  ...HYDRO_PARTS,
  { value: "total", label: "Total", colour: "--s-avg", inAll: false },
  { value: "lowc", label: "Low-carbon", colour: "--s-actual", inAll: false },
  { value: "ren", label: "Renewables", colour: "--s-ly", inAll: false },
  { value: "vre", label: "Wind + solar", colour: "--s-id", inAll: false }
];
const GROUPS = { total: FUEL_ORDER, lowc: LOW, ren: REN, vre: ["wind", "solar"] };
const hydroOther = r => (r.hydro != null && r.hydro_ror != null && r.hydro_res != null && r.hydro_pump != null ? r.hydro - r.hydro_ror - r.hydro_res - r.hydro_pump : null);
const valueOf = (r, k) => (k === "hydro_other" ? r.hydro_other ?? hydroOther(r) : GROUPS[k] ? (GROUPS[k].some(f => r[f] != null) ? GROUPS[k].reduce((a, f) => a + Math.max(0, r[f] || 0), 0) : null) : r[k]);
const dailyTotal = r => (r.total != null ? r.total : FUEL_ORDER.reduce((a, f) => a + Math.max(0, r[f] || 0), 0));

export function genExplorer(root) {
  return new TimeExplorer(root, {
    key: "generation/explorer",
    hero: ["Explore French generation,", "since 2015.", "Output by fuel from RTE, from 15-minute detail (since 2017; hourly in 2015–16) to yearly averages. One fuel: against last year, the average and range of earlier years or a chosen year. Several fuels: side by side or stacked, with the change on last year and the gap between two."],
    firstDate: MIX_FIRST, source: RTE, fine: "15m",
    subjects: GEN_SUBJECTS, subjectLabel: "Fuels", multi: true, allLabel: "All fuels", splitOf: "hydro", splitLabel: "Split hydro", subjectPlural: "fuels", events: marketEventsBetween,
    measures: {
      output: { label: "Output (average GW)", short: "output", unit: "GW", scale: 1000, decimals: 2, agg: "mean", yMin: 0, daily: (r, k) => valueOf(r, k) },
      share: { label: "Share of generation (%)", short: "share of generation", unit: "%", decimals: 1, agg: "mean", daily: (r, k) => { const v = valueOf(r, k); const t = dailyTotal(r); return v != null && t ? 100 * v / t : null; } },
      energy: { label: "Energy (GWh)", short: "generation", unit: "GWh", decimals: 0, agg: "sum", intraday: false, daily: (r, k) => { const v = valueOf(r, k); return v != null && r.hours ? v * r.hours / 1000 : null; } },
      max: { label: "Highest daily average", short: "highest daily average", unit: "GW", scale: 1000, decimals: 2, agg: "max", intraday: false, daily: (r, k) => valueOf(r, k) },
      min: { label: "Lowest daily average", short: "lowest daily average", unit: "GW", scale: 1000, decimals: 2, agg: "min", intraday: false, daily: (r, k) => valueOf(r, k) }
    },
    defaults: { measure: "output", subject: "solar", subjects: "solar", preset: "last90", res: "1d" },
    loadDaily: getGenDaily,
    loadRaw: async (k, from, to, measure) => (await getMix(from, to)).map(r => {
      const v = valueOf(r, k);
      if (measure === "share") { const t = totalOf(r); return { t: r.t, min: r.min, v: v != null && t ? 100 * v / t : null }; }
      return { t: r.t, min: r.min, v };
    }),
    hasQuarters: t => t >= parisMidnight("2017-01-01"),
    quarterNote: "In 2015–16 RTE's mix is hourly; each hourly value is repeated across its four quarter-hours.",
    fmt: (v, m) => fmtByUnit(v, m),
    sentenceSubject: (m, subj) => `French ${subj.toLowerCase().replace(/ \(.*\)/, "")} ${m.short}`,
    notes: s => [(s.subjects || "").includes("hydro_") ? "Hydro split: run-of-river, reservoir and pumped storage as RTE reports them; \"unassigned\" is the part of RTE's hydro total not given a type (up to about 15% in recent years). In 2015–16 pumped storage is net of pumping and can be negative; the split is missing for the first half of 2017." : "", s.subject === "hydro" ? "Hydro includes run-of-river, reservoirs and pumped-storage generation (not pumping consumption)." : "", s.subject === "wind" ? "Wind is onshore plus offshore (offshore from 2022)." : ""].filter(Boolean)
  });
}

// ---------- Records ----------

const GROUP_OF = key => (["fr_base", "fr_min", "fr_neg"].includes(key) ? "Prices" : key === "net_exports" ? "Flows" : key === "demand" ? "Demand" : "Generation");

export class GenRecords {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      ${heroHtml("Records,", "kept up to date.", "The highest and lowest daily values since the data begins: generation by fuel, low-carbon share, prices, negative prices, net exports and demand. Click any record to open the data around that day.")}
      <div data-records><p class="muted">Loading…</p></div>`;
  }

  async activate() {
    const box = this.root.querySelector("[data-records]");
    try {
      const { records = [] } = await getRecords();
      if (!records.length) { box.innerHTML = `<p class="muted">Records appear once the price and generation history has been built.</p>`; return; }
      const groups = new Map();
      for (const r of records) {
        const g = GROUP_OF(r.key);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(r);
      }
      box.innerHTML = [...groups].map(([g, list]) => `
        <section class="records-group"><h2>${g}</h2><div class="records-list">
          ${list.map(r => {
            const from = addDays(r.date, -15);
            const to = addDays(r.date, 15) > todayParis() ? todayParis() : addDays(r.date, 15);
            const link = `#${r.link}${r.link.includes("?") ? "&" : "?"}preset=custom&from=${from}&to=${to}&res=1d`;
            return `<a class="record" href="${link}"><span class="record-kind ${r.kind}">${r.kind === "high" ? "Highest" : "Lowest"}</span><span class="record-label">${r.label[0].toUpperCase() + r.label.slice(1)}</span><b>${fmtRecord(r)}</b><span class="muted">${fmtLongDate(r.date)}</span><span class="record-go" aria-hidden="true">→</span></a>`;
          }).join("")}
        </div></section>`).join("") + `<p class="hint">Daily values: averages over each Paris day (generation, net exports, demand), the baseload or lowest price of the day, or the hours of negative prices in the day. Generation from 2015 (RTE), prices from Jan 2015 (ENTSO-E).</p>`;
    } catch (error) {
      console.error(error);
      box.innerHTML = `<p>Records could not be loaded (${error.message}).</p>`;
    }
  }
}

function fmtRecord(r) {
  if (r.unit === "GW") return `${fmtNumber(r.value / 1000, 1)} GW`;
  if (r.unit === "%") return `${fmtNumber(r.value, 1)}%`;
  if (r.unit === "EUR/MWh") return `${r.value < 0 ? "−" : ""}€${fmtNumber(Math.abs(r.value), 2)}/MWh`;
  if (r.unit === "h") return `${fmtNumber(r.value, 2)} h`;
  return String(r.value);
}
