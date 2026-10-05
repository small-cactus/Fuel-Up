const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;

test('loading handoff preserves mounted content and exposes only the active slot to touch and accessibility', async () => {
    const Reveal = load('src/components/SkeletonReveal.js', {
        'react-native': { Platform: { OS: 'ios' }, View: 'View', StyleSheet: { create: s => s } },
        'expo-modules-core': { requireNativeViewManager: () => 'NativeReveal' },
    }).default;
    let mounts = 0;
    function Content() { React.useEffect(() => { mounts++; }, []); return React.createElement('Data'); }
    const render = loading => React.createElement(Reveal, { loading, placeholder: React.createElement('Skeleton') }, React.createElement(Content));
    let renderer;
    await act(async () => { renderer = create(render(true)); });
    let slots = renderer.root.findAllByType('View');
    assert.equal(slots[0].props.accessibilityElementsHidden, false);
    assert.equal(slots[1].props.pointerEvents, 'none');
    assert.equal(slots[1].props.accessibilityElementsHidden, true);
    await act(async () => renderer.update(render(false)));
    slots = renderer.root.findAllByType('View');
    assert.equal(slots[0].props.accessibilityElementsHidden, true);
    assert.equal(slots[1].props.pointerEvents, 'auto');
    assert.equal(slots[1].props.accessibilityElementsHidden, false);
    await act(async () => renderer.update(render(false)));
    assert.equal(mounts, 1, 'refreshing data must not remount live content');
    await act(async () => renderer.unmount());
});

test('non-iOS fallback shows real content and empty results without requiring a Metal view', async () => {
    const Reveal = load('src/components/SkeletonReveal.js', {
        'react-native': { Platform: { OS: 'android' }, View: 'View', StyleSheet: { create: s => s } },
        'expo-modules-core': { requireNativeViewManager: () => { throw Error('not available'); } },
    }).default;
    let renderer;
    await act(async () => { renderer = create(React.createElement(Reveal, { loading: true, placeholder: 'Loading' }, 'Ready')); });
    assert.deepEqual(renderer.toJSON().children, ['Loading']);
    await act(async () => renderer.update(React.createElement(Reveal, { loading: false, placeholder: 'Loading' }, null)));
    assert.equal(renderer.toJSON().children, null);
    await act(async () => renderer.unmount());
});
