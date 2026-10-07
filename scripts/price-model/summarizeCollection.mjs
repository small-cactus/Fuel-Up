// Coverage-only summary: no fitting, price-change analysis, or holdout scoring.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: summarizeCollection.mjs export.json.gz new-summary.json');
const bytes = readFileSync(input);
const data = JSON.parse(gunzipSync(bytes));
if (data.version !== 1 || !Array.isArray(data.snapshots)) throw Error('Unsupported export');
const seen = new Set(), cities = new Map(), stations = new Set();
const splits = { training: 0, validation: 0, reservedFinal: 0 };
let observations = 0, withoutAnyPrice = 0;
for (const row of data.snapshots) {
  if (seen.has(row.job_id)) throw Error('Duplicate snapshot job');
  seen.add(row.job_id);
  const at = Date.parse(row.observed_at);
  if (!Number.isFinite(at) || at > Date.parse(data.exportCutoff)) throw Error('Invalid observation time');
  splits[at < Date.parse('2026-10-03T18:19:00Z') ? 'training'
    : at < Date.parse('2026-10-05T18:19:00Z') ? 'validation' : 'reservedFinal']++;
  const city = cities.get(row.city_id) || { city: row.city_id, snapshots: 0, stationObservations: 0 };
  city.snapshots++;
  if (!Array.isArray(row.payload?.stations)) throw Error('Missing station payload');
  for (const station of row.payload.stations) {
    stations.add(station.stationId);
    observations++;
    city.stationObservations++;
    if (!station.prices?.some(quote => [quote.cash, quote.credit]
      .some(payment => Number.isFinite(payment?.price) && payment.price > 0))) withoutAnyPrice++;
  }
  cities.set(row.city_id, city);
}
if (seen.size !== data.health.succeeded || observations !== data.health.station_observations) {
  throw Error('Export totals do not match campaign health');
}
const summary = {
  campaign: data.campaign, exportCutoff: data.exportCutoff,
  sha256: createHash('sha256').update(bytes).digest('hex'), compressedBytes: bytes.length,
  plannedCityHours: data.health.planned_city_hours, snapshots: seen.size,
  missedCityHours: data.health.missed, stationObservations: observations,
  uniqueStationIds: stations.size, observationsWithoutAnyPrice: withoutAnyPrice,
  observationTimeSplitCounts: splits, cities: [...cities.values()].sort((a, b) => a.city.localeCompare(b.city)),
  limitation: 'Provider-selected city panels and reported quotes, not complete city inventories or pump truth. Split counts are inventory only; reserved final observations were not used for fitting or evaluation.',
};
writeFileSync(output, JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ snapshots: seen.size, stationObservations: observations, sha256: summary.sha256 }));
