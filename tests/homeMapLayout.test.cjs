const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;

test('Home waits for the real SwiftUI card height before publishing the camera inset', async () => {
    const Carousel = load('src/screens/cluster-lab/StationCardCarousel.js', {
        'react-native': { View: 'View', FlatList: 'FlatList', StyleSheet: { create: x => x },
            useWindowDimensions: () => ({ width: 440, height: 956, fontScale: 1 }) },
        'expo-modules-core': { requireNativeViewManager: () => 'NativePages' },
        '../../components/native/GlassActionButton': 'GlassActionButton',
        './StationPriceCard': 'StationPriceCard',
        './stationCardModel': { pageFromOffset: () => 0 },
    }).default;
    const heights = [];
    let view;
    await act(async () => { view = create(React.createElement(Carousel, {
        stations: [{ id: 'one' }], selectedId: 'one', active: false, bottom: 46,
        onHeight: height => heights.push(height), overview: true,
    })); });
    const layout = height => ({ nativeEvent: { layout: { height } } });
    const containers = () => view.root.findAllByType('View');
    await act(async () => {
        containers()[0].props.onLayout(layout(326)); // provisional 230 + 52 + 44
        containers()[1].props.onLayout(layout(52));
    });
    assert.deepEqual(heights, [], 'Provisional layout must not drive initial zoom');
    await act(async () => {
        const card = view.root.findByType('FlatList').props.renderItem({ item: { id: 'one' }, index: 0 });
        card.props.children.props.onLayout(layout(198));
    });
    assert.deepEqual(heights, [], 'Old outer layout must not race the new card measurement');
    await act(async () => containers()[0].props.onLayout(layout(294)));
    assert.deepEqual(heights, [340]);
    await act(async () => view.unmount());
});
