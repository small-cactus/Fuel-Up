import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResearchPayload, fetchResearchSnapshot, collectDueResearchJobs, CollectionError, authorizedResearchRequest } from '../supabase/functions/_shared/researchCollector.mjs';
const fixture = () => ({ data: { locationBySearchTerm: { countryCode: 'US', stations: { count: 100, results: [{
    id: 1, name: 'Station', latitude: 28, longitude: -82, brands: [{ name: 'Brand' }], prices: [
        { fuelProduct: 'regular_gas', credit: { price: 4, postedTime: '2026-09-30T12:00Z' }, cash: { price: 3.9, postedTime: '2026-09-29T12:00Z' } },
        { fuelProduct: 'premium_gas', credit: { price: 5, postedTime: '2026-09-28T12:00Z' } }] }] } } } });

test('research captures raw grades/payment times independently and keeps unchanged reports', () => {
    const result = normalizeResearchPayload(fixture());
    const prices = result.stations[0].prices;
    assert.equal(prices[0].credit.sourceUpdatedAt, '2026-09-30T12:00Z');
    assert.equal(prices[0].cash.sourceUpdatedAt, '2026-09-29T12:00Z');
    assert.equal(prices[1].credit.sourceUpdatedAt, '2026-09-28T12:00Z');
    assert.equal(prices[1].cash, null);
    assert.equal(result.resultCount, 100);
    assert.equal(result.stations.length, 1);
    assert.deepEqual(result, normalizeResearchPayload(fixture()));
});

test('unusable or changed schemas fail rather than recording empty successful hours', () => {
    assert.throws(() => normalizeResearchPayload({ data: {} }), /SCHEMA/);
    const payload = fixture(); payload.data.locationBySearchTerm.stations.results = [];
    assert.throws(() => normalizeResearchPayload(payload), /NO_USABLE/);
});

test('provider request bypasses our cache and preserves retry-after throttling', async () => {
    await assert.rejects(fetchResearchSnapshot({ latitude: 28, longitude: -82 }, {
        fetchImpl: async (url, options) => {
            assert.equal(url, 'https://www.gasbuddy.com/graphql');
            assert.equal(JSON.parse(options.body).variables.fuel, 1);
            return new Response('', { status: 429, headers: { 'retry-after': '1200' } });
        } }), error => error.code === 'UPSTREAM_HTTP_429' && error.retryAfterSeconds === 1200);
});

test('dedicated scheduler secret required; public client authorization is insufficient', () => {
    const secret = 'server-only-token';
    assert.equal(authorizedResearchRequest(new Request('https://example.com', { headers: { Authorization: 'Bearer public' } }), secret), false);
    assert.equal(authorizedResearchRequest(new Request('https://example.com', { headers: { 'x-fuel-research-key': secret } }), secret), true);
    assert.equal(authorizedResearchRequest(new Request('https://example.com'), undefined), false);
});

test('failed city does not lose the next leased job; writes only research RPCs', async () => {
    const calls = [];
    const db = { rpc: async (name, args) => {
        calls.push({ name, args });
        return name === 'claim_fuel_research_jobs' ? { data: [{ id: 1, city_id: 'a', lease_token: 'x' }, { id: 2, city_id: 'b', lease_token: 'y' }] } : { data: true };
    } };
    const results = await collectDueResearchJobs({ db, fetchSnapshot: async job => {
        if (job.id === 1) throw new CollectionError('UPSTREAM_HTTP_500');
        return { startedAt: '2026-09-30T12:00Z', observedAt: '2026-09-30T12:00:01Z', payload: normalizeResearchPayload(fixture()) };
    } });
    assert.deepEqual(results.map(result => result.status), ['retry_pending', 'succeeded']);
    assert.deepEqual(calls.map(call => call.name), ['claim_fuel_research_jobs', 'fail_fuel_research_job', 'finish_fuel_research_job']);
    assert.equal(calls[1].args.p_token, 'x');
    assert.equal(calls[2].args.p_token, 'y');
});
