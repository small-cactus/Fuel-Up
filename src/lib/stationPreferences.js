import { resolveQuotePriceForFuelGrade } from './fuelGrade.js';

export function normalizeStationBrand(name) {
    return typeof name === 'string'
        ? name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
        : '';
}

export function normalizePreferredBrands(brands) {
    return [...new Set((Array.isArray(brands) ? brands : []).map(normalizeStationBrand).filter(Boolean))].sort();
}

export function stationBrandNames(quote) {
    const brands = (Array.isArray(quote?.brandNames) ? quote.brandNames : []).filter(name => typeof name === 'string' && name.trim());
    return brands.length ? brands : [quote?.stationName].filter(name => typeof name === 'string' && name.trim());
}

export function stationOffersE85(quote) {
    // Unknown availability is not a match. Never infer E85 from a brand name.
    if (quote?.availableFuelGrades?.some(grade => ['e85', 'e_85'].includes(String(grade).toLowerCase()))) return true;
    const price = quote?.allPrices?.e85 ?? quote?.allPrices?.e_85;
    if (Number.isFinite(Number(price)) && Number(price) > 0) return true;
    return ['e85', 'e_85'].includes(quote?.fuelType) && Number(quote?.price) > 0;
}

export function rankStationQuotes(quotes, { preferredBrands = [], requiresE85 = false } = {}) {
    const preferred = new Set(normalizePreferredBrands(preferredBrands));
    const isPreferred = quote => stationBrandNames(quote).some(name => preferred.has(normalizeStationBrand(name)));
    const distance = quote => Number.isFinite(quote.distanceMiles) ? quote.distanceMiles : Infinity;
    return (quotes || []).filter(quote => !requiresE85 || stationOffersE85(quote)).slice().sort((a, b) =>
        Number(isPreferred(b)) - Number(isPreferred(a)) ||
        a.price - b.price || distance(a) - distance(b) || String(a.stationId).localeCompare(String(b.stationId)));
}

function distanceFrom(origin, quote) {
    if (![origin.latitude, origin.longitude, quote.latitude, quote.longitude].every(Number.isFinite)) return Number.isFinite(quote.distanceMiles) ? quote.distanceMiles : Infinity;
    const radians = degrees => degrees * Math.PI / 180;
    const a = Math.sin(radians(quote.latitude - origin.latitude) / 2) ** 2 +
        Math.cos(radians(origin.latitude)) * Math.cos(radians(quote.latitude)) * Math.sin(radians(quote.longitude - origin.longitude) / 2) ** 2;
    return 3958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function buildStationBrandOptions(quotes, { latitude, longitude, radiusMiles, fuelGrade, requiresE85 = false }) {
    const groups = new Map();
    for (const quote of quotes || []) {
        if (quote.isEstimated || (quote.providerTier && quote.providerTier !== 'station')) continue;
        if (resolveQuotePriceForFuelGrade(quote, fuelGrade) === null || (requiresE85 && !stationOffersE85(quote))) continue;
        const distance = distanceFrom({ latitude, longitude }, quote);
        if (!Number.isFinite(distance) || distance > radiusMiles) continue;
        for (const name of stationBrandNames(quote)) {
            const id = normalizeStationBrand(name);
            if (!id) continue;
            const group = groups.get(id) || { id, label: name.trim(), stations: new Set(), nearest: Infinity };
            group.stations.add(String(quote.stationId || `${quote.latitude}:${quote.longitude}:${quote.stationName}`));
            group.nearest = Math.min(group.nearest, distance);
            groups.set(id, group);
        }
    }
    return [...groups.values()].sort((a, b) => b.stations.size - a.stations.size || a.nearest - b.nearest || a.label.localeCompare(b.label))
        .map(({ id, label, stations }) => ({ id, label, count: stations.size }));
}
