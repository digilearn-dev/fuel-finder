// Cheapest fuel near me — data build
// Pulls all forecourts + prices from the UK Fuel Finder API and writes a static site to dist/:
//   dist/index.html          the page
//   dist/data/meta.json      { fetchedAt, tile, tiles: [...keys], stations }
//   dist/data/t/<key>.json   stations in one ~16x17 mile grid cell
// The page loads only the cells around the searched location.
//
// Usage: FF_CLIENT_ID=.. FF_CLIENT_SECRET=.. node scripts/refresh.mjs
//        node scripts/refresh.mjs --sample   (fake stations, for trying the page locally)

import { mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = `${ROOT}dist`;
const BASE_URL = process.env.FF_BASE_URL || "https://www.fuel-finder.service.gov.uk";
const MAX_BATCHES = 100;
const TILE = { lat: 0.25, lng: 0.4 }; // degrees; the page reads this from meta.json

// ---------- Fuel Finder API ----------

async function getToken() {
  const { FF_CLIENT_ID, FF_CLIENT_SECRET } = process.env;
  if (!FF_CLIENT_ID || !FF_CLIENT_SECRET) throw new Error("FF_CLIENT_ID and FF_CLIENT_SECRET must be set");
  const res = await fetch(`${BASE_URL}/api/v1/oauth/generate_access_token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: FF_CLIENT_ID, client_secret: FF_CLIENT_SECRET }),
  });
  if (res.status === 429) throw new Error("Token endpoint rate limited (bad credentials lock out for 5 min)");
  if (!res.ok) throw new Error(`Token endpoint returned ${res.status}`);
  const body = await res.json();
  const token = (body.data || body).access_token;
  if (!token) throw new Error("No access_token in token response");
  return token;
}

async function fetchBatched(token, path) {
  const out = [];
  for (let batch = 1; batch <= MAX_BATCHES; batch++) {
    const res = await fetch(`${BASE_URL}${path}?batch-number=${batch}`, {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (res.status === 404 && batch > 1) break; // API 404s past the last batch
    if (!res.ok) throw new Error(`${path} batch ${batch} returned ${res.status}`);
    const page = await res.json();
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
  }
  return out;
}

// Join stations + prices into a compact array the page can use.
function buildDataset(stationsRaw, pricesRaw) {
  const byId = new Map();
  for (const s of stationsRaw) {
    if (s.permanent_closure || s.temporary_closure) continue;
    const loc = s.location || {};
    const lat = Number(loc.latitude), lng = Number(loc.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    byId.set(s.node_id, {
      id: s.node_id,
      name: s.trading_name || "",
      brand: s.brand_name || null,
      addr: [loc.address_line_1, loc.city].filter(Boolean).join(", "),
      pc: loc.postcode || null,
      lat: Math.round(lat * 1e5) / 1e5,
      lng: Math.round(lng * 1e5) / 1e5,
      mway: !!s.is_motorway_service_station,
      smkt: !!s.is_supermarket_service_station,
      p: {}, // fuel code -> [pence per litre, updated ISO]
    });
  }
  for (const row of pricesRaw) {
    const st = byId.get(row.node_id);
    if (!st) continue;
    for (const fp of row.fuel_prices || []) {
      const price = Number(fp.price);
      // Ignore obvious bad data (e.g. prices entered in pounds or with a missing digit)
      if (!fp.fuel_type || !Number.isFinite(price) || price < 50 || price > 400) continue;
      st.p[fp.fuel_type] = [price, fp.price_last_updated || null];
    }
  }
  return [...byId.values()].filter((s) => Object.keys(s.p).length > 0);
}

// ---------- Sample data ----------

function sampleDataset() {
  const towns = [["London", 51.507, -0.128], ["Manchester", 53.481, -2.242], ["Glasgow", 55.864, -4.252]];
  const brands = ["Tesco", "Shell", "BP", "Esso", "Sainsbury's", "Asda", "Texaco", "Morrisons"];
  const out = [];
  let n = 0;
  for (const [town, lat0, lng0] of towns) {
    for (let i = 0; i < 80; i++, n++) {
      const brand = brands[n % brands.length];
      const base = 128 + Math.random() * 20;
      const ago = () => new Date(Date.now() - Math.random() * (n % 9 === 0 ? 20 : 2) * 86400e3).toISOString();
      out.push({
        id: `sample-${n}`, name: `${brand} ${town} ${i + 1}`, brand, addr: `${i + 1} Sample Road, ${town}`, pc: null,
        lat: Math.round((lat0 + (Math.random() - 0.5) * 0.4) * 1e5) / 1e5,
        lng: Math.round((lng0 + (Math.random() - 0.5) * 0.6) * 1e5) / 1e5,
        mway: n % 17 === 0, smkt: ["Tesco", "Sainsbury's", "Asda", "Morrisons"].includes(brand),
        p: {
          E10: [Math.round(base * 10) / 10, ago()],
          E5: [Math.round((base + 12) * 10) / 10, ago()],
          B7_STANDARD: [Math.round((base + 6) * 10) / 10, ago()],
          ...(n % 3 === 0 ? { B7_PREMIUM: [Math.round((base + 20) * 10) / 10, ago()] } : {}),
        },
      });
    }
  }
  return out;
}

// ---------- Output ----------

const tileKey = (lat, lng) => `${Math.floor(lat / TILE.lat)}_${Math.floor(lng / TILE.lng)}`;

async function writeSite(stations) {
  const tiles = new Map();
  for (const s of stations) {
    const k = tileKey(s.lat, s.lng);
    if (!tiles.has(k)) tiles.set(k, []);
    tiles.get(k).push(s);
  }
  await rm(OUT, { recursive: true, force: true });
  await mkdir(`${OUT}/data/t`, { recursive: true });
  await copyFile(`${ROOT}site/index.html`, `${OUT}/index.html`);
  await Promise.all([...tiles].map(([k, list]) => writeFile(`${OUT}/data/t/${k}.json`, JSON.stringify(list))));
  const meta = { fetchedAt: new Date().toISOString(), tile: TILE, tiles: [...tiles.keys()].sort(), stations: stations.length };
  await writeFile(`${OUT}/data/meta.json`, JSON.stringify(meta));
  return tiles.size;
}

const sample = process.argv.includes("--sample");
let stations;
if (sample) {
  stations = sampleDataset();
} else {
  const token = await getToken();
  const [stationsRaw, pricesRaw] = await Promise.all([
    fetchBatched(token, "/api/v1/pfs"),
    fetchBatched(token, "/api/v1/pfs/fuel-prices"),
  ]);
  console.log(`Fetched ${stationsRaw.length} stations and ${pricesRaw.length} price rows`);
  stations = buildDataset(stationsRaw, pricesRaw);
  // Failing here stops the workflow, so the previously published prices stay live
  if (stations.length === 0) throw new Error("Refresh produced no stations");
}
const tileCount = await writeSite(stations);
console.log(`Wrote ${stations.length} ${sample ? "sample " : ""}stations in ${tileCount} tiles to dist/`);
