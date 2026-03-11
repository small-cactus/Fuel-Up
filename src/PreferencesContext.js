import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    buildFuelSearchCriteriaSignature,
    normalizeFuelSearchPreferences,
} from './lib/fuelSearchState';

const STORAGE_KEY = '@fuelup/preferences';

const DEFAULT_PREFERENCES = {
    searchRadiusMiles: 10,
    preferredOctane: 'regular', // 'regular' | 'midgrade' | 'premium' | 'diesel'
    preferredProvider: 'gasbuddy', // 'gasbuddy' | 'all'
    minimumRating: 0, // 0 = no filter
    debugClusterAnimations: false,
    excludedBrands: [],
    hasCompletedOnboarding: false,
};

const PreferencesContext = createContext({
    preferences: DEFAULT_PREFERENCES,
    fuelSearchCriteriaSignature: '',
    normalizedFuelSearchPreferences: normalizeFuelSearchPreferences(DEFAULT_PREFERENCES),
    preferenceRevision: 0,
    updatePreference: () => { },
    resetOnboarding: () => { },
    completeOnboarding: () => { },
    isLoading: true,
});

function areValuesEqual(left, right) {
    if (Object.is(left, right)) {
        return true;
    }

    if (Array.isArray(left) && Array.isArray(right)) {
        if (left.length !== right.length) {
            return false;
        }

        return left.every((value, index) => areValuesEqual(value, right[index]));
    }

    if (
        left &&
        right &&
        typeof left === 'object' &&
        typeof right === 'object'
    ) {
        const leftKeys = Object.keys(left);
        const rightKeys = Object.keys(right);

        if (leftKeys.length !== rightKeys.length) {
            return false;
        }

        return leftKeys.every(key => areValuesEqual(left[key], right[key]));
    }

    return false;
}

function normalizePreferences(preferences = {}) {
    const normalizedFuelSearchPreferences = normalizeFuelSearchPreferences(preferences);

    return {
        ...DEFAULT_PREFERENCES,
        ...preferences,
        ...normalizedFuelSearchPreferences,
    };
}

export function PreferencesProvider({ children }) {
    const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
    const [preferenceRevision, setPreferenceRevision] = useState(0);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        loadPreferences();
    }, []);

    const loadPreferences = async () => {
        try {
            const stored = await AsyncStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                setPreferences(normalizePreferences(parsed));
            }
        } catch (error) {
            console.warn('Failed to load preferences:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const savePreferences = async (nextPreferences) => {
        try {
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextPreferences));
        } catch (error) {
            console.warn('Failed to save preferences:', error);
        }
    };

    const updatePreference = (key, value) => {
        setPreferences(current => {
            const next = normalizePreferences({ ...current, [key]: value });
            if (areValuesEqual(current, next)) {
                return current;
            }

            savePreferences(next);
            setPreferenceRevision(currentValue => currentValue + 1);
            return next;
        });
    };

    const completeOnboarding = () => {
        updatePreference('hasCompletedOnboarding', true);
    };

    const resetOnboarding = () => {
        updatePreference('hasCompletedOnboarding', false);
    };

    const normalizedFuelSearchPreferences = useMemo(() => (
        normalizeFuelSearchPreferences(preferences)
    ), [preferences]);

    const fuelSearchCriteriaSignature = useMemo(() => (
        buildFuelSearchCriteriaSignature(normalizedFuelSearchPreferences)
    ), [normalizedFuelSearchPreferences]);

    return (
        <PreferencesContext.Provider
            value={{
                preferences,
                fuelSearchCriteriaSignature,
                normalizedFuelSearchPreferences,
                preferenceRevision,
                updatePreference,
                resetOnboarding,
                completeOnboarding,
                isLoading,
            }}
        >
            {children}
        </PreferencesContext.Provider>
    );
}

export function usePreferences() {
    return useContext(PreferencesContext);
}
