const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { create, act } = require('react-test-renderer');
const load = require(path.resolve('tests/helpers/loadComponent.cjs'));
global.IS_REACT_ACT_ENVIRONMENT = true;
const root = process.env.FUELUP_CARD_TEST_ROOT || process.cwd();
const file = name => path.join(root, name);
const formatters = {
    distanceText: miles => miles < 0.1 ? 'Right here' : `${miles.toFixed(1)} mi away`,
    relativeTime: (time, now) => `${Math.floor((now - time) / 60000)}m ago`,
};
const sample = { id: 'a', name: 'Station', latitude: 28, longitude: -82, price: 3.19,
    fuelType: 'regular', distanceMiles: 1.11, rating: 4.3, address: 'Main St', updatedAt: 60000 };
async function presentationModule() {
    return load(file('src/lib/stationCardPresentation.js'), {
        './fuelGrade.js': await import(require('node:url').pathToFileURL(path.resolve('src/lib/fuelGrade.js')).href),
    });
}

test('rounded movement and identical refreshes reuse presentation; visible updates invalidate it', async () => {
    const { createStationCardPresentation: present, reuseStationCardPresentation: reuse } = await presentationModule();
    const initial = present(sample, 'regular', 120000, formatters);
    assert.equal(reuse(initial, present({ ...sample, distanceMiles: 1.12 }, 'regular', 120000, formatters)), initial);
    assert.equal(reuse(initial, present({ ...sample }, 'regular', 120000, formatters)), initial);
    for (const changes of [{ price: 3.29 }, { rating: 4.5 }, { distanceMiles: 1.2 }, { name: 'New name' },
        { address: 'Side St' }, { latitude: NaN }, { dualPrices: { primaryLabel: '87', primaryPrice: '$3.19', e85Price: '$2.39' } }]) {
        assert.notEqual(reuse(initial, present({ ...sample, ...changes }, 'regular', 120000, formatters)), initial);
    }
    assert.notEqual(reuse(initial, present(sample, 'regular', 180000, formatters)), initial, 'age label updates');
    const dual = { ...sample, dualPrices: { primaryLabel: '87', primaryPrice: '$3.19', e85Price: '$2.39' } };
    const dualBefore = present(dual, 'regular', 120000, formatters);
    assert.equal(reuse(dualBefore, present({ ...dual, dualPrices: { ...dual.dualPrices } }, 'regular', 120000, formatters)), dualBefore);
    assert.notEqual(reuse(dualBefore, present({ ...dual, dualPrices: { ...dual.dualPrices, e85Price: '$2.49' } }, 'regular', 120000, formatters)), dualBefore);
});

test('card skips native redraws but actions receive latest station and changed UI props render', async () => {
    let renders = 0, latest;
    const NativeCard = props => { renders += 1; latest = props; return React.createElement('NativeCard', props); };
    const Card = load(file('src/screens/cluster-lab/StationPriceCard.js'), {
        '../../localization': formatters,
        '../../components/native/NativeStationCard': NativeCard,
        '../../lib/stationCardPresentation': await presentationModule(),
    }).default;
    let view;
    let props = { station: sample, now: 120000, fuelGrade: 'regular', rank: 1, isDark: false,
        themeColors: { text: 'black' }, onMeasure() {}, onNavigate() {} };
    const render = async changes => { props = { ...props, ...changes }; await act(async () => {
        if (view) view.update(React.createElement(Card, props)); else view = create(React.createElement(Card, props));
    }); };
    await render({});
    const measurement = latest.onLayout;
    const moved = { ...sample, longitude: -82.0001, distanceMiles: 1.12 };
    await render({ station: moved });
    assert.equal(renders, 1);
    assert.equal(latest.getStation(), moved, 'Go must use current coordinates and raw metadata');
    assert.equal(latest.onLayout, measurement);
    for (const change of [{ rank: 2 }, { themeColors: { text: 'white' } }, { isDark: true },
        { fuelGrade: 'premium' }, { now: 180000 }, { onNavigate() {} }]) {
        const before = renders;
        await render(change);
        assert.equal(renders, before + 1);
    }
    await act(async () => view.unmount());
});

test('ranking correction cannot interrupt a drag or its momentum; explicit navigation still works', async () => {
    const scrolls = [], selected = [];
    const List = React.forwardRef((props, ref) => {
        React.useImperativeHandle(ref, () => ({ scrollToOffset: command => scrolls.push(command) }), []);
        return React.createElement('FlatList', props);
    });
    const Carousel = load(file('src/screens/cluster-lab/StationCardCarousel.js'), {
        'react-native': { View: 'View', FlatList: List, StyleSheet: { create: x => x },
            useWindowDimensions: () => ({ width: 400, height: 900, fontScale: 1 }) },
        'expo-modules-core': { requireNativeViewManager: () => 'NativePages' },
        '../../components/native/GlassActionButton': 'GlassActionButton',
        './StationPriceCard': 'StationPriceCard',
        './stationCardModel': { pageFromOffset: (offset, width) => Math.round(offset / width) },
    }).default;
    const ref = React.createRef();
    let view;
    await act(async () => { view = create(React.createElement(Carousel, {
        ref, stations: [{ id: 'a' }, { id: 'b' }], selectedId: 'a', active: false, bottom: 0,
        onHeight() {}, onSelect: id => selected.push(id), overview: true,
    })); });
    scrolls.length = 0;
    const list = () => view.root.findByType('FlatList').props;
    await act(async () => list().onScrollBeginDrag());
    await act(async () => ref.current.syncSelection(1));
    assert.equal(scrolls.length, 0);
    await act(async () => list().onScrollEndDrag({ nativeEvent: { contentOffset: { x: 150 }, targetContentOffset: { x: 400 } } }));
    await act(async () => ref.current.syncSelection(1));
    assert.equal(scrolls.length, 0, 'momentum must finish without a programmatic snap');
    await act(async () => list().onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 400 } } }));
    assert.equal(selected.at(-1), 'b');
    await act(async () => ref.current.syncSelection(0));
    assert.equal(scrolls.length, 1);
    await act(async () => ref.current.syncSelection(0));
    assert.equal(scrolls.length, 1, 'duplicate corrections do not resnap');
    await act(async () => { list().onScrollBeginDrag(); ref.current.scrollTo(1, true); });
    assert.deepEqual(scrolls.at(-1), { offset: 400, animated: true });
    await act(async () => view.unmount());
});

test('reordering during a swipe selects its actual landing card without a delayed correction', async () => {
    const scrolls = [];
    const List = React.forwardRef((props, ref) => {
        React.useImperativeHandle(ref, () => ({ scrollToOffset: command => scrolls.push(command) }), []);
        return React.createElement('FlatList', props);
    });
    const Carousel = load(file('src/screens/cluster-lab/StationCardCarousel.js'), {
        'react-native': { View: 'View', FlatList: List, StyleSheet: { create: x => x },
            useWindowDimensions: () => ({ width: 400, height: 900, fontScale: 1 }) },
        'expo-modules-core': { requireNativeViewManager: () => 'NativePages' },
        '../../components/native/GlassActionButton': 'GlassActionButton',
        './StationPriceCard': 'StationPriceCard',
        './stationCardModel': { pageFromOffset: (offset, width) => Math.round(offset / width) },
    }).default;
    let replaceStations, selectedID;
    function Screen() {
        const [stations, setStations] = React.useState([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
        const [selectedId, select] = React.useState('b');
        const carousel = React.useRef(null);
        const selectedIndex = stations.findIndex(s => s.id === selectedId);
        React.useEffect(() => carousel.current.syncSelection(selectedIndex), [selectedIndex]);
        replaceStations = setStations;
        selectedID = selectedId;
        return React.createElement(Carousel, { ref: carousel, stations, selectedId, active: false,
            bottom: 0, onHeight() {}, onSelect: select, overview: false });
    }
    let view;
    await act(async () => { view = create(React.createElement(Screen)); });
    scrolls.length = 0;
    const list = () => view.root.findByType('FlatList').props;
    await act(async () => list().onScrollBeginDrag());
    await act(async () => replaceStations([{ id: 'b' }, { id: 'a' }, { id: 'c' }]));
    assert.equal(scrolls.length, 0, 'ranking correction is skipped while finger owns position');
    await act(async () => list().onScrollEndDrag({ nativeEvent: { contentOffset: { x: 500 }, targetContentOffset: { x: 800 } } }));
    await act(async () => list().onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 800 } } }));
    assert.equal(selectedID, 'c');
    assert.equal(scrolls.length, 0, 'swipe landing is authoritative; no old index correction remains');
    await act(async () => replaceStations([{ id: 'b' }, { id: 'a' }, { id: 'c' }]));
    assert.equal(scrolls.length, 0, 'same-order refresh stays at the landing card');
    await act(async () => view.unmount());
});
