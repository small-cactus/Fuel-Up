const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;

test('switching national grades or leaving the screen cancels stale responses; initial loads do not pull the page down', async () => {
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
    assert.equal(requests[0].signal.aborted, true);
    await act(async () => requests[1].resolve({quotes:[quote('premium')],trendData:{averagePricesByDay:[{date:'2026-10-01T00:00:00Z',price:4}]}}));
    await act(async () => requests[0].resolve({quotes:[quote('regular')],trendData:{averagePricesByDay:[{date:'2026-10-01T00:00:00Z',price:3}]}}));
    assert.equal(value.quotes[0].fuelType, 'premium');
    assert.equal(value.trendData.averagePricesByDay[0].price,4);
    await act(async () => { void value.onRefresh(); });
    assert.equal(value.refreshing, true);
    await update({ enabled: false });
    assert.equal(requests[2].signal.aborted, true);
    await act(async () => requests[2].resolve({quotes:[quote('regular')],trendData:{averagePricesByDay:[{date:'2026-10-01T00:00:00Z',price:3}]}}));
    assert.equal(value.quotes[0].fuelType, 'premium');
    assert.equal(value.trendData.averagePricesByDay[0].price,4);
    await act(async () => renderer.unmount());
});
