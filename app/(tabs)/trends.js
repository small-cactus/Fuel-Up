import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ThemeContext';

export default function TrendsScreen() {
    const insets = useSafeAreaInsets();
    const { isDark, themeColors } = useTheme();

    return (
        <View style={[styles.container, { backgroundColor: themeColors.background, paddingTop: insets.top }]}>
            <View style={{ width: '100%', alignItems: 'center' }}>
                <Text style={{ fontSize: 24, fontWeight: '700', color: themeColors.text, marginBottom: 10 }}>Trends</Text>
            </View>
            <View style={{ padding: 20 }}>
                <GlassView
                    style={styles.card}
                    tintColor={isDark ? '#000000' : '#FFFFFF'}
                    glassEffectStyle="regular"
                    key={isDark ? 'dark' : 'light'}
                >
                    <Text style={[styles.cardText, { color: themeColors.text }]}>Price trends visualization here</Text>
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
        padding: 30,
        borderRadius: 32,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    cardText: {
        fontSize: 16,
        fontWeight: '500',
    }
});
