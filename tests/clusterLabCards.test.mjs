import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLabStations, stationAge, stationDistance, pageFromOffset, matchingHomeStationSnapshot } from '../src/screens/cluster-lab/stationCardModel.js';

test('card and map share station IDs and cheapest ordering without losing quote metadata', () => {
    const base = { providerTier: 'station', latitude: 27.9, longitude: -82.4, price: 3.2, updatedAt: new Date().toISOString() };
    const validation = { usedPrediction: false, finalPrice: 3.2 };
    const result = buildLabStations({ topStations: [
        { ...base, stationId: 'b' }, { ...base, stationId: 'a', address: '123 Main St', rating: 4.5, distanceMiles: 2,
            updatedAt: new Date().toISOString(), validation, allPrices: { regular: 3.2 } },
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


test('Glass Lab cache fallback applies Home radius, rating, selected fuel while also showing E85', () => {
    const base = { providerTier: 'station', latitude: 27.95, longitude: -82.45,
        price: 3.2, updatedAt: new Date().toISOString(), fuelType: 'regular', rating: 4.5, distanceMiles: 1, allPrices: { regular: 3.2, premium: 4.1, e85: 2.6 } };
    const topStations = [
        { ...base, stationId: 'eligible' },
        { ...base, stationId: 'outside', distanceMiles: 12 },
        { ...base, stationId: 'low-rating', rating: 2 },
        { ...base, stationId: 'no-e85', allPrices: { regular: 3.2, premium: 4.2 } },
        { ...base, stationId: 'no-premium', allPrices: { regular: 3.2, e85: 2.6 } },
    ];
    const stations = buildLabStations({ topStations }, { radiusMiles: 5, minimumRating: 4,
        fuelGrade: 'premium', requiresE85: true });
    assert.deepEqual(stations.map(station => station.id), ['eligible', 'no-e85']);
    assert.equal(stations[0].highlightE85, true);
    assert.equal(stations[1].highlightE85, false);
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

test('unpriced E85 remains on the map after fresh prices, preserving radius and membership rules', () => {
    const now=Date.parse('2026-10-01T20:00:00Z');
    const base={providerTier:'station',latitude:28,longitude:-82,fuelType:'e85',offersE85:true,price:null,allPrices:{}};
    const stations=buildLabStations({topStations:[
        {...base,stationId:'unpriced-near',distanceMiles:1},
        {...base,stationId:'unpriced-far',distanceMiles:2},
        {...base,stationId:'expired',price:1.2,allPrices:{e85:1.2},updatedAt:'2026-09-29T20:00:00Z',distanceMiles:3},
        {...base,stationId:'priced',price:2.99,allPrices:{e85:2.99},updatedAt:'2026-10-01T19:00:00Z'},
        {...base,stationId:'unknown',offersE85:false},
        {...base,stationId:'outside',distanceMiles:6},
        {...base,stationId:'membership',stationName:"Sam's Club",distanceMiles:1},
    ]},{fuelGrade:'e85',radiusMiles:5,now});
    assert.deepEqual(stations.map(s=>s.id),['priced','unpriced-near','unpriced-far','expired']);
    assert(stations.slice(1).every(s=>s.price===null && Object.keys(s.allPrices).length===0));
    const availabilityOnly = buildLabStations({ topStations: [
        { ...base, stationId: 'near', distanceMiles: 1 },
        { ...base, stationId: 'far', distanceMiles: 2 },
    ] }, { fuelGrade: 'e85', radiusMiles: 5, now });
    assert.deepEqual(availabilityOnly.filter(s => s.isRecommended).map(s => s.id), ['near']);
    assert(availabilityOnly.every(s => s.price === null));
});


test('green map identity follows the same personalized first card without changing prices', () => {
    const base = { providerTier: 'station', latitude: 27.9, longitude: -82.4, updatedAt: new Date().toISOString() };
    const snapshot = { topStations: [
        { ...base, stationId: 'cheap', stationName: 'Wawa', price: 3.00 },
        { ...base, stationId: 'preferred', stationName: 'Shell', brandNames: ['Shell'], price: 3.15 },
        { ...base, stationId: 'membership', stationName: "Sam's Club", price: 2.80 },
    ] };
    for (const preferredBrands of [['shell'], []]) {
        const stations = buildLabStations(snapshot, { preferredBrands });
        assert.equal(stations[0].id, preferredBrands.length ? 'preferred' : 'cheap');
        assert.deepEqual(stations.filter(s => s.isRecommended).map(s => s.id), [stations[0].id]);
        assert.equal(stations.find(s => s.id === 'preferred').price, 3.15);
        assert.equal(stations.find(s => s.id === 'cheap').price, 3.00);
        assert.ok(!stations.some(s => s.id === 'membership'));
    }
});


test('Also show E85 adds stations without removing gasoline or duplicating shared IDs', () => {
    const base = { providerTier: 'station', latitude: 28, longitude: -82, updatedAt: new Date().toISOString() };
    const primary = { topStations: [
        { ...base, stationId: 'gas', fuelType: 'premium', price: 3.5 },
        { ...base, stationId: 'both', fuelType: 'premium', price: 3.8 },
    ] };
    const extra = { topStations: [
        { ...base, stationId: 'both', fuelType: 'e85', price: 2.5, offersE85: true },
        { ...base, stationId: 'ethanol', fuelType: 'e85', price: 2.1, offersE85: true },
        { ...base, stationId: 'unpriced', fuelType: 'e85', price: null, offersE85: true },
    ] };
    const options = { fuelGrade: 'premium', requiresE85: true };
    const stations = buildLabStations(primary, options, extra);
    assert.deepEqual(stations.map(s => s.id), ['gas', 'both', 'ethanol', 'unpriced']);
    assert.deepEqual(stations.map(s => s.highlightE85), [false, true, true, true]);
    assert.deepEqual(stations.filter(s => s.isRecommended).map(s => s.id), ['gas']);
    assert.equal(stations[1].price, 3.8);
    assert.deepEqual(stations[1].dualPrices, { primaryLabel: '93', primaryPrice: '$3.80', e85Price: '$2.50' });
    assert.deepEqual(stations[2].dualPrices, { primaryLabel: '93', primaryPrice: '—', e85Price: '$2.10' });
    assert.equal(stations[3].dualPrices.e85Price, '—');
    const stale = buildLabStations(primary, options, { topStations: extra.topStations.map(s => ({ ...s, updatedAt: '2020-01-01T00:00:00Z' })) });
    assert.equal(stale.find(s => s.id === 'both').dualPrices.e85Price, '—');
    assert.equal(stations[2].fuelType, 'e85');
    assert.equal(stations[2].price, 2.1);
    assert.equal(stations[2].comparisonPrice, null);
    assert.equal(stations[3].price, null);
    const off = buildLabStations(primary, { ...options, requiresE85: false }, extra);
    assert.deepEqual(off.map(s => s.id), ['gas', 'both']);
    assert(off.every(s => !s.highlightE85));
});
