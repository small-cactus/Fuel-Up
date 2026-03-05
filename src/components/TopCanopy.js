import React from 'react';
import { Platform, StyleSheet, UIManager, View } from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { ProgressiveBlurView } from '@sbaiahmed1/react-native-blur';

const HAS_NATIVE_PROGRESSIVE_BLUR =
    Platform.OS === 'ios' && Boolean(UIManager.hasViewManagerConfig?.('ReactNativeProgressiveBlurView'));
const HAS_NATIVE_MASK =
    Platform.OS === 'ios' && Boolean(UIManager.hasViewManagerConfig?.('RNCMaskedView'));

const TOP_CANOPY_BLUR_STRENGTH = 0.8; // 0 = no blur, 1 = default, >1 = stronger
const TOP_CANOPY_BLUR_SPREAD = 1.4; // 1 = default height, >1 = spreads further down
const BASE_PROGRESSIVE_BLUR_AMOUNT = 5;
const BASE_MASK_BLUR_INTENSITY = 80;

const LIGHT_GRADIENT = [
    'rgba(248, 250, 252, 0.68)',
    'rgba(248, 250, 252, 0.46)',
    'rgba(248, 250, 252, 0.22)',
    'rgba(248, 250, 252, 0.08)',
    'rgba(248, 250, 252, 0)',
];
const DARK_GRADIENT = [
    'rgba(10, 14, 20, 0.5)',
    'rgba(10, 14, 20, 0.34)',
    'rgba(10, 14, 20, 0.16)',
    'rgba(10, 14, 20, 0.06)',
    'rgba(10, 14, 20, 0)',
];
const MASK_GRADIENT = ['rgba(0, 0, 0, 1)', 'rgba(0, 0, 0, 0.7)', 'rgba(0, 0, 0, 0.28)', 'rgba(0, 0, 0, 0.06)', 'rgba(0, 0, 0, 0)'];

export function TopCanopy({ height, isDark }) {
    const canopyHeight = Math.max(0, height * Math.max(0, TOP_CANOPY_BLUR_SPREAD));
    const progressiveBlurAmount = Math.max(0, BASE_PROGRESSIVE_BLUR_AMOUNT * TOP_CANOPY_BLUR_STRENGTH);
    const maskBlurIntensity = Math.min(100, Math.max(0, BASE_MASK_BLUR_INTENSITY * TOP_CANOPY_BLUR_STRENGTH));

    return (
        <View pointerEvents="none" style={[styles.shell, { height: canopyHeight }]}>
            {HAS_NATIVE_PROGRESSIVE_BLUR ? (
                <ProgressiveBlurView
                    blurType={isDark ? 'dark' : 'light'}
                    blurAmount={progressiveBlurAmount}
                    direction="blurredTopClearBottom"
                    startOffset={0.0}
                    style={{ height: canopyHeight }}
                />
            ) : HAS_NATIVE_MASK ? (
                <MaskedView
                    style={{ height: canopyHeight }}
                    maskElement={
                        <LinearGradient
                            colors={MASK_GRADIENT}
                            locations={[0, 0.3, 0.6, 0.9, 1]}
                            style={StyleSheet.absoluteFillObject}
                        />
                    }
                >
                    <BlurView intensity={maskBlurIntensity} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
                </MaskedView>
            ) : (
                <LinearGradient
                    colors={isDark ? DARK_GRADIENT : LIGHT_GRADIENT}
                    locations={[0, 0.3, 0.6, 0.9, 1]}
                    style={{ height: canopyHeight }}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    shell: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
    },
});

export default TopCanopy;
