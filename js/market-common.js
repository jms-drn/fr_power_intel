// Small shared pieces for the price, generation and flow tabs: a period
// picker (preset + from/to) and card markup.

import { PRESETS, presetRange } from "./time-explorer.js";

export function periodHtml(first) {
  return `<label class="field"><span>Period</span><select data-p="preset">${PRESETS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
    <label class="field"><span>From</span><input type="date" data-p="from" min="${first}"></label>
    <label class="field"><span>To</span><input type="date" data-p="to" min="${first}"></label>`;
}

/** Wire the period picker: state gets preset/from/to; onChange is called after each change. */
export function bindPeriod(root, state, onChange) {
  const sync = () => root.querySelectorAll("[data-p]").forEach(i => { i.value = state[i.dataset.p]; });
  const apply = () => {
    const r = presetRange(state.preset);
    if (r) [state.from, state.to] = r;
    sync();
  };
  root.querySelectorAll("[data-p]").forEach(input => input.addEventListener("change", () => {
    state[input.dataset.p] = input.value;
    if (input.dataset.p === "preset") apply();
    else state.preset = "custom";
    if (state.from > state.to) [state.from, state.to] = [state.to, state.from];
    sync();
    onChange();
  }));
  if (state.preset !== "custom" || !state.from) apply(); else sync();
  return { apply, sync };
}

export const card = (label, value, detail = "", cls = "") =>
  `<div class="card${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="detail">${detail}</div></div>`;

export function readParams(state, params) {
  for (const k of Object.keys(state)) if (params.has(k)) state[k] = params.get(k);
}
