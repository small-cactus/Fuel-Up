import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@fuelup/preferences';

const DEFAULT_PREFERENCES = {
    searchRadiusMiles: 10,
    preferredOctane: 'regular', // 'regular' | 'midgrade' | 'premium'
    preferredProvider: 'gasbuddy', // 'gasbuddy' | 'all'
    minimumRating: 0, // 0 = no filter
    debugClusterAnimations: false,
    excludedBrands: [],
    hasCompletedOnboarding: false,
};

const PreferencesContext = createContext({
    preferences: DEFAULT_PREFERENCES,
    updatePreference: () => { },
    resetOnboarding: () => { },
    completeOnboarding: () => { },
    isLoading: true,
});

export function PreferencesProvider({ children }) {
    const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        loadPreferences();
    }, []);

    const loadPreferences = async () => {
        try {
            const stored = await AsyncStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                setPreferences({ ...DEFAULT_PREFERENCES, ...parsed });
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
            const next = { ...current, [key]: value };
            savePreferences(next);
            return next;
        });
    };

    const completeOnboarding = () => {
        updatePreference('hasCompletedOnboarding', true);
    };

    const resetOnboarding = () => {
        updatePreference('hasCompletedOnboarding', false);
    };

    return (
        <PreferencesContext.Provider
            value={{
                preferences,
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
