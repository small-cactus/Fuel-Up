import React from 'react';
import { ThemeProvider } from '../src/ThemeContext';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
    return (
        <ThemeProvider>
            <Slot />
            <StatusBar style="auto" />
        </ThemeProvider>
    );
}
