import { fetchNationalTrends } from './nationalLeaderboard';
import { publishTrendCacheChange } from './trendCacheEvents';
import { trendSnapshotStore } from './trendSnapshotStore';

const CACHE_TTL_MS = 60 * 60000;
const cache = new Map();
const prefetches = new Map();
let generation = 0;
const diskKey = ({ fuelType, requiresE85 }) => `national:${JSON.stringify([fuelType, requiresE85])}`;

export const nationalTrendsScope = ({ fuelType, requiresE85, resetToken }) =>
    JSON.stringify([fuelType, requiresE85, resetToken]);
export const getCachedNationalTrends = scope => cache.get(scope);
export const getNationalTrendsPrefetch = scope => prefetches.get(scope);
export function isNationalTrendsFresh(result) {
    const now = Date.now();
    return Boolean(result && now >= result.loadedAt
        && now < Math.min(result.loadedAt + CACHE_TTL_MS, Date.parse(result.refreshAfter) || Infinity));
}
export function rememberNationalTrends(scope, result) {
    cache.delete(scope);
    cache.set(scope, result);
    if (cache.size > 20) cache.delete(cache.keys().next().value);
    publishTrendCacheChange();
}

export function clearNationalTrendsCache() {
    generation++;
    cache.clear();
    prefetches.clear();
    publishTrendCacheChange();
}
export async function restoreNationalTrends(options) {
    const started = generation;
    const scope = nationalTrendsScope(options);
    const saved = await trendSnapshotStore.get(diskKey(options));
    if (started === generation && saved && Array.isArray(saved.quotes)
        && Array.isArray(saved.trendData?.averagePricesByDay) && !cache.has(scope)) {
        rememberNationalTrends(scope, { ...saved, scope });
    }
}

// Shared by launch, onboarding and the tab. Changing tabs does not cancel an
// app-wide refresh; each consumer still guards its own scope before rendering.
export function prefetchNationalTrends(options) {
    const scope = nationalTrendsScope(options);
    const cached = cache.get(scope);
    if (prefetches.has(scope)) return prefetches.get(scope);
    const age = Date.now() - cached?.loadedAt;
    if ((!options.force && isNationalTrendsFresh(cached))
        || (options.force && age >= 0 && age < (options.maxAgeMs || 0))) return Promise.resolve(cached);
    const started = generation;
    const request = fetchNationalTrends(options).then(response => {
        const result = { scope, ...response, loadedAt: Date.now(), error: null };
        if (started !== generation) return null;
        if (!response.historyError) {
            rememberNationalTrends(scope, result);
            void trendSnapshotStore.set(diskKey(options), result);
        }
        return result;
    }).finally(() => {
        if (prefetches.get(scope) === request) prefetches.delete(scope);
    });
    prefetches.set(scope, request);
    return request;
}
