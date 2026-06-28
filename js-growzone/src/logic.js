/**
 * logic.js — pure, stateless functions for the growzone cell.
 * No imports from data.js; safe to unit-test in plain Node.
 */

export const ZIP_LOCATIONS = {
  "01001": { city: "Agawam",        state: "MA" },
  "10001": { city: "New York",      state: "NY" },
  "90210": { city: "Beverly Hills", state: "CA" },
  "98101": { city: "Seattle",       state: "WA" },
  "60601": { city: "Chicago",       state: "IL" },
  "77001": { city: "Houston",       state: "TX" },
  "30301": { city: "Atlanta",       state: "GA" },
  "85001": { city: "Phoenix",       state: "AZ" },
  "80201": { city: "Denver",        state: "CO" },
  "94101": { city: "San Francisco", state: "CA" },
  "33101": { city: "Miami",         state: "FL" },
  "20001": { city: "Washington",    state: "DC" },
  "97201": { city: "Portland",      state: "OR" },
  "75201": { city: "Dallas",        state: "TX" },
  "95814": { city: "Sacramento",    state: "CA" },
  "92101": { city: "San Diego",     state: "CA" },
  "19101": { city: "Philadelphia",  state: "PA" },
  "55401": { city: "Minneapolis",   state: "MN" },
  "02101": { city: "Boston",        state: "MA" },
  "99501": { city: "Anchorage",     state: "AK" },
  "96801": { city: "Honolulu",      state: "HI" },
};

// Growing-season info by USDA zone number (1–13).
// Separate from temperature data; keyed by the integer zone number.
export const GROWING_INFO = {
  1:  { season: "very short (<90 days)",    lastFrost: "Jun–Jul", firstFrost: "Aug"      },
  2:  { season: "very short (<90 days)",    lastFrost: "May–Jun", firstFrost: "Aug–Sep"  },
  3:  { season: "short (90–120 days)",      lastFrost: "May",     firstFrost: "Sep–Oct"  },
  4:  { season: "short (120–150 days)",     lastFrost: "Apr–May", firstFrost: "Oct"      },
  5:  { season: "moderate (150–180 days)",  lastFrost: "Mar–Apr", firstFrost: "Oct–Nov"  },
  6:  { season: "moderate (180–210 days)",  lastFrost: "Mar–Apr", firstFrost: "Oct–Nov"  },
  7:  { season: "long (210–240 days)",      lastFrost: "Feb–Mar", firstFrost: "Nov"      },
  8:  { season: "long (240–270 days)",      lastFrost: "Feb–Mar", firstFrost: "Nov–Dec"  },
  9:  { season: "very long (270–300 days)", lastFrost: "Jan–Feb", firstFrost: "Dec"      },
  10: { season: "nearly year-round",        lastFrost: "Jan",     firstFrost: "Jan"      },
  11: { season: "year-round (frost-free)",  lastFrost: null,      firstFrost: null       },
  12: { season: "year-round (frost-free)",  lastFrost: null,      firstFrost: null       },
  13: { season: "year-round (frost-free)",  lastFrost: null,      firstFrost: null       },
};

export const ZONE_COLORS = {
  1: "#c8e6ff", 2: "#a0cfff", 3: "#78b8ff", 4: "#50a0ff",
  5: "#4caf50", 6: "#8bc34a", 7: "#cddc39", 8: "#ffeb3b",
  9: "#ffc107", 10: "#ff9800", 11: "#ff5722", 12: "#e53935", 13: "#b71c1c",
};

export function zoneColor(n) { return ZONE_COLORS[n] ?? "#999"; }

/**
 * Parse a zone string like "8b", "10a", "6" into its components.
 * Returns { number, sub, full }.
 */
export function parseZone(z) {
  const m = String(z).match(/^(\d+)([ab])?$/i);
  return m
    ? { number: parseInt(m[1], 10), sub: m[2]?.toLowerCase() ?? null, full: z }
    : { number: 0, sub: null, full: z };
}

/**
 * Estimate a US state from a zip code numeric range.
 * Returns { state, approximate: true }.
 */
export function approxLocation(zip) {
  const n = parseInt(zip, 10);
  const ranges = [
    [99500, 99999, "AK"], [96700, 96899, "HI"],
    [90000, 96199, "CA"], [98000, 99499, "WA"], [97000, 97999, "OR"],
    [85000, 86599, "AZ"], [80000, 81699, "CO"], [87000, 88499, "NM"],
    [75000, 79999, "TX"], [70000, 71499, "LA"], [33000, 34999, "FL"],
    [30000, 31999, "GA"], [27000, 28999, "NC"], [22000, 24699, "VA"],
    [20000, 20599, "DC"], [10000, 14999, "NY"], [15000, 19699, "PA"],
    [1000,  2799,  "MA"], [6000,  6999,  "CT"], [7000,  8999,  "NJ"],
    [43000, 45899, "OH"], [46000, 47999, "IN"], [48000, 49999, "MI"],
    [60000, 62999, "IL"], [50000, 52899, "IA"], [53000, 54999, "WI"],
    [55000, 56799, "MN"], [40000, 42799, "KY"], [63000, 65899, "MO"],
    [66000, 67999, "KS"], [73000, 74999, "OK"], [37000, 38599, "TN"],
    [35000, 36999, "AL"], [38600, 39799, "MS"], [59000, 59999, "MT"],
    [82000, 83199, "WY"], [83200, 83899, "ID"], [84000, 84799, "UT"],
    [88900, 89899, "NV"], [58000, 58899, "ND"], [57000, 57799, "SD"],
    [68000, 69399, "NE"],
  ];
  for (const [lo, hi, st] of ranges) {
    if (n >= lo && n <= hi) return { state: st, approximate: true };
  }
  return { state: "US", approximate: true };
}

/**
 * Build the API response object from the raw data pieces.
 *
 * @param {string}   zip          - 5-digit zip code string
 * @param {{zone, trange}}  zoneData     - row from the USDA CSV (from getZoneByZip)
 * @param {{tempF, tempC}|null} zoneDetails - temperature details (from getZoneDetails), may be null
 * @param {Function} stateInfoFn  - getStateInfo(code) → full state name or null
 * @param {Function} extensionFn  - getExtensionService(code) → URL string
 */
export function buildResponse(zip, zoneData, zoneDetails, stateInfoFn, extensionFn) {
  const parsed = parseZone(zoneData.zone);
  const loc = ZIP_LOCATIONS[zip] ?? approxLocation(zip);
  const stateFull = stateInfoFn(loc.state);

  return {
    zipCode: zip,
    zone: {
      full:    parsed.full,
      number:  parsed.number,
      subZone: parsed.sub,
      name:    `Zone ${parsed.full}`,
    },
    temperature: {
      rangeF: zoneDetails?.tempF ?? zoneData.trange,
      rangeC: zoneDetails?.tempC ?? null,
    },
    location: {
      city:        loc.city ?? null,
      state:       loc.state,
      stateFull:   stateFull ?? loc.stateFull ?? loc.state,
      approximate: loc.approximate ?? false,
    },
    // Growing season is keyed by zone NUMBER (1–13), not the zone string.
    // zoneDetails contains temperature data only — it must not go here.
    growing: GROWING_INFO[parsed.number] ?? null,
    resources: {
      usdaMap:          "https://planthardiness.ars.usda.gov/",
      extensionService: extensionFn(loc.state),
    },
    dataSource: {
      name:     "USDA Plant Hardiness Zone Map (2023)",
      provider: "USDA-ARS / Oregon State University PRISM Climate Group",
    },
  };
}
