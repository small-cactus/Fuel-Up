import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { getFuelGradeMeta, resolveQuotePriceForFuelGrade } from '../../lib/fuelGrade';
import { stationAge, stationDistance } from './stationCardModel';

function StationPriceCard({ station, rank, fuelGrade, isDark, themeColors, now, compact, onNavigate, onLayout }) {
    const grade = getFuelGradeMeta(fuelGrade);
    const price = resolveQuotePriceForFuelGrade(station, fuelGrade);
    const rating = Number.isFinite(station.rating) ? station.rating.toFixed(1) : null;
    const details = [stationDistance(station.distanceMiles), stationAge(station.updatedAt, now)].filter(Boolean).join(' · ');
    const text = { color: themeColors.text };
    return (
        <GlassView glassEffectStyle="regular" style={styles.glass}>
            <View onLayout={onLayout} style={[styles.content, compact && styles.compact]}>
                <View style={styles.header}>
                    <View style={styles.heading}>
                        <Text style={[styles.name, text]} numberOfLines={1}>{station.name}</Text>
                        <View style={styles.subtitle}>
                            <Text style={[styles.secondary, { color: themeColors.textOpacity }]}>#{rank} · {grade.label}{grade.octane !== grade.label ? ` ${grade.octane}` : ''}</Text>
                            {rating && <View style={styles.rating}>
                                <SymbolView name="star.fill" size={11} tintColor="#FFB800" />
                                <Text style={[styles.secondary, text]}>{rating}</Text>
                            </View>}
                        </View>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Navigate to ${station.name}`}
                        onPress={() => onNavigate(station)} style={({ pressed }) => [styles.go, pressed && styles.pressed]}>
                        <SymbolView name="arrow.up.right" size={15} tintColor="#FFFFFF" />
                        <Text style={styles.goText}>Go</Text>
                    </Pressable>
                </View>
                <View style={styles.priceRow}>
                    <Text style={[styles.price, compact && styles.compactPrice, text]} numberOfLines={1}
                        adjustsFontSizeToFit minimumFontScale={0.7}>${Number.isFinite(price) ? price.toFixed(2) : '--'}</Text>
                    <Text style={[styles.unit, { color: themeColors.textOpacity }]}>/ gal</Text>
                </View>
                {!compact && <>
                    {station.address ? <Text style={[styles.address, text]} numberOfLines={2}>{station.address}</Text> : null}
                    {details ? <Text style={[styles.secondary, { color: themeColors.textOpacity }]} numberOfLines={1}>{details}</Text> : null}
                </>}
            </View>
        </GlassView>
    );
}

export default memo(StationPriceCard);

const styles = StyleSheet.create({
    glass: { borderRadius: 28 },
    content: { padding: 18, gap: 7 },
    compact: { paddingVertical: 12, gap: 3 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    heading: { flex: 1, minWidth: 0, gap: 4 },
    name: { fontSize: 19, fontWeight: '700' },
    subtitle: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    secondary: { fontSize: 12, fontWeight: '500' },
    rating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    go: { minWidth: 70, minHeight: 44, paddingHorizontal: 12, borderRadius: 22,
        backgroundColor: '#248A3D', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5 },
    goText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
    pressed: { opacity: 0.75 },
    priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
    price: { fontSize: 44, fontWeight: '700', letterSpacing: -1.5, flexShrink: 1, fontVariant: ['tabular-nums'] },
    compactPrice: { fontSize: 30 },
    unit: { fontSize: 15 },
    address: { fontSize: 14 },
});
