const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./helpers/loadComponent.cjs');
const { createPreferencesStore } = require('../src/lib/preferencesStore.js');
global.IS_REACT_ACT_ENVIRONMENT = true;

async function setup(page) {
    let saved, query, backs = 0, writes = 0;
    const initial = { searchRadiusMiles: 12, preferredOctane: 'premium', requiresE85: false,
        preferredBrands: ['shell'], fuelMemberships: ['sams'], hasCompletedOnboarding: true };
    const store = createPreferencesStore({ getItem: async () => JSON.stringify(initial),
        setItem: async (_, value) => { saved = JSON.parse(value); writes++; } });
    await store.load();
    const Page = load('src/components/settings/PreferencePage.js', {
        'react-native': { View: 'View', StyleSheet: { create: value => value } },
        'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 62, bottom: 34 }) },
        '../TopCanopy': { __esModule: true, default: () => null },
        '../FuelUpHeaderLogo': { __esModule: true, default: () => null },
        'expo-router': { Stack: { Screen: () => null }, useRouter: () => ({ back: () => backs++ }) },
        'expo-modules-core': { requireNativeViewManager: () => 'NativePage' },
        '../../AppStateContext': { useAppState: () => ({ resolvedFuelSearchContext: { latitude: 28, longitude: -82 } }) },
        '../../PreferencesContext': { usePreferences: () => ({ preferences: store.getSnapshot().preferences, updatePreferences: store.update }) },
        '../../ThemeContext': { useTheme: () => ({ isDark: true, themeColors: { background: '#000000' } }) },
        '../../screens/onboarding/useNativeOnboardingData': { __esModule: true, default: (coordinate, choices) => {
            query = { coordinate, choices }; return { data: {}, retry() {} };
        } },
    }).default;
    let view;
    await act(async () => { view = create(React.createElement(Page, { page })); });
    return { get query() { return query; }, get saved() { return saved; }, get writes() { return writes; }, get backs() { return backs; },
        send: event => act(async () => view.root.findByType('NativePage').props.onAction({ nativeEvent: event })),
        unmount: () => act(async () => view.unmount()) };
}

test('fuel page immediately saves only fuel fields, preserving radius and station preferences', async () => {
    const state = await setup('fuel');
    assert.equal(state.query.coordinate, null, 'fuel choices do not start station or membership requests');
    const draft = { preferredOctane: 'e85', requiresE85: true, searchRadiusMiles: 6, preferredBrands: [], fuelMemberships: [] };
    await state.send({ type: 'choices', choices: draft });
    assert.equal(state.writes, 1);
    assert.equal(state.query.choices.searchRadiusMiles, 12);
    assert.equal(state.saved.preferredOctane, 'e85');
    assert.equal(state.saved.requiresE85, true);
    assert.equal(state.saved.searchRadiusMiles, 12);
    assert.deepEqual(state.saved.preferredBrands, ['shell']);
    assert.deepEqual(state.saved.fuelMemberships, ['sams']);
    assert.equal(state.saved.hasCompletedOnboarding, true);
    assert.equal(state.backs, 0, 'selection keeps the page open');
    await state.unmount();
});

test('brand page saves memberships and favorites together without changing fuel or radius', async () => {
    const state = await setup('brands');
    assert.deepEqual(state.query.coordinate, { latitude: 28, longitude: -82 });
    const draft = { preferredBrands: ['costco'], fuelMemberships: ['costco'], preferredOctane: 'regular', requiresE85: true, searchRadiusMiles: 6 };
    await state.send({ type: 'choices', choices: draft });
    assert.equal(state.query.choices.searchRadiusMiles, 12);
    assert.equal(state.query.choices.preferredOctane, 'premium');
    assert.deepEqual(state.saved.fuelMemberships, ['costco']);
    assert.deepEqual(state.saved.preferredBrands, ['costco']);
    assert.equal(state.saved.preferredOctane, 'premium');
    assert.equal(state.saved.requiresE85, false);
    assert.equal(state.saved.searchRadiusMiles, 12);
    assert.equal(state.writes, 1);
    await state.unmount();
});

test('rapid selections persist in order and survive leaving without Save', async () => {
    const state = await setup('brands');
    await state.send({ type: 'choices', choices: { preferredBrands: [], fuelMemberships: [] } });
    await state.send({ type: 'choices', choices: { preferredBrands: ['shell'], fuelMemberships: ['costco'] } });
    await state.unmount();
    assert.equal(state.writes, 2);
    assert.deepEqual(state.saved.preferredBrands, ['shell']);
    assert.deepEqual(state.saved.fuelMemberships, ['costco']);
    assert.equal(state.saved.searchRadiusMiles, 12);
    assert.equal(state.backs, 0);
});
