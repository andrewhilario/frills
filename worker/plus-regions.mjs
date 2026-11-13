// The countries Frills Plus is planned to be sold in first (the "Tier-1" list in the Plus plan): North America and Oceania, the UK and Ireland, the EU and EFTA. The stats page uses it to say how
// many of this week's overlays are somewhere Plus would reach. The Plus code itself (worker/region.mjs, on the Plus branch) holds the same list, and is changed to read it from here when the two meet.

export const PLUS_COUNTRIES = new Set([
  "US", "CA", "AU", "NZ",
  "GB", "IE",
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IS", "IT", "LV", "LI", "LT", "LU", "MT",
  "NL", "NO", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "CH",
]);
