const listeners = new Set();
let version = 0;
function publishTrendCacheChange() {
    version++;
    listeners.forEach(listener => listener());
}
module.exports = {
    publishTrendCacheChange,
    subscribeTrendCache: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    getTrendCacheVersion: () => version,
};
