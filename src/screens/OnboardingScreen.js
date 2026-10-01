import { WelcomeStep } from './onboarding/WelcomeStep.js';
import { LocationStep } from './onboarding/LocationStep.js';
import { NotificationStep } from './onboarding/NotificationStep.js';
import { hasPredictiveLocationAccess, getLocationActionLabel } from './onboarding/locationCopy.js';
import { SCREEN_WIDTH, DEMO_REGION, LIGHT_SCREEN_BACKGROUND, LIGHT_SCREEN_BACKGROUND_85, LIGHT_SCREEN_BACKGROUND_0 } from './onboarding/presentation.js';
import RadiusStep from './onboarding/RadiusStep';
import FuelGradeStep from './onboarding/FuelGradeStep';
import BrandStep from './onboarding/BrandStep';
import useOnboardingLocation from './onboarding/useOnboardingLocation';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import GlassActionButton from '../components/native/GlassActionButton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';

import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import Animated, { useSharedValue, useAnimatedStyle, useAnimatedProps, withTiming, withDelay, cancelAnimation, Easing } from 'react-native-reanimated';
import { usePreferences } from '../PreferencesContext';
import { useTheme } from '../ThemeContext';

import PredictiveFuelingStep from './onboarding/predictive/PredictiveFuelingStep';
import { registerForPushNotificationsAsync, savePushTokenToSupabase } from '../lib/notifications';
import { enablePredictiveTrackingAsync, getPredictiveTrackingPermissionStateAsync, openPredictiveTrackingSettingsAsync } from '../lib/predictiveTrackingAccess';

import { buildOnboardingPreferenceUpdates, isTranslucentOnboardingStep, ONBOARDING_STEPS } from '../lib/onboardingFlow';
const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

const MemoWelcomeStep = React.memo(WelcomeStep);
const MemoLocationStep = React.memo(LocationStep);
const MemoNotificationStep = React.memo(NotificationStep);

export default function OnboardingScreen() {
    const insets = useSafeAreaInsets();
    const { isDark, themeColors } = useTheme();
    const { preferences, updatePreference, completeOnboarding } = usePreferences();
    const [currentStep, setCurrentStep] = useState(0);

    const blurIntensity = useSharedValue(80);

    const animatedBlurProps = useAnimatedProps(() => ({
        intensity: blurIntensity.value,
    }));

    const animatedBlurStyle = useAnimatedStyle(() => ({
        opacity: blurIntensity.value > 0.1 ? 1 : 0,
        pointerEvents: blurIntensity.value > 10 ? 'auto' : 'none',
    }));

    useEffect(() => {
        // Initial splash unblur (defocus)
        blurIntensity.value = withDelay(500, withTiming(0, {
            duration: 1000,
            easing: Easing.out(Easing.exp)
        }));
        return () => cancelAnimation(blurIntensity);
    }, [blurIntensity]);

    const scrollViewRef = useRef(null);
    const activeStepRef = useRef(currentStep);
    activeStepRef.current = currentStep;
    const permissionRequestRef = useRef(false);
    const advanceTimerRef = useRef(null);
    const isMountedRef = useRef(false);
    const [isRequestingPermission, setIsRequestingPermission] = useState(false);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            clearTimeout(advanceTimerRef.current);
        };
    }, []);

    const advanceAfterPermission = step => {
        if (!isMountedRef.current) return;
        clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = setTimeout(() => {
            if (activeStepRef.current === step) {
                scrollViewRef.current?.scrollTo({ x: (step + 1) * SCREEN_WIDTH, animated: true });
            }
        }, 600);
    };

    const handleScroll = (event) => {
        const offset = event.nativeEvent.contentOffset.x;
        const index = Math.round(offset / SCREEN_WIDTH);
        if (index !== currentStep && index >= 0 && index < totalSteps) {
            clearTimeout(advanceTimerRef.current);
            setCurrentStep(index);
        }
    };
    const totalSteps = ONBOARDING_STEPS.length;

    const [radius, setRadius] = useState(preferences.searchRadiusMiles);
    const [octane, setOctane] = useState(preferences.preferredOctane);
    const [requiresE85, setRequiresE85] = useState(Boolean(preferences.requiresE85));
    const [fuelMemberships, setFuelMemberships] = useState(preferences.fuelMemberships || []);
    const [preferredBrands, setPreferredBrands] = useState(preferences.preferredBrands || []);
    const [locationPermissionState, setLocationPermissionState] = useState(null);
    const [notifPermissionStatus, setNotifPermissionStatus] = useState(null);
    const onboardingCoordinate = useOnboardingLocation(locationPermissionState);

    useEffect(() => {
        let isActive = true;
        const refreshPermissions = async () => {
            const [location, notifications] = await Promise.allSettled([
                getPredictiveTrackingPermissionStateAsync(),
                Notifications.getPermissionsAsync(),
            ]);
            if (!isActive) return;
            if (location.status === 'fulfilled') setLocationPermissionState(location.value);
            if (notifications.status === 'fulfilled') setNotifPermissionStatus(notifications.value.status);
        };
        void refreshPermissions();
        const subscription = AppState.addEventListener('change', state => {
            if (state === 'active') void refreshPermissions();
        });
        return () => { isActive = false; subscription.remove(); };
    }, []);

    const handleRequestPermission = async () => {
        if (permissionRequestRef.current) return;
        permissionRequestRef.current = true;
        setIsRequestingPermission(true);
        const requestedStep = currentStep;
        try {
            const nextPermissionState = await enablePredictiveTrackingAsync();
            if (!isMountedRef.current) return;
            setLocationPermissionState(nextPermissionState);

            if (nextPermissionState.isReady) {
                advanceAfterPermission(requestedStep);
                return;
            }

            if (nextPermissionState.needsSettings) {
                Alert.alert(
                    'Finish Location Setup',
                    nextPermissionState.servicesEnabled
                        ? 'Fuel Up still needs Always Allow, Precise Location, and Motion & Fitness access in iPhone Settings before predictive fueling can start when you begin driving.'
                        : 'Turn on Location Services in iPhone Settings, then come back and enable Always Allow, Precise Location, and Motion & Fitness.',
                    [
                        { text: 'Not Now', style: 'cancel' },
                        {
                            text: 'Open Settings',
                            onPress: () => {
                                void openPredictiveTrackingSettingsAsync();
                            },
                        },
                    ]
                );
            }
        } catch (error) {
            if (!isMountedRef.current) return;
            Alert.alert(
                'Unable To Enable Predictive Tracking',
                'Unable to check tracking permissions. Please try again or review access in iPhone Settings.'
            );
        } finally {
            permissionRequestRef.current = false;
            if (isMountedRef.current) setIsRequestingPermission(false);
        }
    };

    const handleRequestNotifications = async () => {
        if (permissionRequestRef.current) return;
        permissionRequestRef.current = true;
        setIsRequestingPermission(true);
        const requestedStep = currentStep;
        try {
            const token = await registerForPushNotificationsAsync();
            // Permission and remote token registration are separate: being offline
            // must not turn a granted permission into a displayed denial.
            const permission = await Notifications.getPermissionsAsync();
            if (!isMountedRef.current) return;
            setNotifPermissionStatus(permission.status);
            if (token) void savePushTokenToSupabase(token);
            advanceAfterPermission(requestedStep);
        } catch (error) {
            if (!isMountedRef.current) return;
            Alert.alert('Notification Setup Unavailable', 'Please try again. You can also enable notifications later in iPhone Settings.');
        } finally {
            permissionRequestRef.current = false;
            if (isMountedRef.current) setIsRequestingPermission(false);
        }
    };

    const handleContinue = () => {
        if (permissionRequestRef.current) return;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

        if (currentStep === 2 && !hasPredictiveLocationAccess(locationPermissionState)) {
            handleRequestPermission();
            return;
        }

        if (ONBOARDING_STEPS[currentStep] === 'notifications' && notifPermissionStatus !== 'granted') {
            handleRequestNotifications();
            return;
        }

        if (currentStep < totalSteps - 1) {
            buildOnboardingPreferenceUpdates({
                currentStep,
                radius,
                octane,
                requiresE85,
                fuelMemberships,
            }).forEach(([preferenceKey, preferenceValue]) => {
                updatePreference(preferenceKey, preferenceValue);
            });

            scrollViewRef.current?.scrollTo({ x: (currentStep + 1) * SCREEN_WIDTH, animated: true });
        } else {
            // Final step
            completeOnboarding({ searchRadiusMiles: radius, preferredOctane: octane, requiresE85, preferredBrands, fuelMemberships });
        }
    };

    const isLastStep = currentStep === totalSteps - 1;
    const canSkipPermission = (
        currentStep === 2 && !hasPredictiveLocationAccess(locationPermissionState)
    ) || (ONBOARDING_STEPS[currentStep] === 'notifications' && notifPermissionStatus !== 'granted');
    const handleSkipPermission = () => {
        if (permissionRequestRef.current || !canSkipPermission) return;
        clearTimeout(advanceTimerRef.current);
        scrollViewRef.current?.scrollTo({ x: (currentStep + 1) * SCREEN_WIDTH, animated: true });
    };

    // Use full map for specific steps
    const isTranslucentStep = isTranslucentOnboardingStep(currentStep);
    const onboardingBackgroundColor = (
        !isDark && currentStep === 1
            ? '#FFFFFF'
            : themeColors.background
    );

    return (
        <View style={[styles.container, { backgroundColor: onboardingBackgroundColor }]}>

            <View style={styles.content}>
                <ScrollView
                    ref={scrollViewRef}
                    testID="onboarding-pages"
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    onMomentumScrollEnd={handleScroll}
                    scrollEnabled={!isRequestingPermission}
                    scrollEventThrottle={16}
                    style={styles.scrollView}
                    removeClippedSubviews={false}
                >

                    <MemoWelcomeStep isDark={isDark} themeColors={themeColors} insets={insets} mapRegion={DEMO_REGION} />

                    <PredictiveFuelingStep
                        isDark={isDark}
                        insets={insets}
                        isActive={currentStep === 1}
                    />

                    <MemoLocationStep isDark={isDark} themeColors={themeColors} insets={insets} permissionState={locationPermissionState} />
                    <MemoNotificationStep isDark={isDark} themeColors={themeColors} insets={insets} permissionStatus={notifPermissionStatus} />
                    <RadiusStep isActive={ONBOARDING_STEPS[currentStep] === 'radius'} width={SCREEN_WIDTH} isDark={isDark} themeColors={themeColors} insets={insets} value={radius} onChange={setRadius} coordinate={onboardingCoordinate} />
                    <FuelGradeStep width={SCREEN_WIDTH} isDark={isDark} themeColors={themeColors} insets={insets} value={octane} onChange={setOctane} requiresE85={requiresE85} onRequiresE85Change={setRequiresE85} />
                    <BrandStep width={SCREEN_WIDTH} insets={insets} themeColors={themeColors} isDark={isDark}
                        isActive={ONBOARDING_STEPS[currentStep] === 'brands'} coordinate={onboardingCoordinate} radiusMiles={radius} fuelGrade={octane}
                        requiresE85={requiresE85} selectedBrands={preferredBrands} onChange={setPreferredBrands}
                        fuelMemberships={fuelMemberships} onMembershipsChange={setFuelMemberships} />
                </ScrollView>
            </View>

            {/* Progress dots + continue (Stay solid) */}
            {isTranslucentStep && (
                <LinearGradient
                    colors={[isDark ? 'rgba(0,0,0,0)' : LIGHT_SCREEN_BACKGROUND_0, isDark ? 'rgba(0,0,0,0.85)' : LIGHT_SCREEN_BACKGROUND_85, isDark ? '#000000' : LIGHT_SCREEN_BACKGROUND]}
                    locations={[0, 0.4, 1]}
                    style={[styles.footerGradient, { paddingBottom: insets.bottom + 20 }]}
                    pointerEvents="none"
                />
            )}

            <View style={[styles.footer, isTranslucentStep && styles.footerAbsolute, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.dotsRow}>
                    {Array.from({ length: totalSteps }).map((_, i) => (
                        <View
                            key={i}
                            style={[
                                styles.dot,
                                i === currentStep && styles.dotActive,
                                { backgroundColor: i === currentStep ? '#007AFF' : (isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)') },
                            ]}
                        />
                    ))}
                </View>

                <View style={styles.continueActions}>
                    <GlassActionButton testID="onboarding-continue" prominent fullWidth
                        value={`${currentStep + 1} of ${totalSteps}`} disabled={isRequestingPermission}
                        onPress={handleContinue}
                        title={isLastStep ? 'Get Started' : (
                            currentStep === 2 && !hasPredictiveLocationAccess(locationPermissionState) ? getLocationActionLabel(locationPermissionState) :
                                ONBOARDING_STEPS[currentStep] === 'notifications' && notifPermissionStatus !== 'granted' ? 'Enable Notifications' : 'Continue'
                        )}
                        icon={isLastStep ? 'checkmark' : (
                            currentStep === 2 && !hasPredictiveLocationAccess(locationPermissionState) ? 'location.fill' :
                                ONBOARDING_STEPS[currentStep] === 'notifications' && notifPermissionStatus !== 'granted' ? 'bell.fill' : 'arrow.right'
                        )}
                        isDark={isDark}
                    />
                    {canSkipPermission && (
                        <Pressable testID="onboarding-permission-skip" accessibilityRole="button"
                            accessibilityLabel={currentStep === 2 ? 'Not now, set up location later' : 'Not now, set up notifications later'}
                            accessibilityState={{ disabled: isRequestingPermission }} disabled={isRequestingPermission}
                            onPress={handleSkipPermission} style={styles.skipPermission}>
                            <Text style={[styles.skipPermissionText, { color: themeColors.text }]}>Not Now</Text>
                        </Pressable>
                    )}
                </View>
            </View>

            {/* Full-screen transition blur overlay (Dynamic Intensity) */}
            <Animated.View
                style={[StyleSheet.absoluteFill, animatedBlurStyle]}
                pointerEvents="none"
            >
                <AnimatedBlurView
                    animatedProps={animatedBlurProps}
                    tint={isDark ? 'dark' : 'light'}
                    style={StyleSheet.absoluteFill}
                />
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  content: {
    flex: 1
  },
  scrollView: {
    flex: 1
  },
  // Footer
  footer: {
    alignItems: 'center',
    gap: 20,
    paddingHorizontal: 24
  },
  footerAbsolute: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0
  },
  footerGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 200
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 8
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  dotActive: {
    width: 24,
    borderRadius: 4
  },
  continueActions: {
    width: '100%',
    gap: 4
  },
  skipPermission: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center'
  },
  skipPermissionText: {
    fontSize: 16,
    fontWeight: '500'
  },
});
