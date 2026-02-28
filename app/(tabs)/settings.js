import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppState } from '../../src/AppStateContext';
import { clearFuelPriceCache } from '../../src/services/fuel';
import { useTheme } from '../../src/ThemeContext';

export default function SettingsScreen() {
    const insets = useSafeAreaInsets();
    const { isDark, toggleTheme, themeColors } = useTheme();
    const {
        clearManualLocationOverride,
        fuelDebugState,
        manualLocationOverride,
        requestFuelReset,
        setFuelDebugState,
        setManualLocationOverride,
    } = useAppState();
    const [isResetting, setIsResetting] = useState(false);
    const [resetNotice, setResetNotice] = useState(null);
    const [manualLatitude, setManualLatitude] = useState(
        manualLocationOverride ? String(manualLocationOverride.latitude) : '40.7128'
    );
    const [manualLongitude, setManualLongitude] = useState(
        manualLocationOverride ? String(manualLocationOverride.longitude) : '-74.0060'
    );

    const handleFuelReset = async () => {
        if (isResetting) {
            return;
        }

        setIsResetting(true);
        setResetNotice(null);

        try {
            await clearFuelPriceCache();
            setFuelDebugState(null);
            requestFuelReset();
            setResetNotice('Stored fuel cache and screen state were reset.');
        } catch (error) {
            setResetNotice('Unable to reset fuel cache right now.');
        } finally {
            setIsResetting(false);
        }
    };

    const handleApplyManualLocation = () => {
        const parsedLatitude = Number(manualLatitude);
        const parsedLongitude = Number(manualLongitude);
        const isLatitudeValid = Number.isFinite(parsedLatitude) && parsedLatitude >= -90 && parsedLatitude <= 90;
        const isLongitudeValid = Number.isFinite(parsedLongitude) && parsedLongitude >= -180 && parsedLongitude <= 180;

        if (!isLatitudeValid || !isLongitudeValid) {
            setResetNotice('Manual location is invalid. Enter a latitude and longitude in range.');
            return;
        }

        setManualLocationOverride({
            latitude: parsedLatitude,
            longitude: parsedLongitude,
        });
        setResetNotice('Manual location saved. Open Home to fetch with the override.');
    };

    const handleUseDeviceLocation = () => {
        clearManualLocationOverride();
        setResetNotice('Manual location cleared. Home will use the device location again.');
    };

    const debugLocation = fuelDebugState?.input
        ? `${fuelDebugState.input.latitude}, ${fuelDebugState.input.longitude}`
        : manualLocationOverride
            ? `${manualLocationOverride.latitude}, ${manualLocationOverride.longitude}`
            : 'Device location';
    const debugSource = fuelDebugState?.input?.locationSource || manualLocationOverride?.source || 'device';
    const debugDump = JSON.stringify(
        {
            activeLocation: {
                coordinates: debugLocation,
                source: debugSource,
            },
            latestRequest: fuelDebugState,
        },
        null,
        2
    );

    return (
        <ScrollView
            contentContainerStyle={[styles.container, { backgroundColor: themeColors.background, paddingTop: insets.top }]}
        >
            <View style={{ width: '100%', alignItems: 'center' }}>
                <Text style={{ fontSize: 24, fontWeight: '700', color: themeColors.text, marginBottom: 10 }}>Settings</Text>
            </View>

            <View style={styles.cardStack}>
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

                <Pressable disabled={isResetting} onPress={handleFuelReset}>
                    <GlassView
                        style={[styles.card, styles.actionCard, isResetting ? styles.cardDisabled : null]}
                        tintColor={isDark ? '#000000' : '#FFFFFF'}
                        glassEffectStyle="regular"
                        key={isDark ? 'danger-dark' : 'danger-light'}
                    >
                        <View style={styles.actionCopy}>
                            <Text style={[styles.settingText, styles.dangerText]}>Reset Fuel Cache</Text>
                            <Text style={[styles.settingMeta, { color: themeColors.text }]}>
                                Clear cached prices and reset the Home screen state.
                            </Text>
                        </View>
                        {isResetting ? (
                            <ActivityIndicator size="small" color={themeColors.text} />
                        ) : (
                            <Text style={[styles.actionLabel, { color: themeColors.text }]}>Reset</Text>
                        )}
                    </GlassView>
                </Pressable>

                <GlassView
                    style={[styles.card, styles.debugCard]}
                    tintColor={isDark ? '#000000' : '#FFFFFF'}
                    glassEffectStyle="regular"
                    key={isDark ? 'location-dark' : 'location-light'}
                >
                    <View style={styles.fullWidth}>
                        <Text style={[styles.settingText, { color: themeColors.text }]}>Manual Location Override</Text>
                        <Text style={[styles.settingMeta, { color: themeColors.text }]}>
                            Used on Home instead of device GPS when set.
                        </Text>

                        <View style={styles.inputRow}>
                            <TextInput
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="numbers-and-punctuation"
                                onChangeText={setManualLatitude}
                                placeholder="Latitude"
                                placeholderTextColor={isDark ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.35)'}
                                style={[
                                    styles.input,
                                    {
                                        color: themeColors.text,
                                        borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
                                    },
                                ]}
                                value={manualLatitude}
                            />
                            <TextInput
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="numbers-and-punctuation"
                                onChangeText={setManualLongitude}
                                placeholder="Longitude"
                                placeholderTextColor={isDark ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.35)'}
                                style={[
                                    styles.input,
                                    {
                                        color: themeColors.text,
                                        borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
                                    },
                                ]}
                                value={manualLongitude}
                            />
                        </View>

                        <View style={styles.buttonRow}>
                            <Pressable onPress={handleApplyManualLocation} style={styles.inlineButton}>
                                <Text style={[styles.inlineButtonText, { color: themeColors.text }]}>Set Manual Location</Text>
                            </Pressable>
                            <Pressable onPress={handleUseDeviceLocation} style={styles.inlineButton}>
                                <Text style={[styles.inlineButtonText, { color: themeColors.text }]}>Use Device Location</Text>
                            </Pressable>
                        </View>
                    </View>
                </GlassView>

                <GlassView
                    style={[styles.card, styles.debugCard]}
                    tintColor={isDark ? '#000000' : '#FFFFFF'}
                    glassEffectStyle="regular"
                    key={isDark ? 'debug-dark' : 'debug-light'}
                >
                    <View style={styles.fullWidth}>
                        <Text style={[styles.settingText, { color: themeColors.text }]}>Fuel Debug</Text>
                        <Text style={[styles.settingMeta, { color: themeColors.text }]}>
                            Latest API inputs, outputs, and the coordinates sent to providers.
                        </Text>
                        <Text style={[styles.debugText, { color: themeColors.text }]}>{debugDump}</Text>
                    </View>
                </GlassView>

                {resetNotice ? <Text style={[styles.noticeText, { color: themeColors.text }]}>{resetNotice}</Text> : null}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        minHeight: '100%',
        paddingBottom: 40,
    },
    cardStack: {
        padding: 20,
        gap: 16,
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
    },
    actionCard: {
        minHeight: 108,
    },
    debugCard: {
        alignItems: 'flex-start',
    },
    cardDisabled: {
        opacity: 0.72,
    },
    actionCopy: {
        flex: 1,
        paddingRight: 16,
    },
    settingMeta: {
        fontSize: 12,
        lineHeight: 18,
        marginTop: 6,
        opacity: 0.75,
    },
    actionLabel: {
        fontSize: 16,
        fontWeight: '700',
    },
    dangerText: {
        color: '#E35D4F',
    },
    noticeText: {
        fontSize: 12,
        lineHeight: 18,
        paddingHorizontal: 8,
        opacity: 0.82,
    },
    fullWidth: {
        width: '100%',
    },
    inputRow: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 16,
    },
    input: {
        flex: 1,
        minHeight: 46,
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 14,
        fontSize: 15,
        fontWeight: '500',
    },
    buttonRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginTop: 14,
    },
    inlineButton: {
        minHeight: 40,
        paddingHorizontal: 14,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(52, 199, 89, 0.14)',
    },
    inlineButtonText: {
        fontSize: 13,
        fontWeight: '700',
    },
    debugText: {
        marginTop: 14,
        fontSize: 11,
        lineHeight: 16,
        fontFamily: 'Courier',
        opacity: 0.88,
    },
});
