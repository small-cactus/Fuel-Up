// MapKit owns interpolation. JS only submits a new target when the user or
// station set changes, never on a timer or on every rendered animation frame.
export function buildOverviewCoordinates(stations, userLocation) {
    const points = [...(stations || []), userLocation].filter(point =>
        Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude));
    if (!points.length) return [];
    if (points.length === 1) {
        const point = points[0];
        return [
            { latitude: point.latitude - 0.004, longitude: point.longitude - 0.004 },
            { latitude: point.latitude + 0.004, longitude: point.longitude + 0.004 },
        ];
    }
    return points.map(({ latitude, longitude }) => ({ latitude, longitude }));
}

export function cameraTargetChanged(previous, next) {
    if (!previous || previous.stationSignature !== next.stationSignature || previous.paddingSignature !== next.paddingSignature) return true;
    // Ignore GPS jitter, while still following meaningful movement.
    const dy = (next.latitude - previous.latitude) * 111320;
    const dx = (next.longitude - previous.longitude) * 111320 * Math.cos(next.latitude * Math.PI / 180);
    return Math.hypot(dx, dy) >= 20;
}

export function homeMapPadding({ topInset, bottomInset, cardHeight, width }) {
    return {
        top: topInset + 88,
        bottom: bottomInset + 60 + cardHeight + 24,
        left: Math.min(68, width * 0.16),
        right: Math.min(68, width * 0.16),
    };
}
