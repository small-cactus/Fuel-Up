import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHomeFuelStations } from '../src/screens/cluster-lab/homeFuelStations.js';

const now = Date.parse('2026-10-06T16:00:00Z');
const base = { providerTier: 'station', latitude: 28, longitude: -82, updatedAt: '2026-10-06T15:00:00Z', distanceMiles: 1 };
const main = { topStations: [
    { ...base, stationId: 'gas', fuelType: 'premium', price: 3.5 },
    { ...base, stationId: 'both', fuelType: 'premium', price: 3.7, offersE85: true, allPrices: { premium: 3.7, diesel: 3.8 } },
] };
const e85 = { topStations: [
    { ...base, stationId: 'both', fuelType: 'e85', price: 2.5, offersE85: true },
    { ...base, stationId: 'only', fuelType: 'e85', price: null, offersE85: true },
] };
const options = { fuelGrade: 'premium', requiresE85: true, now };

test('additional E85 shows the union, deduplicates stations and does not rank ethanol against gasoline', () => {
    const stations = buildHomeFuelStations(main, e85, options);
    assert.deepEqual(stations.map(s => s.id), ['gas', 'both', 'only']);
    assert.deepEqual(stations.filter(s => s.isRecommended).map(s => s.id), ['gas']);
    assert.equal(stations[1].chipPrices, '93 3.70\nE85 2.50');
    assert.equal(stations[1].offersDiesel, true);
    assert.equal(stations[2].chipPrices, '93 —\nE85 —');
    assert.equal(stations[2].fuelType, 'e85');
    assert.equal(stations[1].comparisonPrice, 3.7);
    assert.equal(stations[2].comparisonPrice, null);
});

test('each price expires independently while E85 availability stays visible', () => {
    const stale = { topStations: e85.topStations.map(s => ({ ...s, updatedAt: '2026-10-04T15:00:00Z' })) };
    const stations = buildHomeFuelStations(main, stale, options);
    assert.equal(stations[1].chipPrices, '93 3.70\nE85 —');
    const expiredMain = { topStations: main.topStations.map(s => ({ ...s, updatedAt: '2026-10-04T15:00:00Z' })) };
    const extra = buildHomeFuelStations(expiredMain, e85, options);
    assert.equal(extra[0].chipPrices, '93 —\nE85 2.50');
});

test('turning E85 off restores the selected grade and its ordinary chips', () => {
    const stations = buildHomeFuelStations(main, e85, { ...options, requiresE85: false });
    assert.deepEqual(stations.map(s => s.id), ['gas', 'both']);
    assert(stations.every(s => s.chipPrices === null));
});

test('E85-only selection keeps its reported price and availability without a gasoline row', () => {
    const stations = buildHomeFuelStations(e85, null, { ...options, fuelGrade: 'e85' });
    assert.equal(stations[0].price, 2.5);
    assert(stations.every(s => s.chipPrices === null));
});

test('a cheaper E85-only quote cannot become the premium comparison baseline', () => {
    const stations = buildHomeFuelStations(main, { topStations: [
        { ...base, stationId: 'ethanol', fuelType: 'e85', price: 2.1, offersE85: true },
    ] }, options);
    const ethanol = stations.find(station => station.id === 'ethanol');
    assert.equal(ethanol.price, 2.1);
    assert.equal(ethanol.chipPrices, '93 —\nE85 2.10');
    assert.equal(ethanol.comparisonPrice, null);
    assert.equal(ethanol.isRecommended, false);
    assert.equal(stations[0].id, 'gas');
});
