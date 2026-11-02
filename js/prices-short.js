// Prices > Short term: today's and tomorrow's day-ahead prices for France and a
// chosen neighbour, with the stats tiles used across the site ("highest since",
// against the 7- and 30-day averages and the same weekday last year).

import { ChartPanel } from "./chart.js";
import {
  ENTSOE, NEIGHBOURS, ZONES, fmtEur, fmtEurDelta, fmtHours, getPriceDaily, getPrices, isPeak, toQuarters
} from "./market-data.js";
import { meanOf } from "./time-explorer.js";
import {
  QUARTER, addDays, copyText, dateKey, fmtDateTime, fmtLongDate, fmtNumber, fmtTime, heroHtml, parisMidnight, todayParis,
  weekdayIndex, writeHash
} from "./util.js";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** "the highest since 12 Feb 2025" / "the lowest since..." for a value on day d in a daily series. */
export function sinceText(rows, key, d, v, minGapDays = 7) {
  const before = rows.filter(r => r.date < d && r[key] != null);
  if (!before.length) return "";
  const higher = [...before].reverse().find(r => r[key] >= v);
  const lower = [...before].reverse().find(r => r[key] <= v);
  const gap = r => (r ? (parisMidnight(d) - parisMidnight(r.date)) / 86400000 : Infinity);
  const first = before[0].date.slice(0, 4);
  if (!higher) return `the highest on record (since ${first})`;
  if (!lower) return `the lowest on record (since ${first})`;
  if (gap(higher) >= minGapDays && gap(higher) >= gap(lower)) return `the highest since ${fmtLongDate(higher.date)}`;
  if (gap(lower) >= minGapDays) return `the lowest since ${fmtLongDate(lower.date)}`;
  return "";
}

export class PriceShort {
  constructor(root) {
    this.root = root;
    this.writesHash = true;
    this.state = { nb: "DE" };
    root.innerHTML = `
      ${heroHtml("Day-ahead prices,", "today and tomorrow.", "The French day-ahead price for today and, once the auction has published (about 13:00 Paris time), tomorrow, set against recent days, last year and a neighbouring market. 15-minute prices since 30 Sep 2025.")}
      <div class="toolbar" role="group" aria-label="Settings"><div class="toolbar-row">
        <label class="field"><span>Neighbour</span><select data-nb>${NEIGHBOURS.map(z => `<option value="${z}">${ZONES[z].name}</option>`).join("")}</select></label>
        <p class="hint" style="margin:0 0 6px">The neighbour sets the parity and spread tiles and the second line on the chart.</p>
      </div></div>
      <div class="headline"><p data-headline>Loading…</p><button class="btn ghost small" type="button" data-copy>Copy</button></div>
      <div class="card-row-label">Price</div>
      <div class="cards" data-cards-a></div>
      <div class="card-row-label">Shape of the day</div>
      <div class="cards" data-cards-b></div>
      <div class="card-row-label">Against the neighbour</div>
      <div class="cards" data-cards-c></div>
      <div data-chart></div>
      <div data-zones></div>`;
    this.headline = root.querySelector("[data-headline]");
    root.querySelector("[data-copy]").addEventListener("click", () => copyText(this.headline.textContent));
    root.querySelector("[data-nb]").addEventListener("change", e => { this.state.nb = e.target.value; this.update(); });
    this.panel = new ChartPanel(root.querySelector("[data-chart]"), { title: "Day-ahead prices", size: "tall", source: ENTSOE });
    this.zonePanel = new ChartPanel(root.querySelector("[data-zones]"), { title: "Baseload by country", size: "short", source: ENTSOE });
  }

  setParams(p) { if (p.has("nb") && ZONES[p.get("nb")]) this.state.nb = p.get("nb"); }

  activate() { this.update(); }

  async update() {
    const nb = this.state.nb;
    this.root.querySelector("[data-nb]").value = nb;
    writeHash("prices/short", { nb });
    try {
      const today = todayParis();
      const tomorrow = addDays(today, 1);
      const [fr, other, daily] = await Promise.all([getPrices("FR", addDays(today, -1), tomorrow), getPrices(nb, addDays(today, -1), tomorrow), getPriceDaily()]);
      const frQ = toQuarters(fr);
      const nbQ = toQuarters(other);
      const hasTomorrow = [...frQ.keys()].some(t => dateKey(t) === tomorrow) && daily.byDate.get(tomorrow)?.FR_base != null;
      const day = hasTomorrow ? tomorrow : today;
      const row = daily.byDate.get(day);
      if (!row || row.FR_base == null) throw new Error("no French prices yet for today");
      const rows = daily.rows;
      const before = n => meanOf(rows.filter(r => r.date < day && r.date >= addDays(day, -n) && r.FR_base != null).map(r => r.FR_base));
      const avg7 = before(7);
      const avg30 = before(30);
      const ly = daily.byDate.get(addDays(day, -364))?.FR_base;
      const prev = daily.byDate.get(addDays(day, -1))?.FR_base;
      const dayQ = [...frQ].filter(([t]) => dateKey(t) === day);
      const hi = dayQ.reduce((a, b) => (!a || b[1] > a[1] ? b : a), null);
      const lo = dayQ.reduce((a, b) => (!a || b[1] < a[1] ? b : a), null);
      const quarters = fr.some(p => dateKey(p.t) === day && p.min === 15);
      const negQ = dayQ.filter(([, v]) => v < 0).length;
      const negHours = row.FR_neg;
      // Parity and spread with the neighbour (15-minute grid, hourly prices repeated).
      let same = 0; let both = 0;
      for (const [t, v] of dayQ) { const o = nbQ.get(t); if (o == null) continue; both += 1; if (Math.abs(v - o) < 0.01) same += 1; }
      const parity = both ? 100 * same / both : null;
      const nbBase = row[`${nb}_base`];
      const spread = nbBase != null ? row.FR_base - nbBase : null;
      const since = sinceText(rows, "FR_base", day, row.FR_base, 7);
      const label = day === today ? "today" : "tomorrow";
      const wd = WEEKDAYS[weekdayIndex(day)];

      const delta = (a, b) => (a != null && b != null ? fmtEurDelta(a - b) : "–");
      const card = (l, v, d = "", c = "") => `<div class="card${c}"><div class="label">${l}</div><div class="value">${v}</div><div class="detail">${d}</div></div>`;
      const nbName = ZONES[nb].name;
      this.root.querySelector("[data-cards-a]").innerHTML = [
        card(`Baseload ${label}`, fmtEur(row.FR_base), `${wd} ${fmtLongDate(day)}${since ? ` · ${since.replace(/^the /, "")}` : ""}`, " accent"),
        card(day === tomorrow ? "vs today" : "vs yesterday", delta(row.FR_base, prev), prev != null ? fmtEur(prev) : ""),
        card("vs 7-day average", delta(row.FR_base, avg7), avg7 != null ? `${fmtEur(avg7)} over the previous 7 days` : ""),
        card("vs 30-day average", delta(row.FR_base, avg30), avg30 != null ? `${fmtEur(avg30)} over the previous 30 days` : ""),
        card("vs same weekday last year", delta(row.FR_base, ly), ly != null ? `${fmtEur(ly)} on ${fmtLongDate(addDays(day, -364))}` : "")
      ].join("");
      this.root.querySelector("[data-cards-b]").innerHTML = [
        card("Peak (Mon–Fri 08–20)", row.FR_peak != null ? fmtEur(row.FR_peak) : "–", row.FR_peak == null ? "No peak hours at the weekend" : ""),
        card("Off-peak", fmtEur(row.FR_off), ""),
        card("Peak minus off-peak", row.FR_peak != null ? fmtEurDelta(row.FR_peak - row.FR_off) : "–", ""),
        card(`Highest ${quarters ? "quarter-hour" : "hour"}`, hi ? fmtEur(hi[1]) : "–", hi ? `${fmtTime(hi[0])}–${fmtTime(hi[0] + QUARTER * (quarters ? 1 : 4))}` : ""),
        card(`Lowest ${quarters ? "quarter-hour" : "hour"}`, lo ? fmtEur(lo[1]) : "–", lo ? `${fmtTime(lo[0])}–${fmtTime(lo[0] + QUARTER * (quarters ? 1 : 4))}` : ""),
        card("Intraday range", hi && lo ? fmtEur(hi[1] - lo[1]) : "–", "Highest minus lowest"),
        card(`Negative prices ${label}`, fmtHours(negHours), negQ ? `${negQ} quarter-hours below zero` : "None")
      ].join("");
      this.root.querySelector("[data-cards-c]").innerHTML = [
        card(`${nbName} baseload`, fmtEur(nbBase), ""),
        card(`France minus ${nbName}`, spread != null ? fmtEurDelta(spread) : "–", spread == null ? "" : spread > 0 ? "France dearer" : spread < 0 ? "France cheaper" : "Same price"),
        card(`Price parity with ${nbName}`, parity != null ? `${fmtNumber(parity, 0)}%` : "–", parity != null ? `Share of ${quarters ? "quarter-hours" : "hours"} at the same price` : "")
      ].join("");

      // Headline.
      const amt = d => `€${fmtNumber(Math.abs(d), 2)}`;
      const vsBits = [];
      if (avg30 != null) vsBits.push(`${amt(row.FR_base - avg30)} ${row.FR_base >= avg30 ? "above" : "below"} the 30-day average`);
      if (ly != null) vsBits.push(`${amt(row.FR_base - ly)} ${row.FR_base >= ly ? "above" : "below"} the same weekday last year`);
      const parts = [`The French day-ahead baseload price for ${label}, ${wd} ${fmtLongDate(day)}, is ${fmtEur(row.FR_base)}${since ? `, ${since}` : ""}.`];
      if (vsBits.length) parts.push(`That is ${vsBits.join(" and ")}.`);
      if (row.FR_peak != null) parts.push(`Peak is ${fmtEur(row.FR_peak)}.`);
      if (negHours > 0) parts.push(`Prices are below zero for ${fmtHours(negHours).replace(" h", negHours === 1 ? " hour" : " hours")}.`);
      this.headline.textContent = parts.join(" ");

      // Chart: yesterday, today and tomorrow.
      const start = parisMidnight(addDays(today, -1));
      const pts = q => [...q].filter(([t]) => t >= start).sort((a, b) => a[0] - b[0]);
      this.panel.setTitle("French and neighbouring day-ahead prices", `${fmtLongDate(addDays(today, -1))} – ${fmtLongDate(hasTomorrow ? tomorrow : today)} · €/MWh`);
      this.panel.render({
        xType: "time", xLabel: x => fmtDateTime(x), yName: "€/MWh", zeroLine: true, source: ENTSOE,
        series: [
          { name: nbName, colour: ZONES[nb].colour, type: "line", data: pts(nbQ), step: "start", width: 1.6, unit: "€/MWh", decimals: 2 },
          { name: "France", colour: "--s-actual", type: "line", data: pts(frQ), step: "start", width: 2.4, unit: "€/MWh", decimals: 2, z: 20 }
        ],
        markAreas: [{ from: parisMidnight(today), to: parisMidnight(tomorrow), label: "Today", colour: "--today" }],
        notes: [hasTomorrow ? "Tomorrow's prices come from the day-ahead auction published at about 13:00 Paris time." : "Tomorrow's prices appear after the day-ahead auction (about 13:00 Paris time).", ZONES[nb].note || ""]
      });

      // Baseload by country for the day, with 7-day averages.
      const zones = Object.keys(ZONES);
      const avg7z = z => meanOf(rows.filter(r => r.date < day && r.date >= addDays(day, -7) && r[`${z}_base`] != null).map(r => r[`${z}_base`]));
      this.zonePanel.setTitle(`Baseload by country, ${label}`, `${fmtLongDate(day)} · €/MWh`);
      this.zonePanel.render({
        xType: "category", categories: zones.map(z => ZONES[z].name), xLabel: x => x, xHeader: "Bidding zone", yName: "€/MWh", yMin: 0, yScale: false, source: ENTSOE,
        series: [
          { name: `Baseload ${label}`, colour: "--s-actual", type: "bar", data: zones.map((z, i) => [i, row[`${z}_base`]]), unit: "€/MWh", decimals: 2, avg: false, barWidth: 26, labels: v => fmtNumber(v, 0), colourFn: (v, i) => ZONES[zones[i]].colour, barColours: i => ZONES[zones[i]].colour },
          { name: "Previous 7-day average", colour: "--s-avg", type: "line", data: zones.map((z, i) => [i, avg7z(z)]), unit: "€/MWh", decimals: 2, dashed: true, avg: false, symbols: true }
        ],
        legendCaption: null
      });
    } catch (error) {
      console.error(error);
      this.headline.textContent = `Prices could not be loaded (${error.message}).`;
    }
  }

  refreshTheme() { this.panel.refreshTheme(); this.zonePanel.refreshTheme(); }
}
