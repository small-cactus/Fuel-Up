import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildFuelSearchCriteriaSignature, normalizeFuelSearchPreferences } from './lib/fuelSearchState';
import { createPreferencesStore, DEFAULT_PREFERENCES } from './lib/preferencesStore';

const PreferencesContext = createContext({
    preferences: DEFAULT_PREFERENCES,
    fuelSearchCriteriaSignature: '',
    normalizedFuelSearchPreferences: normalizeFuelSearchPreferences(DEFAULT_PREFERENCES),
    preferenceRevision: 0,
    updatePreference: () => {},
    resetOnboarding: () => {},
    completeOnboarding: () => {},
    isLoading: true,
});

export function PreferencesProvider({ children }) {
    const [store] = useState(() => createPreferencesStore(AsyncStorage));
    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    useEffect(() => { void store.load(); }, [store]);
    const updatePreference = useCallback((key, value) => store.update({ [key]: value }), [store]);
    const completeOnboarding = useCallback((choices = {}) => store.update({
        ...choices,
        hasCompletedOnboarding: true,
    }), [store]);
    const resetOnboarding = useCallback(() => store.update({ hasCompletedOnboarding: false }), [store]);
    const normalizedFuelSearchPreferences = useMemo(() => (
        normalizeFuelSearchPreferences(snapshot.preferences)
    ), [snapshot.preferences]);
    const value = useMemo(() => ({
        ...snapshot,
        normalizedFuelSearchPreferences,
        fuelSearchCriteriaSignature: buildFuelSearchCriteriaSignature(normalizedFuelSearchPreferences),
        updatePreference,
        resetOnboarding,
        completeOnboarding,
    }), [snapshot, normalizedFuelSearchPreferences, updatePreference, resetOnboarding, completeOnboarding]);
    return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
    return useContext(PreferencesContext);
}
