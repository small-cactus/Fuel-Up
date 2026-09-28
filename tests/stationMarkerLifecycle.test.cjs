const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;

async function setup(t) {
  const calls = { mounts: 0, unmounts: 0, renders: 0, animations: 0, cancellations: 0 };
  function NativeMarker(props) {
    calls.renders++;
    React.useEffect(() => { calls.mounts++; return () => { calls.unmounts++; }; }, []);
    return React.createElement('NativeMarker', props);
  }
  const Component = load('src/components/cluster/StationMarker.js', {
    'react-native': { StyleSheet: { create: x => x }, Text: 'Text', View: 'View' },
    'react-native-maps': { Marker: NativeMarker },
    '@callstack/liquid-glass': { LiquidGlassView: 'Glass' },
    'expo-symbols': { SymbolView: 'Symbol' },
    '../../cluster/constants': load('src/cluster/constants.js', {}),
    'react-native-reanimated': {
      __esModule: true, default: { createAnimatedComponent: c => c },
      useSharedValue: initial => React.useRef({ value: initial }).current,
      useAnimatedStyle: () => ({}), withTiming: v => { calls.animations++; return v; },
      cancelAnimation: () => { calls.cancellations++; },
      Easing: { out: v => v, cubic: v => v }, Extrapolate: { CLAMP: 'clamp' }, interpolate: v => v,
    },
  }).default;
  let props = {
    quote: { stationId: 'a', latitude: 37, longitude: -122, price: 3.29 },
    isActive: false, isBest: false, onPress: () => {},
  };
  let renderer;
  await act(async () => { renderer = create(React.createElement(Component, props)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return {
    calls,
    get marker() { return renderer.root.findByType('NativeMarker'); },
    update: async extra => {
      props = { ...props, ...extra };
      await act(async () => renderer.update(React.createElement(Component, props)));
    },
    unmount: async () => { await act(async () => renderer.unmount()); },
  };
}

test('selection changes native stacking without remounting or restarting marker appearance', async t => {
  const h = await setup(t);
  assert.equal(h.marker.props.zIndex, 1);
  await h.update({ isBest: true });
  assert.equal(h.marker.props.zIndex, 2);
  await h.update({ isBest: false, isActive: true });
  assert.equal(h.marker.props.zIndex, 3);
  await h.update({ isActive: false });
  assert.equal(h.marker.props.zIndex, 1);
  assert.equal(h.calls.mounts, 1);
  assert.equal(h.calls.unmounts, 0);
  assert.equal(h.calls.animations, 1);
  assert.equal(h.marker.props.tracksViewChanges, undefined);
});

test('unchanged props do not rerender native marker and changed quote data does not remount it', async t => {
  const h = await setup(t);
  assert.equal(h.calls.renders, 1, 'no view-tracking effect schedules a second render');
  await h.update({});
  assert.equal(h.calls.renders, 1);
  await h.update({ quote: { stationId: 'a', latitude: 37, longitude: -122, price: 3.39 } });
  assert.equal(h.calls.mounts, 1);
  assert.equal(h.calls.animations, 1);
});

test('temporarily displayed suppressed marker is noninteractive and behind normal chips', async t => {
  const h = await setup(t);
  await h.update({ isSuppressed: true, shouldDelaySuppression: true, isActive: false });
  assert.equal(h.marker.props.zIndex, -1);
  assert.equal(h.marker.props.onPress, undefined);
  assert.equal(h.marker.props.tappable, false);
});

test('unmount cancels the appearance animation', async t => {
  const h = await setup(t);
  await h.unmount();
  assert.equal(h.calls.cancellations, 1);
});


test('collision suppression retains the native annotation and custom view without invisible glass', async t => {
  const h = await setup(t);
  const firstMarker = h.marker;
  const wrapper = firstMarker.findByProps({ collapsable: false });
  assert.equal(wrapper.findAllByType('Glass').length, 1);
  for (let pass = 0; pass < 3; pass++) {
    await h.update({ isSuppressed: true });
    assert.equal(h.marker, firstMarker);
    assert.equal(h.marker.findByProps({ collapsable: false }), wrapper);
    assert.equal(wrapper.findAllByType('Glass').length, 0);
    assert.deepEqual(wrapper.props.style[0], { width: 84, height: 32 });
    assert.equal(h.marker.props.opacity, undefined);
    await h.update({ isSuppressed: false });
    assert.equal(wrapper.findAllByType('Glass').length, 1);
  }
  assert.equal(h.calls.mounts, 1);
  assert.equal(h.calls.unmounts, 0);
  assert.equal(h.calls.animations, 1);
});

test('active selection stays visible even before collision suppression state catches up', async t => {
  const h = await setup(t);
  await h.update({ isSuppressed: true, isActive: true });
  assert.equal(h.marker.props.zIndex, 3);
  assert.equal(h.marker.findAllByType('Glass').length, 1);
  assert.equal(h.marker.props.tappable, true);
  assert.equal(typeof h.marker.props.onPress, 'function');
});
