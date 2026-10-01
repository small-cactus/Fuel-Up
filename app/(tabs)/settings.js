import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Alert, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppState } from '../../src/AppStateContext';
import { usePreferences } from '../../src/PreferencesContext';
import { clearFuelPriceCache } from '../../src/services/fuel';
import { clearTrendDataCache } from '../../src/services/fuel/trends';
import { useTheme } from '../../src/ThemeContext';
import TopCanopy from '../../src/components/TopCanopy';
import FuelUpHeaderLogo from '../../src/components/FuelUpHeaderLogo';
import NativeSettingsForm from '../../src/components/settings/NativeSettingsForm';
import BrandPreferencesSheet from '../../src/components/settings/BrandPreferencesSheet';
import {
    enablePredictiveTrackingAsync,
    getPredictiveTrackingPermissionStateAsync,
    openPredictiveTrackingSettingsAsync,
} from '../../src/lib/predictiveTrackingAccess';

const TOP_CANOPY_HEIGHT = 44;

function noThrow(promise) {
    promise.catch(() => { });
}

export default function SettingsScreen() {
    const insets = useSafeAreaInsets();
    const { isDark, themeMode, setThemeMode, themeColors } = useTheme();
    const { requestFuelReset, setFuelDebugState, manualLocationOverride, resolvedFuelSearchContext } = useAppState();
    const { preferences, updatePreference, resetOnboarding } = usePreferences();
    const [trackingPermissionState, setTrackingPermissionState] = useState(null);
    const [brandsPresented, setBrandsPresented] = useState(false);
    const brandCoordinate = useMemo(() => {
        const origin = manualLocationOverride || resolvedFuelSearchContext;
        return Number.isFinite(origin?.latitude) && Number.isFinite(origin?.longitude)
            ? { latitude: origin.latitude, longitude: origin.longitude } : null;
    }, [manualLocationOverride, resolvedFuelSearchContext]);
    const mountedRef = useRef(false);
    const permissionRevisionRef = useRef(0);
    const reviewingPermissionsRef = useRef(false);
    const resettingFuelRef = useRef(false);

    const canopyEdgeLine = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
    const topCanopyHeight = insets.top + TOP_CANOPY_HEIGHT;

    useEffect(() => {
        let isActive = true;
        mountedRef.current = true;

        const refreshPermissions = async () => {
            if (reviewingPermissionsRef.current) return;
            const revision = ++permissionRevisionRef.current;
            try {
                const nextPermissionState = await getPredictiveTrackingPermissionStateAsync();
                if (isActive && revision === permissionRevisionRef.current) setTrackingPermissionState(nextPermissionState);
            } catch {
                if (isActive && revision === permissionRevisionRef.current) setTrackingPermissionState(null);
            }
        };
        void refreshPermissions();
        const subscription = AppState.addEventListener('change', state => {
            if (state === 'active') void refreshPermissions();
        });
        return () => {
            isActive = false;
            mountedRef.current = false;
            permissionRevisionRef.current += 1;
            subscription.remove();
        };
    }, []);

    const fireTapHaptic = () => {
        noThrow(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
    };

    const handleRadiusChange = (nextValue) => {
        noThrow(Haptics.selectionAsync());
        updatePreference('searchRadiusMiles', Number(nextValue));
    };

    const handleOctaneChange = (nextValue) => {
        fireTapHaptic();
        updatePreference('preferredOctane', nextValue);
    };

    const handleThemeModeChange = (nextValue) => {
        fireTapHaptic();
        setThemeMode(nextValue);
    };

    const handleNavigationAppChange = (nextValue) => {
        fireTapHaptic();
        updatePreference('navigationApp', nextValue);
    };

    const handleFuelReset = async () => {
        if (resettingFuelRef.current) return;
        resettingFuelRef.current = true;
        try {
            await clearFuelPriceCache();
            clearTrendDataCache();
            setFuelDebugState(null);
            requestFuelReset();
            if (mountedRef.current) Alert.alert('Fuel Cache Cleared', 'Your next map refresh will pull fresh prices.');
        } catch (error) {
            if (mountedRef.current) Alert.alert('Reset Failed', 'Unable to clear the fuel cache right now. Please try again.');
        } finally {
            resettingFuelRef.current = false;
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
            'Replay Onboarding',
            'This will show the setup flow again the next time you open the app.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Replay',
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
        if (reviewingPermissionsRef.current) return;
        reviewingPermissionsRef.current = true;
        const revision = ++permissionRevisionRef.current;
        fireTapHaptic();

        try {
            const nextPermissionState = await enablePredictiveTrackingAsync();
            if (!mountedRef.current || revision !== permissionRevisionRef.current) return;
            setTrackingPermissionState(nextPermissionState);

            if (nextPermissionState.isReady) {
                Alert.alert(
                    'Predictive Tracking Enabled',
                    'Always-on precise location and Motion & Fitness access are enabled. Fuel Up will wait for Apple to classify you as driving before starting predictive fueling.'
                );
                return;
            }

            Alert.alert(
                'Finish Tracking Setup',
                nextPermissionState.servicesEnabled
                    ? 'Fuel Up still needs Always Allow, Precise Location, and Motion & Fitness access in iPhone Settings to fully enable predictive fueling.'
                    : 'Turn on Location Services in iPhone Settings first, then come back and enable Always Allow, Precise Location, and Motion & Fitness.',
                [
                    { text: 'Not Now', style: 'cancel' },
                    {
                        text: 'Open Settings',
                        onPress: () => {
                            noThrow(openPredictiveTrackingSettingsAsync());
                        },
                    },
                ]
            );
        } catch (error) {
            if (!mountedRef.current || revision !== permissionRevisionRef.current) return;
            Alert.alert(
                'Unable To Review Permissions',
                'Background tracking permissions can only be configured from a development or production build.'
            );
        } finally {
            reviewingPermissionsRef.current = false;
        }
    };

    const trackingReady = Boolean(trackingPermissionState?.isReady);
    const trackingFooterCopy = useMemo(() => {
        if (trackingReady) {
            return 'Always-on location and Motion & Fitness are enabled. Fuel Up waits for Apple to classify you as driving before it starts predictive fueling.';
        }
        return 'Fuel Up needs Always Allow, Precise Location, and Motion & Fitness access. Predictive fueling will only start after Apple marks you as driving.';
    }, [trackingReady]);

    const onboardingFooterCopy = 'Resets only affect this device. You can always restart onboarding to change your grade or octane preferences.';

    return (
        <View style={styles.container}>
            <BrandPreferencesSheet visible={brandsPresented} onClose={() => setBrandsPresented(false)}
                isDark={isDark} themeColors={themeColors} coordinate={brandCoordinate}
                radiusMiles={preferences.searchRadiusMiles} fuelGrade={preferences.preferredOctane}
                requiresE85={preferences.requiresE85} selectedBrands={preferences.preferredBrands || []}
                fuelMemberships={preferences.fuelMemberships || []} onMembershipsChange={value => updatePreference('fuelMemberships', value)}
                onChange={brands => updatePreference('preferredBrands', brands)} />
            <View style={[styles.baseBackground, { backgroundColor: themeColors.background }]} />
            <View style={styles.foregroundLayer}>
                <View
                    style={[
                        styles.formSlot,
                        {
                            paddingTop: topCanopyHeight,
                            paddingBottom: insets.bottom,
                        },
                    ]}
                >
                    <NativeSettingsForm
                        isDark={isDark}
                        searchRadiusMiles={preferences.searchRadiusMiles}
                        preferredOctane={preferences.preferredOctane}
                        onRadiusChange={handleRadiusChange}
                        onOctaneChange={handleOctaneChange}
                        requiresE85={preferences.requiresE85}
                        onRequiresE85Change={value => updatePreference('requiresE85', value)}
                        fuelMemberships={preferences.fuelMemberships}
                        preferredBrands={preferences.preferredBrands}
                        onEditPreferredBrands={() => setBrandsPresented(true)}
                        navigationApp={preferences.navigationApp}
                        onNavigationAppChange={handleNavigationAppChange}
                        themeMode={themeMode}
                        onThemeModeChange={handleThemeModeChange}
                        trackingReady={trackingReady}
                        onReviewTracking={handleReviewTrackingPermissions}
                        onResetFuelCache={handleConfirmFuelReset}
                        onResetOnboarding={handleResetOnboarding}
                        trackingFooterCopy={trackingFooterCopy}
                        onboardingFooterCopy={onboardingFooterCopy}
                    />
                </View>

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
    formSlot: {
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
});
