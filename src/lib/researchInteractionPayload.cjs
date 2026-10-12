// Explicit allowlist: never serialize a provider response or unrelated UI state.
function stationSnapshot(station, { fuelGrade, rank } = {}) {
    if (!station || typeof station !== 'object') return null;
    const result = {};
    const identifier = station.id ?? station.stationId;
    if (typeof identifier === 'string' || Number.isFinite(identifier)) result.id = String(identifier).slice(0, 240);
    for (const key of ['id', 'name', 'brand', 'address', 'fuelType']) {
        if (typeof station[key] === 'string') result[key] = station[key].slice(0, 240);
    }
    for (const key of ['latitude', 'longitude', 'price', 'distanceMiles']) {
        if (Number.isFinite(station[key])) result[key] = station[key];
    }
    if (Math.abs(result.latitude) > 90) delete result.latitude;
    if (Math.abs(result.longitude) > 180) delete result.longitude;
    if (typeof station.updatedAt === 'string') result.priceUpdatedAt = station.updatedAt.slice(0, 80);
    if (Number.isFinite(station.updatedAt)) result.priceUpdatedAt = station.updatedAt;
    if (typeof fuelGrade === 'string' || Number.isFinite(fuelGrade)) result.fuelGrade = fuelGrade;
    if (Number.isInteger(rank) && rank > 0) result.displayedRank = rank;
    return Object.keys(result).length ? result : null;
}
function interactionPayload(action, fields = {}, now = Date.now()) {
    if (!['station_go', 'station_select', 'map_gesture', 'map_show_all'].includes(action)) return null;
    const payload = { action, clientOccurredAt: now / 1000 };
    if (typeof fields.surface === 'string') payload.surface = fields.surface.slice(0, 80);
    if (typeof fields.gesture === 'string') payload.gesture = fields.gesture.slice(0, 40);
    if (typeof fields.phase === 'string') payload.phase = fields.phase.slice(0, 40);
    const station = stationSnapshot(fields.station, fields);
    if (station) payload.station = station;
    if (fields.viewport) {
        const viewport = {};
        for (const key of ['latitude', 'longitude', 'latitudeDelta', 'longitudeDelta', 'heading', 'distanceMeters']) {
            if (Number.isFinite(fields.viewport[key])) viewport[key] = fields.viewport[key];
        }
        payload.viewport = viewport;
    }
    return payload;
}
module.exports = { stationSnapshot, interactionPayload };
