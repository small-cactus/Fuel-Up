import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Animated, { useSharedValue, useAnimatedStyle, useAnimatedProps, withTiming, withDelay, cancelAnimation, Easing } from 'react-native-reanimated';
import { WelcomeStep } from './onboarding/WelcomeStep';
import { DEMO_REGION, LIGHT_SCREEN_BACKGROUND, LIGHT_SCREEN_BACKGROUND_85, LIGHT_SCREEN_BACKGROUND_0 } from './onboarding/presentation';
import GlassActionButton from '../components/native/GlassActionButton';
import { usePreferences } from '../PreferencesContext';
import { useTheme } from '../ThemeContext';

const NativeOnboarding = Platform.OS === 'ios' && Number(Platform.Version) >= 16
    ? require('./onboarding/NativeOnboarding').default : null;
const LegacyOnboarding = !NativeOnboarding ? require('./OnboardingScreen.legacy').default : null;
const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

export default function OnboardingScreen() {
    return NativeOnboarding ? <NativeWelcomeFlow /> : <LegacyOnboarding />;
}

function NativeWelcomeFlow() {
    const insets = useSafeAreaInsets();
    const { isDark, themeColors } = useTheme();
    const { preferences, completeOnboarding } = usePreferences();
    const [started, setStarted] = useState(false);
    const [showWelcome, setShowWelcome] = useState(true);
    const blur = useSharedValue(80);
    const animatedProps = useAnimatedProps(() => ({ intensity: blur.value }));
    const animatedStyle = useAnimatedStyle(() => ({ opacity: blur.value > 0.1 ? 1 : 0 }));
    useEffect(() => {
        blur.value = withDelay(500, withTiming(0, { duration: 1000, easing: Easing.out(Easing.exp) }));
        return () => cancelAnimation(blur);
    }, [blur]);
    return <View style={{ flex: 1, backgroundColor: themeColors.background }}>
        {showWelcome && <View style={styles.fill}>
            <WelcomeStep isDark={isDark} themeColors={themeColors} insets={insets} mapRegion={DEMO_REGION} />
            <LinearGradient colors={[isDark ? 'rgba(0,0,0,0)' : LIGHT_SCREEN_BACKGROUND_0,
                isDark ? 'rgba(0,0,0,0.85)' : LIGHT_SCREEN_BACKGROUND_85, isDark ? '#000000' : LIGHT_SCREEN_BACKGROUND]}
                locations={[0, 0.4, 1]} style={[styles.gradient, { paddingBottom: insets.bottom + 20 }]} pointerEvents="none" />
            <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.dots}>
                    {Array.from({ length: 5 }, (_, i) => <View key={i} style={{ width: i === 0 ? 24 : 8, height: 8, borderRadius: 4,
                        backgroundColor: i === 0 ? '#007AFF' : isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)' }} />)}
                </View>
                <GlassActionButton testID="onboarding-continue" prominent fullWidth value="1 of 5"
                    title="Continue" icon="arrow.right" isDark={isDark}
                    onPress={() => { setStarted(true); setShowWelcome(false); }} />
            </View>
            <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]} pointerEvents="none">
                <AnimatedBlurView animatedProps={animatedProps} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
            </Animated.View>
        </View>}
        {started && <NativeOnboarding preferences={preferences} isDark={isDark} visible={!showWelcome}
            onBack={() => setShowWelcome(true)} onComplete={completeOnboarding} />}
    </View>;
}
const styles = StyleSheet.create({
    fill: { flex: 1 },
    gradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 200 },
    footer: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', gap: 20, paddingHorizontal: 24 },
    dots: { flexDirection: 'row', gap: 8 },
});
