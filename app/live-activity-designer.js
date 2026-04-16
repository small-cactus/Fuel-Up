/**
 * Live Activity Designer — in-app, pixel-accurate preview + prop
 * editor for the Predictive Fueling Live Activity.
 *
 * Goal: let design iterations happen inside the app. Tweak a prop
 * with a text input, watch all three layouts (lock screen banner,
 * Dynamic Island expanded, Dynamic Island compact) re-render live
 * via real SwiftUI through `<Host>`. When you want to sanity-check
 * against the system's final rendering, tap "Start Live Activity" —
 * it uses the dedup guarantee in `notifications.js` so there's never
 * more than one activity running at a time.
 *
 * This screen uses plain React Native primitives for its controls
 * (`TextInput`, `Pressable`, `ScrollView`) because `@expo/ui`'s
 * SwiftUI `TextField` trips an `_isAncestorOfFirstResponder` assert
 * under RN Fabric and crashes the dev client — documented in
 * `src/components/dev/NativeDevForm.js`.
 *
 * Navigation:
 *   dev tab → Live Activity section → "Open Design Previewer"
 *   (registered in app/_layout.js)
 */

import React, { useCallback, useState } from 'react';
import {
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../src/ThemeContext';
import {
    BannerPreview,
    DynamicIslandCompactPreview,
    DynamicIslandExpandedPreview,
} from '../src/lib/PriceDropActivityLivePreview';
import {
    endAllLiveActivities,
    startPredictiveLiveActivity,
    updateTrackedLiveActivity,
} from '../src/lib/notifications';

const PHASE_OPTIONS = [
    { key: 'approaching', label: 'Approaching' },
    { key: 'arriving', label: 'Arriving' },
    { key: 'arrived', label: 'Arrived' },
    { key: 'passed', label: 'Passed' },
];

const DEFAULT_PROPS = {
    stationName: 'Wawa',
    subtitle: 'Route 73',
    price: '2.99',
    savingsPerGallon: '0.30',
    totalSavings: '4.20',
    distanceMiles: '0.4',
    etaMinutes: '1',
    progress: 0.4,
    status: 'On your route',
    phase: 'approaching',
};

/**
 * A labeled `<TextInput>` row. Takes the full designer props object +
 * a setter, the field key, and a label. Keeps the state-update logic
 * centralized so every row updates the same single source of truth.
 */
function TextRow({ label, value, onChangeText, keyboardType = 'default', placeholder, isDark }) {
    return (
        <View style={styles.controlRow}>
            <Text style={[styles.controlLabel, isDark && styles.controlLabelDark]}>
                {label}
            </Text>
            <TextInput
                style={[styles.controlInput, isDark && styles.controlInputDark]}
                value={value}
                onChangeText={onChangeText}
                keyboardType={keyboardType}
                placeholder={placeholder}
                placeholderTextColor={isDark ? '#8E8E93' : '#C7C7CC'}
                autoCorrect={false}
                autoCapitalize="none"
            />
        </View>
    );
}

/**
 * A segmented control for the `phase` enum. Four buttons, the
 * current selection filled. Plain Pressable — no SwiftUI.
 */
function PhaseSegments({ value, onChange, isDark }) {
    return (
        <View style={styles.segmentedRow}>
            {PHASE_OPTIONS.map(option => {
                const isSelected = value === option.key;
                return (
                    <Pressable
                        key={option.key}
                        onPress={() => onChange(option.key)}
                        style={[
                            styles.segment,
                            isSelected && styles.segmentSelected,
                            isDark && styles.segmentDark,
                            isSelected && isDark && styles.segmentSelectedDark,
                        ]}
                    >
                        <Text
                            style={[
                                styles.segmentLabel,
                                isSelected && styles.segmentLabelSelected,
                                isDark && styles.segmentLabelDark,
                            ]}
                        >
                            {option.label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

/**
 * A labeled row with a decimal `TextInput` and − / + 0.1 quick-adjust
 * buttons for the `progress` float.
 */
function ProgressRow({ value, onChange, isDark }) {
    const displayValue = typeof value === 'number'
        ? value.toFixed(2)
        : String(value || '0');

    const adjust = useCallback((delta) => {
        const parsed = Number(displayValue) || 0;
        const next = Math.max(0, Math.min(1, parsed + delta));
        onChange(Number(next.toFixed(2)));
    }, [displayValue, onChange]);

    return (
        <View style={styles.controlRow}>
            <Text style={[styles.controlLabel, isDark && styles.controlLabelDark]}>
                Progress (0–1)
            </Text>
            <View style={styles.progressInputRow}>
                <TextInput
                    style={[styles.controlInput, styles.progressInputField, isDark && styles.controlInputDark]}
                    value={displayValue}
                    onChangeText={(next) => {
                        const parsed = Number(next);
                        if (Number.isFinite(parsed)) {
                            onChange(Math.max(0, Math.min(1, parsed)));
                        } else if (next === '' || next === '.') {
                            onChange(0);
                        }
                    }}
                    keyboardType="decimal-pad"
                />
                <Pressable onPress={() => adjust(-0.1)} style={[styles.miniButton, isDark && styles.miniButtonDark]}>
                    <Text style={[styles.miniButtonLabel, isDark && styles.miniButtonLabelDark]}>− 0.1</Text>
                </Pressable>
                <Pressable onPress={() => adjust(0.1)} style={[styles.miniButton, isDark && styles.miniButtonDark]}>
                    <Text style={[styles.miniButtonLabel, isDark && styles.miniButtonLabelDark]}>+ 0.1</Text>
                </Pressable>
            </View>
        </View>
    );
}

/**
 * A big filled action button used in the action row at the bottom.
 */
function ActionButton({ label, onPress, tone = 'primary' }) {
    const backgroundColor = tone === 'destructive'
        ? '#FF453A'
        : tone === 'secondary'
            ? '#3A3A3C'
            : '#0A84FF';

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.actionButton,
                { backgroundColor },
                pressed && styles.actionButtonPressed,
            ]}
        >
            <Text style={styles.actionButtonLabel}>{label}</Text>
        </Pressable>
    );
}

export default function LiveActivityDesignerScreen() {
    const { isDark } = useTheme();
    const [props, setProps] = useState(DEFAULT_PROPS);
    const [statusMessage, setStatusMessage] = useState('');

    const updateField = useCallback((key) => (nextValue) => {
        setProps(prev => ({ ...prev, [key]: nextValue }));
    }, []);

    const handleStart = useCallback(async () => {
        setStatusMessage('Starting…');
        try {
            const instance = await startPredictiveLiveActivity(props);
            setStatusMessage(instance ? 'Live Activity started.' : 'Could not start (iOS only).');
        } catch (error) {
            setStatusMessage('Start failed: ' + (error?.message || String(error)));
        }
    }, [props]);

    const handleUpdate = useCallback(() => {
        const updated = updateTrackedLiveActivity(props);
        setStatusMessage(updated ? 'Live Activity updated.' : 'No active Live Activity to update.');
    }, [props]);

    const handleStopAll = useCallback(async () => {
        setStatusMessage('Stopping…');
        try {
            const result = await endAllLiveActivities();
            setStatusMessage('Stopped ' + (result?.ended || 0) + ' activity(ies).');
        } catch (error) {
            setStatusMessage('Stop failed: ' + (error?.message || String(error)));
        }
    }, []);

    return (
        <SafeAreaView
            edges={['bottom']}
            style={[styles.screen, isDark && styles.screenDark]}
        >
            <ScrollView
                contentContainerStyle={styles.scrollContent}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
            >
                {/* ────────── Previews ────────── */}
                <View style={styles.previewStage}>
                    <Text style={styles.previewHeader}>Lock Screen Banner</Text>
                    <BannerPreview props={props} />

                    <Text style={styles.previewHeader}>Dynamic Island — Expanded</Text>
                    <DynamicIslandExpandedPreview props={props} />

                    <Text style={styles.previewHeader}>Dynamic Island — Compact</Text>
                    <DynamicIslandCompactPreview props={props} />
                </View>

                {/* ────────── Controls ────────── */}
                <View style={[styles.controlsSection, isDark && styles.controlsSectionDark]}>
                    <Text style={[styles.sectionHeader, isDark && styles.sectionHeaderDark]}>
                        Props
                    </Text>

                    <TextRow
                        label="Station name"
                        value={props.stationName}
                        onChangeText={updateField('stationName')}
                        isDark={isDark}
                    />
                    <TextRow
                        label="Subtitle"
                        value={props.subtitle}
                        onChangeText={updateField('subtitle')}
                        isDark={isDark}
                    />
                    <TextRow
                        label="Price"
                        value={props.price}
                        onChangeText={updateField('price')}
                        keyboardType="decimal-pad"
                        isDark={isDark}
                    />
                    <TextRow
                        label="Savings / gal"
                        value={props.savingsPerGallon}
                        onChangeText={updateField('savingsPerGallon')}
                        keyboardType="decimal-pad"
                        isDark={isDark}
                    />
                    <TextRow
                        label="Total savings"
                        value={props.totalSavings}
                        onChangeText={updateField('totalSavings')}
                        keyboardType="decimal-pad"
                        isDark={isDark}
                    />
                    <TextRow
                        label="Distance (mi)"
                        value={props.distanceMiles}
                        onChangeText={updateField('distanceMiles')}
                        keyboardType="decimal-pad"
                        isDark={isDark}
                    />
                    <TextRow
                        label="ETA (min)"
                        value={props.etaMinutes}
                        onChangeText={updateField('etaMinutes')}
                        isDark={isDark}
                    />
                    <TextRow
                        label="Status"
                        value={props.status}
                        onChangeText={updateField('status')}
                        isDark={isDark}
                    />

                    <ProgressRow
                        value={props.progress}
                        onChange={updateField('progress')}
                        isDark={isDark}
                    />

                    <View style={styles.controlRow}>
                        <Text style={[styles.controlLabel, isDark && styles.controlLabelDark]}>
                            Phase
                        </Text>
                        <PhaseSegments
                            value={props.phase}
                            onChange={updateField('phase')}
                            isDark={isDark}
                        />
                    </View>
                </View>

                {/* ────────── Actions ────────── */}
                <View style={styles.actionsSection}>
                    <ActionButton label="Start Live Activity" onPress={handleStart} />
                    <ActionButton label="Update Running Activity" tone="secondary" onPress={handleUpdate} />
                    <ActionButton label="Stop All" tone="destructive" onPress={handleStopAll} />
                    {statusMessage ? (
                        <Text style={[styles.statusText, isDark && styles.statusTextDark]}>
                            {statusMessage}
                        </Text>
                    ) : null}
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: '#F2F2F7',
    },
    screenDark: {
        backgroundColor: '#000000',
    },
    scrollContent: {
        paddingBottom: 48,
    },
    previewStage: {
        backgroundColor: '#1C1C1E',
        paddingTop: 24,
        paddingBottom: 32,
        paddingHorizontal: 16,
        gap: 14,
    },
    previewHeader: {
        color: '#8E8E93',
        fontSize: 12,
        fontWeight: '600',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        marginTop: 12,
    },
    controlsSection: {
        backgroundColor: '#FFFFFF',
        marginTop: 16,
        marginHorizontal: 16,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    controlsSectionDark: {
        backgroundColor: '#1C1C1E',
    },
    sectionHeader: {
        fontSize: 12,
        fontWeight: '600',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        color: '#8E8E93',
        marginVertical: 8,
    },
    sectionHeaderDark: {
        color: '#8E8E93',
    },
    controlRow: {
        paddingVertical: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#E5E5EA',
    },
    controlLabel: {
        fontSize: 13,
        fontWeight: '500',
        color: '#3C3C43',
        marginBottom: 6,
    },
    controlLabelDark: {
        color: '#EBEBF5',
    },
    controlInput: {
        fontSize: 16,
        color: '#000000',
        backgroundColor: '#F2F2F7',
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    controlInputDark: {
        color: '#FFFFFF',
        backgroundColor: '#2C2C2E',
    },
    progressInputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    progressInputField: {
        flex: 1,
    },
    miniButton: {
        paddingVertical: 10,
        paddingHorizontal: 12,
        backgroundColor: '#E5E5EA',
        borderRadius: 10,
    },
    miniButtonDark: {
        backgroundColor: '#2C2C2E',
    },
    miniButtonLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#0A84FF',
    },
    miniButtonLabelDark: {
        color: '#0A84FF',
    },
    segmentedRow: {
        flexDirection: 'row',
        gap: 8,
        flexWrap: 'wrap',
    },
    segment: {
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 10,
        backgroundColor: '#E5E5EA',
    },
    segmentDark: {
        backgroundColor: '#2C2C2E',
    },
    segmentSelected: {
        backgroundColor: '#0A84FF',
    },
    segmentSelectedDark: {
        backgroundColor: '#0A84FF',
    },
    segmentLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: '#3C3C43',
    },
    segmentLabelDark: {
        color: '#EBEBF5',
    },
    segmentLabelSelected: {
        color: '#FFFFFF',
    },
    actionsSection: {
        marginTop: 16,
        marginHorizontal: 16,
        gap: 10,
    },
    actionButton: {
        paddingVertical: 14,
        borderRadius: 14,
        alignItems: 'center',
    },
    actionButtonPressed: {
        opacity: 0.8,
    },
    actionButtonLabel: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FFFFFF',
    },
    statusText: {
        fontSize: 13,
        color: '#3C3C43',
        textAlign: 'center',
        marginTop: 4,
    },
    statusTextDark: {
        color: '#EBEBF5',
    },
});
