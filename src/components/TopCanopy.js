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

export function TopCanopy({ edgeColor, height, isDark, topInset }) {
    return (
        <View pointerEvents="none" style={[styles.shell, { height }]}>
            {HAS_NATIVE_PROGRESSIVE_BLUR ? (
                <ProgressiveBlurView
                    blurType={isDark ? 'dark' : 'light'}
                    blurAmount={24}
                    direction="blurredTopClearBottom"
                    startOffset={0.0}
                    style={{ height }}
                />
            ) : HAS_NATIVE_MASK ? (
                <MaskedView
                    style={{ height }}
                    maskElement={
                        <LinearGradient
                            colors={MASK_GRADIENT}
                            locations={[0, 0.3, 0.6, 0.9, 1]}
                            style={StyleSheet.absoluteFillObject}
                        />
                    }
                >
                    <BlurView intensity={80} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
                </MaskedView>
            ) : (
                <LinearGradient
                    colors={isDark ? DARK_GRADIENT : LIGHT_GRADIENT}
                    locations={[0, 0.3, 0.6, 0.9, 1]}
                    style={{ height }}
                />
            )}


            <View
                style={[
                    styles.edge,
                    {
                        top: topInset + 10,
                        backgroundColor: edgeColor,
                    },
                ]}
            />
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
    edge: {
        position: 'absolute',
        left: 20,
        right: 20,
        height: StyleSheet.hairlineWidth,
    },
});

export default TopCanopy;
