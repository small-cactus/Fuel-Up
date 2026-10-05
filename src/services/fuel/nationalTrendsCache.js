import { fetchNationalTrends } from './nationalLeaderboard';

const CACHE_TTL_MS = 60 * 60000;
const cache = new Map();
const prefetches = new Map();

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
}

// Onboarding owns this request. A tab can join it without cancelling it when
// the tab loses focus; the tab's existing scope/abort guards still protect UI.
export function prefetchNationalTrends(options) {
    const scope = nationalTrendsScope(options);
    const cached = cache.get(scope);
    if (isNationalTrendsFresh(cached)) return Promise.resolve(cached);
    if (prefetches.has(scope)) return prefetches.get(scope);
    const request = fetchNationalTrends(options).then(response => {
        const result = { scope, ...response, loadedAt: Date.now(), error: null };
        if (!response.historyError) rememberNationalTrends(scope, result);
        return result;
    }).finally(() => {
        if (prefetches.get(scope) === request) prefetches.delete(scope);
    });
    prefetches.set(scope, request);
    return request;
}
