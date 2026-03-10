import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';
import { GlassView } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppState } from '../../src/AppStateContext';
import { usePreferences } from '../../src/PreferencesContext';
import { clearFuelPriceCache } from '../../src/services/fuel';
import { clearTrendDataCache } from '../../src/services/fuel/trends';
import { useTheme } from '../../src/ThemeContext';
import TopCanopy from '../../src/components/TopCanopy';
import FuelUpHeaderLogo from '../../src/components/FuelUpHeaderLogo';
import {
    getPredictiveLocationPermissionStateAsync,
    openPredictiveLocationSettingsAsync,
    requestPredictiveLocationPermissionsAsync,
} from '../../src/lib/predictiveLocation';

const OCTANE_OPTIONS = [
    { key: 'regular', label: 'Regular' },
    { key: 'midgrade', label: 'Midgrade' },
    { key: 'premium', label: 'Premium' },
];

const PRICE_SOURCE_OPTIONS = [
    { key: 'gasbuddy', label: 'GasBuddy' },
    { key: 'all', label: 'Multi-Source' },
];

const APPEARANCE_OPTIONS = [
    { key: 'light', label: 'Light' },
    { key: 'system', label: 'System' },
    { key: 'dark', label: 'Dark' },
];

const RADIUS_OPTIONS = [5, 10, 15, 20, 25];
const RATING_OPTIONS = [0, 3, 3.5, 4, 4.5];
const TOP_CANOPY_HEIGHT = 44;
const SHOW_PRICE_SOURCE_CONTROLS = false;
const SHOW_MINIMUM_RATING_CONTROLS = false;

function formatRatingLabel(rating) {
    return rating === 0 ? 'Any' : `${rating}+`;
}

function findLabel(options, key, fallback) {
    return options.find((option) => option.key === key)?.label ?? fallback;
}

function noThrow(promise) {
    promise.catch(() => { });
}

function starSymbolsForRating(rating) {
    const wholeStars = Math.floor(rating);
    const hasHalfStar = rating - wholeStars >= 0.5;
    const stars = [];
    for (let i = 1; i <= 5; i += 1) {
        if (i <= wholeStars) {
            stars.push('star.fill');
        } else if (hasHalfStar && i === wholeStars + 1) {
            stars.push('star.leadinghalf.filled');
        } else {
            stars.push('star');
        }
    }
    return stars;
}

function SettingsSection({ title, children, titleColor, titleStyle, footer }) {
    return (
        <View style={styles.section}>
            <Text style={[styles.sectionTitle, titleStyle, { color: titleColor }]}>{title}</Text>
            <View style={styles.sectionRows}>{children}</View>
            {footer ? <Text style={[styles.sectionFooter, { color: titleColor }]}>{footer}</Text> : null}
        </View>
    );
}

function SettingsCard({ title, icon, iconBackground, value, isDark, themeColors, glassTintColor, titleStyle, valueStyle, children }) {
    return (
        <GlassView
            effect="regular"
            colorScheme={isDark ? 'dark' : 'light'}
            tintColor={glassTintColor}
            style={styles.card}
        >
            <View style={styles.cardHeader}>
                <View style={[styles.iconBadge, { backgroundColor: iconBackground }]}>
                    <SymbolView name={icon} size={16} tintColor="#FFFFFF" />
                </View>
                <Text style={[styles.cardTitle, titleStyle, { color: themeColors.text }]}>{title}</Text>
                {value ? (
                    <Text style={[styles.cardValue, styles.numericRounded, valueStyle, { color: themeColors.textOpacity }]}>{value}</Text>
                ) : null}
            </View>
            {children}
        </GlassView>
    );
}

function GlassChoiceButton({
    label,
    selected,
    onPress,
    isDark,
    themeColors,
    activeTint = '#007AFF',
    style,
}) {
    const inactiveTint = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.82)';

    return (
        <Pressable onPress={onPress} style={style}>
            <GlassView
                interactive
                effect="regular"
                colorScheme={isDark ? 'dark' : 'light'}
                tintColor={selected ? activeTint : inactiveTint}
                style={styles.choiceButton}
            >
                <Text style={[styles.choiceText, { color: selected ? '#FFFFFF' : themeColors.text }]}>{label}</Text>
            </GlassView>
        </Pressable>
    );
}

function ActionButton({ title, icon, iconTint, isDark, onPress, glassTintColor, themeColors, destructive = false }) {
    return (
        <Pressable onPress={onPress}>
            <GlassView
                interactive
                effect="regular"
                colorScheme={isDark ? 'dark' : 'light'}
                tintColor={destructive ? (isDark ? 'rgba(227,93,79,0.28)' : 'rgba(227,93,79,0.18)') : glassTintColor}
                style={styles.actionButton}
            >
                <View style={styles.actionButtonInner}>
                    <View style={styles.actionTitleRow}>
                        <SymbolView name={icon} size={16} tintColor={iconTint} />
                        <Text style={[styles.actionTitle, { color: destructive ? '#E35D4F' : themeColors.text }]}>{title}</Text>
                    </View>
                    <SymbolView name="chevron.right" size={14} tintColor={themeColors.textOpacity} />
                </View>
            </GlassView>
        </Pressable>
    );
}

function StarRatingChoice({ rating, selected, onPress, themeColors }) {
    const starSymbols = starSymbolsForRating(rating);
    const starTint = selected ? '#FF9F0A' : themeColors.textOpacity;

    return (
        <Pressable onPress={onPress} style={styles.starChoicePressable}>
            <View style={styles.starChoiceRow}>
                {starSymbols.map((symbolName, index) => (
                    <SymbolView
                        key={`${rating}-star-${index + 1}`}
                        name={symbolName}
                        size={16}
                        tintColor={starTint}
                    />
                ))}
            </View>
        </Pressable>
    );
}

export default function SettingsScreen() {
    const insets = useSafeAreaInsets();
    const { isDark, themeMode, setThemeMode, themeColors } = useTheme();
    const { requestFuelReset, setFuelDebugState } = useAppState();
    const { preferences, updatePreference, resetOnboarding } = usePreferences();
    const [resetNotice, setResetNotice] = useState(null);
    const [trackingPermissionState, setTrackingPermissionState] = useState(null);

    const glassTintColor = isDark ? '#101010ff' : '#FFFFFF';
    const canopyEdgeLine = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
    const topCanopyHeight = insets.top + TOP_CANOPY_HEIGHT;

    const darkModeWeightStyle = useMemo(() => ({
        pageTitle: { fontWeight: isDark ? '700' : '800' },
        pageSubTitle: { fontWeight: isDark ? '400' : '500' },
        sectionTitle: { fontWeight: isDark ? '500' : '600' },
        cardTitle: { fontWeight: isDark ? '600' : '700' },
        cardValue: { fontWeight: isDark ? '400' : '500' },
        noticeText: { fontWeight: isDark ? '400' : '500' },
    }), [isDark]);

    const radiusIndex = Math.max(0, RADIUS_OPTIONS.indexOf(preferences.searchRadiusMiles));
    const radiusValue = RADIUS_OPTIONS[radiusIndex];
    const lastRadiusIndexRef = useRef(radiusIndex);

    useEffect(() => {
        lastRadiusIndexRef.current = radiusIndex;
    }, [radiusIndex]);

    useEffect(() => {
        let isActive = true;

        void (async () => {
            try {
                const nextPermissionState = await getPredictiveLocationPermissionStateAsync();

                if (isActive) {
                    setTrackingPermissionState(nextPermissionState);
                }
            } catch (error) {
                if (isActive) {
                    setTrackingPermissionState(null);
                }
            }
        })();

        return () => {
            isActive = false;
        };
    }, []);

    const fireTapHaptic = () => {
        noThrow(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
    };

    const handleSelectWithHaptic = (callback) => {
        fireTapHaptic();
        callback();
    };

    const handleRadiusSliderChange = (rawValue) => {
        const nextIndex = Math.round(rawValue);
        if (nextIndex === lastRadiusIndexRef.current) return;

        lastRadiusIndexRef.current = nextIndex;
        noThrow(Haptics.selectionAsync());
        updatePreference('searchRadiusMiles', RADIUS_OPTIONS[nextIndex]);
    };

    const handleFuelReset = async () => {
        try {
            await clearFuelPriceCache();
            clearTrendDataCache();
            setFuelDebugState(null);
            requestFuelReset();
            setResetNotice('Fuel cache has been cleared.');
        } catch {
            setResetNotice('Unable to reset cache.');
        }
    };

    const handleConfirmFuelReset = () => {
        fireTapHaptic();
        Alert.alert(
            'Reset Fuel Cache',
            'Clear saved gas prices and force a fresh fetch?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Reset',
                    style: 'destructive',
                    onPress: () => {
                        noThrow(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
                        handleFuelReset();
                    },
                },
            ]
        );
    };

    const handleResetOnboarding = () => {
        fireTapHaptic();
        Alert.alert(
            'Reset Onboarding',
            'This will show the setup flow again on next launch.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Reset',
                    style: 'destructive',
                    onPress: () => {
                        noThrow(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
                        resetOnboarding();
                    },
                },
            ]
        );
    };

    const handleReviewTrackingPermissions = async () => {
        fireTapHaptic();

        try {
            const nextPermissionState = await requestPredictiveLocationPermissionsAsync();
            setTrackingPermissionState(nextPermissionState);

            if (nextPermissionState.isReady) {
                Alert.alert(
                    'Predictive Tracking Enabled',
                    'Always-on precise location is enabled for background fuel predictions.'
                );
                return;
            }

            Alert.alert(
                'Finish Tracking Setup',
                nextPermissionState.servicesEnabled
                    ? 'Fuel Up still needs Always Allow and Precise Location in iPhone Settings to fully enable predictive fueling.'
                    : 'Turn on Location Services in iPhone Settings first, then come back and enable Always Allow and Precise Location.',
                [
                    { text: 'Not Now', style: 'cancel' },
                    {
                        text: 'Open Settings',
                        onPress: () => {
                            void openPredictiveLocationSettingsAsync();
                        },
                    },
                ]
            );
        } catch (error) {
            Alert.alert(
                'Unable To Review Permissions',
                'Background tracking permissions can only be configured from a development or production build.'
            );
        }
    };

    return (
        <View style={styles.container}>
            <View style={[styles.baseBackground, { backgroundColor: themeColors.background }]} />
            <View style={styles.foregroundLayer}>
                <ScrollView
                    style={styles.scrollView}
                    contentContainerStyle={{ paddingTop: insets.top + 44, paddingBottom: insets.bottom + 80 }}
                    showsVerticalScrollIndicator={false}
                    bounces
                >
                    <View style={styles.contentPad}>
                        <View style={styles.pageHeader}>
                            <Text style={[styles.pageTitle, darkModeWeightStyle.pageTitle, { color: themeColors.text }]}>Settings</Text>
                            <Text style={[styles.pageSubTitle, darkModeWeightStyle.pageSubTitle, { color: themeColors.textOpacity }]}>
                                Configure how Fuel Up finds and filters your cheapest nearby station.
                            </Text>
                        </View>

                        <SettingsSection
                            title="PREFERENCES"
                            titleColor={themeColors.textOpacity}
                            titleStyle={darkModeWeightStyle.sectionTitle}
                        >
                            <SettingsCard
                                title="Search Radius"
                                icon="location.magnifyingglass"
                                iconBackground="#0A84FF"
                                value={`${radiusValue} mi`}
                                isDark={isDark}
                                themeColors={themeColors}
                                glassTintColor={glassTintColor}
                                titleStyle={darkModeWeightStyle.cardTitle}
                                valueStyle={darkModeWeightStyle.cardValue}
                            >
                                <View style={styles.sliderArea}>
                                    <Slider
                                        value={radiusIndex}
                                        minimumValue={0}
                                        maximumValue={RADIUS_OPTIONS.length - 1}
                                        step={1}
                                        onValueChange={handleRadiusSliderChange}
                                        onSlidingComplete={handleRadiusSliderChange}
                                        minimumTrackTintColor="#007AFF"
                                        maximumTrackTintColor={isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.16)'}
                                        thumbTintColor="#007AFF"
                                    />
                                    <View style={styles.notchRow}>
                                        {RADIUS_OPTIONS.map((miles, index) => (
                                            <View key={`radius-notch-${miles}`} style={styles.notchItem}>
                                                <View style={[styles.notchDot, { backgroundColor: index <= radiusIndex ? '#007AFF' : (isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.16)') }]} />
                                                <Text style={[styles.notchLabel, { color: themeColors.textOpacity }]}>{miles}</Text>
                                            </View>
                                        ))}
                                    </View>
                                </View>
                            </SettingsCard>

                            <SettingsCard
                                title="Preferred Octane"
                                icon="gauge.with.dots.needle.33percent"
                                iconBackground="#5856D6"
                                value={findLabel(OCTANE_OPTIONS, preferences.preferredOctane, 'Regular')}
                                isDark={isDark}
                                themeColors={themeColors}
                                glassTintColor={glassTintColor}
                                titleStyle={darkModeWeightStyle.cardTitle}
                                valueStyle={darkModeWeightStyle.cardValue}
                            >
                                <View style={styles.choiceRowThree}>
                                    {OCTANE_OPTIONS.map((option) => (
                                        <GlassChoiceButton
                                            key={option.key}
                                            label={option.label}
                                            selected={preferences.preferredOctane === option.key}
                                            onPress={() => handleSelectWithHaptic(() => updatePreference('preferredOctane', option.key))}
                                            isDark={isDark}
                                            themeColors={themeColors}
                                            style={styles.choiceThird}
                                        />
                                    ))}
                                </View>
                                <Text style={[styles.helperText, { color: themeColors.textOpacity }]}>
                                    Regular: 85-88 (usually 87) • Midgrade: 89-90 • Premium: 91-94+
                                </Text>
                            </SettingsCard>

                            {SHOW_PRICE_SOURCE_CONTROLS ? (
                                <SettingsCard
                                    title="Price Source"
                                    icon="antenna.radiowaves.left.and.right"
                                    iconBackground="#30B0C7"
                                    value={findLabel(PRICE_SOURCE_OPTIONS, preferences.preferredProvider, 'GasBuddy')}
                                    isDark={isDark}
                                    themeColors={themeColors}
                                    glassTintColor={glassTintColor}
                                    titleStyle={darkModeWeightStyle.cardTitle}
                                    valueStyle={darkModeWeightStyle.cardValue}
                                >
                                    <View style={styles.choiceRowTwo}>
                                        {PRICE_SOURCE_OPTIONS.map((option) => (
                                            <GlassChoiceButton
                                                key={option.key}
                                                label={option.label}
                                                selected={preferences.preferredProvider === option.key}
                                                onPress={() => handleSelectWithHaptic(() => updatePreference('preferredProvider', option.key))}
                                                isDark={isDark}
                                                themeColors={themeColors}
                                                style={styles.choiceHalf}
                                            />
                                        ))}
                                    </View>
                                </SettingsCard>
                            ) : null}

                            {SHOW_MINIMUM_RATING_CONTROLS ? (
                                <SettingsCard
                                    title="Minimum Rating"
                                    icon="star.fill"
                                    iconBackground="#FF9F0A"
                                    value={formatRatingLabel(preferences.minimumRating)}
                                    isDark={isDark}
                                    themeColors={themeColors}
                                    glassTintColor={glassTintColor}
                                    titleStyle={darkModeWeightStyle.cardTitle}
                                    valueStyle={darkModeWeightStyle.cardValue}
                                >
                                    <View style={styles.starPickerRow}>
                                        {RATING_OPTIONS.map((rating) => (
                                            <StarRatingChoice
                                                key={`rating-stars-${rating === 0 ? 'any' : rating}`}
                                                rating={rating}
                                                selected={preferences.minimumRating === rating}
                                                onPress={() => handleSelectWithHaptic(() => updatePreference('minimumRating', rating))}
                                                themeColors={themeColors}
                                            />
                                        ))}
                                    </View>
                                </SettingsCard>
                            ) : null}
                        </SettingsSection>

                        <SettingsSection
                            title="APPEARANCE"
                            titleColor={themeColors.textOpacity}
                            titleStyle={darkModeWeightStyle.sectionTitle}
                        >
                            <SettingsCard
                                title="Appearance"
                                icon={isDark ? 'moon.fill' : 'sun.max.fill'}
                                iconBackground={isDark ? '#5E5CE6' : '#FF9F0A'}
                                value={findLabel(APPEARANCE_OPTIONS, themeMode, 'Light')}
                                isDark={isDark}
                                themeColors={themeColors}
                                glassTintColor={glassTintColor}
                                titleStyle={darkModeWeightStyle.cardTitle}
                                valueStyle={darkModeWeightStyle.cardValue}
                            >
                                <View style={styles.choiceRowThree}>
                                    {APPEARANCE_OPTIONS.map((option) => (
                                        <GlassChoiceButton
                                            key={option.key}
                                            label={option.label}
                                            selected={themeMode === option.key}
                                            onPress={() => handleSelectWithHaptic(() => setThemeMode(option.key))}
                                            isDark={isDark}
                                            themeColors={themeColors}
                                            style={styles.choiceThird}
                                        />
                                    ))}
                                </View>
                            </SettingsCard>
                        </SettingsSection>

                        <SettingsSection
                            title="TRACKING"
                            titleColor={themeColors.textOpacity}
                            titleStyle={darkModeWeightStyle.sectionTitle}
                            footer={trackingPermissionState?.isReady
                                ? 'Always-on precise location is enabled.'
                                : 'Fuel Up needs Always Allow and Precise Location for predictive fueling and geofences.'}
                        >
                            <ActionButton
                                title={trackingPermissionState?.isReady ? 'Review Tracking Permissions' : 'Enable Predictive Tracking'}
                                icon={trackingPermissionState?.isReady ? 'location.fill.viewfinder' : 'location.badge.clock'}
                                iconTint="#0A84FF"
                                isDark={isDark}
                                onPress={handleReviewTrackingPermissions}
                                glassTintColor={glassTintColor}
                                themeColors={themeColors}
                            />
                        </SettingsSection>

                        <SettingsSection
                            title="DATA"
                            titleColor={themeColors.textOpacity}
                            titleStyle={darkModeWeightStyle.sectionTitle}
                            footer="Data resets only affect this device."
                        >
                            <ActionButton
                                title="Reset Fuel Cache"
                                icon="arrow.counterclockwise"
                                iconTint="#E35D4F"
                                isDark={isDark}
                                onPress={handleConfirmFuelReset}
                                glassTintColor={glassTintColor}
                                themeColors={themeColors}
                                destructive
                            />
                            <ActionButton
                                title="Reset Onboarding"
                                icon="arrow.uturn.backward"
                                iconTint={themeColors.textOpacity}
                                isDark={isDark}
                                onPress={handleResetOnboarding}
                                glassTintColor={glassTintColor}
                                themeColors={themeColors}
                            />
                        </SettingsSection>

                        {resetNotice ? (
                            <Text style={[styles.noticeText, darkModeWeightStyle.noticeText, { color: themeColors.textOpacity }]}>
                                {resetNotice}
                            </Text>
                        ) : null}
                    </View>
                </ScrollView>

                <TopCanopy edgeColor={canopyEdgeLine} height={topCanopyHeight} isDark={isDark} topInset={insets.top} />
                <View style={[styles.header, { paddingTop: insets.top }]}>
                    <FuelUpHeaderLogo isDark={isDark} />
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        position: 'relative',
    },
    baseBackground: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 0,
    },
    foregroundLayer: {
        flex: 1,
        zIndex: 1,
    },
    scrollView: {
        flex: 1,
    },
    header: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        alignItems: 'center',
        paddingTop: 16,
        paddingBottom: 10,
        zIndex: 10,
    },
    contentPad: {
        padding: 16,
    },
    pageHeader: {
        marginBottom: 18,
        paddingHorizontal: 4,
    },
    pageTitle: {
        fontSize: 34,
        fontWeight: '800',
        letterSpacing: -1,
        marginBottom: 6,
    },
    pageSubTitle: {
        fontSize: 14,
        fontWeight: '500',
        letterSpacing: -0.2,
        lineHeight: 20,
    },
    section: {
        marginBottom: 26,
        gap: 10,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '600',
        letterSpacing: 0.8,
        paddingHorizontal: 4,
    },
    sectionRows: {
        gap: 10,
    },
    sectionFooter: {
        fontSize: 12,
        letterSpacing: 0.1,
        lineHeight: 17,
        paddingHorizontal: 6,
        opacity: 0.9,
    },
    card: {
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 15,
        overflow: 'hidden',
        gap: 12,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    iconBadge: {
        width: 30,
        height: 30,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 10,
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: '700',
        letterSpacing: -0.25,
        flexShrink: 1,
    },
    cardValue: {
        fontSize: 15,
        fontWeight: '500',
        letterSpacing: -0.15,
        marginLeft: 'auto',
    },
    sliderArea: {
        gap: 8,
    },
    notchRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        paddingHorizontal: 2,
    },
    notchItem: {
        alignItems: 'center',
        minWidth: 26,
    },
    notchDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginBottom: 4,
    },
    notchLabel: {
        fontSize: 11,
        fontWeight: '500',
    },
    choiceRowThree: {
        flexDirection: 'row',
        gap: 8,
    },
    choiceRowTwo: {
        flexDirection: 'row',
        gap: 8,
    },
    choiceThird: {
        flex: 1,
    },
    choiceHalf: {
        flex: 1,
    },
    starPickerRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
    },
    choiceButton: {
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    choiceText: {
        fontSize: 14,
        fontWeight: '600',
        letterSpacing: -0.2,
    },
    helperText: {
        fontSize: 12,
        lineHeight: 17,
        letterSpacing: 0.05,
        marginTop: 2,
    },
    starChoicePressable: {
        minWidth: 86,
        paddingVertical: 8,
        paddingHorizontal: 4,
        alignItems: 'center',
    },
    starChoiceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
    },
    actionButton: {
        borderRadius: 18,
        paddingHorizontal: 14,
        paddingVertical: 13,
        overflow: 'hidden',
    },
    actionButtonInner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    actionTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    actionTitle: {
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: -0.25,
    },
    noticeText: {
        fontSize: 13,
        lineHeight: 18,
        textAlign: 'center',
        marginTop: 6,
        paddingHorizontal: 10,
    },
    numericRounded: {
        fontFamily: 'ui-rounded',
    },
});
