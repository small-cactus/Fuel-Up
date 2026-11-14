const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;

test('GPS renders keep unchanged Trends leaves stable while displayed data, theme and grade still update', async () => {
    let chartRenders = 0, leaderboardRenders = 0, controllerRenders = 0, latestLeaderboard;
    const Chart = load('src/screens/trends/ObservedPriceChart.js', {
        'react-native': { View: props => { chartRenders++; return React.createElement('ChartView', props); } },
        'react-native-svg': { __esModule: true, default: 'Svg', Path: 'Path', Defs: 'Defs', LinearGradient: 'SvgGradient', Stop: 'Stop' },
        'd3-shape': await import('d3-shape'), 'd3-scale': await import('d3-scale'),
    }).default;
    const Leaderboard = load('src/screens/trends/TrendLeaderboard.js', {
        'react-native': { Platform: { OS: 'ios' } },
        './NativeTrendLeaderboard': props => { leaderboardRenders++; latestLeaderboard = props; return null; },
        './TrendLeaderboardFallback': () => null,
    }).default;
    const snapshot = prices => ({ trendSeriesMode: 'historical',
        averagePricesByDay: prices.map((price, index) => ({ price, date: new Date(1700000000000 + index * 3600000).toISOString() })),
        leaderboard: [{ stationId: 'a', latestPrice: prices.at(-1) }],
        leaderboardLatestReportedAt: '2026-11-14T12:00:00Z',
    });
    let data = snapshot([3, 3]);
    let appState = { resolvedFuelSearchContext: { latitude: 28, longitude: -82 } };
    let theme = { isDark: false, themeColors: { text: '#000', textOpacity: '#555' } };
    let preferences = { normalizedFuelSearchPreferences: { preferredOctane: 'regular', searchRadiusMiles: 10 } };
    const Screen = load('app/(tabs)/trends.js', {
        '../../src/screens/trends/ObservedPriceChart': Chart,
        '../../src/screens/trends/TrendLeaderboard': Leaderboard,
        '../../src/screens/trends/TrendLeaderboardSkeleton': () => null,
        '../../src/screens/trends/TrendScopeControl': 'ScopeControl',
        '../../src/screens/trends/NationalTrendPrices': () => null,
        '../../src/screens/trends/useNationalLeaderboard': () => ({ quotes: [], refreshing: false, loading: false }),
        '../../src/screens/trends/useTrendData': () => { controllerRenders++; return { data, loading: false, refreshing: false }; },
        '../../src/services/fuel/trends': { buildTrendRequestKey: ({ latitude }) => String(latitude) },
        '../../src/AppStateContext': { useAppState: () => appState },
        '../../src/PreferencesContext': { usePreferences: () => preferences },
        '../../src/ThemeContext': { useTheme: () => theme },
        '../../src/lib/fuelGrade': { normalizeFuelGrade: value => value, getFuelGradeMeta: value => ({ label: value }) },
        '../../src/lib/fuelSearchState': { buildResolvedFuelSearchContext: () => null },
        '../../src/components/TopCanopy': () => null,
        '../../src/components/FuelUpHeaderLogo': () => null,
        'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
        'expo-linear-gradient': { LinearGradient: 'Gradient' },
        'react-native': { View: 'View', Text: 'Text', ScrollView: 'ScrollView', RefreshControl: 'RefreshControl',
            Dimensions: { get: () => ({ width: 440 }) }, StyleSheet: { create: value => value, absoluteFillObject: {}, absoluteFill: {} },
            Animated: { View: 'AnimatedView', Value: class { setValue() {} }, timing: () => ({ start() {}, stop() {} }) } },
    }).default;
    let renderer;
    await act(async () => { renderer = create(React.createElement(Screen)); });
    const initialControllerRenders = controllerRenders;
    for (let fix = 1; fix <= 5; fix++) {
        appState = { resolvedFuelSearchContext: { latitude: 28 + fix * 0.001, longitude: -82 } };
        await act(async () => renderer.update(React.createElement(Screen)));
    }
    assert.equal(controllerRenders, initialControllerRenders + 5, 'GPS still reaches the live data controller');
    assert.equal(chartRenders, 1, 'memoized chartPoints keep SVG work out of GPS-only commits');
    assert.equal(leaderboardRenders, 1, 'stable cached rows keep SwiftUI rebuilding out of GPS-only commits');

    const oldLine = renderer.root.findAllByType('Path').find(node => node.props.stroke).props.d;
    data = snapshot([4, 3]);
    await act(async () => renderer.update(React.createElement(Screen)));
    assert.equal(chartRenders, 2);
    assert.equal(leaderboardRenders, 2);
    assert.equal(latestLeaderboard.stations, data.leaderboard);
    const newLine = renderer.root.findAllByType('Path').find(node => node.props.stroke).props.d;
    assert.notEqual(newLine, oldLine);

    theme = { isDark: true, themeColors: { text: '#fff', textOpacity: '#aaa' } };
    await act(async () => renderer.update(React.createElement(Screen)));
    assert.equal(latestLeaderboard.isDark, true);
    assert.equal(latestLeaderboard.themeColors, theme.themeColors);
    assert.equal(leaderboardRenders, 3);
    preferences = { normalizedFuelSearchPreferences: { preferredOctane: 'premium', searchRadiusMiles: 10 } };
    await act(async () => renderer.update(React.createElement(Screen)));
    assert.equal(latestLeaderboard.gradeLabel, 'premium');
    assert.equal(leaderboardRenders, 4);
    data = { ...data, leaderboardLatestReportedAt: '2026-11-13T10:00:00Z' };
    await act(async () => renderer.update(React.createElement(Screen)));
    assert.equal(leaderboardRenders, 5, 'changed report age still reaches the native card');
    await act(async () => renderer.unmount());
});

test('leaderboard memoization preserves its internal dynamic layout updates', async () => {
    const FontScale = React.createContext(1);
    let renders = 0;
    const Leaderboard = load('src/screens/trends/TrendLeaderboard.js', {
        'react-native': { Platform: { OS: 'ios' } },
        './NativeTrendLeaderboard': () => { renders++; return React.createElement('Layout', { scale: React.useContext(FontScale) }); },
        './TrendLeaderboardFallback': () => null,
    }).default;
    const props = { stations: [], gradeLabel: 'Regular' };
    const render = scale => React.createElement(FontScale.Provider, { value: scale }, React.createElement(Leaderboard, props));
    let renderer;
    await act(async () => { renderer = create(render(1)); });
    await act(async () => renderer.update(render(1)));
    assert.equal(renders, 1);
    await act(async () => renderer.update(render(1.5)));
    assert.equal(renders, 2);
    assert.equal(renderer.root.findByType('Layout').props.scale, 1.5);
    await act(async () => renderer.unmount());
});
