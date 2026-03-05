import React, { createContext, useContext, useEffect, useState } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_STORAGE_KEY = '@fuelup/themeMode';

const ThemeContext = createContext({
    isDark: false,
    themeMode: 'light', // 'light' | 'dark' | 'system'
    setThemeMode: () => { },
    themeColors: {
        background: '#FFFFFF',
        text: '#000000',
        textOpacity: 'rgba(0,0,0,0.6)',
        headerText: '#000000',
        tabInactive: '#8E8E93',
    },
});

export const ThemeProvider = ({ children }) => {
    const [themeMode, setThemeModeState] = useState('light');
    const [systemScheme, setSystemScheme] = useState(Appearance.getColorScheme() || 'light');

    // Listen for OS-level appearance changes
    useEffect(() => {
        const subscription = Appearance.addChangeListener(({ colorScheme }) => {
            setSystemScheme(colorScheme || 'light');
        });
        return () => subscription.remove();
    }, []);

    // Load persisted theme mode on mount
    useEffect(() => {
        (async () => {
            try {
                const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
                if (stored === 'light' || stored === 'dark' || stored === 'system') {
                    setThemeModeState(stored);
                    Appearance.setColorScheme(stored === 'system' ? null : stored);
                } else {
                    Appearance.setColorScheme('light'); // fallback default
                }
            } catch (error) {
                console.warn('Failed to load theme mode:', error);
            }
        })();
    }, []);

    const setThemeMode = async (mode) => {
        setThemeModeState(mode);
        Appearance.setColorScheme(mode === 'system' ? null : mode);
        try {
            await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
        } catch (error) {
            console.warn('Failed to persist theme mode:', error);
        }
    };

    // Derive isDark from themeMode + system scheme
    const isDark =
        themeMode === 'dark' ? true :
            themeMode === 'light' ? false :
        /* system */ systemScheme === 'dark';

    const themeColors = {
        background: isDark ? '#000000' : '#FFFFFF',
        text: isDark ? '#FFFFFF' : '#000000',
        textOpacity: isDark ? 'rgba(255,255,255,0.64)' : 'rgba(0,0,0,0.6)',
        headerText: isDark ? '#FFFFFF' : '#000000',
        tabInactive: isDark ? '#636366' : '#8E8E93',
        cardBackground: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    };

    return (
        <ThemeContext.Provider value={{ isDark, themeMode, setThemeMode, themeColors }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => useContext(ThemeContext);
