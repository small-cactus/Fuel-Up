import React, { useRef, useState, useSyncExternalStore } from 'react';
import { useAppState } from '../AppStateContext';
import { buildResolvedFuelSearchContext } from '../lib/fuelSearchState';
import { persistLastDeviceLocationRegion } from '../lib/deviceLocationCache';
import { onboardingHandoff } from '../lib/onboardingHandoff';
import { finishLaunch } from '../lib/launchReadiness';
import { Platform } from 'react-native';
import { usePreferences } from '../PreferencesContext';
import { useTheme } from '../ThemeContext';

// The iOS app requires iOS 26+. Only other platforms use the React flow.
const NativeOnboarding = Platform.OS === 'ios'
    ? require('./onboarding/NativeOnboarding').default : null;
const LegacyOnboarding = Platform.OS !== 'ios' ? require('./OnboardingScreen.legacy').default : null;

export default function OnboardingScreen() {
    const { preferences, updatePreferences, completeOnboarding } = usePreferences();
    const { isDark } = useTheme();
    const { setResolvedFuelSearchContext } = useAppState();
    const phase = useSyncExternalStore(onboardingHandoff.subscribe, onboardingHandoff.getSnapshot, onboardingHandoff.getSnapshot);
    const saving = useRef(false);
    const [saveError, setSaveError] = useState(null);
    const save = async (choices, coordinate) => {
        if (saving.current) return;
        saving.current = true;
        setSaveError(null);
        try {
            if (!coordinate) throw new Error('Your location is unavailable. Please try again.');
            await updatePreferences(choices, { requirePersistence: true });
            await persistLastDeviceLocationRegion({ ...coordinate, latitudeDelta: 0.06, longitudeDelta: 0.06 }, null, { requirePersistence: true });
            setResolvedFuelSearchContext(buildResolvedFuelSearchContext({ origin: coordinate, locationSource: 'device',
                ...preferences, ...choices, fuelGrade: choices.preferredOctane, radiusMiles: choices.searchRadiusMiles }));
            const ready = onboardingHandoff.prepare();
            await ready;
            await completeOnboarding(choices);
            onboardingHandoff.reveal();
        } catch (error) {
            onboardingHandoff.finish();
            saving.current = false;
            setSaveError(error.message || 'Could not save. Please try again.');
        }
    };
    return NativeOnboarding
        ? <NativeOnboarding preferences={preferences} isDark={isDark} visible onMapReady={finishLaunch} onComplete={save} revealing={phase === 'revealing'} saveError={saveError} onExitComplete={() => onboardingHandoff.finish()} />
        : <LegacyOnboarding />;
}
