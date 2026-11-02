// Small, flat flags (16 x 11) drawn inline, so they look the same on every
// system (Windows shows emoji flags as letters). Simplified: no coats of arms.

const W = 16;
const H = 11;
const v3 = (a, b, c) => `<rect width="5.34" height="${H}" fill="${a}"/><rect x="5.33" width="5.34" height="${H}" fill="${b}"/><rect x="10.66" width="5.34" height="${H}" fill="${c}"/>`;
const h3 = (a, b, c, mid = 1 / 3) => {
  const t = H * (1 - mid) / 2;
  return `<rect width="${W}" height="${t}" fill="${a}"/><rect y="${t}" width="${W}" height="${H * mid}" fill="${b}"/><rect y="${t + H * mid}" width="${W}" height="${t}" fill="${c}"/>`;
};

const SHAPES = {
  FR: v3("#0055a4", "#ffffff", "#ef4135"),
  BE: v3("#1a1a1a", "#fdda24", "#ef3340"),
  IT: v3("#009246", "#ffffff", "#ce2b37"),
  DE: h3("#1a1a1a", "#dd0000", "#ffce00"),
  ES: h3("#aa151b", "#f1bf00", "#aa151b", 0.5),
  CH: `<rect width="${W}" height="${H}" fill="#da291c"/><rect x="6.9" y="2.2" width="2.2" height="6.6" fill="#fff"/><rect x="4.7" y="4.4" width="6.6" height="2.2" fill="#fff"/>`,
  GB: `<rect width="${W}" height="${H}" fill="#012169"/><path d="M0 0L16 11M16 0L0 11" stroke="#fff" stroke-width="2.2"/><path d="M0 0L16 11M16 0L0 11" stroke="#c8102e" stroke-width="0.8"/><path d="M8 0V11M0 5.5H16" stroke="#fff" stroke-width="3.2"/><path d="M8 0V11M0 5.5H16" stroke="#c8102e" stroke-width="1.8"/>`
};
const ALIAS = { IT_NORD: "IT", DE_LU: "DE" };

/** Inline SVG flag for a zone or border code (FR, DE, BE, CH, IT_NORD, ES, GB), or "". */
export function flag(code, title = "") {
  const shape = SHAPES[ALIAS[code] || code];
  if (!shape) return "";
  return `<svg class="flag" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${title || code}"><g>${shape}</g></svg>`;
}
