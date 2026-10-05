const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;

test('a gradient target starts once and superseded/unmounted animation work is stopped', async () => {
    const animations = [];
    const snapshot = prices => ({ trendSeriesMode: 'historical', averagePricesByDay: prices.map((price, index) => ({ price, date: new Date(1700000000000 + index * 3600000).toISOString() })) });
    let data = snapshot([3, 3]);
    const nationalData = snapshot([3.8,3.1,3.4]);
    const appState = {};
    const preferences = { normalizedFuelSearchPreferences: { preferredOctane: 'regular', searchRadiusMiles: 10 } };
    const Chart = load('src/screens/trends/ObservedPriceChart.js', {
        'react-native': { View: 'View' },
        'react-native-svg': { __esModule: true, default: 'Svg', Path: 'Path', Defs: 'Defs', LinearGradient: 'SvgGradient', Stop: 'Stop' },
        'd3-shape': await import('d3-shape'), 'd3-scale': await import('d3-scale'),
    }).default;
    const Screen = load('app/(tabs)/trends.js', {
        '../../src/components/SkeletonReveal': ({ loading, placeholder, children }) => loading ? placeholder : children,
        '../../src/lib/useNetworkStatus': { __esModule: true, default: () => ({ faultsEnabled: false }) },
        '../../src/screens/trends/TrendLeaderboardSkeleton': () => null,
        '../../src/screens/trends/ObservedPriceChart': Chart,
        'react-native': { View: 'View', Text: 'Text', ScrollView: 'ScrollView', RefreshControl: 'RefreshControl',
            Dimensions: { get: () => ({ width: 440 }) }, StyleSheet: { create: value => value, absoluteFillObject: {}, absoluteFill: {} },
            Animated: { View: 'AnimatedView', Value: class { setValue() {} }, timing: () => {
                const animation = { started: 0, stopped: 0, start(callback) { this.started++; this.callback = callback; },
                    stop() { this.stopped++; this.callback?.({ finished: false }); } };
                animations.push(animation); return animation;
            } } },
        'expo-glass-effect': { GlassView: 'GlassView' },
        'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
        '../../src/ThemeContext': { useTheme: () => ({ isDark: false, themeColors: { text: '#000' } }) },
        'expo-linear-gradient': { LinearGradient: 'Gradient' },
        'react-native-svg': { __esModule: true, default: 'Svg', Path: 'Path', Defs: 'Defs', LinearGradient: 'SvgGradient', Stop: 'Stop', Circle: 'Circle' },
        'd3-shape': await import('d3-shape'), 'd3-scale': await import('d3-scale'),
        '../../src/screens/trends/TrendLeaderboard': () => null,
        '../../src/screens/trends/TrendScopeControl': 'ScopeControl',
        '../../src/screens/trends/NationalTrendPrices': () => null,
        '../../src/screens/trends/useNationalLeaderboard': () => ({quotes:[],refreshing:false,loading:false,trendData:nationalData}),
        '../../src/services/fuel/trends': { buildTrendRequestKey: () => 'test' },
        '../../src/screens/trends/useTrendData': () => ({ data, loading: false, refreshing: false }),
        '../../src/AppStateContext': { useAppState: () => appState },
        '../../src/PreferencesContext': { usePreferences: () => preferences },
        '../../src/components/TopCanopy': () => null,
        '../../src/components/FuelUpHeaderLogo': () => null,
        '../../src/lib/fuelGrade': { normalizeFuelGrade: value => value, getFuelGradeMeta: () => ({ label: 'Regular' }) },
        '../../src/lib/fuelSearchState': { buildResolvedFuelSearchContext: () => null },
    }).default;
    let renderer;
    await act(async () => { renderer = create(React.createElement(Screen)); });
    assert.equal(animations.length, 0);
    data = snapshot([4, 3]);
    await act(async () => renderer.update(React.createElement(Screen)));
    assert.equal(animations.length, 1, 'updating incoming colors must not restart its own animation');
    assert.equal(animations[0].started, 1);
    data = snapshot([3, 4]);
    await act(async () => renderer.update(React.createElement(Screen)));
    assert.equal(animations.length, 2);
    assert.equal(animations[0].stopped, 1);
    const localLine = renderer.root.findAllByType('Path').find(p => p.props.stroke)?.props.d;
    assert.equal(renderer.root.findAllByType('Circle').length,0);
    assert(renderer.root.findAllByType('Path').some(p => p.props.fill === 'url(#gradientTrend)'));
    await act(async () => renderer.root.findByType('ScopeControl').props.onChange('national'));
    assert(renderer.root.findAllByType('Text').some(p => p.props.children?.includes?.('National')));
    const nationalLine = renderer.root.findAllByType('Path').find(p => p.props.stroke)?.props.d;
    assert(nationalLine);assert.notEqual(nationalLine,localLine);
    assert.equal(renderer.root.findAllByType('Path').find(p => p.props.stroke)?.props.stroke, '#51CF66',
        'the national decline must be green even when the last bucket rose');
    assert.equal(renderer.root.findAllByType('Circle').length,0);
    data = { averagePricesByDay: [], overallTrend: null,
        latestObservedAverage: { date: new Date().toISOString(), price: 3.25 } };
    await act(async () => renderer.root.findByType('ScopeControl').props.onChange('local'));
    const flatLine = renderer.root.findAllByType('Path').find(p => p.props.stroke)?.props.d;
    assert(flatLine && !flatLine.includes('NaN'), 'a new local area must render its current raw average');
    assert(renderer.root.findAllByType('Text').some(p => Array.isArray(p.props.children) && p.props.children.includes('3.25')));
    await act(async () => renderer.unmount());
    assert(animations.every(animation => animation.stopped >= 1));
});
