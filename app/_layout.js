import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { AppStateProvider } from '../src/AppStateContext';
import { ThemeProvider, useTheme } from '../src/ThemeContext';
import { PreferencesProvider, usePreferences } from '../src/PreferencesContext';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import OnboardingScreen from '../src/screens/OnboardingScreen';

function AppGate() {
    const { preferences, isLoading } = usePreferences();
    const { isDark, themeColors } = useTheme();

    if (isLoading) {
        return (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: themeColors.background }}>
                <ActivityIndicator size="large" color={themeColors.text} />
            </View>
        );
    }

    if (!preferences.hasCompletedOnboarding) {
        return <OnboardingScreen />;
    }

    return (
        <>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen
                    name="prices-sheet"
                    options={{
                        presentation: 'formSheet',
                        sheetAllowedDetents: [0.45, 1],
                        sheetGrabberVisible: true,
                    }}
                />
            </Stack>
        </>
    );
}

export default function RootLayout() {
    return (
        <AppStateProvider>
            <ThemeProvider>
                <PreferencesProvider>
                    <AppGate />
                </PreferencesProvider>
            </ThemeProvider>
        </AppStateProvider>
    );
}
