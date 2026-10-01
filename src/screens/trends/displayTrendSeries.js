// Presentation only. Carry known values across empty buckets without changing
// stored reports, leaderboards, averages, or measured trend deltas.
function buildDisplayTrendSeries(observations, { latestObservedAverage, now = Date.now() } = {}) {
    const byTime = new Map();
    for (const point of observations || []) {
        const time = Date.parse(point?.date);
        if (Number.isFinite(time) && time <= now && Number.isFinite(point?.price) && point.price > 0) {
            byTime.set(time, { ...point });
        }
    }
    if (!byTime.size && latestObservedAverage?.price > 0 && Number.isFinite(latestObservedAverage.price)) {
        const time = Date.parse(latestObservedAverage.date);
        if (Number.isFinite(time) && time <= now) byTime.set(time, { ...latestObservedAverage });
    }
    const points = [...byTime].sort((a, b) => a[0] - b[0]);
    if (!points.length) return [];
    const bucket = points.length > 1 && points.every(([time]) => time % 86400000 === 0) ? 86400000 : 3600000;
    const result = [];
    for (let index = 0; index < points.length; index++) {
        const [time, point] = points[index];
        result.push(point);
        const end = points[index + 1]?.[0] ?? now;
        // Bound display work even if imported history spans years.
        const step = Math.max(bucket, Math.ceil((end - time) / 1000));
        for (let at = time + step; at < end; at += step) {
            result.push({ date: new Date(at).toISOString(), price: point.price, carriedForward: true });
        }
    }
    const last = result.at(-1);
    if (Date.parse(last.date) < now) result.push({ date: new Date(now).toISOString(), price: last.price, carriedForward: true });
    // A single observation still draws a full-width flat line. This duplicate
    // has the same timestamp/value and is solely a rendering endpoint.
    if (result.length === 1) result.push({ ...last, carriedForward: true });
    return result;
}
module.exports = { buildDisplayTrendSeries };
