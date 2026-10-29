import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import Svg, { Path, Circle } from 'react-native-svg';
import NativeGlassContainer from '../../components/native/NativeGlassContainer';
import { plusPalette } from './presentation';

// Static sample artwork: no location request, station lookup, or alert registration.
export default function PriceAlertIllustration({ isDark, textColor, compact = false }) {
    const colors = plusPalette(isDark);
    return <View style={[styles.scene, compact && { height: 140 }, { backgroundColor: colors.illustration }]}
        accessible accessibilityLabel="Example price-drop alert: your favorite station dropped 12 cents to $3.29 per gallon.">
        <View style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Svg width="100%" height="100%" viewBox="0 0 340 194" preserveAspectRatio="xMidYMid slice">
                <Path d="M-20 162 L100 162 Q136 162 136 126 L136 36 Q136 14 160 14 L360 14 M-10 62 L78 62 Q94 62 94 80 L94 220 M202 -20 L202 220 M270 -20 L270 220 M-10 112 L360 112" stroke={colors.road} strokeWidth={2} fill="none" />
                <Path d="M-20 175 L74 175 Q110 175 110 139 L110 66 Q110 42 136 42 L226 42 Q252 42 252 68" stroke={colors.route} strokeWidth={5} strokeLinecap="round" fill="none" />
                <Circle cx="48" cy="175" r="7" fill={colors.route} />
                <Circle cx="48" cy="175" r="3" fill={colors.illustration} />
            </Svg>
        </View>
        <View style={[styles.pin, compact && { top: 8, right: '12%', width: 36, height: 36, borderRadius: 13 }, { backgroundColor: colors.route }]} accessibilityElementsHidden>
            <SymbolView name="fuelpump.fill" size={24} tintColor={isDark ? '#251C13' : '#FFFFFF'} />
        </View>
        <NativeGlassContainer style={[styles.alert, compact && { padding: 12, bottom: 10, left: 16, right: 16 }, { backgroundColor: colors.surface }]}>
            <View style={styles.alertHeading}>
                <SymbolView name="bell.badge.fill" size={16} tintColor={colors.accent} />
                <Text allowFontScaling={false} style={[styles.kicker, { color: colors.accent }]}>PRICE DROP</Text>
                <Text allowFontScaling={false} style={[styles.now, { color: colors.secondary }]}>now</Text>
            </View>
            <View style={styles.priceRow}>
                <Text allowFontScaling={false} style={[styles.price, { color: textColor }]}>$3.29</Text>
                <Text allowFontScaling={false} style={[styles.drop, { color: colors.green }]}>↓ 12¢</Text>
            </View>
            <Text allowFontScaling={false} style={[styles.station, { color: colors.secondary }]}>Your favorite station · Regular</Text>
        </NativeGlassContainer>
    </View>;
}

const styles = StyleSheet.create({
    scene: { height: 194, borderRadius: 32, overflow: 'hidden', width: '100%' },
    pin: { position: 'absolute', right: '18%', top: 22, width: 48, height: 48, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    alert: { position: 'absolute', left: 22, right: 22, bottom: 16, borderRadius: 24, padding: 16 },
    alertHeading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    kicker: { fontSize: 11, fontWeight: '700', letterSpacing: 1.3 },
    now: { marginLeft: 'auto', fontSize: 12 },
    priceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
    price: { fontSize: 32, fontWeight: '700', letterSpacing: -1 },
    drop: { fontSize: 17, fontWeight: '600' },
    station: { fontSize: 12, marginTop: 2 },
});
