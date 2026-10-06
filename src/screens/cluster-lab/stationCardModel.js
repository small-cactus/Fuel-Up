import { buildVisibleStations } from '../../lib/visibleStations.js';
import { getFuelGradeMeta } from '../../lib/fuelGrade.js';
import { stationOffersE85 } from '../../lib/stationPreferences.js';

export function buildLabStations(snapshot, options = {}, e85Snapshot = null) {
    const main = buildVisibleStations(snapshot, { ...options, requiresE85: false });
    const extra = options.requiresE85 && options.fuelGrade !== 'e85'
        ? buildVisibleStations(e85Snapshot, { ...options, fuelGrade: 'e85', requiresE85: false }) : [];
    const ids = new Set(main.map(station => station.id));
    const ethanolIDs = new Set(extra.map(station => station.id));
    const primaryByID = new Map(main.map(station => [station.id, station]));
    const ethanolByID = new Map(extra.map(station => [station.id, station]));
    const priceText = value => Number.isFinite(value) && value > 0 ? `$${value.toFixed(2)}` : '—';
    const hasDualPrices = station => options.requiresE85 && options.fuelGrade !== 'e85' &&
        (stationOffersE85(station) || ethanolIDs.has(station.id));
    return [...main, ...extra.filter(station => !ids.has(station.id))].map((station, index) => ({
        ...station,
        dualPrices: hasDualPrices(station) ? {
            primaryLabel: getFuelGradeMeta(options.fuelGrade).octane,
            primaryPrice: priceText(primaryByID.get(station.id)?.price),
            e85Price: priceText(ethanolByID.get(station.id)?.price),
        } : null,
        secondaryUpdatedAt: hasDualPrices(station) ? ethanolByID.get(station.id)?.updatedAt : null,
        // Keep the selected grade's recommendation; do not rank cheaper ethanol
        // against gasoline. Added E85 quotes still retain their own display price.
        isRecommended: index === 0,
        comparisonPrice: !options.fuelGrade || station.fuelType === options.fuelGrade ? station.price : null,
        highlightE85: Boolean((options.requiresE85 || options.fuelGrade === 'e85') &&
            (stationOffersE85(station) || ethanolIDs.has(station.id))),
    }));
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
