import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_STORAGE_KEY = '@fuelup/themeMode';

const ThemeContext = createContext({
    isDark: false,
    themeMode: 'light', // 'light' | 'dark' | 'system'
    setThemeMode: () => { },
    themeColors: {
        background: '#f2f1f6',
        text: '#000000',
        textOpacity: 'rgba(0,0,0,0.6)',
        headerText: '#000000',
        tabInactive: '#8E8E93',
    },
});

export const ThemeProvider = ({ children }) => {
    const [themeMode, setThemeModeState] = useState('light');
    const [systemScheme, setSystemScheme] = useState(Appearance.getColorScheme() || 'light');
    const selectionRevision = useRef(0);
    const pendingWrites = useRef(Promise.resolve());

    // Listen for OS-level appearance changes
    useEffect(() => {
        const subscription = Appearance.addChangeListener(({ colorScheme }) => {
            setSystemScheme(colorScheme || 'light');
        });
        return () => subscription.remove();
    }, []);

    // Load persisted theme mode on mount
    useEffect(() => {
        let cancelled = false;
        const revision = selectionRevision.current;
        (async () => {
            try {
                const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
                if (cancelled || selectionRevision.current !== revision) return;
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
        return () => { cancelled = true; };
    }, []);

    const setThemeMode = useCallback((mode) => {
        if (!['light', 'dark', 'system'].includes(mode)) return Promise.resolve();
        selectionRevision.current += 1;
        setThemeModeState(mode);
        Appearance.setColorScheme(mode === 'system' ? null : mode);
        // A slow earlier write must not replace the user's latest selection on relaunch.
        pendingWrites.current = pendingWrites.current.then(() => AsyncStorage.setItem(THEME_STORAGE_KEY, mode)).catch(error => {
            console.warn('Failed to persist theme mode:', error);
        });
        return pendingWrites.current;
    }, []);

    // Derive isDark from themeMode + system scheme
    const isDark =
        themeMode === 'dark' ? true :
            themeMode === 'light' ? false :
        /* system */ systemScheme === 'dark';

    const themeColors = useMemo(() => ({
        background: isDark ? '#000000' : '#f2f1f6',
        text: isDark ? '#FFFFFF' : '#000000',
        textOpacity: isDark ? 'rgba(255,255,255,0.64)' : 'rgba(0,0,0,0.6)',
        headerText: isDark ? '#FFFFFF' : '#000000',
        tabInactive: isDark ? '#636366' : '#8E8E93',
        cardBackground: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    }), [isDark]);
    const value = useMemo(() => ({ isDark, themeMode, setThemeMode, themeColors }), [isDark, themeMode, setThemeMode, themeColors]);

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => useContext(ThemeContext);
