import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';

export default function PredictiveNarrativeCard({
    insets,
    isDark,
    narrative,
    sceneConfig,
}) {
    if (!narrative) {
        return null;
    }

    return (
        <View
            pointerEvents="none"
            style={[
                styles.shell,
                { bottom: insets.bottom + sceneConfig.cardBottomOffset },
            ]}
        >
            <GlassView
                glassEffectStyle="regular"
                tintColor={isDark ? '#05070A' : '#FFFFFF'}
                style={styles.card}
            >
                <View style={styles.headerRow}>
                    <View style={[
                        styles.iconShell,
                        { backgroundColor: isDark ? 'rgba(10,132,255,0.14)' : 'rgba(10,132,255,0.1)' },
                    ]}>
                        <SymbolView name="arrow.triangle.turn.up.right.diamond.fill" size={15} tintColor="#0A84FF" />
                    </View>
                    <Text style={[styles.title, { color: isDark ? '#FFFFFF' : '#111111' }]}>{narrative.title}</Text>
                </View>
                <Text style={[styles.subtitle, { color: isDark ? 'rgba(255,255,255,0.72)' : 'rgba(17,17,17,0.68)' }]}>
                    {narrative.subtitle}
                </Text>
                <View style={styles.metaRow}>
                    <Text style={[styles.metaText, { color: isDark ? 'rgba(255,255,255,0.9)' : 'rgba(17,17,17,0.82)' }]}>
                        {narrative.distanceLabel}
                    </Text>
                    <Text style={[styles.metaDivider, { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(17,17,17,0.32)' }]}>•</Text>
                    <Text style={[styles.metaText, { color: isDark ? 'rgba(255,255,255,0.9)' : 'rgba(17,17,17,0.82)' }]}>
                        {narrative.durationLabel}
                    </Text>
                    <Text style={[styles.metaDivider, { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(17,17,17,0.32)' }]}>•</Text>
                    <Text style={[styles.metaText, { color: isDark ? 'rgba(255,255,255,0.9)' : 'rgba(17,17,17,0.82)' }]}>
                        {narrative.savingsLabel}
                    </Text>
                </View>
            </GlassView>
        </View>
    );
}

const styles = StyleSheet.create({
    shell: {
        position: 'absolute',
        left: 16,
        right: 16,
    },
    card: {
        borderRadius: 28,
        paddingHorizontal: 18,
        paddingVertical: 16,
        overflow: 'hidden',
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    iconShell: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        flex: 1,
        fontSize: 18,
        fontWeight: '800',
        letterSpacing: -0.3,
    },
    subtitle: {
        marginTop: 8,
        fontSize: 13,
        lineHeight: 18,
        fontWeight: '600',
    },
    metaRow: {
        marginTop: 12,
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
    },
    metaText: {
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 0.2,
        textTransform: 'uppercase',
    },
    metaDivider: {
        marginHorizontal: 6,
        fontSize: 12,
        fontWeight: '700',
    },
});
