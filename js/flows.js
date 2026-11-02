// Flows page: a live map of physical flows on each French border (ENTSO-E),
// an explorer, and flows against price spreads.

import { ChartPanel } from "./chart.js";
import { marketEventsBetween } from "./events.js";
import { flag } from "./flags.js";
import { BORDERS, ENTSOE, ZONES, fmtEur, getFlowDaily, getFlows, getMarketHourly, getPrices, toHours } from "./market-data.js";
import { bindPeriod, card, periodHtml, readParams } from "./market-common.js";
import { loadMap } from "./nuclear-today.js";
import { TimeExplorer, meanOf } from "./time-explorer.js";
import {
  HOUR, addDays, copyText, cssVar, dateKey, fmtDateTime, fmtFromTo, fmtLongDate, fmtNumber, fmtPeriod, fmtTime, heroHtml,
  parisMidnight, todayParis, writeHash
} from "./util.js";

const SRC = `${ENTSOE} (physical flows)`;
const ORDER = ["BE", "DE", "CH", "IT_NORD", "ES", "GB"];
const COLOUR = { BE: "--z-be", DE: "--z-de", CH: "--z-ch", IT_NORD: "--z-it", ES: "--z-es", GB: "--z-gb" };
// [France side, neighbour side] as [lon, lat] for the map arrows.
const GEO = {
  BE: [[2.75, 50.25], [4.35, 50.85]], DE: [[7.1, 48.75], [8.9, 49.75]], CH: [[6.4, 46.75], [7.9, 47.1]],
  IT_NORD: [[6.6, 45.15], [8.4, 45.2]], ES: [[-0.6, 43.25], [-2.4, 41.9]], GB: [[1.65, 50.75], [0.4, 51.55]]
};
const gw = mw => `${fmtNumber(Math.abs(mw) / 1000, mw && Math.abs(mw) < 1000 ? 2 : 1)} GW`;

/** Hourly net flows per border between two dates: Map(border -> Map(hour -> {exp, imp, net})). */
async function hourlyFlows(from, to) {
  const out = new Map();
  await Promise.all(ORDER.map(async b => {
    const pts = await getFlows(b, from, to);
    const e = toHours(pts, "export_mw");
    const i = new Map(toHours(pts, "import_mw").map(p => [p.t, p.v]));
    out.set(b, new Map(e.map(p => [p.t, { exp: p.v, imp: i.get(p.t) ?? 0, net: p.v - (i.get(p.t) ?? 0) }])));
  }));
  return out;
}

export class FlowsMap {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      ${heroHtml("Power across the borders,", "right now.", "Physical flows on each French interconnector, latest from ENTSO-E: what is crossing each border in the most recent hour, and the past week. Flows are measured, not scheduled, so they include loop flows through neighbours.")}
      <div class="headline"><p data-headline>Loading…</p><button class="btn ghost small" type="button" data-copy>Copy</button></div>
      <div class="cards" data-cards></div>
      <div class="grid-map"><div data-map></div><div data-list></div></div>
      <div data-week></div>`;
    this.headline = root.querySelector("[data-headline]");
    root.querySelector("[data-copy]").addEventListener("click", () => copyText(this.headline.textContent));
    this.mapPanel = new ChartPanel(root.querySelector("[data-map]"), { title: "Latest hour", size: "map", table: true, source: SRC });
    this.weekPanel = new ChartPanel(root.querySelector("[data-week]"), { title: "Past 7 days", size: "tall", overview: true, source: SRC });
  }

  async activate() {
    try {
      await loadMap();
      const today = todayParis();
      const flows = await hourlyFlows(addDays(today, -7), today);
      // Latest hour with data on every border that has any recent data.
      const latestPer = new Map(ORDER.map(b => [b, Math.max(...flows.get(b).keys(), -Infinity)]));
      const recent = ORDER.filter(b => latestPer.get(b) > Date.now() - 2 * 86400000);
      if (!recent.length) throw new Error("no recent flow data");
      const t = Math.min(...recent.map(b => latestPer.get(b)));
      const now = new Map(recent.map(b => [b, flows.get(b).get(t)]));
      const net = [...now.values()].reduce((a, v) => a + (v?.net || 0), 0);
      const todayStart = parisMidnight(today);
      const todayNet = meanOf([...new Set(recent.flatMap(b => [...flows.get(b).keys()]))].filter(x => x >= todayStart && recent.every(b => flows.get(b).has(x))).map(x => recent.reduce((a, b) => a + flows.get(b).get(x).net, 0)));
      const sorted = [...now].filter(([, v]) => v).sort((a, b) => b[1].net - a[1].net);
      const exportsTo = sorted.filter(([, v]) => v.net > 50);
      const importsFrom = sorted.filter(([, v]) => v.net < -50).reverse();
      const hour = `${fmtTime(t)}–${fmtTime(t + HOUR)}`;
      const list = arr => arr.slice(0, 3).map(([b, v]) => `${BORDERS[b].name} (${gw(v.net)})`).join(", ").replace(/, ([^,]*)$/, " and $1");
      this.headline.textContent = `France was ${net >= 0 ? "exporting" : "importing"} a net ${gw(net)} between ${hour} on ${fmtLongDate(dateKey(t))}${exportsTo.length ? `, sending power to ${list(exportsTo)}` : ""}${importsFrom.length ? `${exportsTo.length ? ", while" : ","} taking it from ${list(importsFrom)}` : ""}.`;
      this.root.querySelector("[data-cards]").innerHTML = [
        card(net >= 0 ? "Net exports, latest hour" : "Net imports, latest hour", gw(net), `${hour} · ${recent.length} of ${ORDER.length} borders`, " accent"),
        card(todayNet != null && todayNet >= 0 ? "Net exports today so far" : "Net imports today so far", todayNet != null ? gw(todayNet) : "–", "Average of complete hours"),
        ...ORDER.map(b => { const v = now.get(b); return card(`${flag(b)} ${BORDERS[b].name}`, v ? `${v.net >= 0 ? "→" : "←"} ${gw(v.net)}` : "–", v ? `${v.net >= 0 ? "Export" : "Import"} · out ${gw(v.exp)}, in ${gw(v.imp)}` : "No recent data"); })
      ].join("");
      this.renderMap(now, t);
      // Past week.
      const xs = [...new Set(recent.flatMap(b => [...flows.get(b).keys()]))].sort((a, b) => a - b);
      this.weekPanel.setTitle("Net flow on each border, past 7 days", "GW · positive = France exporting");
      this.weekPanel.render({
        xType: "time", xLabel: fmtDateTime, yName: "GW", zeroLine: true, source: SRC,
        series: [
          ...ORDER.map(b => ({ name: BORDERS[b].name, colour: COLOUR[b], type: "line", data: xs.map(x => [x, flows.get(b).get(x)?.net / 1000 ?? null]).filter(p => p[1] != null && Number.isFinite(p[1])), unit: "GW", decimals: 2, width: 1.4 })),
          { name: "Net total", colour: "--s-actual", type: "line", data: xs.filter(x => recent.every(b => flows.get(b).has(x))).map(x => [x, recent.reduce((a, b) => a + flows.get(b).get(x).net, 0) / 1000]), unit: "GW", decimals: 2, width: 2.6, z: 20 }
        ],
        notes: ["Latest data from ENTSO-E; the most recent hours can be revised. Net total covers the borders with data in that hour."]
      });
    } catch (error) {
      console.error(error);
      this.headline.textContent = `Flow data could not be loaded (${error.message}).`;
    }
  }

  renderMap(now, t) {
    const max = Math.max(1000, ...[...now.values()].map(v => Math.abs(v?.net || 0)));
    const lines = ORDER.filter(b => now.get(b)).map(b => {
      const v = now.get(b);
      const [fr, nb] = GEO[b];
      const exporting = v.net >= 0;
      return { b, v, coords: exporting ? [fr, nb] : [nb, fr], width: 2 + 10 * Math.abs(v.net) / max, colour: cssVar(exporting ? "--s-actual" : "--s-d1") };
    });
    const option = (tk, { forExport }) => ({
      backgroundColor: "transparent", animation: false,
      tooltip: forExport ? undefined : { trigger: "item", backgroundColor: tk.tooltip, borderColor: tk.border, textStyle: { color: tk.text, fontSize: 12 },
        formatter: p => { const l = lines.find(x => x.b === p.data?.b); return l ? `<b>${BORDERS[l.b].name}</b><br>${l.v.net >= 0 ? "France exporting" : "France importing"} net <b>${gw(l.v.net)}</b><br>France → ${BORDERS[l.b].short}: ${gw(l.v.exp)}<br>${BORDERS[l.b].short} → France: ${gw(l.v.imp)}` : ""; } },
      geo: {
        map: "fr-region", roam: !forExport, scaleLimit: { min: 1, max: 5 }, boundingCoords: [[-6.2, 53.2], [12.4, 40.6]],
        top: forExport ? 100 : 10, bottom: forExport ? 60 : 10, silent: true, label: { show: false },
        itemStyle: { areaColor: cssVar("--map-other"), borderColor: tk.grid, borderWidth: 1 },
        regions: [{ name: "France", itemStyle: { areaColor: cssVar("--map-land"), borderColor: tk.axis, borderWidth: 1.2 } }]
      },
      series: [
        { type: "lines", coordinateSystem: "geo", z: 3, data: lines.map(l => ({ b: l.b, coords: l.coords, lineStyle: { color: l.colour, width: l.width, opacity: 0.9, curveness: 0 } })), symbol: ["none", "arrow"], symbolSize: 14 },
        { type: "scatter", coordinateSystem: "geo", symbolSize: 0, z: 4, silent: true,
          data: lines.map(l => ({ name: `${BORDERS[l.b].name}\n${l.v.net >= 0 ? "→" : "←"} ${gw(l.v.net)}`, value: GEO[l.b][1] })),
          label: { show: true, formatter: p => p.name, position: "right", distance: 8, color: tk.text, fontSize: 11, fontWeight: 600, fontFamily: "Inter", lineHeight: 15 } }
      ]
    });
    this.mapPanel.setTitle("Net flow on each border, latest hour", `${fmtDateTime(t)} Paris time · arrow width shows size`);
    this.mapPanel.render({
      series: [], source: SRC,
      custom: {
        option, exportSize: 760,
        legend: [{ name: "France exporting", colour: "--s-actual" }, { name: "France importing", colour: "--s-d1" }],
        table: () => ({ headers: ["Border", "France exports (MW)", "France imports (MW)", "Net (MW)"], rows: lines.map(l => [BORDERS[l.b].name, Math.round(l.v.exp), Math.round(l.v.imp), Math.round(l.v.net)]) })
      },
      legendCaption: null,
      notes: ["Each arrow points the way the net flow runs. Italy is the Italy-North border; Germany includes the whole German border. Map: Natural Earth."]
    });
  }

  refreshTheme() { this.mapPanel.refreshTheme(); this.weekPanel.refreshTheme(); }
}

// ---------- Explorer ----------

export function flowsExplorer(root) {
  const subjects = [{ value: "net", label: "All borders" }, ...ORDER.map(b => ({ value: b, label: BORDERS[b].name }))];
  return new TimeExplorer(root, {
    key: "flows/explorer",
    hero: ["Explore cross-border flows,", "since 2015.", "Physical flows on France's borders from ENTSO-E: net exports, exports or imports for all borders or one, hourly to yearly, against earlier years or another border."],
    firstDate: "2015-01-01", source: SRC, fine: "1h", resolutions: ["1h", "1d", "1w", "1M", "1y"],
    subjects, subjectLabel: "Border", compareSubjects: true, compareLabel: "Another border…",
    measures: {
      net: { label: "Net exports (exports minus imports)", short: "net exports", unit: "GW", scale: 1000, decimals: 2, agg: "mean", zeroLine: true, daily: (r, b) => (b === "net" ? r.net : r[`${b}_net`]) },
      exp: { label: "Exports from France", short: "exports", unit: "GW", scale: 1000, decimals: 2, agg: "mean", yMin: 0, daily: (r, b) => (b === "net" ? sumOf(r, "exp") : r[`${b}_exp`]) },
      imp: { label: "Imports into France", short: "imports", unit: "GW", scale: 1000, decimals: 2, agg: "mean", yMin: 0, daily: (r, b) => (b === "net" ? sumOf(r, "imp") : r[`${b}_imp`]) }
    },
    defaults: { measure: "net", subject: "net", preset: "last90", res: "1d" },
    loadDaily: getFlowDaily, events: marketEventsBetween,
    loadRaw: async (b, from, to, measure) => {
      const list = b === "net" ? ORDER : [b];
      const maps = await Promise.all(list.map(async x => {
        const pts = await getFlows(x, from, to);
        const e = new Map(toHours(pts, "export_mw").map(p => [p.t, p.v]));
        const i = new Map(toHours(pts, "import_mw").map(p => [p.t, p.v]));
        return { e, i };
      }));
      const hours = [...new Set(maps.flatMap(m => [...m.e.keys()]))].sort((a, c) => a - c);
      return hours.filter(h => maps.every(m => m.e.has(h))).map(h => {
        const e = maps.reduce((a, m) => a + m.e.get(h), 0);
        const i = maps.reduce((a, m) => a + (m.i.get(h) ?? 0), 0);
        return { t: h, min: 60, v: measure === "exp" ? e : measure === "imp" ? i : e - i };
      });
    },
    fmt: (v, m) => (v == null ? "–" : m.key === "net" || m.zeroLine ? `${v < 0 ? "−" : ""}${fmtNumber(Math.abs(v) / 1000, 2)} GW` : `${fmtNumber(v / 1000, 2)} GW`),
    sentenceSubject: (m, subj) => (subj === "All borders" ? `French ${m.short}` : `French ${m.short} ${m.short === "imports" ? "from" : m.short === "exports" ? "to" : "with"} ${subj}`),
    notes: s => [s.subject === "GB" || s.cmp === "GB" ? "Great Britain: IFA, IFA2 and ElecLink; ENTSO-E still publishes these flows." : "", "Flows are physical (measured), so they can differ from the commercial exchanges agreed in the markets."].filter(Boolean)
  });
}
function sumOf(r, k) {
  let s = 0;
  for (const b of ORDER) { if (r[`${b}_${k}`] == null) return null; s += r[`${b}_${k}`]; }
  return s;
}

// ---------- Flows against prices ----------

export class FlowsPrices {
  constructor(root) {
    this.root = root;
    this.writesHash = true;
    this.state = { preset: "last90", from: "", to: "", border: "ES" };
    const opts = ORDER.filter(b => b !== "GB").map(b => `<option value="${b}">${BORDERS[b].name}</option>`).join("");
    root.innerHTML = `
      ${heroHtml("Flows and", "price gaps.", "Hourly physical flow on each border against the day-ahead price gap (France minus neighbour): average flow by price-gap band, every hour as a point, and the share of hours flowing from the dearer to the cheaper market. Borders with Belgium, Germany, Switzerland, Italy North and Spain; Great Britain is excluded (no ENTSO-E day-ahead price).")}
      <div class="toolbar"><div class="toolbar-row">${periodHtml("2015-01-05")}
        <label class="field"><span>Border</span><select data-k="border">${opts}</select></label>
      </div></div>
      <div class="headline"><p data-headline>Loading…</p><button class="btn ghost small" type="button" data-copy>Copy</button></div>
      <div class="cards" data-cards></div>
      <div class="grid-2"><div data-a></div><div data-b></div></div>`;
    this.headline = root.querySelector("[data-headline]");
    root.querySelector("[data-copy]").addEventListener("click", () => copyText(this.headline.textContent));
    this.period = bindPeriod(root, this.state, () => this.update());
    root.querySelector("[data-k]").addEventListener("change", e => { this.state.border = e.target.value; this.update(); });
    this.bandPanel = new ChartPanel(root.querySelector("[data-a]"), { title: "Flow by price gap", size: "short", source: ENTSOE });
    this.scatterPanel = new ChartPanel(root.querySelector("[data-b]"), { title: "Every hour", size: "short", source: ENTSOE });
  }

  setParams(p) { readParams(this.state, p); if (this.state.preset !== "custom") this.period.apply(); }
  activate() { this.update(); }

  async update() {
    const s = this.state;
    writeHash("flows/prices", s);
    this.period.sync();
    this.root.querySelector("[data-k]").value = s.border;
    try {
      let from = s.from;
      const to = s.to > todayParis() ? todayParis() : s.to;
      if ((parisMidnight(to) - parisMidnight(from)) / 86400000 > 730) from = addDays(to, -729);
      const zones = ORDER.filter(b => b !== "GB");
      const [fr, ...others] = await Promise.all([getPrices("FR", from, to), ...zones.map(z => getPrices(z, from, to))]);
      const frH = new Map(toHours(fr).map(p => [p.t, p.v]));
      const flows = await hourlyFlows(from, to);
      const stats = zones.map((z, i) => {
        const nbH = new Map(toHours(others[i]).map(p => [p.t, p.v]));
        const pairs = [];
        for (const [t, f] of flows.get(z)) {
          const a = frH.get(t); const b = nbH.get(t);
          if (a == null || b == null) continue;
          pairs.push({ t, spread: a - b, net: f.net });
        }
        const priced = pairs.filter(p => Math.abs(p.spread) >= 1);
        const against = priced.filter(p => (p.spread > 0 && p.net > 100) || (p.spread < 0 && p.net < -100));
        return { z, pairs, priced: priced.length, against: against.length, pct: priced.length ? 100 * against.length / priced.length : null, cheapExp: meanOf(pairs.filter(p => p.spread <= -1).map(p => p.net)), dearImp: meanOf(pairs.filter(p => p.spread >= 1).map(p => p.net)) };
      });
      const sel = stats.find(x => x.z === s.border);
      if (!sel?.pairs.length) throw new Error("no hours with both prices and flows on this border");
      const name = BORDERS[s.border].name;
      this.headline.textContent = `${fmtFromTo(from, to).replace(/^f/, "F")}, power flowed from the dearer to the cheaper market on the ${name} border in ${fmtNumber(sel.pct, 1)}% of the hours with a price gap of at least €1/MWh. When France was cheaper it exported a net ${gw(sel.cheapExp ?? 0)} on average; when it was dearer the net flow was ${sel.dearImp != null && sel.dearImp < 0 ? `${gw(sel.dearImp)} of imports` : `${gw(sel.dearImp ?? 0)} of exports`}.`;
      this.root.querySelector("[data-cards]").innerHTML = stats.map(x => card(`${BORDERS[x.z].name}: against the price gap`, x.pct != null ? `${fmtNumber(x.pct, 1)}%` : "–", `${fmtNumber(x.against, 0)} of ${fmtNumber(x.priced, 0)} hours with a gap ≥ €1`, x.z === s.border ? " accent" : "")).join("");
      // Average net flow by spread band.
      const bands = new Map();
      for (const p of sel.pairs) {
        const k = Math.max(-60, Math.min(55, Math.floor(p.spread / 5) * 5));
        if (!bands.has(k)) bands.set(k, []);
        bands.get(k).push(p.net);
      }
      const keys = [...bands.keys()].filter(k => bands.get(k).length >= 5).sort((a, b) => a - b);
      this.bandPanel.setTitle(`Average net flow to ${name} by price gap`, `${fmtPeriod(from, to)} · GW · gap = France minus ${name}`);
      this.bandPanel.render({ xType: "category", categories: keys.map(k => (k <= -60 ? "≤ −60" : k >= 55 ? "≥ 55" : `${k} to ${k + 5}`)), xLabel: x => `€${x}/MWh`, xHeader: "Price gap (€/MWh)", yName: "GW", zeroLine: true, source: ENTSOE,
        series: [{ name: "Average net exports", colour: "--s-actual", type: "bar", data: keys.map((k, i) => [i, meanOf(bands.get(k)) / 1000]), unit: "GW", decimals: 2, avg: false, barWidth: 14, colourFn: v => (v >= 0 ? "--s-actual" : "--s-d1") }],
        notes: ["Left: France cheaper (exports expected). Right: France dearer (imports expected). Bands with fewer than 5 hours are left out."], legendCaption: null });
      const step = Math.max(1, Math.floor(sel.pairs.length / 12000));
      const pts = sel.pairs.filter((_, i) => i % step === 0);
      this.scatterPanel.setTitle(`Every hour: net flow against the price gap with ${name}`, `${fmtPeriod(from, to)}`);
      this.scatterPanel.render({ source: ENTSOE,
        custom: {
          legend: [{ name: "Each hour", colour: "--s-actual", shape: "dot" }],
          option: t => ({
            backgroundColor: "transparent", animation: false, grid: { left: 56, right: 20, top: 30, bottom: 40 },
            tooltip: { trigger: "item", backgroundColor: t.tooltip, borderColor: t.border, textStyle: { color: t.text, fontSize: 12 }, formatter: p => `${fmtDateTime(p.value[2])}<br>Gap: <b>${fmtEur(p.value[0])}</b><br>Net exports: <b>${fmtNumber(p.value[1], 2)} GW</b>` },
            xAxis: { type: "value", name: "France minus neighbour (€/MWh)", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: t.muted }, axisLabel: { color: t.muted, fontFamily: "JetBrains Mono", fontSize: 11 }, splitLine: { lineStyle: { color: t.grid } } },
            yAxis: { type: "value", name: "GW", nameTextStyle: { color: t.muted }, axisLabel: { color: t.muted, fontFamily: "JetBrains Mono", fontSize: 11 }, splitLine: { lineStyle: { color: t.grid } } },
            series: [{ type: "scatter", symbolSize: 3, large: true, itemStyle: { color: cssVar("--s-actual"), opacity: 0.5 }, data: pts.map(p => [p.spread, p.net / 1000, p.t]) }]
          }),
          table: () => ({ headers: ["Time (Paris)", "Price gap (€/MWh)", "Net exports (MW)"], rows: sel.pairs.map(p => [fmtDateTime(p.t), fmtNumber(p.spread, 2), Math.round(p.net)]) })
        } });
    } catch (error) {
      console.error(error);
      this.headline.textContent = `The data could not be loaded (${error.message}).`;
    }
  }

  refreshTheme() { this.bandPanel.refreshTheme(); this.scatterPanel.refreshTheme(); }
}

export { getMarketHourly, ZONES };
