const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;

function setup() {
    const nationalRequests = [], localRequests = [];
    const fetchNationalTrends = params => new Promise((resolve, reject) => nationalRequests.push({params, resolve, reject}));
    const cache = load('src/services/fuel/nationalTrendsCache.js', { './nationalLeaderboard': {fetchNationalTrends} });
    const locals = new Map(), times = new Map(), pending = new Map();
    const trends = {
        buildTrendRequestKey: p => JSON.stringify(p),
        getCachedTrendData: key => locals.get(key),
        getLastTrendsScreenViewedAt: key => times.get(key) || 0,
        prefetchTrendData(params) {
            const key = JSON.stringify(params);
            if (pending.has(key)) return pending.get(key);
            const promise = new Promise((resolve, reject) => localRequests.push({params, resolve, reject})).then(value => {
                locals.set(key, value); times.set(key, Date.now()); return value;
            }).finally(() => pending.delete(key));
            pending.set(key, promise); return promise;
        },
    };
    const onboarding = load('src/screens/onboarding/useOnboardingTrendsPrefetch.js', {
        '../../services/fuel/trends': trends,
        '../../services/fuel/nationalTrendsCache': cache,
    });
    const useNational = load('src/screens/trends/useNationalLeaderboard.js', {
        'expo-router': {useFocusEffect: cb => React.useEffect(cb, [cb])},
        'react-native': {AppState: {addEventListener: () => ({remove() {}})}},
        '../../services/fuel/nationalLeaderboard': {fetchNationalTrends},
        '../../services/fuel/nationalTrendsCache': cache,
    }).default;
    return {...onboarding, cache, useNational, nationalRequests, localRequests};
}
const origin = {latitude: 27.95, longitude: -82.46};
const choices = {preferredOctane: 'regular', searchRadiusMiles: 6, preferredBrands: [], fuelMemberships: []};
const response = () => ({quotes: [{stationId: 'a', providerTier: 'station', fuelType: 'regular', price: 3, updatedAt: new Date().toISOString()}], trendData: {averagePricesByDay: []}});

test('onboarding waits for the map, debounces choices, and Save warms the exact final selection without waiting', async t => {
    t.mock.timers.enable({apis: ['setTimeout']});
    const s = setup(); let warm, view;
    function Onboarding(props) { warm = s.default(props.coordinate, props.choices, 0, props.ready); return null; }
    let props = {coordinate: origin, choices, ready: false};
    const update = async patch => {props = {...props,...patch}; await act(async () => view.update(React.createElement(Onboarding,props)));};
    await act(async () => {view = create(React.createElement(Onboarding, props)); t.mock.timers.tick(1000);});
    assert.equal(s.localRequests.length, 0);
    await update({ready:true});
    await act(async () => t.mock.timers.tick(600));
    await update({choices:{...choices, searchRadiusMiles:9}});
    await act(async () => t.mock.timers.tick(600));
    assert.equal(s.localRequests.length, 0);
    await act(async () => t.mock.timers.tick(201));
    assert.equal(s.localRequests.length, 1);
    assert.equal(s.localRequests[0].params.radiusMiles,9);
    assert.equal(s.nationalRequests.length,1);
    const finalChoices = {...choices, preferredOctane:'premium', requiresE85:true, searchRadiusMiles:12};
    assert.equal(warm(finalChoices),undefined, 'Save does not wait for these requests');
    assert.equal(s.localRequests[1].params.fuelType,'premium');
    assert.equal(s.localRequests[1].params.requiresE85,true);
    assert.equal(s.localRequests[1].params.radiusMiles,12);
    await act(async () => view.unmount());
    s.localRequests.forEach(r => r.reject(Error('offline')));
    s.nationalRequests.forEach(r => r.reject(Error('offline')));
    await new Promise(resolve => setImmediate(resolve));
});

test('Trends joins an onboarding national request, then renders the shared cache immediately on remount', async () => {
    const s = setup(); let value, view;
    const warm = s.warmOnboardingTrends(origin, choices, 0);
    function Consumer() { value = s.useNational({enabled:true,fuelType:'regular',requiresE85:false,resetToken:0}); return null; }
    await act(async () => {view = create(React.createElement(Consumer));});
    assert.equal(s.nationalRequests.length,1, 'tab joins the prefetch');
    await act(async () => view.unmount());
    s.nationalRequests[0].resolve(response()); s.localRequests[0].resolve({leaderboard:[]});
    await warm;
    const renders = [];
    function Revisit() { value = s.useNational({enabled:true,fuelType:'regular',requiresE85:false,resetToken:0}); renders.push(value.loading); return null; }
    await act(async () => {view = create(React.createElement(Revisit));});
    assert.equal(renders[0],false, 'first render already has content');
    assert.equal(value.quotes[0].stationId,'a');
    assert.equal(s.nationalRequests.length,1);
    await s.warmOnboardingTrends(origin, choices,0);
    assert.equal(s.localRequests.length,1, 'completed local prefetch is reused');
    assert.equal(s.nationalRequests.length,1);
    await act(async () => view.unmount());
});

test('failed and partial prefetches remain retryable and reset/grade scopes remain isolated', async () => {
    const s = setup();
    const options = {fuelType:'regular',requiresE85:false,resetToken:0};
    let promise = s.cache.prefetchNationalTrends(options);
    s.nationalRequests[0].reject(Error('offline'));
    await assert.rejects(promise,/offline/);
    promise = s.cache.prefetchNationalTrends(options);
    s.nationalRequests[1].resolve({...response(),historyError:'unavailable'});
    await promise;
    assert.equal(s.cache.getCachedNationalTrends(s.cache.nationalTrendsScope(options)),undefined);
    promise = s.cache.prefetchNationalTrends(options);
    s.nationalRequests[2].resolve(response()); await promise;
    assert.equal(s.cache.getCachedNationalTrends(s.cache.nationalTrendsScope({...options,resetToken:1})),undefined);
    assert.equal(s.cache.getCachedNationalTrends(s.cache.nationalTrendsScope({...options,fuelType:'premium'})),undefined);
});
