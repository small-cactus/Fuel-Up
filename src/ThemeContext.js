import React, { createContext, useState, useContext } from 'react';

const ThemeContext = createContext({
    isDark: false,
    toggleTheme: () => { },
    themeColors: {
        background: '#FFFFFF',
        text: '#000000',
        headerText: '#000000',
        tabInactive: '#8E8E93',
    }
});

export const ThemeProvider = ({ children }) => {
    const [isDark, setIsDark] = useState(false); // Default to light mode as requested

    const toggleTheme = () => {
        setIsDark(!isDark);
    };

    const themeColors = {
        background: isDark ? '#000000' : '#FFFFFF',
        text: isDark ? '#FFFFFF' : '#000000',
        headerText: isDark ? '#FFFFFF' : '#000000',
        tabInactive: isDark ? '#636366' : '#8E8E93',
        cardBackground: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    };

    return (
        <ThemeContext.Provider value={{ isDark, toggleTheme, themeColors }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => useContext(ThemeContext);
