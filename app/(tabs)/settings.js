import React from 'react';
import { StyleSheet, Text, View, Switch } from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ThemeContext';

export default function SettingsScreen() {
    const insets = useSafeAreaInsets();
    const { isDark, toggleTheme, themeColors } = useTheme();

    return (
        <View style={[styles.container, { backgroundColor: themeColors.background, paddingTop: insets.top }]}>
            <View style={{ width: '100%', alignItems: 'center' }}>
                <Text style={{ fontSize: 24, fontWeight: '700', color: themeColors.text, marginBottom: 10 }}>Settings</Text>
            </View>

            <View style={{ padding: 20 }}>
                <GlassView
                    style={styles.card}
                    tintColor={isDark ? '#000000' : '#FFFFFF'}
                    glassEffectStyle="regular"
                    key={isDark ? 'dark' : 'light'}
                >
                    <Text style={[styles.settingText, { color: themeColors.text }]}>Dark Mode</Text>
                    <Switch
                        value={isDark}
                        onValueChange={toggleTheme}
                        trackColor={{ true: '#34C759', false: '#E5E5EA' }}
                    />
                </GlassView>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    card: {
        padding: 24,
        borderRadius: 32,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        overflow: 'hidden',
    },
    settingText: {
        fontSize: 18,
        fontWeight: '600',
    }
});
