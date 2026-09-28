import { buildGasBuddyGraphQLRequest, normalizeGasBuddyResponse, calculateDistanceMiles } from './core.mjs';
import { applyValidationToStationQuotes, buildLatestQuotesFromRows, fetchAreaHistoryRows, sanitizeStationQuotesForFuelType } from './stationData.mjs';

export class ServiceError extends Error {
    constructor(code, status = 502) { super(code); this.code = code; this.status = status; }
}
export function validateInput(input) {
    const { latitude, longitude, fuelType = 'regular', radiusMiles = 10, forceRefresh = false } = input || {};
    if (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
        typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
        !['regular', 'midgrade', 'premium', 'diesel', 'e85'].includes(fuelType) ||
        typeof radiusMiles !== 'number' || !Number.isFinite(radiusMiles) || radiusMiles < 1 || radiusMiles > 100 ||
        typeof forceRefresh !== 'boolean') throw new ServiceError('INVALID_INPUT', 400);
    return { latitude, longitude, fuelType, radiusMiles, forceRefresh };
}
export function queryKey(input) {
    // Fine coordinates avoid presenting a neighbouring query as complete coverage.
    return `${input.latitude.toFixed(4)}:${input.longitude.toFixed(4)}:${input.fuelType}:${input.radiusMiles}`;
}
function output(quotes, input, source, summary = {}) {
    return { version: 1, source, quotes: sanitizeStationQuotesForFuelType(quotes, input.fuelType)
        .filter(q => q.providerId === 'gasbuddy' && Number.isFinite(q.latitude) && Number.isFinite(q.longitude))
        .map(q => ({ ...q, distanceMiles: calculateDistanceMiles(input, q) }))
        .filter(q => q.distanceMiles <= input.radiusMiles), summary };
}
export async function fetchProvider(input, fetchImpl = fetch, csrf = '1.Y2RjCddx4SvvGneh') {
    const request = buildGasBuddyGraphQLRequest(input);
    const response = await fetchImpl(request.url, { method: 'POST',
        headers: { ...request.headers, gbcsrf: csrf }, body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new ServiceError(`UPSTREAM_HTTP_${response.status}`);
    let payload;
    try { payload = await response.json(); } catch { throw new ServiceError('UPSTREAM_INVALID_JSON'); }
    if (payload?.errors?.length) throw new ServiceError('UPSTREAM_GRAPHQL_ERROR');
    const stations = payload?.data?.locationBySearchTerm?.stations?.results;
    if (!Array.isArray(stations)) throw new ServiceError('UPSTREAM_SCHEMA_CHANGED');
    if (stations.some(s => !s || !Array.isArray(s.prices) || !Number.isFinite(s.latitude) || !Number.isFinite(s.longitude))) {
        throw new ServiceError('UPSTREAM_STATION_SCHEMA_CHANGED');
    }
    return { quotes: sanitizeStationQuotesForFuelType(normalizeGasBuddyResponse({ origin: input, fuelType: input.fuelType, payload }) || [], input.fuelType), stationCount: stations.length };
}
export function toHistoryRows(quotes, input) {
    return quotes.map(q => ({ station_id: q.stationId, provider_id: 'gasbuddy', fuel_type: q.fuelType,
        all_prices: q.allPrices || {}, price: q.price, currency: q.currency,
        station_name: String(q.stationName).slice(0, 255), address: String(q.address).slice(0, 500),
        latitude: q.latitude, longitude: q.longitude,
        // Service-generated rows have no end-user identity.
        user_uuid: '00000000-0000-4000-8000-000000000001',
        search_latitude_rounded: Math.round(input.latitude * 10) / 10,
        search_longitude_rounded: Math.round(input.longitude * 10) / 10,
        source_label: q.sourceLabel, rating: q.rating, user_rating_count: q.userRatingCount,
        updated_at_source: q.updatedAt }));
}
export async function getGasPrices({ input: rawInput, db, fetchImpl = fetch, csrf, probeOnly = false, recordOutcome = async () => {} }) {
    const input = validateInput(rawInput);
    const key = queryKey(input);
    const now = Date.now();
    const { data: cached, error: cacheError } = await db.from('fuel_query_cache').select('quotes,expires_at').eq('query_key', key).maybeSingle();
    if (cacheError) throw new ServiceError('CACHE_UNAVAILABLE', 503);
    if (!probeOnly && !input.forceRefresh && cached && Date.parse(cached.expires_at) > now) return output(cached.quotes, input, 'cache');
    const { data: lease, error: leaseError } = probeOnly ? { data: null, error: null } : await db.rpc('claim_fuel_refresh', { p_key: key });
    if (leaseError) throw new ServiceError('CACHE_UNAVAILABLE', 503);
    if (!probeOnly && !lease) throw new ServiceError('REFRESH_IN_PROGRESS', 503);
    try {
        const { data: history, error: historyError } = await fetchAreaHistoryRows({ supabase: db,
            searchLat: Math.round(input.latitude * 10) / 10, searchLng: Math.round(input.longitude * 10) / 10, fuelType: input.fuelType });
        const historyRows = (history || []).filter(r => r.provider_id === 'gasbuddy');
        // Reuse externally filled GasBuddy history before spending an upstream call.
        if (!probeOnly && !input.forceRefresh && historyRows.some(row => Date.parse(row.created_at) > now - 10 * 60_000)) {
            const quotes = buildLatestQuotesFromRows({ rows: historyRows, origin: input, fallbackSourceLabel: 'GasBuddy (area cache)' });
            const cachedResult = output(quotes, input, 'cache-fill');
            if (cachedResult.quotes.length) {
                const newest = Math.max(...historyRows.map(row => Date.parse(row.created_at)).filter(Number.isFinite));
                await db.from('fuel_query_cache').upsert({ query_key: key, quotes: cachedResult.quotes,
                    expires_at: new Date(Math.min(now + 10 * 60_000, newest + 10 * 60_000)).toISOString() });
                return cachedResult;
            }
        }
        let upstream;
        try {
            upstream = await fetchProvider(input, fetchImpl, csrf);
            if (!probeOnly) await recordOutcome(true, 'OK');
        } catch (error) {
            const code = error instanceof ServiceError ? error.code : 'UPSTREAM_NETWORK_ERROR';
            if (!probeOnly) await recordOutcome(false, code);
            throw new ServiceError(code);
        }
        const validated = sanitizeStationQuotesForFuelType(applyValidationToStationQuotes({
            stationQuotes: upstream.quotes, historyRows, origin: input }), input.fuelType);
        const liveIds = new Set(validated.map(q => q.stationId));
        const fallback = buildLatestQuotesFromRows({ rows: historyRows, origin: input, fallbackSourceLabel: 'GasBuddy (area cache)' })
            .filter(q => !liveIds.has(q.stationId));
        const result = output([...validated, ...fallback], input, 'live', {
            liveQuoteCount: validated.length, fallbackQuoteCount: fallback.length, resultCount: upstream.stationCount,
            adjustedQuoteCount: validated.filter(q => q.validation?.usedPrediction).length,
            ...(historyError ? { historyUnavailable: true } : {}),
        });
        if (probeOnly) return result;
        if (validated.length) {
            const { error } = await db.from('station_prices').insert(toHistoryRows(validated, input));
            result.summary.persistedLiveRowCount = error ? 0 : validated.length;
            if (error) result.summary.persistError = 'History write unavailable';
        }
        // Empty results get a short negative-cache TTL; they are not incidents.
        const ttl = result.quotes.length ? 10 * 60_000 : 60_000;
        const { error } = await db.from('fuel_query_cache').upsert({ query_key: key, quotes: result.quotes,
            expires_at: new Date(Date.now() + ttl).toISOString() });
        if (error) result.summary.cacheWriteFailed = true;
        return result;
    } finally {
        if (lease) await db.rpc('release_fuel_refresh', { p_key: key, p_token: lease });
    }
}
