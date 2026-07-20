import { fetchTerritoryData } from "../src/lib/sheets.js";

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQugwzM2d854XUSxfQBG-UXngD8bhKp-Tt72E_BEgeS80PtoQXNQg0YTFOt70iNE3s3sr2b6NSOfZoo/pub?output=csv";

const CACHE_TTL_MS = 60_000;
let cache = { data: null, timestamp: 0 };

export async function getTerritories() {
  const now = Date.now();
  if (cache.data && now - cache.timestamp < CACHE_TTL_MS) {
    return cache.data;
  }
  const data = await fetchTerritoryData(SHEET_URL);
  cache = { data, timestamp: now };
  return data;
}