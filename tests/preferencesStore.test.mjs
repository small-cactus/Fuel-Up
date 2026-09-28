import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreferencesStore, DEFAULT_PREFERENCES } from '../src/lib/preferencesStore.js';

function memoryStorage(initial = null) {
    let value = initial;
    return { getItem: async () => value, setItem: async (_, next) => { value = next; }, value: () => JSON.parse(value) };
}

for (const grade of ['regular', 'midgrade', 'premium', 'diesel']) {
    for (const radius of [2, 7, 15]) {
        test(`clean setup persists ${grade} and ${radius} miles together across relaunch`, async () => {
            const storage = memoryStorage();
            const first = createPreferencesStore(storage);
            await first.load();
            await first.update({ preferredOctane: grade, searchRadiusMiles: radius, hasCompletedOnboarding: true });
            const second = createPreferencesStore(storage);
            await second.load();
            assert.equal(second.getSnapshot().preferences.preferredOctane, grade);
            assert.equal(second.getSnapshot().preferences.searchRadiusMiles, radius);
            assert.equal(second.getSnapshot().preferences.hasCompletedOnboarding, true);
        });
    }
}

test('rapid changes serialize writes so old requests cannot overwrite the latest preference', async () => {
    let active = 0;
    let peak = 0;
    let stored;
    const store = createPreferencesStore({
        getItem: async () => null,
        setItem: async (_, value) => {
            peak = Math.max(peak, ++active);
            await new Promise(resolve => setTimeout(resolve, JSON.parse(value).searchRadiusMiles === 2 ? 15 : 1));
            stored = JSON.parse(value);
            active--;
        },
    });
    await store.load();
    await Promise.all([store.update({ searchRadiusMiles: 2 }), store.update({ searchRadiusMiles: 15 }), store.update({ preferredOctane: 'diesel' })]);
    assert.equal(peak, 1);
    assert.equal(stored.searchRadiusMiles, 15);
    assert.equal(stored.preferredOctane, 'diesel');
});

test('edits during hydration retain stored settings and apply once loading finishes', async () => {
    const storage = memoryStorage(JSON.stringify({ ...DEFAULT_PREFERENCES, navigationApp: 'google-maps' }));
    const store = createPreferencesStore(storage);
    await store.update({ preferredOctane: 'premium' });
    assert.equal(storage.value().navigationApp, 'google-maps');
    assert.equal(storage.value().preferredOctane, 'premium');
});

test('a failed write does not poison future writes; replay preserves choices', async () => {
    const storage = memoryStorage();
    const save = storage.setItem;
    let fail = true;
    storage.setItem = (...args) => { if (fail) { fail = false; throw Error('disk unavailable'); } return save(...args); };
    const errors = [];
    const store = createPreferencesStore(storage, (...args) => errors.push(args));
    await store.load();
    await store.update({ preferredOctane: 'diesel', hasCompletedOnboarding: true });
    await store.update({ hasCompletedOnboarding: false });
    assert.equal(errors.length, 1);
    assert.equal(storage.value().preferredOctane, 'diesel');
    assert.equal(storage.value().hasCompletedOnboarding, false);
});

for (const corrupt of ['not json', 'null', '[]', '{"hasCompletedOnboarding":"false"}']) {
    test(`corrupt preferences recover to clean onboarding: ${corrupt}`, async () => {
        const store = createPreferencesStore(memoryStorage(corrupt), () => {});
        await store.load();
        assert.equal(store.getSnapshot().isLoading, false);
        assert.equal(store.getSnapshot().preferences.hasCompletedOnboarding, false);
    });
}
