export { buildVisibleStations as buildLabStations } from '../../lib/visibleStations.js';

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
