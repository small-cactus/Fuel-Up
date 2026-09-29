import { filterStationQuotesForHome } from '../../lib/homeState.js';
import { rankQuotesForFuelGrade } from '../../lib/fuelGrade.js';
import { stationOffersE85 } from '../../lib/stationPreferences.js';

// Keep station identity and all quote metadata outside the rendered carousel.
export function buildLabStations(snapshot, { origin, radiusMiles, minimumRating = 0, fuelGrade, requiresE85 = false } = {}) {
    let quotes = [...(snapshot?.topStations || [])];
    if (snapshot?.quote) quotes.unshift(snapshot.quote);
    quotes = filterStationQuotesForHome({ quotes, origin, radiusMiles, minimumRating });
    if (fuelGrade) quotes = rankQuotesForFuelGrade(quotes, fuelGrade);
    if (requiresE85) quotes = quotes.filter(stationOffersE85);
    const byId = new Map();
    for (const quote of quotes) {
        if (quote.providerTier !== 'station' || quote.isEstimated || quote.stationId == null ||
            !Number.isFinite(quote.latitude) || !Number.isFinite(quote.longitude) ||
            Math.abs(quote.latitude) > 90 || Math.abs(quote.longitude) > 180 ||
            !Number.isFinite(quote.price) || quote.price <= 0) continue;
        const id = String(quote.stationId);
        if (!id) continue;
        byId.set(id, { ...quote, id, name: quote.stationName || quote.name || 'Gas station' });
    }
    // Match Swift's global cheapest/tie ordering, regardless of input order.
    return [...byId.values()].sort((a, b) => a.price - b.price || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function stationAge(updatedAt, now = Date.now()) {
    const date = new Date(updatedAt).getTime();
    if (!updatedAt || !Number.isFinite(date)) return null;
    const minutes = Math.max(0, Math.floor((now - date) / 60000));
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
    return `${Math.floor(minutes / 1440)}d ago`;
}

export function stationDistance(miles) {
    if (!Number.isFinite(miles) || miles < 0) return null;
    return miles < 0.1 ? 'Right here' : `${miles.toFixed(1)} mi away`;
}

export function pageFromOffset(offset, width, count) {
    if (!Number.isFinite(offset) || width <= 0 || count < 1) return null;
    return Math.min(count - 1, Math.max(0, Math.round(offset / width)));
}


// A different fuel/filter/reset/origin must never reuse the prior Home result.
export function matchingHomeStationSnapshot(snapshot, { criteriaSignature, fuelResetToken, latitude, longitude }) {
    if (!snapshot || snapshot.criteriaSignature !== criteriaSignature || snapshot.fuelResetToken !== fuelResetToken) return null;
    // Match Home's region equality tolerance (sub-meter GPS rounding).
    if (Number.isFinite(latitude) && (!Number.isFinite(snapshot.origin?.latitude) ||
        !Number.isFinite(snapshot.origin?.longitude) || Math.abs(snapshot.origin.latitude - latitude) > 0.000001 ||
        Math.abs(snapshot.origin.longitude - longitude) > 0.000001)) return null;
    return snapshot;
}
