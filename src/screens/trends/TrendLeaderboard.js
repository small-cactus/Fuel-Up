import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';

export default function TrendLeaderboard({ stations, gradeLabel, updatedLabel, isDark, themeColors }) {
    const { fontScale } = useWindowDimensions();
    const stacked = fontScale > 1.3;
    const textColor = { color: themeColors.text };
    const secondaryColor = { color: themeColors.textOpacity };
    return (
        <GlassView style={styles.card} glassEffectStyle="regular" tintColor={isDark ? '#101010ff' : '#FFFFFF'}>
            <View style={[styles.header, stacked && styles.stacked]}>
                <Text maxFontSizeMultiplier={2} accessibilityRole="header" style={[styles.title, textColor, { fontWeight: isDark ? '700' : '800' }]}>{gradeLabel} Leaderboard</Text>
                <Text style={[styles.updated, secondaryColor]}>Updated {updatedLabel}</Text>
            </View>
            {stations.map((station, index) => {
                const rank = index === 0 ? '1st' : index === 1 ? '2nd' : index === 2 ? '3rd' : `${index + 1}th`;
                const medalColor = index === 0 ? themeColors.text : index === 1 ? '#8f8f8f' : '#CD7F32';
                const shift = Number(station.rankShift) || 0;
                const shiftColor = shift > 0 ? '#51CF66' : shift < 0 ? '#FF6B6B' : themeColors.textOpacity;
                return (
                    <View key={station.stationId} style={[
                        styles.row,
                        stacked && styles.stacked,
                        index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: isDark ? '#333' : '#EEE' },
                    ]}>
                        <View style={[styles.details, stacked && styles.fullWidth]}>
                            <View style={[styles.nameRow, stacked && styles.stacked]}>
                                <Text style={[styles.name, textColor, { fontWeight: isDark ? '600' : '700' }]}>{station.name || 'Unknown Station'}</Text>
                                <View style={styles.rank}>
                                    {index < 3 && <SymbolView name="laurel.leading" tintColor={medalColor} size={30} />}
                                    <Text style={[styles.numeric, { fontSize: index < 3 ? 18 : 13, color: index < 3 ? medalColor : themeColors.textOpacity, fontWeight: isDark ? '600' : '700' }]}>{rank}</Text>
                                    {index < 3 && <SymbolView name="laurel.trailing" tintColor={medalColor} size={30} />}
                                </View>
                            </View>
                            <View style={[styles.addressRow, stacked && styles.stacked]}>
                                <Text style={[styles.address, secondaryColor]}>{station.address?.split(',')[0]}</Text>
                                {Number.isFinite(station.distanceMiles) && (
                                    <View style={styles.distance}>
                                        {!stacked && <Text style={[styles.address, secondaryColor]}>·</Text>}
                                        <SymbolView name="car.fill" tintColor={themeColors.textOpacity} size={18} />
                                        <Text style={[styles.address, styles.numeric, secondaryColor]}>{station.distanceMiles.toFixed(1)} mi</Text>
                                    </View>
                                )}
                            </View>
                        </View>
                        <View style={[styles.priceColumn, stacked && styles.priceRow]}>
                            <Text style={[styles.price, styles.numeric, textColor, { fontWeight: isDark ? '700' : '800' }]}>${station.latestPrice.toFixed(2)}</Text>
                            <View style={styles.shift}>
                                {shift !== 0 && <SymbolView name={shift > 0 ? 'arrow.up' : 'arrow.down'} tintColor={shiftColor} size={13} weight="bold" />}
                                <Text style={[styles.numeric, { fontSize: 13, fontWeight: '600', color: shiftColor }]}>{shift === 0 ? '—' : Math.abs(shift)}</Text>
                            </View>
                        </View>
                    </View>
                );
            })}
        </GlassView>
    );
}

const styles = StyleSheet.create({
    card: { borderRadius: 24, padding: 24, overflow: 'hidden' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 },
    title: { fontSize: 19, letterSpacing: -0.5, flexShrink: 1 },
    updated: { fontSize: 13, fontWeight: '500', flexShrink: 1 },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, gap: 16 },
    details: { flex: 1, minWidth: 0 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    name: { fontSize: 16, letterSpacing: -0.3, flexShrink: 1 },
    rank: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
    addressRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    address: { fontSize: 14, fontWeight: '500', flexShrink: 1 },
    distance: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
    priceColumn: { alignItems: 'flex-end', gap: 4 },
    price: { fontSize: 17, letterSpacing: -0.5 },
    shift: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    numeric: { fontFamily: 'ui-rounded' },
    stacked: { flexDirection: 'column', alignItems: 'flex-start', gap: 8 },
    fullWidth: { flex: 0, width: '100%' },
    priceRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
});
