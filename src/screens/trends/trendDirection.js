// Color and percentage must describe the same observed interval. Looking only
// at the final two buckets can make an overall decline appear red.
function getTrendDirectionFromData(data) {
    const points = data?.averagePricesByDay;
    if (!points || points.length < 2) return null;
    const delta = Number.isFinite(data?.overallTrend?.delta) ? data.overallTrend.delta
        : points.at(-1).price - points[0].price;
    if (!Number.isFinite(delta)) return null;
    return delta < 0 ? 'lower' : delta > 0 ? 'higher' : 'flat';
}
module.exports = { getTrendDirectionFromData };
