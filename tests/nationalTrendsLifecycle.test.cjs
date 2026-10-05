const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const loadComponent = require('./helpers/loadComponent.cjs');
function load(file, mocks) {
    const cache = loadComponent('src/services/fuel/nationalTrendsCache.js', {
        './nationalLeaderboard': mocks['../../services/fuel/nationalLeaderboard'],
    });
    return loadComponent(file, { ...mocks, '../../services/fuel/nationalTrendsCache': cache });
}
global.IS_REACT_ACT_ENVIRONMENT = true;

test('switching national grades or leaving the screen ignores stale UI responses while shared refreshes finish; initial loads do not pull the page down', async () => {
    const requests = [];
    const useNational = load('src/screens/trends/useNationalLeaderboard.js', {
        'expo-router': { useFocusEffect: callback => React.useEffect(callback, [callback]) },
        'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
        '../../services/fuel/nationalLeaderboard': { fetchNationalTrends: params => new Promise(resolve => requests.push({ ...params, resolve })) },
    }).default;
    let value, renderer;
    let props = { enabled: true, fuelType: 'regular', requiresE85: false, resetToken: 0 };
    function Consumer(input) { value = useNational(input); return null; }
    const update = async patch => { props = { ...props, ...patch }; await act(async () => renderer.update(React.createElement(Consumer, props))); };
    const quote = fuelType => ({ stationId: fuelType, fuelType, providerTier: 'station', price: 3, updatedAt: new Date().toISOString() });
    await act(async () => { renderer = create(React.createElement(Consumer, props)); });
    assert.equal(value.refreshing, false);
    await update({ fuelType: 'premium' });
    assert.equal(requests[0].signal, undefined, 'shared cache request survives a tab change');
    await act(async () => requests[1].resolve({quotes:[quote('premium')],trendData:{averagePricesByDay:[{date:'2026-10-01T00:00:00Z',price:4}]}}));
    await act(async () => requests[0].resolve({quotes:[quote('regular')],trendData:{averagePricesByDay:[{date:'2026-10-01T00:00:00Z',price:3}]}}));
    assert.equal(value.quotes[0].fuelType, 'premium');
    assert.equal(value.trendData.averagePricesByDay[0].price,4);
    await act(async () => { void value.onRefresh(); });
    assert.equal(value.refreshing, true);
    await update({ enabled: false });
    assert.equal(requests[2].signal, undefined, 'leaving a tab does not cancel the app-wide refresh');
    await act(async () => requests[2].resolve({quotes:[quote('regular')],trendData:{averagePricesByDay:[{date:'2026-10-01T00:00:00Z',price:3}]}}));
    assert.equal(value.quotes[0].fuelType, 'premium');
    assert.equal(value.trendData.averagePricesByDay[0].price,4);
    await act(async () => renderer.unmount());
});

test('national cache returns immediately on revisit, stays isolated by grade/filter/reset, and refreshes after an hour', async t => {
    const now = Date.parse('2026-10-01T18:00:00Z');
    t.mock.timers.enable({ apis: ['Date'], now });
    const requests = [];
    const useNational = load('src/screens/trends/useNationalLeaderboard.js', {
        'expo-router': { useFocusEffect: callback => React.useEffect(callback, [callback]) },
        'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
        '../../services/fuel/nationalLeaderboard': { fetchNationalTrends: params => new Promise((resolve, reject) => requests.push({ ...params, resolve, reject })) },
    }).default;
    let value, renderer, props = { enabled: true, fuelType: 'regular', requiresE85: false, resetToken: 0 };
    function Consumer(input) { value = useNational(input); return null; }
    const update = async patch => { props = { ...props, ...patch }; await act(async () => renderer.update(React.createElement(Consumer, props))); };
    const response = { quotes: [{ stationId: 'a', providerTier: 'station', fuelType: 'regular', price: 3, updatedAt: new Date(now).toISOString() }], trendData: { averagePricesByDay: [{ date: new Date(now).toISOString(), price: 3 }] } };
    await act(async () => { renderer = create(React.createElement(Consumer, props)); });
    await act(async () => requests[0].resolve(response));
    await update({ enabled: false });
    await update({ enabled: true });
    assert.equal(requests.length, 1);
    assert.equal(value.loading, false);
    assert.equal(value.quotes[0].stationId, 'a');
    await update({ fuelType: 'premium' });
    assert.equal(value.loading, true);
    await update({ fuelType: 'regular' });
    assert.equal(requests.length, 2);
    assert.equal(value.loading, false);
    await update({ requiresE85: true });
    assert.equal(requests.length, 3); assert.equal(value.loading, true);
    await update({ requiresE85: false });
    assert.equal(value.quotes[0].stationId, 'a');
    await update({ enabled: false });
    t.mock.timers.tick(300001);
    await update({ enabled: true });
    assert.equal(requests.length, 3, 'five minutes no longer invalidates the cache');
    await update({ enabled: false });
    t.mock.timers.tick(3300000);
    await update({ enabled: true });
    assert.equal(requests.length, 4);
    assert.equal(value.quotes[0].stationId, 'a', 'keep valid data visible during refresh');
    await act(async () => requests[3].reject(new Error('offline')));
    assert.equal(value.quotes[0].stationId, 'a');
    await update({ resetToken: 1 });
    assert.equal(value.loading, true); assert.equal(requests.length, 5);
    await act(async () => renderer.unmount());
});

test('server scan deadline refreshes an old cached scan, while quote expiry alone does not fetch', async t => {
    const now = Date.parse('2026-10-01T18:20:00Z');
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
    let requests = 0, value, renderer;
    const useNational = load('src/screens/trends/useNationalLeaderboard.js', {
        'expo-router': { useFocusEffect: callback => React.useEffect(callback, [callback]) },
        'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
        '../../services/fuel/nationalLeaderboard': { fetchNationalTrends: async () => {
            requests++;
            return { scanId: 590, refreshAfter: new Date(now + 60000).toISOString(), quotes: requests === 1 ? [
                { stationId: 'a', providerTier: 'station', fuelType: 'regular', price: 3, updatedAt: new Date(now - 86400000 + 1000).toISOString() },
            ] : [], trendData: { averagePricesByDay: [] } };
        } },
    }).default;
    let props = { enabled: true, fuelType: 'regular', requiresE85: false, resetToken: 0 };
    function Consumer(input) { value = useNational(input); return null; }
    const update = async patch => { props = { ...props, ...patch }; await act(async () => renderer.update(React.createElement(Consumer, props))); };
    await act(async () => { renderer = create(React.createElement(Consumer, props)); });
    assert.equal(value.quotes.length, 1);
    await act(async () => t.mock.timers.tick(1001));
    assert.equal(value.quotes.length, 0); assert.equal(requests, 1);
    await update({ enabled: false });
    await update({ enabled: true });
    assert.equal(requests, 1);
    await update({ enabled: false });
    t.mock.timers.tick(59000);
    await update({ enabled: true });
    assert.equal(requests, 2, 'use scan deadline instead of waiting an hour from first viewing');
    await act(async () => renderer.unmount());
});
