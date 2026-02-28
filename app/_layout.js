import React from 'react';
import { AppStateProvider } from '../src/AppStateContext';
import { ThemeProvider } from '../src/ThemeContext';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
    return (
        <AppStateProvider>
            <ThemeProvider>
                <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen name="(tabs)" />
                    <Stack.Screen
                        name="prices-sheet"
                        options={{
                            presentation: 'formSheet',
                            sheetAllowedDetents: [0.45, 1], // Approximately 1 card + top of next
                            sheetGrabberVisible: true,
                        }}
                    />
                </Stack>
                <StatusBar style="auto" />
            </ThemeProvider>
        </AppStateProvider>
    );
}
