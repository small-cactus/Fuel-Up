import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, TextInput } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { useTheme } from '../../src/ThemeContext';
import { useAppState } from '../../src/AppStateContext';
import { usePreferences } from '../../src/PreferencesContext';
import { getApiStats, resetApiStats } from '../../src/lib/devCounter';
import { scheduleTestNotification, startLiveActivity, updateLiveActivity, endLiveActivity } from '../../src/lib/notifications';
import { isFuelCacheResetError, refreshFuelPriceSnapshot } from '../../src/services/fuel';

export default function DevStatsScreen() {
    const { isDark } = useTheme();
    const { manualLocationOverride, setFuelDebugState } = useAppState();
    const { preferences, updatePreference } = usePreferences();
    const [stats, setStats] = useState({ gasbuddy: 0, google: 0, supabase: 0, barchart: 0, tomtom: 0 });
    const [isRefreshingFuel, setIsRefreshingFuel] = useState(false);
    const [testTitle, setTestTitle] = useState('Test Push');
    const [testBody, setTestBody] = useState('This is a local push notification test.');
    const [liveActivityInstance, setLiveActivityInstance] = useState(null);

    useFocusEffect(
        useCallback(() => {
            getApiStats().then(setStats);
        }, [])
    );

    const handleReset = async () => {
        const fresh = await resetApiStats();
        setStats(fresh);
    };

    const resolveActiveCoordinates = async () => {
        if (
            manualLocationOverride &&
            Number.isFinite(Number(manualLocationOverride.latitude)) &&
            Number.isFinite(Number(manualLocationOverride.longitude))
        ) {
            return {
                latitude: Number(manualLocationOverride.latitude),
                longitude: Number(manualLocationOverride.longitude),
                source: 'manual',
            };
        }

        let permission = await Location.getForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
            permission = await Location.requestForegroundPermissionsAsync();
        }

        if (permission.status !== 'granted') {
            throw new Error('Location permission denied.');
        }

        const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
        });

        return {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            source: 'device',
        };
    };

    const handleRunHourlyRefreshPath = async () => {
        if (isRefreshingFuel) {
            return;
        }

        setIsRefreshingFuel(true);
        try {
            const coords = await resolveActiveCoordinates();
            const query = {
                latitude: coords.latitude,
                longitude: coords.longitude,
                radiusMiles: preferences.searchRadiusMiles || 10,
                fuelType: preferences.preferredOctane || 'regular',
                allowLiveGasBuddy: true,
                preferredProvider: 'gasbuddy',
                forceLiveGasBuddy: true,
            };

            const result = await refreshFuelPriceSnapshot(query);
            if (result?.debugState) {
                setFuelDebugState(result.debugState);
            }

            const latestStats = await getApiStats();
            setStats(latestStats);

            const quote = result?.snapshot?.quote || null;
            const gasBuddyDebug = (result?.debugState?.providers || []).find(
                provider => provider?.providerId === 'gasbuddy'
            );
            const persistedCount = gasBuddyDebug?.summary?.persistedLiveRowCount;
            const persistError = gasBuddyDebug?.summary?.persistError;
            const persistLine = typeof persistedCount === 'number'
                ? `\nDB persisted rows: ${persistedCount}`
                : '';
            const persistErrorLine = persistError ? `\nDB write error: ${persistError}` : '';
            Alert.alert(
                'Hourly Refresh Complete',
                quote
                    ? `${quote.stationName}: $${Number(quote.price).toFixed(2)} (${coords.source}, gasbuddy live)${persistLine}${persistErrorLine}`
                    : `No station quote returned (${coords.source}).${persistLine}${persistErrorLine}`
            );
        } catch (error) {
            if (isFuelCacheResetError(error)) {
                return;
            }

            if (error?.debugState) {
                setFuelDebugState(error.debugState);
            }
            Alert.alert(
                'Hourly Refresh Failed',
                error?.userMessage || error?.message || 'Unable to run hourly refresh path.'
            );
        } finally {
            setIsRefreshingFuel(false);
        }
    };

    const textColor = isDark ? '#FFF' : '#000';
    const bgColor = isDark ? '#000' : '#FFF';
    const cardColor = isDark ? '#1A1A1A' : '#F5F5F5';
    const debugEnabled = Boolean(preferences.debugClusterAnimations);

    const handleLocalPush = (delay) => {
        scheduleTestNotification(testTitle, testBody, delay);
        if (delay > 0) {
            Alert.alert('Scheduled', `Notification will appear in ${delay} seconds. Background the app now!`);
        }
    };

    return (
        <ScrollView style={[styles.container, { backgroundColor: bgColor }]} contentContainerStyle={{ paddingBottom: 120 }}>
            <Text style={[styles.title, { color: textColor }]}>API Hit Counters</Text>

            <View style={[styles.card, { backgroundColor: cardColor }]}>
                <View style={styles.row}>
                    <Text style={[styles.label, { color: textColor }]}>GasBuddy DB (Supabase):</Text>
                    <Text style={[styles.value, { color: textColor }]}>{stats.supabase || 0}</Text>
                </View>
                <View style={styles.row}>
                    <Text style={[styles.label, { color: textColor }]}>GasBuddy Live Request:</Text>
                    <Text style={[styles.value, { color: textColor }]}>{stats.gasbuddy || 0}</Text>
                </View>
                <View style={styles.row}>
                    <Text style={[styles.label, { color: textColor }]}>Google Places Live Request:</Text>
                    <Text style={[styles.value, { color: textColor }]}>{stats.google || 0}</Text>
                </View>
                <View style={styles.row}>
                    <Text style={[styles.label, { color: textColor }]}>TomTom Live Request:</Text>
                    <Text style={[styles.value, { color: textColor }]}>{stats.tomtom || 0}</Text>
                </View>
                <View style={styles.row}>
                    <Text style={[styles.label, { color: textColor }]}>Barchart Live Request:</Text>
                    <Text style={[styles.value, { color: textColor }]}>{stats.barchart || 0}</Text>
                </View>

                <TouchableOpacity
                    style={[
                        styles.actionButton,
                        { backgroundColor: '#007AFF', marginTop: 16, opacity: isRefreshingFuel ? 0.7 : 1 },
                    ]}
                    onPress={handleRunHourlyRefreshPath}
                    disabled={isRefreshingFuel}
                >
                    <Text style={styles.actionButtonText}>
                        {isRefreshingFuel ? 'Running Hourly Fuel Refresh...' : 'Run Hourly Fuel Refresh Path'}
                    </Text>
                </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.resetButton} onPress={handleReset}>
                <Text style={styles.resetButtonText}>Reset Counters</Text>
            </TouchableOpacity>

            <Text style={[styles.title, { color: textColor, marginTop: 40 }]}>Cluster Animation Debug</Text>
            <View style={[styles.card, { backgroundColor: cardColor }]}>
                <Text style={[styles.label, { color: textColor, marginBottom: 8 }]}>
                    Toggle the home-map cluster handoff diagnostics.
                </Text>
                <Text style={[styles.debugDescription, { color: textColor }]}>
                    When enabled, the home screen replaces the bottom fuel card with cluster handoff diagnostics and can record one summarized debug log for the cluster nearest the map center.
                </Text>
                <TouchableOpacity
                    style={[
                        styles.actionButton,
                        { backgroundColor: debugEnabled ? '#34C759' : '#3A3A3C', marginTop: 16 }
                    ]}
                    onPress={() => updatePreference('debugClusterAnimations', !debugEnabled)}
                >
                    <Text style={styles.actionButtonText}>
                        {debugEnabled ? 'Disable Cluster Debug Overlay' : 'Enable Cluster Debug Overlay'}
                    </Text>
                </TouchableOpacity>
            </View>

            <Text style={[styles.title, { color: textColor, marginTop: 40 }]}>Push Notifications</Text>
            <View style={[styles.card, { backgroundColor: cardColor }]}>
                <Text style={[styles.label, { color: textColor, marginBottom: 8 }]}>Test Local Push:</Text>
                <TextInput
                    style={[styles.input, { backgroundColor: bgColor, color: textColor, marginBottom: 8 }]}
                    value={testTitle}
                    onChangeText={setTestTitle}
                    placeholder="Notification Title"
                />
                <TextInput
                    style={[styles.input, { backgroundColor: bgColor, color: textColor, marginBottom: 16 }]}
                    value={testBody}
                    onChangeText={setTestBody}
                    placeholder="Notification Body"
                />

                <TouchableOpacity style={[styles.actionButton, { backgroundColor: '#FF9500' }]} onPress={() => handleLocalPush(0)}>
                    <Text style={styles.actionButtonText}>Trigger Now (Foreground)</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.actionButton, { backgroundColor: '#AF52DE', marginTop: 8 }]} onPress={() => handleLocalPush(5)}>
                    <Text style={styles.actionButtonText}>Trigger in 5s (Test Background)</Text>
                </TouchableOpacity>
            </View>

            <Text style={[styles.title, { color: textColor, marginTop: 40 }]}>Live Activities (iOS)</Text>
            <View style={[styles.card, { backgroundColor: cardColor }]}>
                <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: '#34C759' }]}
                    onPress={() => {
                        const instance = startLiveActivity('Wawa - Route 73', '$2.99');
                        if (instance) {
                            setLiveActivityInstance(instance);
                            Alert.alert('Started', 'Live Activity Started! Swipe to Home to see the "!"');
                        } else {
                            Alert.alert('Error', 'Could not start. Are you on iOS 16.2+ and is the app prebuilt?');
                        }
                    }}
                >
                    <Text style={styles.actionButtonText}>1. Start "Price Drop" Activity</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: '#FF9500', marginTop: 8 }]}
                    onPress={() => {
                        if (!liveActivityInstance) return Alert.alert('Error', 'Start an activity first.');
                        updateLiveActivity(liveActivityInstance, '$2.85');
                        Alert.alert('Updated', 'Price dropped to $2.85!');
                    }}
                >
                    <Text style={styles.actionButtonText}>2. Update Price (Drop to $2.85)</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: '#FF3B30', marginTop: 8 }]}
                    onPress={() => {
                        if (!liveActivityInstance) return Alert.alert('Error', 'Start an activity first.');
                        endLiveActivity(liveActivityInstance);
                        setLiveActivityInstance(null);
                        Alert.alert('Ended', 'Live Activity Stopped');
                    }}
                >
                    <Text style={styles.actionButtonText}>3. End Activity</Text>
                </TouchableOpacity>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 24,
        paddingTop: 80,
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        marginBottom: 24,
    },
    card: {
        borderRadius: 12,
        padding: 16,
        marginBottom: 32,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#ccc',
    },
    label: {
        fontSize: 16,
        fontWeight: '500',
    },
    debugDescription: {
        fontSize: 13,
        lineHeight: 18,
        opacity: 0.8,
    },
    value: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    resetButton: {
        backgroundColor: '#FF3B30',
        paddingVertical: 16,
        borderRadius: 12,
        alignItems: 'center',
    },
    resetButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
    },
    inputContainer: {
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#ccc',
        overflow: 'hidden',
    },
    input: {
        padding: 12,
        fontSize: 14,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#ccc',
    },
    actionButton: {
        paddingVertical: 14,
        borderRadius: 10,
        alignItems: 'center',
    },
    actionButtonText: {
        color: 'white',
        fontSize: 15,
        fontWeight: '600',
    },
    divider: {
        height: 1,
        backgroundColor: '#ccc',
        marginVertical: 16,
        opacity: 0.5,
    },
});
