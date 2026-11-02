// A reusable explorer for any time series (prices, generation, flows, capture
// prices, residual demand): period presets, resolutions from 15 minutes to a
// year, comparisons with last year, an N-year average and range, a chosen
// year and a second series, weekday or calendar alignment, a daily profile
// with a weekday/weekend split, a duration curve, a difference view, a
// ranking of the same period in every year, a headline sentence and cards.
//
// A page describes its data with a config:
//   key, hero: [title, accent, text], firstDate, source,
//   subjects: [{value, label}], subjectLabel, compareSubjects (bool),
//   measures: { key: { label, short, unit, decimals, scale, agg, daily(row, subject), intraday?: bool, peak?: "peak"|"off" } },
//   loadDaily(): {byDate}, loadRaw(subject, from, to): [{t, v, min}],
//   defaults: {...}, notes?(state): string[], fmt(v, m), hasQuarters(t): bool
// agg: "mean" (average of days), "sum", "min", "max".

import { ChartPanel } from "./chart.js";
import { setSwitch, switchHtml } from "./nuclear-common.js";
import {
  DAY, HOUR, QUARTER, addDays, copyText, csvDate, csvDateTime, dateKey, dateRange, daysBetween, fmtDate, fmtDateTime,
  fmtFromTo, fmtLongDate, fmtMonth, fmtNumber, fmtPeriod, fromWall, heroHtml, ordinal, parisMidnight, timeKey,
  toWall, todayParis, weekStart, weekdayIndex, writeHash
} from "./util.js";

const RES_LABEL = { "15m": "15-minute", "1h": "hourly", "1d": "daily", "1w": "weekly", "1M": "monthly", "1y": "yearly" };
const LIMIT = { "15m": 62, "1h": 400 };
const PROFILE_LIMIT = 400;

export const PRESETS = [
  ["today", "Today"], ["yesterday", "Yesterday"], ["tomorrow", "Tomorrow"], ["thisweek", "This week"], ["lastweek", "Last week"],
  ["last7", "Last 7 days"], ["last30", "Last 30 days"], ["last90", "Last 90 days"], ["last365", "Last 365 days"],
  ["mtd", "Month to date"], ["lastmonth", "Last month"], ["qtd", "Quarter to date"], ["lastq", "Last quarter"],
  ["q1", "Q1 this year"], ["q2", "Q2 this year"], ["q3", "Q3 this year"], ["q4", "Q4 this year"],
  ["ytd", "Year to date"], ["lastyear", "Last year"], ["gasyear", "Gas year to date (from 1 Oct)"],
  ["winter", "This winter (Oct–Mar)"], ["summer", "This summer (Apr–Sep)"], ["custom", "Custom"]
];

export function presetRange(preset, today = todayParis()) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
  const ym = (yy, mm) => `${yy}-${String(mm).padStart(2, "0")}`;
  const monthEnd = (yy, mm) => addDays(`${ym(mm === 12 ? yy + 1 : yy, mm === 12 ? 1 : mm + 1)}-01`, -1);
  const clip = to => (to > today ? today : to);
  const q = k => [`${ym(y, 3 * k - 2)}-01`, monthEnd(y, 3 * k)];
  const gasStart = m >= 10 ? y : y - 1;
  switch (preset) {
    case "today": return [today, today];
    case "yesterday": return [addDays(today, -1), addDays(today, -1)];
    case "tomorrow": return [addDays(today, 1), addDays(today, 1)];
    case "thisweek": return [weekStart(today), addDays(weekStart(today), 6)];
    case "lastweek": return [addDays(weekStart(today), -7), addDays(weekStart(today), -1)];
    case "last7": return [addDays(today, -6), today];
    case "last30": return [addDays(today, -29), today];
    case "last90": return [addDays(today, -89), today];
    case "last365": return [addDays(today, -364), today];
    case "mtd": return [`${today.slice(0, 7)}-01`, today];
    case "lastmonth": { const [yy, mm] = m === 1 ? [y - 1, 12] : [y, m - 1]; return [`${ym(yy, mm)}-01`, monthEnd(yy, mm)]; }
    case "qtd": return [`${ym(y, qStartMonth)}-01`, today];
    case "lastq": { const [yy, mm] = qStartMonth === 1 ? [y - 1, 10] : [y, qStartMonth - 3]; return [`${ym(yy, mm)}-01`, monthEnd(yy, mm + 2)]; }
    case "q1": case "q2": case "q3": case "q4": { const [a, b] = q(Number(preset[1])); return [a, clip(b)]; }
    case "ytd": return [`${y}-01-01`, today];
    case "lastyear": return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    case "gasyear": return [`${gasStart}-10-01`, today];
    case "winter": { const s = m >= 10 ? y : m <= 3 ? y - 1 : y; return [`${s}-10-01`, clip(`${s + 1}-03-31`)]; }
    case "summer": { const s = m >= 4 ? y : y - 1; return [`${s}-04-01`, clip(`${s}-09-30`)]; }
    default: return null;
  }
}

/** Same Paris wall-clock moment k years earlier: calendar date, or 364 days a year for weekday alignment. */
function shiftT(t, k, align) {
  if (align === "wd") return fromWall(toWall(t) - 364 * k * DAY);
  const d = dateKey(t);
  const y = Number(d.slice(0, 4)) - k;
  if (d.slice(5) === "02-29" && !((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) return null;
  const src = `${y}${d.slice(4)}`;
  return fromWall(toWall(parisMidnight(src)) + (toWall(t) - toWall(parisMidnight(d))));
}
function shiftD(d, k, align) {
  if (align === "wd") return addDays(d, -364 * k);
  const y = Number(d.slice(0, 4)) - k;
  if (d.slice(5) === "02-29" && !((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) return null;
  return `${y}${d.slice(4)}`;
}

const meanOf = vs => (vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null);
function aggregate(values, agg, weights) {
  if (agg === "wmean" && weights) {
    let sum = 0; let w = 0;
    values.forEach((v, i) => { const wi = weights[i]; if (v != null && Number.isFinite(v) && wi > 0) { sum += v * wi; w += wi; } });
    return w > 0 ? sum / w : null;
  }
  const vs = values.filter(v => v != null && Number.isFinite(v));
  if (!vs.length) return null;
  if (agg === "sum") return vs.reduce((a, b) => a + b, 0);
  if (agg === "min") return Math.min(...vs);
  if (agg === "max") return Math.max(...vs);
  return meanOf(vs);
}

export class TimeExplorer {
  constructor(root, cfg) {
    this.root = root;
    this.cfg = cfg;
    this.writesHash = true;
    this.state = this.defaults();
    this.renderId = 0;
    this.build();
    this.applyPreset();
  }

  defaults() {
    return {
      preset: "last30", from: "", to: "", res: "1d", measure: Object.keys(this.cfg.measures)[0],
      subject: this.cfg.subjects[0].value, cmp: "", ly: "1", avg: "1", band: "0", n: "5", yr: "", align: "auto",
      view: "series", split: "all", diff: "0", ref: "ly", subjects: "", stack: "0", gap: "0", hs: "0", ev: "0", ...this.cfg.defaults
    };
  }

  setParams(params) {
    const state = this.defaults();
    for (const key of Object.keys(state)) if (params.has(key)) state[key] = params.get(key);
    this.state = state;
    if (state.preset !== "custom" || !state.from) this.applyPreset();
    this.syncControls();
  }

  /** Take a period chosen on another tab of the same page. */
  applyPeriod(p) {
    if (!p || (p.preset === this.state.preset && p.from === this.state.from && p.to === this.state.to)) return;
    Object.assign(this.state, { preset: p.preset, from: p.from, to: p.to });
    if (p.preset !== "custom") this.applyPreset();
    this.syncControls();
  }

  applyPreset() {
    const range = presetRange(this.state.preset);
    if (range) [this.state.from, this.state.to] = range;
    if (this.state.preset !== "custom") {
      const days = daysBetween(this.state.from, this.state.to) + 1;
      // Sensible resolution for the preset.
      const res = this.state.res;
      if (days <= 3 && ["1d", "1w", "1M", "1y"].includes(res)) this.state.res = this.cfg.fine || "1h";
      else if (days > 400 && ["15m", "1h"].includes(res)) this.state.res = "1d";
      else if (days > 62 && res === "15m") this.state.res = "1h";
    }
    this.syncControls();
  }

  chip(key, label, colour) {
    return `<button class="chip" type="button" data-chip="${key}" style="color:var(${colour})"><span class="swatch"></span><span class="chip-label">${label}</span></button>`;
  }

  build() {
    const c = this.cfg;
    const thisYear = Number(todayParis().slice(0, 4));
    const firstYear = Number(c.firstDate.slice(0, 4));
    const years = [];
    for (let y = thisYear - 1; y >= firstYear; y--) years.push(y);
    this.root.innerHTML = `
      ${heroHtml(...c.hero)}
      ${c.intro || ""}
      <div class="toolbar" role="group" aria-label="Explorer settings">
        ${c.multi ? `<div class="toolbar-row"><div class="field field-wide"><span>${c.subjectLabel} <em class="field-note">tick one or more</em></span><div class="chips" data-subjects>
          ${c.subjects.filter(x => !x.sub).map(x => this.subjChip(x)).join("")}
          <span class="chips" data-subs>${c.subjects.filter(x => x.sub).map(x => this.subjChip(x)).join("")}</span>
          <span class="chip-actions"><button type="button" class="link" data-all>${c.allLabel || "All"}</button><button type="button" class="link" data-none>Clear</button></span>
          ${c.splitLabel ? `<label class="check"><input type="checkbox" data-hs> ${c.splitLabel}</label>` : ""}
        </div></div>
        <div class="field" data-multi-only><span>Lines</span>${switchHtml("data-stack", "Separate", "Stacked")}</div>
        <div class="field" data-gap-field><span>Two selected</span><label class="check"><input type="checkbox" data-gap> Show gap over time</label></div>
        </div>` : ""}
        <div class="toolbar-row">
          ${c.multi ? "" : `<label class="field"><span>${c.subjectLabel}</span><select data-k="subject">${c.subjects.map(s => `<option value="${s.value}">${s.label}</option>`).join("")}</select></label>`}
          <label class="field"><span>Measure</span><select data-k="measure">${Object.entries(c.measures).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join("")}</select></label>
          <label class="field"><span>Period</span><select data-k="preset">${PRESETS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
          <label class="field"><span>From</span><input type="date" data-k="from" min="${c.firstDate}"></label>
          <label class="field"><span>To</span><input type="date" data-k="to" min="${c.firstDate}"></label>
          <label class="field"><span>Resolution</span>
            <select data-k="res">${(c.resolutions || ["15m", "1h", "1d", "1w", "1M", "1y"]).map(r => `<option value="${r}">${r === "15m" ? "15 minutes" : RES_LABEL[r][0].toUpperCase() + RES_LABEL[r].slice(1)}</option>`).join("")}</select>
          </label>
          <div class="field"><span>View</span><div class="chips">
            <label class="check"><input type="checkbox" data-view="profile"> Show daily profile</label>
            <label class="check"><input type="checkbox" data-view="duration"> Duration curve</label>
          </div></div>
          <label class="field" data-split-field><span>Days</span>
            <select data-k="split"><option value="all">All days</option><option value="wd">Weekdays</option><option value="we">Weekends</option><option value="both">Weekdays and weekends</option></select>
          </label>
        </div>
        <div class="toolbar-row">
          <div class="field"><span>Compare with</span>
            <div class="chips">
              ${this.chip("ly", "Last year", "--s-ly")}
              ${this.chip("avg", "Average of previous", "--s-avg")}
              <select data-k="n" aria-label="Number of previous years" class="compact">${[2, 3, 5, 8, 10].map(n => `<option value="${n}">${n} years</option>`).join("")}</select>
              ${this.chip("band", "Min–max range", "--s-avg")}
              <select data-k="yr" aria-label="A chosen year" class="compact"><option value="">A chosen year…</option>${years.map(y => `<option value="${y}">${y}</option>`).join("")}</select>
              ${c.events ? this.chip("ev", "Events", "--muted") : ""}
              ${c.compareSubjects && !c.multi ? `<select data-k="cmp" aria-label="Second ${c.subjectLabel.toLowerCase()}" class="compact"><option value="">${c.compareLabel || "Another series…"}</option>${c.subjects.map(s => `<option value="${s.value}">${s.label}</option>`).join("")}</select>` : ""}
            </div>
          </div>
          <div class="field"><span>Align earlier years by</span>${switchHtml("data-align", "Weekday", "Calendar date")}</div>
          <div class="field"><span>Show as</span>${switchHtml("data-diff", "Values", "Difference")}</div>
          <label class="field" data-ref-field><span>Difference from</span>
            <select data-k="ref"><option value="ly">Last year</option><option value="avg">Earlier-years average</option>${c.compareSubjects ? '<option value="cmp">Second series</option>' : ""}<option value="yr">Chosen year</option></select>
          </label>
        </div>
        <p class="hint" data-hint></p>
      </div>
      <div class="headline"><p data-headline>Loading…</p><button class="btn ghost small" type="button" data-copy title="Copy this sentence">Copy</button></div>
      <div class="cards" data-cards>${'<div class="card skeleton"></div>'.repeat(5)}</div>
      <div data-chart></div>
      <div data-mtable></div>
      <div data-rank></div>`;
    this.headline = this.root.querySelector("[data-headline]");
    this.cards = this.root.querySelector("[data-cards]");
    this.mtable = this.root.querySelector("[data-mtable]");
    this.panel = new ChartPanel(this.root.querySelector("[data-chart]"), { title: "", size: "tall", overview: true, source: c.source });
    this.rankPanel = new ChartPanel(this.root.querySelector("[data-rank]"), { title: "The same period in every year", size: "short", source: c.source });
    this.root.querySelector("[data-copy]").addEventListener("click", () => copyText(this.headline.textContent));
    this.root.querySelectorAll("[data-k]").forEach(input => input.addEventListener("change", () => {
      const key = input.dataset.k;
      this.state[key] = input.value;
      if (key === "preset" && input.value !== "custom") this.applyPreset();
      if (key === "from" || key === "to") this.state.preset = "custom";
      if (this.state.from > this.state.to) [this.state.from, this.state.to] = [this.state.to, this.state.from];
      if (key === "res" && this.state.align !== "auto") this.state.align = "auto";
      this.syncControls();
      this.update();
    }));
    this.root.querySelectorAll("[data-chip]").forEach(chip => chip.addEventListener("click", () => {
      const key = chip.dataset.chip;
      this.state[key] = this.state[key] === "1" ? "0" : "1";
      this.syncControls();
      this.update();
    }));
    this.root.querySelector("[data-align]").addEventListener("click", () => {
      this.state.align = this.align() === "wd" ? "cal" : "wd";
      this.syncControls();
      this.update();
    });
    this.root.querySelectorAll("[data-view]").forEach(box => box.addEventListener("change", () => {
      this.state.view = box.checked ? box.dataset.view : "series";
      this.syncControls();
      this.update();
    }));
    if (c.multi) {
      this.root.querySelectorAll("[data-subj]").forEach(chip => chip.addEventListener("click", () => {
        const list = this.subjects();
        const v = chip.dataset.subj;
        const next = list.includes(v) ? list.filter(x => x !== v) : [...list, v];
        this.setSubjects(next.length ? next : [v]);
      }));
      this.root.querySelector("[data-all]").addEventListener("click", () => this.setSubjects(this.allSubjects()));
      this.root.querySelector("[data-none]").addEventListener("click", () => this.setSubjects([this.subjects()[0]]));
      this.root.querySelector("[data-hs]")?.addEventListener("change", e => {
        this.state.hs = e.target.checked ? "1" : "0";
        const list = this.subjects();
        const [grp, parts] = [c.splitOf, c.subjects.filter(x => x.sub).map(x => x.value)];
        this.setSubjects(this.state.hs === "1" ? list.flatMap(x => (x === grp ? parts : [x])) : [...new Set(list.map(x => (parts.includes(x) ? grp : x)))]);
      });
      this.root.querySelector("[data-stack]").addEventListener("click", () => { this.state.stack = this.state.stack === "1" ? "0" : "1"; this.syncControls(); this.update(); });
      this.root.querySelector("[data-gap]").addEventListener("change", e => { this.state.gap = e.target.checked ? "1" : "0"; this.update(); });
    }
    this.root.querySelector("[data-diff]").addEventListener("click", () => {
      this.state.diff = this.state.diff === "1" ? "0" : "1";
      this.syncControls();
      this.update();
    });
  }

  /** Weekday alignment for daily or finer views, calendar for weekly and up, unless switched. */
  align() {
    if (this.state.align === "wd" || this.state.align === "cal") return this.state.align;
    return ["1w", "1M", "1y"].includes(this.state.res) && this.state.view === "series" ? "cal" : "wd";
  }

  syncControls() {
    const s = this.state;
    this.root.querySelectorAll("[data-k]").forEach(input => {
      if (input.type === "date" || input.querySelector?.(`option[value="${CSS.escape(s[input.dataset.k])}"]`)) input.value = s[input.dataset.k];
    });
    this.root.querySelectorAll("[data-chip]").forEach(chip => chip.setAttribute("aria-pressed", s[chip.dataset.chip] === "1"));
    setSwitch(this.root.querySelector("[data-align]"), this.align() === "cal");
    setSwitch(this.root.querySelector("[data-diff]"), s.diff === "1");
    const diff = s.diff === "1";
    this.root.querySelector("[data-ref-field]").classList.toggle("hidden", !diff);
    this.root.querySelector("[data-split-field]").classList.toggle("hidden", s.view !== "profile");
    this.root.querySelectorAll("[data-view]").forEach(box => { box.checked = s.view === box.dataset.view; });
    if (this.cfg.multi) {
      const list = this.subjects();
      this.root.querySelectorAll("[data-subj]").forEach(chip => chip.setAttribute("aria-pressed", list.includes(chip.dataset.subj)));
      const split = s.hs === "1";
      this.root.querySelector("[data-subs]").hidden = !split;
      const grpChip = this.root.querySelector(`[data-subj="${this.cfg.splitOf}"]`);
      if (grpChip) grpChip.hidden = split;
      const hs = this.root.querySelector("[data-hs]");
      if (hs) hs.checked = split;
      const multi = list.length > 1;
      this.root.querySelector("[data-multi-only]").classList.toggle("hidden", !multi);
      this.root.querySelector("[data-gap-field]").classList.toggle("hidden", list.length !== 2 || s.view !== "series");
      this.root.querySelector("[data-gap]").checked = s.gap === "1";
      setSwitch(this.root.querySelector("[data-stack]"), s.stack === "1");
      this.root.querySelectorAll('[data-chip="ly"], [data-chip="avg"], [data-chip="band"], [data-k="yr"]').forEach(x => { x.disabled = multi && (x.dataset.chip === "band" || x.dataset.k === "yr"); });
      this.root.querySelector("[data-diff]").disabled = multi || s.view !== "series";
    }
    this.root.querySelector('[data-k="res"]').disabled = s.view !== "series";
    this.root.querySelector('[data-chip="band"]').disabled = diff || s.view === "duration";
    if (!this.cfg.multi) this.root.querySelector("[data-diff]").disabled = s.view !== "series";
    const m = this.cfg.measures[s.measure];
    this.root.querySelector("[data-hint]").textContent = s.view === "profile"
      ? "Daily profile: the average for each time of day over the period, Paris time."
      : s.view === "duration" ? "Duration curve: every period sorted from highest to lowest, so you can read how much of the time a level was reached."
        : m?.hint || this.cfg.hint || "Tip: drag across the chart to zoom; double-click to zoom out. Click a legend entry to hide it.";
  }

  activate() {
    this.update();
  }

  measure() {
    return this.cfg.measures[this.state.measure];
  }

  subjChip(x) {
    return `<button class="chip" type="button" data-subj="${x.value}" style="color:var(${x.colour || "--s-actual"})"><span class="swatch"></span><span class="chip-label">${x.label}</span></button>`;
  }

  /** Ticked subjects (multi mode), falling back to the single subject. */
  subjects() {
    const valid = new Set(this.cfg.subjects.map(x => x.value));
    const list = (this.state.subjects || "").split(",").filter(v => valid.has(v));
    return list.length ? list : [this.state.subject];
  }

  allSubjects() {
    const split = this.state.hs === "1";
    return this.cfg.subjects.filter(x => (x.inAll ?? true) && (split ? x.value !== this.cfg.splitOf : !x.sub)).map(x => x.value);
  }

  setSubjects(list) {
    this.state.subjects = list.join(",");
    this.state.subject = list[0];
    if (list.length !== 2) this.state.gap = "0";
    this.syncControls();
    this.update();
  }

  subjectLabel(v) {
    return this.cfg.subjects.find(s => s.value === v)?.label || v;
  }

  fmt(v) {
    return this.cfg.fmt(v, this.measure());
  }

  fmtDelta(d) {
    const m = this.measure();
    if (d == null) return "–";
    const sign = d > 0 ? "+" : d < 0 ? "−" : "";
    return `${sign}${this.cfg.fmt(Math.abs(d), m, { bare: false })}`;
  }

  /** Earlier years to load: list of k (years back). */
  comparisonYears(from) {
    const s = this.state;
    const ks = new Set();
    const n = Number(s.n);
    if (s.ly === "1" || (s.diff === "1" && s.ref === "ly")) ks.add(1);
    if (s.avg === "1" || s.band === "1" || (s.diff === "1" && s.ref === "avg")) for (let k = 1; k <= n; k++) ks.add(k);
    if (s.yr) ks.add(Number(from.slice(0, 4)) - Number(s.yr));
    const first = this.cfg.firstDate;
    return [...ks].filter(k => k > 0 && addDays(from, -365 * k) >= addDays(first, -366)).sort((a, b) => a - b);
  }

  yearsLabel(from) {
    const n = Number(this.state.n);
    const y = Number(from.slice(0, 4));
    return from.slice(0, 4) !== this.state.to.slice(0, 4) ? `previous ${n} years` : `${y - n}–${String(y - 1).slice(-2)}`;
  }

  async update() {
    const id = ++this.renderId;
    const s = this.state;
    writeHash(this.cfg.key, s);
    this.panel.setLoading(true);
    this.headline.textContent = "Loading…";
    try {
      const notes = [];
      const from = s.from < this.cfg.firstDate ? this.cfg.firstDate : s.from;
      const to = this.cfg.lastDate ? (s.to > this.cfg.lastDate() ? this.cfg.lastDate() : s.to) : s.to;
      if (to < s.to) notes.push(`Data runs to ${fmtLongDate(to)}.`);
      if (from > to) throw new Error("no data for this period");
      let result;
      const multi = this.cfg.multi && this.subjects().length > 1;
      if (multi) result = await this.buildMulti(from, to, notes);
      else if (s.view === "profile" || s.view === "duration") result = await this.buildShape(from, to, notes);
      else {
        const days = daysBetween(from, to) + 1;
        let res = s.res;
        const m = this.measure();
        if ((res === "15m" || res === "1h") && m.intraday === false) { res = "1d"; notes.push(`${m.label} is a daily measure, so it is shown daily.`); }
        if (LIMIT[res] && days > LIMIT[res]) {
          const next = res === "15m" && days <= LIMIT["1h"] ? "1h" : "1d";
          notes.push(`${RES_LABEL[res][0].toUpperCase() + RES_LABEL[res].slice(1)} views are limited to ${LIMIT[res]} days, so this period is shown ${RES_LABEL[next]}.`);
          res = next;
        }
        result = res === "15m" || res === "1h" ? await this.buildIntraday(from, to, res, notes) : await this.buildDaily(from, to, res, notes);
      }
      if (id !== this.renderId) return;
      for (const n of this.cfg.notes?.(s, from, to) || []) notes.push(n);
      this.panel.setTitle(result.title, result.subtitle);
      this.panel.render(result.spec);
      this.mtable.innerHTML = "";
      if (multi) {
        this.renderMultiSummary(result.summary, from, to);
        this.rankPanel.show(false);
      } else {
        this.cards.hidden = false;
        this.renderSummary(result.summary, from, to);
        if (s.view === "series") await this.renderRanking(from, to, id); else this.rankPanel.show(false);
      }
    } catch (error) {
      console.error(error);
      if (id === this.renderId) {
        this.headline.textContent = `The data could not be loaded (${error.message}).`;
        this.cards.innerHTML = "";
        this.panel.setLoading(false);
      }
    }
  }

  // ---------- Daily and coarser ----------

  dailyValue(table, d, subject) {
    const row = table.byDate.get(d);
    return row ? this.measure().daily(row, subject, d) : null;
  }

  groupKey(d, res) {
    return res === "1w" ? weekStart(d) : res === "1M" ? `${d.slice(0, 7)}-01` : res === "1y" ? `${d.slice(0, 4)}-01-01` : d;
  }

  group(map, res, agg) {
    if (res === "1d") return map;
    const acc = new Map();
    for (const [d, v] of map) {
      const k = this.groupKey(d, res);
      if (!acc.has(k)) acc.set(k, [[], []]);
      acc.get(k)[0].push(v);
      acc.get(k)[1].push(map.weights?.get(d));
    }
    return new Map([...acc].map(([k, [vs, ws]]) => [k, aggregate(vs, agg, ws)]));
  }

  async buildDaily(from, to, res, notes) {
    const s = this.state;
    const m = this.measure();
    const table = await this.cfg.loadDaily();
    const align = this.align();
    const dates = dateRange(from, to);
    const series = (subject, k = 0) => {
      const map = new Map();
      if (m.weight) map.weights = new Map();
      for (const d of dates) {
        const src = k ? shiftD(d, k, align) : d;
        const v = src ? this.dailyValue(table, src, subject) : null;
        if (v != null) {
          map.set(d, v);
          if (m.weight) map.weights.set(d, m.weight(table.byDate.get(src), subject));
        }
      }
      return map;
    };
    const actual = series(s.subject);
    const ks = this.comparisonYears(from);
    const perYear = new Map(ks.map(k => [k, series(s.subject, k)]));
    const cmp = s.cmp && s.cmp !== s.subject ? series(s.cmp) : null;
    return this.assemble({ from, to, res, notes, actual, perYear, cmp, agg: m.agg || "mean", keyX: k => parisMidnight(k), daily: true });
  }

  // ---------- 15-minute and hourly ----------

  async raw(subject, from, to, res) {
    const pts = await this.cfg.loadRaw(subject, from, to, this.state.measure);
    const map = new Map();
    const m = this.measure();
    const keep = m.peak ? t => this.cfg.isPeak(t) === (m.peak === "peak") : null;
    if (res === "15m") {
      for (const p of pts) {
        if (p.v == null) continue;
        for (let q = 0; q < Math.max(1, p.min / 15); q++) {
          const t = p.t + q * QUARTER;
          if (!keep || keep(t)) map.set(t, p.v);
        }
      }
    } else {
      const acc = new Map();
      for (const p of pts) {
        if (p.v == null) continue;
        const h = Math.floor(p.t / HOUR) * HOUR;
        const a = acc.get(h) || [0, 0];
        a[0] += p.v * p.min;
        a[1] += p.min;
        acc.set(h, a);
      }
      for (const [h, [sum, mins]] of acc) if (mins >= 59 && (!keep || keep(h))) map.set(h, sum / mins);
    }
    return map;
  }

  async buildIntraday(from, to, res, notes) {
    const s = this.state;
    const align = this.align();
    const actual = await this.raw(s.subject, from, to, res);
    const ks = this.comparisonYears(from);
    const perYear = new Map();
    for (const k of ks) {
      const src = await this.raw(s.subject, shiftD(from, k, align) || addDays(shiftD(addDays(from, 1), k, align), -1), shiftD(to, k, align) || shiftD(addDays(to, -1), k, align), res);
      const map = new Map();
      const step = res === "15m" ? QUARTER : HOUR;
      for (let t = parisMidnight(from); t < parisMidnight(addDays(to, 1)); t += step) {
        const st = shiftT(t, k, align);
        const v = st != null ? src.get(st) : null;
        if (v != null) map.set(t, v);
      }
      perYear.set(k, map);
    }
    const cmp = s.cmp && s.cmp !== s.subject ? await this.raw(s.cmp, from, to, res) : null;
    if (res === "15m" && this.cfg.hasQuarters && !this.cfg.hasQuarters(parisMidnight(from))) notes.push(this.cfg.quarterNote || "Before 15-minute data, each hourly value is repeated across its four quarter-hours.");
    return this.assemble({ from, to, res, notes, actual, perYear, cmp, agg: "mean", keyX: k => k, daily: false });
  }

  /** Combine actual, comparisons and options into a chart spec and summary. */
  assemble({ from, to, res, notes, actual, perYear, cmp, agg, keyX, daily }) {
    const s = this.state;
    const m = this.measure();
    const sc = m.scale || 1;
    const n = Number(s.n);
    const g = map => (daily ? this.group(map, res, agg) : map);
    const A = g(actual);
    const years = new Map([...perYear].map(([k, map]) => [k, g(map)]));
    const keys = [...new Set([...A.keys(), ...[...years.values()].flatMap(mp => [...mp.keys()])])].sort((a, b) => (a < b ? -1 : 1));
    const ly = years.get(1) || new Map();
    const avg = new Map();
    const band = new Map();
    for (const key of keys) {
      const vals = [];
      for (let k = 1; k <= n; k++) { const v = years.get(k)?.get(key); if (v != null) vals.push(v); }
      if (vals.length) avg.set(key, meanOf(vals));
      if (vals.length >= 2) band.set(key, [Math.min(...vals), Math.max(...vals)]);
    }
    const yrK = s.yr ? Number(from.slice(0, 4)) - Number(s.yr) : null;
    const yrMap = yrK ? years.get(yrK) || new Map() : null;
    const C = cmp ? g(cmp) : null;
    const pts = map => [...map].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [keyX(k), v / sc]);
    const unit = m.unit;
    const decimals = m.decimals ?? 1;
    const markers = daily && res !== "1d" ? true : undefined;
    const yLabel = this.yearsLabel(from);
    const thisYear = from.slice(0, 4);
    const sameYear = thisYear === to.slice(0, 4);
    const subj = this.subjectLabel(s.subject);
    const series = [];
    let yName = unit;
    const diff = s.diff === "1";
    if (diff) {
      const ref = s.ref === "avg" ? avg : s.ref === "cmp" ? C : s.ref === "yr" ? yrMap : ly;
      const refName = s.ref === "avg" ? `the ${yLabel} average` : s.ref === "cmp" ? this.subjectLabel(s.cmp) : s.ref === "yr" ? s.yr : "last year";
      if (!ref) throw new Error("choose the comparison to measure the difference from");
      const d = [...A].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => {
        const r = ref.get(k);
        return r == null ? null : [keyX(k), (v - r) / sc];
      }).filter(Boolean);
      series.push({ name: `${subj} vs ${refName}`, colour: "--s-actual", type: daily ? "bar" : "line", data: d, unit, decimals, width: 1.6, colourFn: v => (v >= 0 ? "--s-actual" : "--s-d1") });
    } else {
      if (s.band === "1" && band.size) series.push({ name: `Range ${yLabel}`, colour: "--s-band", type: "band", data: [...band].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, [lo, hi]]) => [keyX(k), lo / sc, hi / sc]), unit, decimals });
      if (s.avg === "1" && avg.size) series.push({ name: `Average ${yLabel}`, colour: "--s-avg", type: "line", data: pts(avg), dashed: true, width: 1.6, unit, decimals, symbols: markers });
      if (s.ly === "1" && ly.size) series.push({ name: sameYear ? `Last year (${Number(thisYear) - 1})` : "One year earlier", colour: "--s-ly", type: "line", data: pts(ly), width: 1.5, unit, decimals, symbols: markers });
      if (yrMap?.size) series.push({ name: `Same period in ${s.yr}`, colour: "--s-d1", type: "line", data: pts(yrMap), width: 1.5, unit, decimals, symbols: markers });
      if (C?.size) series.push({ name: this.subjectLabel(s.cmp), colour: "--s-id", type: "line", data: pts(C), width: 1.8, unit, decimals, z: 18, symbols: markers });
      series.push({ name: subj, colour: "--s-actual", type: "line", data: pts(A), width: 2.4, unit, decimals, z: 20, symbols: markers, step: !daily && this.cfg.step ? "start" : undefined });
    }
    if (perYear.size) notes.push(this.align() === "wd" ? "Earlier years are matched by weekday (364 days earlier per year), so weekends line up." : "Earlier years use the same calendar dates.");
    if (daily && res !== "1d") notes.push(`Each point is the ${agg === "sum" ? "total" : agg === "max" ? "highest" : agg === "min" ? "lowest" : "average"} of the days in that ${res === "1w" ? "week" : res === "1M" ? "month" : "year"} inside the period.`);
    const xLabel = !daily ? x => fmtDateTime(x) : res === "1M" ? x => fmtMonth(x) : res === "1y" ? x => dateKey(x).slice(0, 4) : res === "1w" ? x => `Week of ${fmtDate(x)}` : x => fmtDate(x);
    // Values keyed by day for the summary.
    const byDay = map => {
      if (daily) return map;
      const acc = new Map();
      for (const [t, v] of map) { const d = dateKey(t); if (!acc.has(d)) acc.set(d, []); acc.get(d).push(v); }
      return new Map([...acc].map(([d, vs]) => [d, meanOf(vs)]));
    };
    return {
      title: `${m.label}${this.cfg.subjects.length > 1 ? ` · ${subj}` : ""}, ${RES_LABEL[res]}${diff ? " (difference)" : ""}`,
      subtitle: `${fmtPeriod(from, to)} · ${unit}`,
      spec: {
        xType: "time", xLabel, csvLabel: daily ? csvDate : csvDateTime, axisLabel: res === "1M" ? x => fmtMonth(x) : res === "1y" ? x => dateKey(x).slice(0, 4) : undefined,
        xHeader: daily ? (res === "1M" ? "Month" : res === "1w" ? "Week starting" : res === "1y" ? "Year" : "Date") : "Time (Europe/Paris)",
        yName, series, zeroLine: diff || m.zeroLine, yFormat: v => fmtNumber(v, Number.isInteger(v) ? 0 : 1), notes,
        events: s.ev === "1" && this.cfg.events ? this.cfg.events(from, to) : [],
        yMin: m.yMin
      },
      summary: { actual: byDay(actual), perYear: new Map([...perYear].map(([k, mp]) => [k, byDay(mp)])), cmp: cmp ? byDay(cmp) : null, raw: daily ? null : actual, agg }
    };
  }

  // ---------- Daily profile and duration curve ----------

  async buildShape(from, to, notes) {
    const s = this.state;
    const m = this.measure();
    if (m.intraday === false) throw new Error(`${m.label} has no time-of-day detail; choose another measure or the "Over time" view`);
    const days = daysBetween(from, to) + 1;
    if (days > PROFILE_LIMIT) {
      from = addDays(to, -(PROFILE_LIMIT - 1));
      notes.push(`Profiles and duration curves use at most ${PROFILE_LIMIT} days, so this shows ${fmtPeriod(from, to)}.`);
    }
    const quarters = this.cfg.hasQuarters?.(parisMidnight(from)) && days <= 120;
    const res = quarters ? "15m" : "1h";
    const align = this.align();
    const load = async (subject, k) => {
      if (!k) return this.raw(subject, from, to, res);
      const a = shiftD(from, k, align) || shiftD(addDays(from, 1), k, align);
      const b = shiftD(to, k, align) || shiftD(addDays(to, -1), k, align);
      return this.raw(subject, a, b, quarters ? "1h" : res);
    };
    const sets = [{ name: this.subjectLabel(s.subject), colour: "--s-actual", map: await load(s.subject, 0), width: 2.4, z: 20 }];
    const ks = this.comparisonYears(from);
    const n = Number(s.n);
    const yLabel = this.yearsLabel(from);
    const comp = new Map();
    for (const k of ks) comp.set(k, await load(s.subject, k));
    if (s.ly === "1" && comp.get(1)) sets.push({ name: "Last year", colour: "--s-ly", map: comp.get(1), width: 1.5 });
    if (s.yr && comp.get(Number(from.slice(0, 4)) - Number(s.yr))) sets.push({ name: s.yr, colour: "--s-d1", map: comp.get(Number(from.slice(0, 4)) - Number(s.yr)), width: 1.5 });
    if (s.cmp && s.cmp !== s.subject) sets.push({ name: this.subjectLabel(s.cmp), colour: "--s-id", map: await load(s.cmp, 0), width: 1.8, z: 18 });
    const sc = m.scale || 1;
    const unit = m.unit;
    const decimals = m.decimals ?? 1;
    const series = [];
    const isWeekend = t => weekdayIndex(dateKey(t)) >= 5;
    if (s.view === "profile") {
      const slot = t => { const w = new Date(toWall(t)); return w.getUTCHours() * 60 + w.getUTCMinutes(); };
      const step = quarters ? 15 : 60;
      const profile = (map, filter) => {
        const acc = new Map();
        for (const [t, v] of map) {
          if (filter && !filter(t)) continue;
          const k = Math.floor(slot(t) / step) * step;
          const a = acc.get(k) || [0, 0];
          a[0] += v; a[1] += 1;
          acc.set(k, a);
        }
        return [...acc].sort((a, b) => a[0] - b[0]).map(([k, [sum, c]]) => [k, sum / c / sc]);
      };
      const filters = s.split === "wd" ? [[t => !isWeekend(t), ""]] : s.split === "we" ? [[isWeekend, ""]] : s.split === "both" ? [[t => !isWeekend(t), " (weekdays)"], [isWeekend, " (weekends)"]] : [[null, ""]];
      if (s.avg === "1" || s.band === "1") {
        const profs = [...comp].filter(([k]) => k <= n).map(([, mp]) => new Map(profile(mp, filters[0][0])));
        const slots = [...new Set(profs.flatMap(p => [...p.keys()]))].sort((a, b) => a - b);
        const avgPts = slots.map(k => [k, meanOf(profs.map(p => p.get(k)).filter(v => v != null))]);
        if (s.band === "1" && profs.length >= 2) series.push({ name: `Range ${yLabel}`, colour: "--s-band", type: "band", data: slots.map(k => { const vs = profs.map(p => p.get(k)).filter(v => v != null); return [k, Math.min(...vs), Math.max(...vs)]; }), unit, decimals });
        if (s.avg === "1" && profs.length) series.push({ name: `Average ${yLabel}`, colour: "--s-avg", type: "line", data: avgPts, dashed: true, width: 1.6, unit, decimals });
      }
      for (const set of sets.slice().reverse()) {
        filters.forEach(([f, suffix], i) => series.push({ name: set.name + suffix, colour: set.colour, type: "line", data: profile(set.map, f), width: set.width, z: set.z, dash: i ? [2, 3] : undefined, unit, decimals }));
      }
      const hhmm = k => `${String(Math.floor(k / 60)).padStart(2, "0")}:${String(k % 60).padStart(2, "0")}`;
      notes.push(`Average for each ${quarters ? "quarter-hour" : "hour"} of the day, Paris time${s.split === "both" ? "; dotted lines are weekends" : ""}.`);
      return {
        title: `${m.label}: daily profile${this.cfg.subjects.length > 1 ? ` · ${this.subjectLabel(s.subject)}` : ""}`,
        subtitle: `${fmtPeriod(from, to)} · ${unit}`,
        spec: { xType: "value", xMin: 0, xMax: 1440 - step, xLabel: hhmm, axisLabel: hhmm, xHeader: "Time of day (Paris)", yName: unit, series, notes, zeroLine: m.zeroLine, yFormat: v => fmtNumber(v, Number.isInteger(v) ? 0 : 1), xInterval: 180 },
        summary: { actual: this.dayMeans(sets[0].map), perYear: new Map([...comp].map(([k, mp]) => [k, this.dayMeans(mp, k)])), cmp: null, raw: sets[0].map, agg: "mean" }
      };
    }
    // Duration curve: x = share of the time (%).
    const curve = map => {
      const vs = [...map.values()].sort((a, b) => b - a);
      const step = Math.max(1, Math.floor(vs.length / 1500));
      const out = [];
      for (let i = 0; i < vs.length; i += step) out.push([(100 * i) / Math.max(1, vs.length - 1), vs[i] / sc]);
      if (vs.length) out.push([100, vs.at(-1) / sc]);
      return out;
    };
    if (s.avg === "1") {
      const vs = [...comp].filter(([k]) => k <= n).map(([, mp]) => curve(mp));
      if (vs.length) {
        const grid = Array.from({ length: 201 }, (_, i) => i / 2);
        const at = (c, x) => { const i = c.findIndex(p => p[0] >= x); return i < 0 ? c.at(-1)?.[1] : c[i][1]; };
        series.push({ name: `Average ${yLabel}`, colour: "--s-avg", type: "line", data: grid.map(x => [x, meanOf(vs.map(c => at(c, x)).filter(v => v != null))]), dashed: true, width: 1.6, unit, decimals });
      }
    }
    for (const set of sets.slice().reverse()) series.push({ name: set.name, colour: set.colour, type: "line", data: curve(set.map), width: set.width, z: set.z, unit, decimals });
    notes.push(`Each line sorts every ${quarters ? "quarter-hour" : "hour"} in the period from highest to lowest. Read across: the value was at or above the line for that share of the time.`);
    return {
      title: `${m.label}: duration curve${this.cfg.subjects.length > 1 ? ` · ${this.subjectLabel(s.subject)}` : ""}`,
      subtitle: `${fmtPeriod(from, to)} · ${unit}`,
      spec: { xType: "value", xMin: 0, xMax: 100, xLabel: x => `${fmtNumber(x, 1)}% of the time`, axisLabel: x => `${x}%`, xHeader: "Share of the time (%)", yName: unit, series, notes, zeroLine: m.zeroLine, yFormat: v => fmtNumber(v, Number.isInteger(v) ? 0 : 1) },
      summary: { actual: this.dayMeans(sets[0].map), perYear: new Map([...comp].map(([k, mp]) => [k, this.dayMeans(mp, k)])), cmp: null, raw: sets[0].map, agg: "mean" }
    };
  }

  /** Daily means keyed by the current period's dates (comparison maps are shifted back). */
  dayMeans(map, k = 0) {
    const acc = new Map();
    const align = this.align();
    for (const [t, v] of map) {
      let d = dateKey(t);
      if (k) d = align === "wd" ? addDays(d, 364 * k) : `${Number(d.slice(0, 4)) + k}${d.slice(4)}`;
      if (!acc.has(d)) acc.set(d, []);
      acc.get(d).push(v);
    }
    return new Map([...acc].map(([d, vs]) => [d, meanOf(vs)]));
  }

  // ---------- Headline, cards and ranking ----------

  renderSummary(sum, from, to) {
    const s = this.state;
    const m = this.measure();
    const agg = this.state.view === "series" ? sum.agg : "mean";
    const all = sum.actual;
    if (!all.size) {
      this.headline.textContent = "No data for this period.";
      this.cards.innerHTML = "";
      return;
    }
    const total = map => aggregate([...map.values()], agg, map.weights ? [...map.keys()].map(d => map.weights.get(d)) : null);
    const cur = total(all);
    const likeFor = maps => {
      const a = []; const b = []; const wa = []; const wb = [];
      for (const [d, v] of all) {
        const vals = maps.map(mp => mp?.get(d)).filter(x => x != null);
        if (!vals.length) continue;
        a.push(v); b.push(meanOf(vals));
        wa.push(all.weights?.get(d)); wb.push(meanOf(maps.map(mp => mp?.weights?.get(d)).filter(x => x != null)));
      }
      return a.length ? { cur: aggregate(a, agg, wa), ref: aggregate(b, agg, wb) } : null;
    };
    const n = Number(s.n);
    const avgMaps = [...sum.perYear].filter(([k]) => k <= n).map(([, mp]) => mp);
    const vsLy = sum.perYear.get(1) && s.ly === "1" ? likeFor([sum.perYear.get(1)]) : null;
    const vsAvg = avgMaps.length && (s.avg === "1" || s.band === "1") ? likeFor(avgMaps) : null;
    const vsCmp = sum.cmp ? likeFor([sum.cmp]) : null;
    const yrK = s.yr ? Number(from.slice(0, 4)) - Number(s.yr) : null;
    const vsYr = yrK && sum.perYear.get(yrK) ? likeFor([sum.perYear.get(yrK)]) : null;
    const word = d => (d >= 0 ? "above" : "below");
    const abs = d => this.cfg.fmt(Math.abs(d), m);
    const bits = [];
    if (vsLy) bits.push(`${abs(vsLy.cur - vsLy.ref)} ${word(vsLy.cur - vsLy.ref)} last year`);
    if (vsAvg) bits.push(`${abs(vsAvg.cur - vsAvg.ref)} ${word(vsAvg.cur - vsAvg.ref)} the ${this.yearsLabel(from)} average`);
    if (vsYr) bits.push(`${abs(vsYr.cur - vsYr.ref)} ${word(vsYr.cur - vsYr.ref)} ${s.yr}`);
    const subj = this.subjectLabel(s.subject);
    const verb = to > todayParis() ? "is" : agg === "sum" ? "totalled" : "averaged";
    const subject = this.cfg.sentenceSubject ? this.cfg.sentenceSubject(m, subj) : `${subj} ${m.short}`;
    let text = agg === "sum" ? `${subject} ${verb} ${this.fmt(cur)} ${fmtFromTo(from, to)}` : agg === "max" ? `The highest ${subject} ${fmtFromTo(from, to)} was ${this.fmt(cur)}` : agg === "min" ? `The lowest ${subject} ${fmtFromTo(from, to)} was ${this.fmt(cur)}` : `${subject[0].toUpperCase() + subject.slice(1)} ${verb} ${this.fmt(cur)} ${fmtFromTo(from, to)}`;
    if (agg === "sum" || agg === "mean") text = text[0].toUpperCase() + text.slice(1);
    if (bits.length) text += `, ${bits.slice(0, 2).join(" and ")}`;
    if (vsCmp) text += `${bits.length ? "; " : ", "}${abs(vsCmp.cur - vsCmp.ref)} ${word(vsCmp.cur - vsCmp.ref)} ${this.subjectLabel(s.cmp)}`;
    this.baseHeadline = `${text}.`;
    this.headline.textContent = this.baseHeadline;

    const entries = [...all].filter(([, v]) => v != null);
    const max = entries.reduce((a, b) => (!a || b[1] > a[1] ? b : a), null);
    const min = entries.reduce((a, b) => (!a || b[1] < a[1] ? b : a), null);
    const card = (l, v, d = "", c = "") => `<div class="card${c}"><div class="label">${l}</div><div class="value">${v}</div><div class="detail">${d}</div></div>`;
    const delta = r => (r ? `${r.cur - r.ref >= 0 ? "+" : "−"}${abs(r.cur - r.ref)}` : "–");
    const raw = sum.raw;
    let rawMax = null;
    let rawMin = null;
    if (raw?.size) {
      for (const [t, v] of raw) {
        if (!rawMax || v > rawMax[1]) rawMax = [t, v];
        if (!rawMin || v < rawMin[1]) rawMin = [t, v];
      }
    }
    this.cards.innerHTML = [
      card(agg === "sum" ? "Total" : agg === "max" ? "Highest" : agg === "min" ? "Lowest" : "Average", this.fmt(cur), fmtPeriod(from, to), " accent"),
      vsLy ? card("vs last year", delta(vsLy), `${this.fmt(vsLy.ref)} like-for-like`) : "",
      vsAvg ? card(`vs ${this.yearsLabel(from)} average`, delta(vsAvg), `${this.fmt(vsAvg.ref)} like-for-like`) : "",
      vsYr ? card(`vs ${s.yr}`, delta(vsYr), `${this.fmt(vsYr.ref)} like-for-like`) : "",
      vsCmp ? card(`vs ${this.subjectLabel(s.cmp)}`, delta(vsCmp), `${this.fmt(vsCmp.ref)}`) : "",
      rawMax ? card(`Highest ${raw.size > 2000 || this.state.res === "15m" ? "period" : "hour"}`, this.fmt(rawMax[1]), fmtDateTime(rawMax[0])) : max && entries.length > 1 ? card("Highest day", this.fmt(max[1]), fmtLongDate(max[0])) : "",
      rawMin ? card(`Lowest ${raw.size > 2000 || this.state.res === "15m" ? "period" : "hour"}`, this.fmt(rawMin[1]), fmtDateTime(rawMin[0])) : min && entries.length > 1 ? card("Lowest day", this.fmt(min[1]), fmtLongDate(min[0])) : "",
      ...(this.cfg.extraCards?.(sum, from, to, this) || [])
    ].join("");
  }

  async renderRanking(from, to, id) {
    const s = this.state;
    const m = this.measure();
    const days = daysBetween(from, to) + 1;
    if (days > 366) { this.rankPanel.show(false); return; }
    const table = await this.cfg.loadDaily();
    const align = this.align();
    const firstYear = Number(this.cfg.firstDate.slice(0, 4));
    const rows = [];
    const agg = m.agg || "mean";
    for (let k = 0; Number(from.slice(0, 4)) - k >= firstYear; k++) {
      const vals = [];
      const ws = [];
      for (const d of dateRange(from, to)) {
        const src = k ? shiftD(d, k, align) : d;
        const v = src ? this.dailyValue(table, src, s.subject) : null;
        if (v != null) { vals.push(v); ws.push(m.weight ? m.weight(table.byDate.get(src), s.subject) : null); }
      }
      if (!vals.length || (k > 0 && vals.length < 0.9 * days)) continue;
      const a = shiftD(from, k, align) || from;
      const b = shiftD(to, k, align) || to;
      const label = from.slice(0, 4) === to.slice(0, 4) ? a.slice(0, 4) : `${a.slice(0, 4)}–${b.slice(2, 4)}`;
      rows.push({ k, label, value: aggregate(vals, agg, ws) });
    }
    if (id !== this.renderId) return;
    if (rows.length < 3) { this.rankPanel.show(false); return; }
    this.rankPanel.show(true);
    rows.reverse();
    const current = rows.find(r => r.k === 0);
    const desc = [...rows].sort((a, b) => b.value - a.value);
    const rankHigh = current ? desc.indexOf(current) + 1 : null;
    const rankLow = current ? rows.length - rankHigh + 1 : null;
    const rankText = current ? `${rankLow < rankHigh ? `${rankLow === 1 ? "" : `${ordinal(rankLow)} `}lowest` : `${rankHigh === 1 ? "" : `${ordinal(rankHigh)} `}highest`} of ${rows.length} years` : "";
    if (current && this.baseHeadline && s.view === "series") this.headline.textContent = `${this.baseHeadline.slice(0, -1)}, the ${rankText} for this period${rows[0] ? ` since ${rows[0].label.slice(0, 4)}` : ""}.`;
    const sc = m.scale || 1;
    const n = Number(s.n);
    const colourFor = (_, i) => (rows[i]?.k === 0 ? "--s-actual" : rows[i]?.k <= n ? "--s-avg" : "--s-band");
    this.rankPanel.setTitle(current ? `${fmtPeriod(from, to)}: ${rankText}` : "The same period in every year",
      `${m.label}${this.cfg.subjects.length > 1 ? ` · ${this.subjectLabel(s.subject)}` : ""}, same ${align === "cal" ? "dates" : "weekdays"} in each year · ${m.unit}`);
    this.rankPanel.render({
      xType: "category", categories: rows.map(r => r.label), xLabel: x => x, xHeader: "Year",
      yName: m.unit, yMin: m.zeroLine ? undefined : 0, yScale: false, yFormat: v => fmtNumber(v, Number.isInteger(v) ? 0 : 1),
      series: [{ name: `${m.label}, same period`, colour: "--s-actual", type: "bar", data: rows.map((r, i) => [i, r.value / sc]), unit: m.unit, decimals: m.decimals ?? 1, colourFn: colourFor, barColours: i => colourFor(null, i), avg: false, barWidth: 30, labels: v => fmtNumber(v, Math.abs(v) >= 100 ? 0 : 1) }],
      legendCaption: null,
      notes: [`Highlighted: this period. Mid-tone bars are the years in the ${n}-year average. Years with less than 90% of days are left out.`]
    });
  }


  // ---------- Several subjects at once ----------

  /** One subject's values for the period (k years back, aligned), at the given resolution, keyed like the chart. */
  async seriesFor(subject, from, to, res, k, table) {
    const align = this.align();
    const m = this.measure();
    if (!["15m", "1h"].includes(res)) {
      const map = new Map();
      for (const d of dateRange(from, to)) {
        const src = k ? shiftD(d, k, align) : d;
        const v = src ? this.dailyValue(table, src, subject) : null;
        if (v != null) map.set(d, v);
      }
      return this.group(map, res, m.agg || "mean");
    }
    if (!k) return this.raw(subject, from, to, res);
    const src = await this.raw(subject, shiftD(from, k, align) || shiftD(addDays(from, 1), k, align), shiftD(to, k, align) || shiftD(addDays(to, -1), k, align), res);
    const map = new Map();
    const step = res === "15m" ? QUARTER : HOUR;
    for (let t = parisMidnight(from); t < parisMidnight(addDays(to, 1)); t += step) {
      const st = shiftT(t, k, align);
      const v = st != null ? src.get(st) : null;
      if (v != null) map.set(t, v);
    }
    return map;
  }

  async buildMulti(from, to, notes) {
    const s = this.state;
    const m = this.measure();
    const sc = m.scale || 1;
    const unit = m.unit;
    const decimals = m.decimals ?? 1;
    const list = this.subjects();
    const colourOf = v => this.cfg.subjects.find(x => x.value === v)?.colour || "--s-actual";
    const table = await this.cfg.loadDaily();
    const n = Number(s.n);
    const agg = m.agg || "mean";
    const stacked = s.stack === "1";

    if (s.view === "profile" || s.view === "duration") {
      if (m.intraday === false) throw new Error(`${m.label} has no time-of-day detail`);
      let f = from;
      if (daysBetween(f, to) + 1 > PROFILE_LIMIT) { f = addDays(to, -(PROFILE_LIMIT - 1)); notes.push(`Profiles and duration curves use at most ${PROFILE_LIMIT} days.`); }
      const quarters = this.cfg.hasQuarters?.(parisMidnight(f)) && daysBetween(f, to) <= 120;
      const res = quarters ? "15m" : "1h";
      const series = [];
      const rows = [];
      for (const subj of list) {
        const map = await this.raw(subj, f, to, res);
        let data;
        if (s.view === "profile") {
          const acc = new Map();
          const isWe = t => weekdayIndex(dateKey(t)) >= 5;
          for (const [t, v] of map) {
            if ((s.split === "wd" && isWe(t)) || (s.split === "we" && !isWe(t))) continue;
            const w = new Date(toWall(t));
            const slot = Math.floor((w.getUTCHours() * 60 + w.getUTCMinutes()) / (quarters ? 15 : 60)) * (quarters ? 15 : 60);
            const a = acc.get(slot) || [0, 0];
            a[0] += v; a[1] += 1;
            acc.set(slot, a);
          }
          data = [...acc].sort((a, b) => a[0] - b[0]).map(([k, [sum, c]]) => [k, sum / c / sc]);
        } else {
          const vs = [...map.values()].sort((a, b) => b - a);
          const step = Math.max(1, Math.floor(vs.length / 1500));
          data = [];
          for (let i = 0; i < vs.length; i += step) data.push([(100 * i) / Math.max(1, vs.length - 1), vs[i] / sc]);
        }
        series.push({ name: this.subjectLabel(subj), colour: colourOf(subj), type: "line", data, unit, decimals, width: 2, stack: stacked && s.view === "profile" ? "multi" : undefined, areaOpacity: 0.8, symbols: false });
        rows.push({ subj, cur: meanOf([...map.values()]) });
      }
      const hhmm = k => `${String(Math.floor(k / 60)).padStart(2, "0")}:${String(k % 60).padStart(2, "0")}`;
      const profile = s.view === "profile";
      return {
        title: `${m.label}: ${profile ? "daily profile" : "duration curve"}`,
        subtitle: `${fmtPeriod(f, to)} · ${unit}${stacked && profile ? ", stacked" : ""}`,
        spec: profile
          ? { xType: "value", xMin: 0, xMax: 1440 - (quarters ? 15 : 60), xLabel: hhmm, axisLabel: hhmm, xHeader: "Time of day (Paris)", yName: unit, series, notes: [...notes, "Average for each time of day, Paris time."], yMin: m.yMin, xInterval: 180 }
          : { xType: "value", xMin: 0, xMax: 100, xLabel: x => `${fmtNumber(x, 1)}% of the time`, axisLabel: x => `${x}%`, xHeader: "Share of the time (%)", yName: unit, series, notes: [...notes, "Each line sorts every period from highest to lowest."], yMin: m.yMin },
        summary: { multi: true, rows: rows.map(r => ({ ...r, ly: null, avg: null })), from: f, to, list }
      };
    }

    // Over time.
    const days = daysBetween(from, to) + 1;
    let res = s.res;
    if ((res === "15m" || res === "1h") && m.intraday === false) res = "1d";
    if (LIMIT[res] && days > LIMIT[res]) { res = res === "15m" && days <= LIMIT["1h"] ? "1h" : "1d"; notes.push(`This period is shown ${RES_LABEL[res]}.`); }
    const daily = !["15m", "1h"].includes(res);
    const keyX = daily ? k => parisMidnight(k) : k => k;
    const pts = map => [...map].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [keyX(k), v / sc]);
    const wantLy = s.ly === "1" || s.gap === "1";
    const wantAvg = s.avg === "1";
    const rows = [];
    const cur = {};
    const lyMaps = {};
    for (const subj of list) {
      const A = await this.seriesFor(subj, from, to, res, 0, table);
      cur[subj] = A;
      const L = wantLy && addDays(from, -365) >= addDays(this.cfg.firstDate, -1) ? await this.seriesFor(subj, from, to, res, 1, table) : null;
      lyMaps[subj] = L;
      const avgMaps = [];
      if (wantAvg) for (let k = 1; k <= n; k++) if (addDays(from, -365 * k) >= addDays(this.cfg.firstDate, -1)) avgMaps.push(await this.seriesFor(subj, from, to, res, k, table));
      // Like-for-like: only keys present in both.
      const like = maps => {
        const a = []; const b = [];
        for (const [key, v] of A) {
          const vals = maps.map(mp => mp.get(key)).filter(x => x != null);
          if (vals.length) { a.push(v); b.push(meanOf(vals)); }
        }
        return a.length ? { cur: aggregate(a, agg), ref: aggregate(b, agg) } : null;
      };
      rows.push({ subj, cur: aggregate([...A.values()], agg), ly: L ? like([L]) : null, avg: avgMaps.length ? like(avgMaps) : null, years: avgMaps.length });
    }
    const series = [];
    if (s.gap === "1" && list.length === 2) {
      const [a, b] = list;
      const gapOf = (x, y) => new Map([...x].filter(([k]) => y.has(k)).map(([k, v]) => [k, v - y.get(k)]));
      const name = `${this.subjectLabel(a)} minus ${this.subjectLabel(b)}`;
      if (lyMaps[a] && lyMaps[b]) series.push({ name: `${name}, last year`, colour: "--s-ly", type: "line", data: pts(gapOf(lyMaps[a], lyMaps[b])), width: 1.5, unit, decimals, symbols: daily && res !== "1d" ? true : undefined });
      series.push({ name, colour: "--s-actual", type: "line", data: pts(gapOf(cur[a], cur[b])), width: 2.4, unit, decimals, z: 20, symbols: daily && res !== "1d" ? true : undefined });
      notes.push("Above zero: the first fuel produced more than the second.");
    } else {
      for (const subj of stacked ? list : [...list].reverse()) series.push({ name: this.subjectLabel(subj), colour: colourOf(subj), type: "line", data: pts(cur[subj]), width: stacked ? 0.6 : 2, unit, decimals, stack: stacked ? "multi" : undefined, areaOpacity: 0.85, symbols: stacked ? false : daily && res !== "1d" ? true : undefined });
    }
    const xLabel = !daily ? x => fmtDateTime(x) : res === "1M" ? x => fmtMonth(x) : res === "1y" ? x => dateKey(x).slice(0, 4) : res === "1w" ? x => `Week of ${fmtDate(x)}` : x => fmtDate(x);
    if (wantLy || wantAvg) notes.push(`Changes in the table compare like-for-like ${this.align() === "wd" ? "weekdays" : "dates"} in earlier years.`);
    return {
      title: s.gap === "1" && list.length === 2 ? `${this.subjectLabel(list[0])} minus ${this.subjectLabel(list[1])}, ${RES_LABEL[res]}` : `${m.label}: ${list.length} ${this.cfg.subjectPlural || "series"}, ${RES_LABEL[res]}`,
      subtitle: `${fmtPeriod(from, to)} · ${unit}${stacked && s.gap !== "1" ? ", stacked" : ""}`,
      spec: {
        xType: "time", xLabel, csvLabel: daily ? csvDate : csvDateTime, axisLabel: res === "1M" ? x => fmtMonth(x) : res === "1y" ? x => dateKey(x).slice(0, 4) : undefined,
        xHeader: daily ? "Date" : "Time (Europe/Paris)", yName: unit, series, notes, zeroLine: s.gap === "1", yMin: s.gap === "1" ? undefined : m.yMin,
        yFormat: v => fmtNumber(v, Number.isInteger(v) ? 0 : 1), events: s.ev === "1" && this.cfg.events ? this.cfg.events(from, to) : []
      },
      summary: { multi: true, rows, from, to, list, gap: list.length === 2 }
    };
  }

  renderMultiSummary(sum, from, to) {
    const s = this.state;
    const m = this.measure();
    const f = v => this.cfg.fmt(v, m);
    const abs = v => this.cfg.fmt(Math.abs(v), m);
    const signed = d => (d == null ? "–" : `${d >= 0 ? "+" : "−"}${abs(d)}`);
    const pct = r => (r && r.ref ? 100 * (r.cur / r.ref - 1) : null);
    const pctTxt = v => (v == null ? "–" : `${v >= 0 ? "+" : "−"}${fmtNumber(Math.abs(v), 1)}%`);
    const cls = v => (v == null ? "" : v >= 0 ? "up" : "down");
    const rows = sum.rows;
    const yrs = rows.find(r => r.years)?.years || Number(s.n);
    const avgLabel = `${yrs}-yr avg`;
    const label = v => this.subjectLabel(v).replace(/ \(.*\)/, "");
    // Share of the total of the selected fuels (only meaningful for output-type measures).
    const total = rows.reduce((a, r) => a + (r.cur || 0), 0);
    const showShare = m.unit === "GW" || m.unit === "GWh";
    const head = `<tr><th>${this.cfg.subjectLabel}</th><th>${m.agg === "sum" ? "Total" : "Average"}</th><th>vs last year</th><th>%</th><th>vs ${avgLabel}</th><th>%</th>${showShare ? "<th>Share of selected</th>" : ""}</tr>`;
    const body = rows.map(r => {
      const dl = r.ly ? r.ly.cur - r.ly.ref : null;
      const da = r.avg ? r.avg.cur - r.avg.ref : null;
      return `<tr><td><span class="dot" style="background:var(${this.cfg.subjects.find(x => x.value === r.subj)?.colour || "--s-actual"})"></span>${label(r.subj)}</td><td>${f(r.cur)}</td>
        <td class="${cls(dl)}">${signed(dl)}</td><td class="${cls(pct(r.ly))}">${pctTxt(pct(r.ly))}</td>
        <td class="${cls(da)}">${signed(da)}</td><td class="${cls(pct(r.avg))}">${pctTxt(pct(r.avg))}</td>${showShare ? `<td>${total ? `${fmtNumber(100 * r.cur / total, 1)}%` : "–"}</td>` : ""}</tr>`;
    }).join("");
    let gapRow = "";
    let gapText = "";
    if (rows.length === 2 && rows[0].ly && rows[1].ly) {
      const [a, b] = rows;
      const g = a.cur - b.cur;
      const gl = a.ly.ref - b.ly.ref;
      const ga = a.avg && b.avg ? a.avg.ref - b.avg.ref : null;
      gapRow = `<tr class="gap-row"><td>${label(a.subj)} minus ${label(b.subj)}</td><td>${signed(g)}</td><td class="${cls(g - gl)}">${signed(g - gl)}</td><td></td><td class="${ga == null ? "" : cls(g - ga)}">${ga == null ? "–" : signed(g - ga)}</td><td></td>${showShare ? "<td></td>" : ""}</tr>`;
      const lead = g >= 0 ? [a, b] : [b, a];
      const was = g >= 0 ? gl : -gl;
      gapText = ` ${label(lead[0].subj)} ${m.agg === "sum" ? "exceeded" : "exceeded"} ${label(lead[1].subj).toLowerCase()} by ${abs(g)}, ${was >= 0 ? `${Math.abs(g) >= was ? "up" : "down"} from ${abs(was)}` : `reversing a gap of ${abs(was)} the other way`} a year earlier.`;
    }
    this.mtable.innerHTML = `<div class="mtable-wrap"><table class="mtable"><thead>${head}</thead><tbody>${body}${gapRow}</tbody></table></div>`;
    this.cards.hidden = true;
    this.cards.innerHTML = "";
    // Headline: each fuel's change on last year when two or three are ticked, otherwise the biggest movers.
    const span = fmtFromTo(sum.from, sum.to);
    const withLy = rows.filter(r => r.ly && r.ly.ref && r.subj !== "hydro_other" && (m.unit !== "GW" || r.cur >= 500));
    let text;
    const one = r => `${label(r.subj).toLowerCase()} ${f(r.cur)}${r.ly && r.ly.ref ? ` (${pctTxt(pct(r.ly))} on last year)` : ""}`;
    if (rows.length <= 3) {
      const [first, ...rest] = rows;
      const pc = r => (r.ly && r.ly.ref ? ` (${pctTxt(pct(r.ly))}${r === first ? " on last year" : ""})` : "");
      const restTxt = rest.map(r => `${label(r.subj).toLowerCase()} ${f(r.cur)}${pc(r)}`).join(", ").replace(/, ([^,]*)$/, " and $1");
      text = `${span[0].toUpperCase() + span.slice(1)}, French ${label(first.subj).toLowerCase()} ${m.short} averaged ${f(first.cur)}${pc(first)}${rest.length ? ` and ${restTxt}` : ""}.`;
    }
    else if (withLy.length) {
      const up = [...withLy].sort((x, y) => pct(y.ly) - pct(x.ly))[0];
      const down = [...withLy].sort((x, y) => pct(x.ly) - pct(y.ly))[0];
      text = `${span[0].toUpperCase() + span.slice(1)}, ${label(up.subj).toLowerCase()} rose most on last year among the selected fuels (${pctTxt(pct(up.ly))} to ${f(up.cur)}) and ${label(down.subj).toLowerCase()} ${pct(down.ly) < 0 ? "fell most" : "rose least"} (${pctTxt(pct(down.ly))} to ${f(down.cur)}).`;
    } else text = `${span[0].toUpperCase() + span.slice(1)}: ${rows.map(one).join(", ")}.`;
    if (m.agg === "sum") text = text.replace(" averaged ", " totalled ");
    this.headline.textContent = text + gapText;
  }
  refreshTheme() {
    this.panel.refreshTheme();
    this.rankPanel.refreshTheme();
  }
}

export { shiftT, shiftD, aggregate, meanOf, timeKey };
