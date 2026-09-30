import { buildGasBuddyGraphQLRequest } from './core.mjs';

const fuels = { regular_gas: 'regular', midgrade_gas: 'midgrade', premium_gas: 'premium', diesel: 'diesel', e85: 'e85' };
export class CollectionError extends Error {
    constructor(code, retryAfterSeconds = 0) { super(code); this.code = code; this.retryAfterSeconds = retryAfterSeconds; }
}

export function normalizeResearchPayload(payload) {
    const area = payload?.data?.locationBySearchTerm;
    if (payload?.errors?.length) throw new CollectionError('UPSTREAM_GRAPHQL_ERROR');
    if (!Array.isArray(area?.stations?.results)) throw new CollectionError('UPSTREAM_SCHEMA_CHANGED');
    if (area.countryCode && area.countryCode !== 'US') throw new CollectionError('UNEXPECTED_COUNTRY');
    const payment = value => {
        if (!value || !Number.isFinite(value.price) || value.price <= 0) return null;
        // Preserve the grade/payment's own source time, even when invalid or absent.
        // Later analysis can flag it; never borrow a different grade's timestamp.
        return { price: value.price, sourceUpdatedAt: typeof value.postedTime === 'string' ? value.postedTime : null };
    };
    const stations = area.stations.results.map(station => {
        if (!station?.id || !Number.isFinite(station.latitude) || !Number.isFinite(station.longitude) || !Array.isArray(station.prices)) {
            throw new CollectionError('UPSTREAM_STATION_SCHEMA_CHANGED');
        }
        return { stationId: String(station.id), name: String(station.name || '').slice(0, 255),
            brands: (station.brands || []).map(brand => String(brand.name).slice(0, 100)),
            latitude: station.latitude, longitude: station.longitude,
            prices: station.prices.filter(quote => fuels[quote.fuelProduct]).map(quote => ({
                fuel: fuels[quote.fuelProduct], cash: payment(quote.cash), credit: payment(quote.credit) })) };
    });
    if (!stations.length || !stations.some(station => station.prices.some(price => price.cash || price.credit))) {
        throw new CollectionError('NO_USABLE_QUOTES');
    }
    if (new Set(stations.map(station => station.stationId)).size !== stations.length) throw new CollectionError('DUPLICATE_STATIONS');
    return { version: 1, provider: 'gasbuddy', resultCount: area.stations.count ?? null, stations };
}

export async function fetchResearchSnapshot(city, { fetchImpl = fetch, csrf, now = () => new Date().toISOString() } = {}) {
    const request = buildGasBuddyGraphQLRequest({ latitude: city.latitude, longitude: city.longitude, fuelType: 'regular' });
    const startedAt = now();
    const response = await fetchImpl(request.url, { method: 'POST',
        headers: { ...request.headers, ...(csrf ? { gbcsrf: csrf } : {}) },
        body: JSON.stringify(request.body), signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
        const retry = response.headers.get('retry-after');
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : Math.max(0, (Date.parse(retry || '') - Date.now()) / 1000);
        throw new CollectionError(`UPSTREAM_HTTP_${response.status}`, Number.isFinite(seconds) ? Math.ceil(seconds) : 0);
    }
    const body = await response.text();
    if (body.length > 2_000_000) throw new CollectionError('UPSTREAM_BODY_TOO_LARGE');
    let payload;
    try { payload = JSON.parse(body); } catch { throw new CollectionError('UPSTREAM_INVALID_JSON'); }
    return { startedAt, observedAt: now(), payload: normalizeResearchPayload(payload) };
}

export async function collectDueResearchJobs({ db, fetchSnapshot = fetchResearchSnapshot, csrf }) {
    const { data: jobs, error } = await db.rpc('claim_fuel_research_jobs', { p_limit: 2 });
    if (error) throw new CollectionError('CLAIM_FAILED');
    const results = [];
    for (const job of jobs || []) {
        try {
            const snapshot = await fetchSnapshot(job, { csrf });
            const { data: saved, error: saveError } = await db.rpc('finish_fuel_research_job', {
                p_id: job.id, p_token: job.lease_token, p_started_at: snapshot.startedAt,
                p_observed_at: snapshot.observedAt, p_payload: snapshot.payload });
            if (saveError || !saved) throw new CollectionError('SNAPSHOT_COMMIT_FAILED');
            results.push({ id: job.id, city: job.city_id, status: 'succeeded', stations: snapshot.payload.stations.length });
        } catch (error) {
            const code = error instanceof CollectionError ? error.code : 'COLLECTION_NETWORK_ERROR';
            const { error: failureError } = await db.rpc('fail_fuel_research_job', { p_id: job.id, p_token: job.lease_token,
                p_code: code, p_retry_after_seconds: error instanceof CollectionError ? error.retryAfterSeconds : 0 });
            if (failureError) throw new CollectionError('FAILURE_RECORD_FAILED');
            results.push({ id: job.id, city: job.city_id, status: 'retry_pending', code });
            // Respect provider-wide cooldown immediately. Any remaining lease
            // expires safely and can be reclaimed; do not issue another request.
            if (error.retryAfterSeconds > 0 || ['UPSTREAM_HTTP_429', 'UPSTREAM_HTTP_403'].includes(code)) break;
        }
    }
    return results;
}

export function authorizedResearchRequest(request, secret) {
    const received = request.headers.get('x-fuel-research-key') || '';
    if (!secret || received.length !== secret.length) return false;
    let difference = 0;
    for (let i = 0; i < received.length; i++) difference |= received.charCodeAt(i) ^ secret.charCodeAt(i);
    return difference === 0;
}
