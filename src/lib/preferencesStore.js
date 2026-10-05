import { normalizeFuelSearchPreferences } from './fuelSearchState.js';

export const PREFERENCES_STORAGE_KEY = '@fuelup/preferences';
export const DEFAULT_PREFERENCES = {
    searchRadiusMiles: 10,
    preferredOctane: 'regular',
    preferredProvider: 'gasbuddy',
    minimumRating: 0,
    navigationApp: 'apple-maps',
    debugClusterAnimations: false,
    excludedBrands: [],
    preferredBrands: [],
    fuelMemberships: [],
    requiresE85: false,
    hasCompletedOnboarding: false,
};

export function normalizePreferences(value) {
    const preferences = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        ...DEFAULT_PREFERENCES,
        ...preferences,
        ...normalizeFuelSearchPreferences(preferences),
        excludedBrands: Array.isArray(preferences.excludedBrands) ? preferences.excludedBrands : [],
        hasCompletedOnboarding: preferences.hasCompletedOnboarding === true,
    };
}

// One ordered writer keeps rapid slider changes and onboarding completion durable.
// Storage work lives outside React state updaters, which React may invoke twice.
export function createPreferencesStore(storage, onError = console.warn) {
    let snapshot = { preferences: DEFAULT_PREFERENCES, preferenceRevision: 0, isLoading: true };
    let loading;
    let writes = Promise.resolve();
    const listeners = new Set();
    const publish = next => {
        snapshot = next;
        listeners.forEach(listener => listener());
    };
    const load = () => {
        if (!loading) {
            loading = (async () => {
                let preferences = DEFAULT_PREFERENCES;
                try {
                    const stored = await storage.getItem(PREFERENCES_STORAGE_KEY);
                    if (stored) preferences = normalizePreferences(JSON.parse(stored));
                } catch (error) {
                    onError('Failed to load preferences:', error);
                }
                publish({ ...snapshot, preferences, isLoading: false });
            })();
        }
        return loading;
    };
    const update = async (changes, { requirePersistence = false } = {}) => {
        if (snapshot.isLoading) await load();
        const preferences = normalizePreferences({ ...snapshot.preferences, ...changes });
        if (!requirePersistence && JSON.stringify(preferences) === JSON.stringify(snapshot.preferences)) return writes;
        if (!requirePersistence) publish({ preferences, preferenceRevision: snapshot.preferenceRevision + 1, isLoading: false });
        const serialized = JSON.stringify(preferences);
        const write = writes.then(() => storage.setItem(PREFERENCES_STORAGE_KEY, serialized));
        writes = write.catch(error => {
            onError('Failed to save preferences:', error);
        });
        if (requirePersistence) {
            await write;
            publish({ preferences, preferenceRevision: snapshot.preferenceRevision + 1, isLoading: false });
        }
        return writes;
    };
    return {
        getSnapshot: () => snapshot,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        load,
        update,
    };
}
