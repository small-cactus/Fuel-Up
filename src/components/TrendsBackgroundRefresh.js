import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useAppState } from '../AppStateContext';
import { usePreferences } from '../PreferencesContext';
import useTrendsBackgroundRefresh from '../screens/trends/useTrendsBackgroundRefresh';

// Mounted outside the tab navigator: opening Home also refreshes Trends.
export default function TrendsBackgroundRefresh() {
    const { preferences, normalizedFuelSearchPreferences, isLoading } = usePreferences();
    const { manualLocationOverride, resolvedFuelSearchContext, fuelResetToken } = useAppState();
    const [active, setActive] = useState(AppState.currentState !== 'background');
    useEffect(() => {
        // Control Center and permission sheets are inactive, not app exits.
        const subscription = AppState.addEventListener('change', state => {
            if (state === 'background') setActive(false);
            else if (state === 'active') setActive(true);
        });
        return () => subscription.remove();
    }, []);
    useTrendsBackgroundRefresh({
        enabled: active && !isLoading && preferences.hasCompletedOnboarding,
        origin: manualLocationOverride || resolvedFuelSearchContext,
        preferences: normalizedFuelSearchPreferences,
        resetToken: fuelResetToken,
    });
    return null;
}
