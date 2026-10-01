const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/loadComponent.cjs');

async function setup(options = {}) {
    const grades = await import('../src/lib/fuelGrade.js');
    const home = await import('../src/lib/homeState.js');
    const preferences = await import('../src/lib/stationPreferences.js');
    const search = await import('../src/lib/fuelSearchState.js');
    const quotes = [
        { stationId: 'cheap', stationName: 'Other', brandNames: ['Other'], price: 3, allPrices: { regular: 3 } },
        { stationId: 'preferred', stationName: 'Shell', brandNames: ['Shell'], price: 4, allPrices: { regular: 4, e85: 2.5 } },
        { stationId: 'flex', stationName: 'Mobil', brandNames: ['Mobil'], price: 3.5, allPrices: { regular: 3.5, e85: 2.8 } },
    ].map(quote => ({ ...quote, latitude: 27.95, longitude: -82.45, fuelType: 'regular', providerTier: 'station', providerId: 'gasbuddy', rating: 4, updatedAt: new Date().toISOString() }));
    const rows = [1, 25].flatMap(hours => quotes.map(quote => ({
        station_id: quote.stationId, station_name: quote.stationName, fuel_type: 'regular', price: quote.price,
        provider_id: 'gasbuddy', all_prices: { ...quote.allPrices, _payment: { regular: { credit: quote.price } } }, updated_at_source: new Date(Date.now() - hours * 3600000).toISOString(), latitude: quote.latitude, longitude: quote.longitude,
        created_at: new Date(Date.now() - hours * 3600000).toISOString(),
    })));
    const db = { select() { return this; }, eq() { return this; }, gte() { return this; }, order() { return this; },
        limit: async () => ({ data: options.noHistory ? [] : rows, error: null }) };
    return load('src/services/fuel/trends.js', {
        '../../lib/supabase.js': { supabase: { from: () => db } },
        '../../lib/fuelGrade.js': grades,
        '../../lib/homeState.js': home,
        '../../lib/stationPreferences.js': preferences,
        '../../lib/fuelSearchState.js': search,
        './index': { getCachedFuelPriceSnapshot: async () => options.cachedSnapshot || null, refreshFuelPriceSnapshot: async () => { if (options.noRefetch) assert.fail('Trends refetched the fresh Home snapshot'); return { snapshot: { topStations: quotes } }; } },
        './priceValidation': { buildValidationState: input => ({ outputs: input.map(row => ({ row, result: { finalDisplayedPrice: row.price } })) }) },
    });
}

test('local ranking stays price-first like Home even with preferred brands', async () => {
    const trends = await setup();
    const result = await trends.fetchTrendData({ latitude: 27.95, longitude: -82.45, fuelType: 'regular', preferredBrands: ['shell'] });
    assert.deepEqual(result.leaderboard.map(row => row.stationId), ['cheap', 'flex', 'preferred']);
    assert.equal(result.averagePricesByDay.at(-1).price, 3.5);
    assert.ok(result.leaderboard.every(row => row.rankShift === 0), 'price-first ordering applies to historical and current ranks');
});

test('requiring E85 excludes unavailable stations from leaderboard and historical averages', async () => {
    const trends = await setup();
    const result = await trends.fetchTrendData({ latitude: 27.95, longitude: -82.45, fuelType: 'regular', preferredBrands: ['shell'], requiresE85: true });
    assert.deepEqual(result.leaderboard.map(row => row.stationId), ['flex', 'preferred']);
    assert.equal(result.averagePricesByDay.at(-1).price, 3.75);
    assert.equal(result.mapHeatmapPoints.length, 2);
});

test('trend request keys distinguish brand and E85 preferences', async () => {
    const trends = await setup();
    const base = { latitude: 27.95, longitude: -82.45, fuelType: 'regular' };
    assert.notEqual(trends.buildTrendRequestKey(base), trends.buildTrendRequestKey({ ...base, preferredBrands: ['shell'] }));
    assert.notEqual(trends.buildTrendRequestKey(base), trends.buildTrendRequestKey({ ...base, requiresE85: true }));
});


test('fresh local prices remain available without history; no historical values are invented', async () => {
    const trends = await setup({ noHistory: true });
    const result = await trends.fetchTrendData({ latitude: 27.95, longitude: -82.45, fuelType: 'regular' });
    assert.equal(result.leaderboard.length, 3);
    assert.deepEqual(result.averagePricesByDay, []);
    assert.equal(result.latestObservedAverage.price, 3.5);
    assert(Number.isFinite(Date.parse(result.latestObservedAverage.date)));
    assert.equal(result.overallTrend, null);
    assert.ok(result.leaderboard.every(station => station.earliestPrice === null && station.rankShift === null));
});


test('local leaderboard exactly matches Home candidate filtering and ID tie order from the same snapshot', async () => {
    const { buildLabStations } = await import('../src/screens/cluster-lab/stationCardModel.js');
    const base = { latitude: 27.95, longitude: -82.45, providerTier: 'station', fuelType: 'regular', providerId: 'gasbuddy', rating: 4, updatedAt: new Date().toISOString() };
    const quote = (id, price, changes = {}) => ({ ...base, stationId: id, price, allPrices: { regular: price }, ...changes });
    const cachedSnapshot = { fetchedAt: new Date().toISOString(), quote: quote('01', 2.9), topStations: [
        quote('20', 3), quote('10', 3, { distanceMiles: 4 }), quote('preferred', 4, { stationName: 'Shell', brandNames: ['Shell'] }),
        quote('expired', 1, { updatedAt: new Date(Date.now() - 86400001).toISOString() }),
        quote('far', 1, { distanceMiles: 20 }), quote('bad-rating', 1, { rating: 1 }), quote('estimated', 1, { isEstimated: true }),
    ] };
    const options = { latitude: 27.95, longitude: -82.45, fuelType: 'regular', radiusMiles: 5, minimumRating: 3, preferredBrands: ['shell'] };
    const trends = await setup({ cachedSnapshot, noRefetch: true });
    const result = await trends.fetchTrendData(options);
    const home = buildLabStations(cachedSnapshot, { origin: options, radiusMiles: 5, minimumRating: 3, fuelGrade: 'regular' });
    assert.deepEqual(result.leaderboard.map(s => s.stationId), home.slice(0, 5).map(s => s.id));
    assert.deepEqual(result.leaderboard.map(s => s.stationId), ['01', '10', '20', 'preferred']);
});
