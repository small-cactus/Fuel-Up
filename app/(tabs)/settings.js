import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppState } from '../../src/AppStateContext';
import { usePreferences } from '../../src/PreferencesContext';
import { clearFuelPriceCache } from '../../src/services/fuel';
import { useTheme } from '../../src/ThemeContext';

const OCTANE_OPTIONS = [
    { key: 'regular', label: 'Regular', octane: '87' },
    { key: 'midgrade', label: 'Midgrade', octane: '89' },
    { key: 'premium', label: 'Premium', octane: '93' },
];

const RADIUS_OPTIONS = [5, 10, 15, 20, 25];
const RATING_OPTIONS = [0, 3, 3.5, 4, 4.5];

function SettingsSection({ title, children }) {
    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {children}
        </View>
    );
}

export default function SettingsScreen() {
    const insets = useSafeAreaInsets();
    const { isDark, themeMode, setThemeMode, themeColors } = useTheme();
    const { requestFuelReset, setFuelDebugState } = useAppState();
    const { preferences, updatePreference, resetOnboarding } = usePreferences();
    const [resetNotice, setResetNotice] = useState(null);

    const handleFuelReset = async () => {
        try {
            await clearFuelPriceCache();
            setFuelDebugState(null);
            requestFuelReset();
            setResetNotice('Fuel cache has been cleared.');
        } catch {
            setResetNotice('Unable to reset cache.');
        }
    };

    const handleResetOnboarding = () => {
        Alert.alert(
            'Reset Onboarding',
            'This will show the setup flow again on next launch.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Reset',
                    style: 'destructive',
                    onPress: () => resetOnboarding(),
                },
            ]
        );
    };

    return (
        <ScrollView
            contentContainerStyle={[styles.container, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 40 }]}
            style={{ backgroundColor: themeColors.background }}
        >
            <Text style={[styles.headerTitle, { color: themeColors.text }]}>Settings</Text>

            {/* ── Preferences ── */}
            <SettingsSection title="PREFERENCES">
                {/* Search Radius */}
                <GlassView
                    style={styles.card}
                    tintColor={isDark ? '#000000' : '#FFFFFF'}
                    glassEffectStyle="regular"
                    key={isDark ? 'radius-dark' : 'radius-light'}
                >
                    <View style={styles.cardHeader}>
                        <SymbolView name="location.magnifyingglass" size={20} tintColor={themeColors.text} />
                        <Text style={[styles.cardTitle, { color: themeColors.text }]}>Search Radius</Text>
                        <Text style={[styles.cardValue, { color: '#007AFF' }]}>{preferences.searchRadiusMiles} mi</Text>
                    </View>
                    <View style={styles.chipRow}>
                        {RADIUS_OPTIONS.map(r => (
                            <Pressable key={r} onPress={() => updatePreference('searchRadiusMiles', r)}>
                                <View style={[
                                    styles.chip,
                                    r === preferences.searchRadiusMiles && styles.chipActive,
                                    { backgroundColor: r === preferences.searchRadiusMiles ? '#007AFF' : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)') },
                                ]}>
                                    <Text style={[
                                        styles.chipText,
                                        { color: r === preferences.searchRadiusMiles ? '#FFFFFF' : themeColors.text },
                                    ]}>{r}</Text>
                                </View>
                            </Pressable>
                        ))}
                    </View>
                </GlassView>

                {/* Octane Preference */}
                <GlassView
                    style={styles.card}
                    tintColor={isDark ? '#000000' : '#FFFFFF'}
                    glassEffectStyle="regular"
                    key={isDark ? 'octane-dark' : 'octane-light'}
                >
                    <View style={styles.cardHeader}>
                        <SymbolView name="gauge.with.dots.needle.33percent" size={20} tintColor={themeColors.text} />
                        <Text style={[styles.cardTitle, { color: themeColors.text }]}>Preferred Octane</Text>
                    </View>
                    <View style={styles.chipRow}>
                        {OCTANE_OPTIONS.map(opt => (
                            <Pressable key={opt.key} onPress={() => updatePreference('preferredOctane', opt.key)}>
                                <View style={[
                                    styles.chip,
                                    styles.chipWide,
                                    opt.key === preferences.preferredOctane && styles.chipActive,
                                    { backgroundColor: opt.key === preferences.preferredOctane ? '#007AFF' : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)') },
                                ]}>
                                    <Text style={[
                                        styles.chipText,
                                        { color: opt.key === preferences.preferredOctane ? '#FFFFFF' : themeColors.text },
                                    ]}>{opt.label} ({opt.octane})</Text>
                                </View>
                            </Pressable>
                        ))}
                    </View>
                </GlassView>

                {/* Price Source */}
                <GlassView
                    style={styles.card}
                    tintColor={isDark ? '#000000' : '#FFFFFF'}
                    glassEffectStyle="regular"
                    key={isDark ? 'provider-dark' : 'provider-light'}
                >
                    <View style={styles.cardHeader}>
                        <SymbolView name="antenna.radiowaves.left.and.right" size={20} tintColor={themeColors.text} />
                        <Text style={[styles.cardTitle, { color: themeColors.text }]}>Price Source</Text>
                    </View>
                    <View style={styles.chipRow}>
                        {[
                            { key: 'gasbuddy', label: 'GasBuddy' },
                            { key: 'all', label: 'Multi-Source' },
                        ].map(opt => (
                            <Pressable key={opt.key} onPress={() => updatePreference('preferredProvider', opt.key)} style={{ flex: 1 }}>
                                <View style={[
                                    styles.chip,
                                    { backgroundColor: opt.key === preferences.preferredProvider ? '#007AFF' : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)') },
                                    { alignItems: 'center' },
                                ]}>
                                    <Text style={[
                                        styles.chipText,
                                        { color: opt.key === preferences.preferredProvider ? '#FFFFFF' : themeColors.text },
                                    ]}>{opt.label}</Text>
                                </View>
                            </Pressable>
                        ))}
                    </View>
                </GlassView>

                {/* Minimum Rating */}
                <GlassView
                    style={styles.card}
                    tintColor={isDark ? '#000000' : '#FFFFFF'}
                    glassEffectStyle="regular"
                    key={isDark ? 'rating-dark' : 'rating-light'}
                >
                    <View style={styles.cardHeader}>
                        <SymbolView name="star.fill" size={20} tintColor="#FFB800" />
                        <Text style={[styles.cardTitle, { color: themeColors.text }]}>Minimum Rating</Text>
                        <Text style={[styles.cardValue, { color: '#FFB800' }]}>
                            {preferences.minimumRating === 0 ? 'All' : `${preferences.minimumRating}+`}
                        </Text>
                    </View>
                    <View style={styles.chipRow}>
                        {RATING_OPTIONS.map(r => (
                            <Pressable key={r} onPress={() => updatePreference('minimumRating', r)}>
                                <View style={[
                                    styles.chip,
                                    r === preferences.minimumRating && styles.chipActive,
                                    { backgroundColor: r === preferences.minimumRating ? '#FFB800' : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)') },
                                ]}>
                                    <Text style={[
                                        styles.chipText,
                                        { color: r === preferences.minimumRating ? '#FFFFFF' : themeColors.text },
                                    ]}>{r === 0 ? 'All' : r}</Text>
                                </View>
                            </Pressable>
                        ))}
                    </View>
                </GlassView>
            </SettingsSection>

            {/* ── Appearance ── */}
            <SettingsSection title="APPEARANCE">
                <GlassView
                    style={styles.card}
                    tintColor={isDark ? '#000000' : '#FFFFFF'}
                    glassEffectStyle="regular"
                    key={isDark ? 'theme-dark' : 'theme-light'}
                >
                    <View style={styles.cardHeader}>
                        <SymbolView name={isDark ? 'moon.fill' : 'sun.max.fill'} size={20} tintColor={themeColors.text} />
                        <Text style={[styles.cardTitle, { color: themeColors.text }]}>Appearance</Text>
                    </View>
                    <View style={styles.chipRow}>
                        {[
                            { key: 'light', label: 'Light', icon: 'sun.max.fill' },
                            { key: 'system', label: 'System', icon: 'gear' },
                            { key: 'dark', label: 'Dark', icon: 'moon.fill' },
                        ].map(opt => (
                            <Pressable key={opt.key} onPress={() => setThemeMode(opt.key)} style={{ flex: 1 }}>
                                <View style={[
                                    styles.chip,
                                    { backgroundColor: opt.key === themeMode ? '#007AFF' : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)') },
                                    { alignItems: 'center' },
                                ]}>
                                    <SymbolView name={opt.icon} size={16} tintColor={opt.key === themeMode ? '#FFFFFF' : themeColors.text} style={{ marginBottom: 4 }} />
                                    <Text style={[
                                        styles.chipText,
                                        { color: opt.key === themeMode ? '#FFFFFF' : themeColors.text },
                                    ]}>{opt.label}</Text>
                                </View>
                            </Pressable>
                        ))}
                    </View>
                </GlassView>
            </SettingsSection>

            {/* ── Data ── */}
            <SettingsSection title="DATA">
                <Pressable onPress={handleFuelReset}>
                    <GlassView
                        style={[styles.card, styles.cardRow]}
                        tintColor={isDark ? '#000000' : '#FFFFFF'}
                        glassEffectStyle="regular"
                        key={isDark ? 'reset-dark' : 'reset-light'}
                    >
                        <View style={styles.cardHeader}>
                            <SymbolView name="arrow.counterclockwise" size={20} tintColor="#E35D4F" />
                            <Text style={[styles.cardTitle, { color: '#E35D4F' }]}>Reset Fuel Cache</Text>
                        </View>
                        <SymbolView name="chevron.right" size={14} tintColor={themeColors.text} style={{ opacity: 0.3 }} />
                    </GlassView>
                </Pressable>

                <Pressable onPress={handleResetOnboarding}>
                    <GlassView
                        style={[styles.card, styles.cardRow]}
                        tintColor={isDark ? '#000000' : '#FFFFFF'}
                        glassEffectStyle="regular"
                        key={isDark ? 'onboard-dark' : 'onboard-light'}
                    >
                        <View style={styles.cardHeader}>
                            <SymbolView name="arrow.uturn.backward" size={20} tintColor={themeColors.text} />
                            <Text style={[styles.cardTitle, { color: themeColors.text }]}>Reset Onboarding</Text>
                        </View>
                        <SymbolView name="chevron.right" size={14} tintColor={themeColors.text} style={{ opacity: 0.3 }} />
                    </GlassView>
                </Pressable>
            </SettingsSection>

            {resetNotice ? (
                <Text style={[styles.noticeText, { color: themeColors.text }]}>{resetNotice}</Text>
            ) : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 20,
    },
    headerTitle: {
        fontSize: 34,
        fontWeight: '800',
        letterSpacing: -0.5,
        marginBottom: 24,
        paddingHorizontal: 4,
    },
    section: {
        marginBottom: 28,
        gap: 12,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '600',
        letterSpacing: 0.8,
        color: '#8E8E93',
        paddingHorizontal: 4,
        marginBottom: 4,
    },
    card: {
        padding: 20,
        borderRadius: 24,
        overflow: 'hidden',
        gap: 14,
    },
    cardRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    cardTitle: {
        fontSize: 17,
        fontWeight: '600',
    },
    cardValue: {
        fontSize: 17,
        fontWeight: '700',
        marginLeft: 'auto',
    },
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    chip: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    chipWide: {
        paddingHorizontal: 14,
    },
    chipActive: {},
    chipText: {
        fontSize: 14,
        fontWeight: '600',
    },
    noticeText: {
        fontSize: 13,
        opacity: 0.6,
        textAlign: 'center',
        marginTop: 8,
    },
});
