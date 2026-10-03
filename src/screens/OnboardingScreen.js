import React from 'react';
import { Platform } from 'react-native';
import { usePreferences } from '../PreferencesContext';
import { useTheme } from '../ThemeContext';

// The iOS app requires iOS 26+. Only other platforms use the React flow.
const NativeOnboarding = Platform.OS === 'ios'
    ? require('./onboarding/NativeOnboarding').default : null;
const LegacyOnboarding = !NativeOnboarding ? require('./OnboardingScreen.legacy').default : null;

export default function OnboardingScreen() {
    const { preferences, completeOnboarding } = usePreferences();
    const { isDark } = useTheme();
    return NativeOnboarding
        ? <NativeOnboarding preferences={preferences} isDark={isDark} visible onComplete={completeOnboarding} />
        : <LegacyOnboarding />;
}
