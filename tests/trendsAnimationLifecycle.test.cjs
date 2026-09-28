const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;

test('a gradient target starts once and superseded/unmounted animation work is stopped', async () => {
    const animations = [];
    const snapshot = prices => ({ trendSeriesMode: 'current_average_snapshot', averagePricesByDay: prices.map(price => ({ price })) });
    let data = snapshot([3, 3]);
    const appState = {};
    const preferences = { normalizedFuelSearchPreferences: { preferredOctane: 'regular', searchRadiusMiles: 10 } };
    const Screen = load('app/(tabs)/trends.js', {
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
        'react-native-svg': { default: 'Svg', Path: 'Path', Defs: 'Defs', LinearGradient: 'SvgGradient', Stop: 'Stop' },
        'd3-shape': {}, 'd3-scale': {},
        '../../src/screens/trends/TrendLeaderboard': () => null,
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
    await act(async () => renderer.unmount());
    assert.equal(animations[1].stopped, 1);
});
