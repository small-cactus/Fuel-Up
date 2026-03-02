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

const LIGHT_GRADIENT = [
    'rgba(248, 250, 252, 0)',
    'rgba(248, 250, 252, 0.08)',
    'rgba(248, 250, 252, 0.22)',
    'rgba(248, 250, 252, 0.46)',
    'rgba(248, 250, 252, 0.68)',
    'rgba(248, 250, 252, 0.90)',
];
const DARK_GRADIENT = [
    'rgba(10, 14, 20, 0)',
    'rgba(10, 14, 20, 0.06)',
    'rgba(10, 14, 20, 0.16)',
    'rgba(10, 14, 20, 0.34)',
    'rgba(10, 14, 20, 0.5)',
    'rgba(10, 14, 20, 0.8)',
];
const MASK_GRADIENT = ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0.06)', 'rgba(0, 0, 0, 0.28)', 'rgba(0, 0, 0, 0.7)', 'rgba(0, 0, 0, 1)'];

export function BottomCanopy({ height, isDark }) {
    return (
        <View pointerEvents="none" style={[styles.shell, { height }]}>
            {HAS_NATIVE_PROGRESSIVE_BLUR ? (
                <ProgressiveBlurView
                    blurType={isDark ? 'dark' : 'light'}
                    blurAmount={12}
                    direction="blurredBottomClearTop"
                    startOffset={0.0}
                    style={{ height }}
                />
            ) : HAS_NATIVE_MASK ? (
                <MaskedView
                    style={{ height }}
                    maskElement={
                        <LinearGradient
                            colors={MASK_GRADIENT}
                            locations={[0, 0.2, 0.5, 0.8, 1]}
                            style={StyleSheet.absoluteFillObject}
                        />
                    }
                >
                    <BlurView intensity={80} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
                </MaskedView>
            ) : (
                <LinearGradient
                    colors={isDark ? DARK_GRADIENT : LIGHT_GRADIENT}
                    locations={[0, 0.2, 0.5, 0.8, 1]}
                    style={{ height }}
                />
            )}

        </View>
    );
}

const styles = StyleSheet.create({
    shell: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
    }
});

export default BottomCanopy;
