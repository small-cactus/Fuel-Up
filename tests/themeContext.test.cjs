const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function setup(storage, strict = false) {
    const applied = [];
    let listener;
    const { ThemeProvider, useTheme } = load('src/ThemeContext.js', {
        'react-native': { Appearance: { getColorScheme: () => 'light',
            addChangeListener: fn => { listener = fn; return { remove() {} }; }, setColorScheme: mode => applied.push(mode) } },
        '@react-native-async-storage/async-storage': storage,
    });
    let value;
    function Consumer() { value = useTheme(); return null; }
    let renderer;
    await act(async () => { renderer = create(React.createElement(strict ? React.StrictMode : React.Fragment, null,
        React.createElement(ThemeProvider, null, React.createElement(Consumer)))); });
    return { get value() { return value; }, applied, listener, renderer };
}

test('late persisted theme cannot overwrite a newer user choice', async () => {
    const read = deferred();
    const state = await setup({ getItem: () => read.promise, setItem: async () => {} });
    await act(async () => state.value.setThemeMode('dark'));
    await act(async () => read.resolve('light'));
    assert.equal(state.value.themeMode, 'dark');
    assert.deepEqual(state.applied, ['dark']);
    await act(async () => state.renderer.unmount());
});

test('theme writes are serialized and newest selection survives rapid changes', async () => {
    const first = deferred(); const writes = [];
    const state = await setup({ getItem: async () => 'light', setItem: async (_, value) => {
        writes.push(value); if (writes.length === 1) await first.promise;
    } });
    let last;
    await act(async () => { void state.value.setThemeMode('dark'); last = state.value.setThemeMode('system'); });
    assert.deepEqual(writes, ['dark']);
    assert.equal(state.value.themeMode, 'system');
    await act(async () => { first.resolve(); await last; });
    assert.deepEqual(writes, ['dark', 'system']);
    await act(async () => state.renderer.unmount());
});

test('unmounted hydration does not change native appearance', async () => {
    const read = deferred();
    const state = await setup({ getItem: () => read.promise, setItem: async () => {} });
    await act(async () => state.renderer.unmount());
    await act(async () => read.resolve('dark'));
    assert.deepEqual(state.applied, []);
});

test('fixed theme does not broadcast unrelated system appearance changes, StrictMode hydration works', async () => {
    const state = await setup({ getItem: async () => 'light', setItem: async () => {} }, true);
    const previous = state.value;
    await act(async () => state.listener({ colorScheme: 'dark' }));
    assert.equal(state.value, previous);
    await act(async () => state.value.setThemeMode('system'));
    assert.equal(state.value.isDark, true);
    await act(async () => state.renderer.unmount());
});
