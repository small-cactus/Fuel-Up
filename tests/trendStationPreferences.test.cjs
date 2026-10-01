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
        './index': { refreshFuelPriceSnapshot: async () => ({ snapshot: { topStations: quotes } }) },
        './priceValidation': { buildValidationState: input => ({ outputs: input.map(row => ({ row, result: { finalDisplayedPrice: row.price } })) }) },
    });
}

test('brand preference changes ordering without removing other brands from trends or average', async () => {
    const trends = await setup();
    const result = await trends.fetchTrendData({ latitude: 27.95, longitude: -82.45, fuelType: 'regular', preferredBrands: ['shell'] });
    assert.deepEqual(result.leaderboard.map(row => row.stationId), ['preferred', 'cheap', 'flex']);
    assert.equal(result.averagePricesByDay.at(-1).price, 3.5);
    assert.ok(result.leaderboard.every(row => row.rankShift === 0), 'brand grouping must apply to both historical and current ranks');
});

test('requiring E85 excludes unavailable stations from leaderboard and historical averages', async () => {
    const trends = await setup();
    const result = await trends.fetchTrendData({ latitude: 27.95, longitude: -82.45, fuelType: 'regular', preferredBrands: ['shell'], requiresE85: true });
    assert.deepEqual(result.leaderboard.map(row => row.stationId), ['preferred', 'flex']);
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
    assert.equal(result.overallTrend, null);
    assert.ok(result.leaderboard.every(station => station.earliestPrice === null && station.rankShift === null));
});
