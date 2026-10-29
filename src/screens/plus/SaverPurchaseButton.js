import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { GlassView } from 'expo-glass-effect';
import Text from './PaywallText';
import { SaverSurface } from './SuperSaverSurface';

export default function SaverPurchaseButton({ isDark, onPress }) {
    return <View>
        <Pressable accessibilityRole="button" accessibilityLabel="Continue. 19 dollars and 99 cents per year."
            accessibilityHint="Opens a preview confirmation. No purchase will be made." onPress={onPress} testID="plus-preview-continue">
            {({ pressed }) => <View style={styles.shell}>
                <View pointerEvents="none" accessibilityElementsHidden style={[StyleSheet.absoluteFill, { opacity: pressed ? 0.82 : 1 }]}><SaverSurface effect={3} isDark={isDark} style={StyleSheet.absoluteFill} /></View>
                <GlassView glassEffectStyle="clear" isInteractive colorScheme="dark" style={styles.glass}>
                    <Text style={styles.label}>Continue</Text>
                </GlassView>
            </View>}
        </Pressable>
    </View>;
}
const styles = StyleSheet.create({
    shell: { borderRadius: 32, overflow: 'hidden' },
    glass: { minHeight: 62, borderRadius: 32, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', paddingVertical: 15 },
    label: { fontSize: 18, fontWeight: '600', color: '#291801' },
});
