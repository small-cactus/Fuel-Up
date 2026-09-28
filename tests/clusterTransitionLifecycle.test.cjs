const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;

// Exercise the real component/effects and transition plans. Only the native
// rendering and animation clock are replaced; completion callbacks are driven
// explicitly to reproduce UI-thread callbacks arriving late on the JS thread.
async function setup(t, initialIds = ['a']) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const constants = load('src/cluster/constants.js', {});
  const layout = load('src/cluster/layout.js', { './constants': constants });
  const engine = load('src/cluster/transitionEngine.js', { './constants': constants, './layout': layout });
  const completions = [], events = [], cancelled = [];
  const animation = {
    __esModule: true, default: { View: 'AnimatedView', createAnimatedComponent: c => c },
    useSharedValue: initial => React.useRef({ value: initial }).current,
    useAnimatedStyle: () => ({}),
    withTiming: (value, _, completion) => { if (completion) completions.push(completion); return value; },
    cancelAnimation: value => cancelled.push(value), runOnJS: fn => fn,
    Easing: { out: x => x, cubic: x => x }, Extrapolate: { CLAMP: 'clamp' },
    interpolate: value => value, interpolateColor: () => '#000',
  };
  const Overlay = load('src/components/cluster/ClusterMarkerOverlay.js', {
    'react-native': { Text: 'Text', StyleSheet: { create: x => x, absoluteFillObject: {} }, Dimensions: { get: () => ({ width: 440, height: 956 }) } },
    '@callstack/liquid-glass': { LiquidGlassContainerView: 'GlassContainer', LiquidGlassView: 'Glass' },
    'expo-symbols': { SymbolView: 'Symbol' }, 'react-native-reanimated': animation,
    '../../cluster/constants': constants, '../../cluster/layout': layout,
    '../../cluster/transitionEngine': engine,
    '../../cluster/clusterMarkerOverlayMemo': load('src/cluster/clusterMarkerOverlayMemo.js', {}),
  }).default;
  const makeCluster = ids => ({ quotes: ids.map((stationId, i) => ({ stationId, latitude: 37 + i / 1000, longitude: -122 + i / 1000, price: 3 + i / 10, originalIndex: i })) });
  let props = {
    cluster: makeCluster(initialIds), scrollX: { value: 0 }, itemWidth: 400,
    themeColors: { text: '#000' }, activeIndex: 0, isDark: false, isMapMoving: false,
    mapRegion: { latitude: 37, longitude: -122, latitudeDelta: 0.01, longitudeDelta: 0.01 },
    onDebugTransitionEvent: event => events.push(event),
  };
  let renderer;
  await act(async () => { renderer = create(React.createElement(Overlay, props)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return {
    events, completions, cancelled,
    update: async (ids, extra = {}) => {
      props = { ...props, ...(ids ? { cluster: makeCluster(ids) } : {}), ...extra };
      await act(async () => renderer.update(React.createElement(Overlay, props)));
    },
    complete: async index => { await act(async () => completions[index](true)); },
    tick: async ms => { await act(async () => t.mock.timers.tick(ms)); },
    unmount: async () => { await act(async () => renderer.unmount()); },
  };
}
const count = (h, type) => h.events.filter(event => event.type === type).length;

test('idle map lets merge and split reach their actual animation completions', async t => {
  const h = await setup(t);
  await h.update(['a', 'b']);
  assert.equal(count(h, 'merge-duplicate-spawn'), 1);
  await h.tick(1000);
  assert.equal(count(h, 'merge-sequence-complete'), 0);
  await h.update(null, { isMapMoving: true });
  await h.update(null, { isMapMoving: false });
  assert.equal(count(h, 'merge-sequence-complete'), 0);
  await h.complete(0);
  await h.tick(16);
  assert.equal(count(h, 'merge-sequence-complete'), 1);
  await h.tick(34);
  await h.update(['a']);
  assert.equal(count(h, 'split-duplicate-spawn'), 1);
  await h.tick(1000);
  assert.equal(count(h, 'split-handoff-complete'), 0);
  await h.complete(1);
  await h.tick(16);
  assert.equal(count(h, 'split-handoff-complete'), 1);
});

test('late completion from a replaced merge cannot mutate the replacement split', async t => {
  const h = await setup(t);
  await h.update(['a', 'b']);
  await h.update(['a']);
  const eventCount = h.events.length;
  await h.complete(0);
  await h.tick(1000);
  assert.equal(h.events.length, eventCount);
  await h.complete(1);
  await h.tick(16);
  assert.equal(count(h, 'split-duplicate-arrive'), 1);
  assert.equal(count(h, 'split-handoff-complete'), 1);
  assert.equal(count(h, 'merge-accumulator-increment'), 0);
});

test('replacement cancels pending queue steps and discards the previous mover', async t => {
  const h = await setup(t);
  await h.update(['a', 'b', 'c']);
  await h.complete(0); // Queue step for c is scheduled, but has not run.
  await h.update(['a']);
  const eventCount = h.events.length;
  await h.tick(1000);
  assert.equal(h.events.length, eventCount);
  assert.equal(count(h, 'merge-duplicate-spawn'), 1);
  assert.equal(count(h, 'split-duplicate-spawn'), 1);
  assert.ok(h.cancelled.length >= 4, 'both animation drivers cancelled at replacement');
});

test('unmount cancels queue timers and rejects already-dispatched animation callbacks', async t => {
  const h = await setup(t);
  await h.update(['a', 'b', 'c']);
  await h.complete(0);
  const eventCount = h.events.length;
  const cancelCount = h.cancelled.length;
  await h.unmount();
  await h.tick(1000);
  await h.complete(0);
  assert.equal(h.events.length, eventCount);
  assert.equal(h.cancelled.length, cancelCount + 3);
});

test('same-membership redraw preserves an in-flight transition', async t => {
  const h = await setup(t);
  await h.update(['a', 'b']);
  const cancelCount = h.cancelled.length;
  await h.update(['a', 'b'], { isDark: true });
  assert.equal(h.cancelled.length, cancelCount);
  assert.equal(h.completions.length, 1);
  await h.complete(0);
  await h.tick(16);
  assert.equal(count(h, 'merge-sequence-complete'), 1);
});

test('late split completion cannot decrement a new merge accumulator', async t => {
  const h = await setup(t, ['a', 'b']);
  await h.update(['a']);
  await h.update(['a', 'b']);
  const eventCount = h.events.length;
  await h.complete(0);
  await h.tick(1000);
  assert.equal(h.events.length, eventCount);
  await h.complete(1);
  await h.tick(16);
  assert.equal(count(h, 'merge-accumulator-increment'), 1);
  assert.equal(count(h, 'merge-sequence-complete'), 1);
  assert.equal(count(h, 'split-duplicate-arrive'), 0);
});
