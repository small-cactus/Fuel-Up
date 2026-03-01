import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, TextInput } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ThemeContext';
import { getApiStats, resetApiStats } from '../../src/lib/devCounter';
import { scheduleTestNotification, startLiveActivity, updateLiveActivity, endLiveActivity } from '../../src/lib/notifications';

export default function DevStatsScreen() {
    const { isDark } = useTheme();
    const [stats, setStats] = useState({ gasbuddy: 0, google: 0, supabase: 0, barchart: 0, tomtom: 0 });
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

    const textColor = isDark ? '#FFF' : '#000';
    const bgColor = isDark ? '#000' : '#FFF';
    const cardColor = isDark ? '#1A1A1A' : '#F5F5F5';

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
            </View>

            <TouchableOpacity style={styles.resetButton} onPress={handleReset}>
                <Text style={styles.resetButtonText}>Reset Counters</Text>
            </TouchableOpacity>

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
