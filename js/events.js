// Events shown as optional markers on charts. Dates are Paris dates; "to"
// is the last day of a period (inclusive).
//
// Sources (checked 29 Oct 2026):
//  - Lockdowns: national confinements of 17 Mar–11 May 2020, 30 Oct–15 Dec
//    2020 and 3 Apr–3 May 2021 (end dates are the day restrictions lifted).
//  - Cold snap: Météo-France fiche "Vague de froid février 2018"
//    (26–28 Feb 2018).
//  - Stress corrosion: EDF announced the shutdown of Civaux 1 and 2 on
//    15 Dec 2021 after cracks were found (Nuclear Engineering International).
//  - Sobriety plan: presented by the government on 6 Oct 2022
//    (service-public.gouv.fr).

export const EVENTS = [
  { from: "2018-02-26", to: "2018-02-28", label: "Cold snap", detail: "Cold wave across mainland France, 26–28 Feb 2018 (Météo-France)" },
  { from: "2020-03-17", to: "2020-05-10", label: "Lockdown 1", detail: "First national Covid-19 lockdown, 17 Mar – 11 May 2020" },
  { from: "2020-10-30", to: "2020-12-14", label: "Lockdown 2", detail: "Second national lockdown, 30 Oct – 15 Dec 2020" },
  { from: "2021-04-03", to: "2021-05-02", label: "Lockdown 3", detail: "Third national lockdown, 3 Apr – 3 May 2021" },
  { from: "2021-12-15", label: "Nuclear stress corrosion", detail: "EDF announces Civaux 1 and 2 shutdowns over stress corrosion cracks; checks spread across the fleet in 2022" },
  { from: "2022-02-24", label: "Ukraine invasion", detail: "Russia invades Ukraine; European energy crisis deepens" },
  { from: "2022-10-06", label: "Sobriety plan", detail: "French government presents its energy sobriety plan" }
];

export function eventsBetween(from, to) {
  return EVENTS.filter(e => (e.to || e.from) >= from && e.from <= to);
}

// Market events, shown on price, generation and flow charts together with the
// events above. Dates checked 2 Nov 2026: bidding-zone split (DE-LU from
// 1 Oct 2018), Iberian gas price cap (15 Jun 2022 – 31 Dec 2023), German
// nuclear exit (last three reactors off 15 Apr 2023), Flamanville 3 first grid
// connection (21 Dec 2024, RTE notices), 15-minute day-ahead prices (first
// delivery day in the ENTSO-E data: 30 Sep 2025).
export const MARKET_EVENTS = [
  { from: "2018-10-01", label: "DE-AT split", detail: "Germany-Luxembourg and Austria become separate bidding zones" },
  { from: "2022-06-15", to: "2023-12-31", label: "Iberian gas cap", detail: "Spain and Portugal cap the gas price used in power generation" },
  { from: "2023-04-15", label: "German nuclear exit", detail: "Germany's last three reactors shut down" },
  { from: "2024-12-21", label: "Flamanville 3", detail: "Flamanville 3 first connected to the grid" },
  { from: "2025-09-30", label: "15-min day-ahead", detail: "Day-ahead market moves from hourly to 15-minute prices" }
];

export function marketEventsBetween(from, to) {
  return [...EVENTS, ...MARKET_EVENTS].filter(e => (e.to || e.from) >= from && e.from <= to);
}
