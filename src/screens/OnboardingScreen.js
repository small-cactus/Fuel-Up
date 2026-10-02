import React from 'react';
import { Platform } from 'react-native';
import { usePreferences } from '../PreferencesContext';
import { useTheme } from '../ThemeContext';

const NativeOnboarding = Platform.OS === 'ios' && Number(Platform.Version) >= 16
    ? require('./onboarding/NativeOnboarding').default : null;
const LegacyOnboarding = !NativeOnboarding ? require('./OnboardingScreen.legacy').default : null;

export default function OnboardingScreen() {
    const { preferences, completeOnboarding } = usePreferences();
    const { isDark } = useTheme();
    return NativeOnboarding
        ? <NativeOnboarding preferences={preferences} isDark={isDark} visible onComplete={completeOnboarding} />
        : <LegacyOnboarding />;
}
