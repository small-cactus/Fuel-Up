import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLabStations, stationAge, stationDistance, pageFromOffset, matchingHomeStationSnapshot } from '../src/screens/cluster-lab/stationCardModel.js';

test('card and map share station IDs and cheapest ordering without losing quote metadata', () => {
    const base = { providerTier: 'station', latitude: 27.9, longitude: -82.4, price: 3.2 };
    const validation = { usedPrediction: true, finalPrice: 3.2 };
    const result = buildLabStations({ topStations: [
        { ...base, stationId: 'b' }, { ...base, stationId: 'a', address: '123 Main St', rating: 4.5, distanceMiles: 2,
            updatedAt: '2026-09-29T12:00:00Z', validation, allPrices: { regular: 3.2 } },
        { ...base, stationId: 'estimate', isEstimated: true }, { ...base, stationId: 'invalid', price: NaN },
    ], quote: { ...base, stationId: 'b', stationName: 'Updated name' } });
    assert.deepEqual(result.map(station => station.id), ['a', 'b']);
    assert.equal(result[0].address, '123 Main St');
    assert.equal(result[0].validation, validation);
    assert.deepEqual(result[0].allPrices, { regular: 3.2 });
    assert.equal(result[1].name, 'Updated name');
    assert.deepEqual(buildLabStations(null), []);
});

test('card age and distance tolerate bad data and advance with the supplied clock', () => {
    const then = '2026-09-29T12:00:00Z', now = Date.parse(then);
    assert.equal(stationAge('bad date', now), null);
    assert.equal(stationAge(null, now), null);
    assert.equal(stationAge(then, now - 10000), 'Just now');
    assert.equal(stationAge(then, now + 120000), '2m ago');
    assert.equal(stationAge(then, now + 7200000), '2h ago');
    assert.equal(stationDistance(NaN), null);
    assert.equal(stationDistance(-1), null);
    assert.equal(stationDistance(0.01), 'Right here');
    assert.equal(stationDistance(1.23), '1.2 mi away');
});

test('pagination clamps overscroll and rejects unavailable layouts', () => {
    assert.equal(pageFromOffset(-25, 375, 4), 0);
    assert.equal(pageFromOffset(752, 375, 4), 2);
    assert.equal(pageFromOffset(2000, 375, 4), 3);
    assert.equal(pageFromOffset(NaN, 375, 4), null);
    assert.equal(pageFromOffset(200, 0, 4), null);
    assert.equal(pageFromOffset(0, 375, 0), null);
});


test('Glass Lab cache fallback applies Home radius, rating, selected fuel and E85 eligibility', () => {
    const base = { providerTier: 'station', latitude: 27.95, longitude: -82.45,
        price: 3.2, fuelType: 'regular', rating: 4.5, distanceMiles: 1, allPrices: { regular: 3.2, premium: 4.1, e85: 2.6 } };
    const topStations = [
        { ...base, stationId: 'eligible' },
        { ...base, stationId: 'outside', distanceMiles: 12 },
        { ...base, stationId: 'low-rating', rating: 2 },
        { ...base, stationId: 'no-e85', allPrices: { regular: 3.2, premium: 4.2 } },
        { ...base, stationId: 'no-premium', allPrices: { regular: 3.2, e85: 2.6 } },
    ];
    const stations = buildLabStations({ topStations }, { radiusMiles: 5, minimumRating: 4,
        fuelGrade: 'premium', requiresE85: true });
    assert.deepEqual(stations.map(station => station.id), ['eligible']);
    assert.equal(stations[0].price, 4.1);
});

test('Home snapshot survives tab returns but is rejected after changing search or resetting cache', () => {
    const origin = { latitude: 27.95, longitude: -82.45 };
    const query = { ...origin, criteriaSignature: 'premium|5|4', fuelResetToken: 1 };
    const home = { origin, criteriaSignature: query.criteriaSignature, fuelResetToken: 1,
        quotes: [{ stationId: 'home-current' }] };
    assert.equal(matchingHomeStationSnapshot(home, query), home);
    assert.equal(matchingHomeStationSnapshot(home, { ...query }), home);
    assert.equal(matchingHomeStationSnapshot(home, { ...query, latitude: query.latitude + 0.0000005 }), home);
    assert.equal(matchingHomeStationSnapshot(home, { ...query, criteriaSignature: 'regular|5|4' }), null);
    assert.equal(matchingHomeStationSnapshot(home, { ...query, latitude: 28 }), null);
    assert.equal(matchingHomeStationSnapshot(home, { ...query, fuelResetToken: 2 }), null);
    assert.equal(matchingHomeStationSnapshot(null, query), null);
    // An intentionally empty Home filter result must not fall back to another cache window.
    const empty = { ...home, quotes: [] };
    assert.equal(matchingHomeStationSnapshot(empty, query), empty);
});
