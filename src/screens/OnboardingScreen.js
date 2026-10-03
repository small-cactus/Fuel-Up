import React from 'react';
import { Platform } from 'react-native';
import { usePreferences } from '../PreferencesContext';
import { useTheme } from '../ThemeContext';

// iOS reports dotted strings such as "27.0.1", which Number() cannot parse.
const NativeOnboarding = Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 16
    ? require('./onboarding/NativeOnboarding').default : null;
const LegacyOnboarding = !NativeOnboarding ? require('./OnboardingScreen.legacy').default : null;

export default function OnboardingScreen() {
    const { preferences, completeOnboarding } = usePreferences();
    const { isDark } = useTheme();
    return NativeOnboarding
        ? <NativeOnboarding preferences={preferences} isDark={isDark} visible onComplete={completeOnboarding} />
        : <LegacyOnboarding />;
}
