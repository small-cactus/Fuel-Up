import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, Text, View, ScrollView, Dimensions, ActivityIndicator } from 'react-native';
import { GlassView, GlassContainer } from 'expo-glass-effect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ThemeContext';
import * as Location from 'expo-location';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import * as d3Shape from 'd3-shape';
import * as d3Scale from 'd3-scale';
import { fetchTrendData } from '../../src/services/fuel/trends';
import TopCanopy from '../../src/components/TopCanopy';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_HEIGHT = 220;
const TOP_CANOPY_HEIGHT = 44;

const COLORS = {
    GREEN: '#51CF66',
    RED: '#FF6B6B',
    GREEN_DARK: '#40C057',
    RED_DARK: '#FA5252'
};

function ContainerlessAreaChart({ data, width, height, isDark, trendColor }) {
    if (!data || data.length === 0) return null;

    const margin = { top: 40, right: 0, bottom: 0, left: 0 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const xExtent = [0, data.length - 1];
    const yExtent = [
        Math.min(...data.map(d => d.price)) * 0.99, // slight bottom padding natively
        Math.max(...data.map(d => d.price)) * 1.01
    ];

    const xScale = d3Scale.scaleLinear()
        .domain(xExtent)
        .range([0, chartWidth]);

    const yScale = d3Scale.scaleLinear()
        .domain(yExtent)
        .range([chartHeight, 0]);

    const lineGenerator = d3Shape.line()
        .x((d, i) => xScale(i))
        .y(d => yScale(d.price))
        .curve(d3Shape.curveMonotoneX);

    const areaGenerator = d3Shape.area()
        .x((d, i) => xScale(i))
        .y0(chartHeight)
        .y1(d => yScale(d.price))
        .curve(d3Shape.curveMonotoneX);

    const pathData = lineGenerator(data);
    const areaData = areaGenerator(data);

    return (
        <View style={{ width, height, marginTop: -margin.top }}>
            <Svg width={width} height={height}>
                <Defs>
                    <LinearGradient id="gradientTrend" x1="0%" y1="0%" x2="0%" y2="100%">
                        <Stop offset="0%" stopColor={trendColor} stopOpacity={0.35} />
                        <Stop offset="80%" stopColor={trendColor} stopOpacity={0.05} />
                        <Stop offset="100%" stopColor={trendColor} stopOpacity={0} />
                    </LinearGradient>
                </Defs>
                <Path d={areaData} fill="url(#gradientTrend)" x={margin.left} y={margin.top} />
                <Path d={pathData} fill="none" stroke={trendColor} strokeWidth={3} x={margin.left} y={margin.top} />
            </Svg>
        </View>
    );
}

export default function TrendsScreen() {
    const insets = useSafeAreaInsets();
    const { isDark, themeColors } = useTheme();

    const [loading, setLoading] = useState(true);
    const [trendData, setTrendData] = useState(null);

    useEffect(() => {
        let mounted = true;
        async function loadData() {
            try {
                let { status } = await Location.requestForegroundPermissionsAsync();
                let loc = null;
                if (status === 'granted') {
                    loc = await Location.getCurrentPositionAsync({});
                }

                const lat = loc?.coords?.latitude || 37.3346;
                const lng = loc?.coords?.longitude || -122.009;

                const data = await fetchTrendData({ latitude: lat, longitude: lng });
                if (mounted) {
                    setTrendData(data);
                    setLoading(false);
                }
            } catch (err) {
                console.warn('Error loading trends data', err);
                if (mounted) setLoading(false);
            }
        }
        loadData();
        return () => { mounted = false; };
    }, []);

    const isPriceDrop = trendData?.overallTrend?.isDecrease;
    // Better = Green, Worse = Red
    const primaryTrendColor = isPriceDrop ? COLORS.GREEN : COLORS.RED;
    const secondaryTrendColor = isPriceDrop ? COLORS.GREEN_DARK : COLORS.RED_DARK;

    const glassTintColor = isDark ? '#000000' : '#FFFFFF';
    const canopyEdgeLine = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
    const topCanopyHeight = insets.top + TOP_CANOPY_HEIGHT;

    return (
        <View style={[styles.container, { backgroundColor: themeColors.background }]}>
            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={{ paddingTop: insets.top + 44, paddingBottom: insets.bottom + 80 }}
                showsVerticalScrollIndicator={false}
                bounces={true}
            >
                {loading ? (
                    <View style={{ marginTop: 100 }}>
                        <ActivityIndicator color={themeColors.text} />
                    </View>
                ) : (
                    <View style={styles.contentWrap}>
                        {/* 1. Containerless Area Chart (Bleeding Edges) */}
                        {trendData?.averagePricesByDay?.length > 1 && (
                            <View style={styles.heroGraphSection}>
                                <View style={styles.heroGraphPad}>
                                    <Text style={[styles.heroSub, { color: themeColors.textOpacity }]}>Regional Average</Text>
                                    <View style={styles.heroPriceRow}>
                                        <Text style={[styles.heroPrice, { color: themeColors.text }]}>
                                            ${trendData.averagePricesByDay[trendData.averagePricesByDay.length - 1].price.toFixed(2)}
                                        </Text>
                                        <Text style={[styles.heroDelta, { color: primaryTrendColor }]}>
                                            {trendData.overallTrend.delta > 0 ? '+' : ''}{trendData.overallTrend.delta.toFixed(2)}¢
                                        </Text>
                                    </View>
                                </View>

                                <ContainerlessAreaChart
                                    data={trendData.averagePricesByDay}
                                    width={SCREEN_WIDTH}
                                    height={CHART_HEIGHT}
                                    isDark={isDark}
                                    trendColor={primaryTrendColor}
                                />

                                <View style={styles.heroAxis}>
                                    <Text style={[styles.axisText, { color: themeColors.textOpacity }]}>
                                        {new Date(trendData.averagePricesByDay[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                    </Text>
                                    <Text style={[styles.axisText, { color: themeColors.textOpacity }]}>
                                        {new Date(trendData.averagePricesByDay[trendData.averagePricesByDay.length - 1].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                    </Text>
                                </View>
                            </View>
                        )}

                        <View style={styles.contentPad}>
                            {/* 2. Stations with Largest Delta */}
                            {trendData?.stationsWithLargestDelta?.length > 0 && (
                                <GlassView
                                    style={styles.glassCard}
                                    glassEffectStyle="regular"
                                    tintColor={glassTintColor}
                                >
                                    <Text style={[styles.cardTitle, { color: themeColors.text, marginBottom: 16 }]}>Largest Price Jumps</Text>
                                    {trendData.stationsWithLargestDelta.map((st, idx) => {
                                        // A big delta signifies a big change. Whether the most recent change was up or down determines the color.
                                        // For simplicity, we highlight changes in red if they jumped UP lately, green if DOWN.
                                        const lastJumpAmt = st.prices.length >= 2
                                            ? st.prices[st.prices.length - 1].price - st.prices[st.prices.length - 2].price
                                            : st.delta;

                                        const isHike = lastJumpAmt > 0;
                                        const deltaColor = isHike ? COLORS.RED : COLORS.GREEN;

                                        return (
                                            <View key={st.stationId} style={[styles.listItem, idx > 0 && { borderTopWidth: 1, borderTopColor: isDark ? '#333' : '#EEE' }]}>
                                                <View style={styles.listTextCol}>
                                                    <Text style={[styles.itemName, { color: themeColors.text }]}>{st.name || 'Unknown Station'}</Text>
                                                    <Text style={[styles.itemSub, { color: themeColors.textOpacity }]}>{st.address?.split(',')[0]}</Text>
                                                </View>
                                                <View style={styles.valPill}>
                                                    <Text style={[styles.itemVal, { color: deltaColor }]}>
                                                        {isHike ? '+' : ''}{lastJumpAmt.toFixed(2)}¢
                                                    </Text>
                                                </View>
                                            </View>
                                        );
                                    })}
                                </GlassView>
                            )}

                            {/* 3. Competitor Clusters */}
                            {trendData?.competitorClusters?.length > 0 && (
                                <GlassView
                                    style={[styles.glassCard, { marginTop: 16 }]}
                                    glassEffectStyle="regular"
                                    tintColor={glassTintColor}
                                >
                                    <Text style={[styles.cardTitle, { color: themeColors.text, marginBottom: 4 }]}>Fierce Competitors</Text>
                                    <Text style={[styles.cardSubTitle, { color: themeColors.textOpacity, marginBottom: 16 }]}>Stations battling on the same block</Text>

                                    {trendData.competitorClusters.map((cluster, idx) => (
                                        <View key={`cluster-${idx}`} style={[styles.listItem, idx > 0 && { borderTopWidth: 1, borderTopColor: isDark ? '#333' : '#EEE' }]}>
                                            <View style={styles.listTextCol}>
                                                <Text style={[styles.itemName, { color: themeColors.text }]}>
                                                    {cluster.stations[0].name} vs {cluster.stations[1].name}
                                                </Text>
                                                <Text style={[styles.itemSub, { color: themeColors.textOpacity }]}>
                                                    {cluster.totalUpdates} updates recently
                                                </Text>
                                            </View>
                                            <View style={styles.valPill}>
                                                <Text style={[styles.itemVal, { color: themeColors.text }]}>
                                                    Avg ±{cluster.averageJumpAmount.toFixed(2)}¢
                                                </Text>
                                            </View>
                                        </View>
                                    ))}
                                </GlassView>
                            )}

                            {/* Empty/No Data Fallback */}
                            {!loading && !trendData?.averagePricesByDay?.length && !trendData?.stationsWithLargestDelta?.length && (
                                <View style={styles.emptyState}>
                                    <Text style={[styles.emptyText, { color: themeColors.textOpacity }]}>Not enough historical data collected yet to render trends. Check back soon.</Text>
                                </View>
                            )}
                        </View>
                    </View>
                )}
            </ScrollView>

            <TopCanopy edgeColor={canopyEdgeLine} height={topCanopyHeight} isDark={isDark} topInset={insets.top} />
            <View style={[styles.header, { paddingTop: insets.top }]}>
                <Text style={[styles.headerTitle, { color: themeColors.text }]}>Fuel Up</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
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
    headerTitle: {
        fontSize: 20,
        fontWeight: '700',
        letterSpacing: -0.5,
    },
    scrollView: {
        flex: 1,
    },
    contentWrap: {
        width: '100%',
    },
    heroGraphSection: {
        width: '100%',
        marginBottom: 8,
    },
    heroGraphPad: {
        paddingHorizontal: 24,
        paddingTop: 16,
        paddingBottom: 0,
    },
    heroSub: {
        fontSize: 15,
        fontWeight: '600',
        letterSpacing: -0.3,
        marginBottom: 4,
    },
    heroPriceRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
    },
    heroPrice: {
        fontSize: 42,
        fontWeight: '800',
        letterSpacing: -1.5,
        marginRight: 10,
    },
    heroDelta: {
        fontSize: 20,
        fontWeight: '700',
        letterSpacing: -0.5,
    },
    heroAxis: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 24,
        marginTop: 4,
    },
    axisText: {
        fontSize: 13,
        fontWeight: '600',
    },
    contentPad: {
        padding: 16,
    },
    glassCard: {
        borderRadius: 24,
        padding: 24,
        overflow: 'hidden',
    },
    cardTitle: {
        fontSize: 19,
        fontWeight: '800',
        letterSpacing: -0.5,
    },
    cardSubTitle: {
        fontSize: 14,
        fontWeight: '500',
        letterSpacing: -0.3,
    },
    listItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 14,
    },
    listTextCol: {
        flex: 1,
        paddingRight: 16,
    },
    itemName: {
        fontSize: 16,
        fontWeight: '700',
        letterSpacing: -0.3,
        marginBottom: 4,
    },
    itemSub: {
        fontSize: 14,
        fontWeight: '500',
    },
    valPill: {
        justifyContent: 'center',
    },
    itemVal: {
        fontSize: 17,
        fontWeight: '800',
        letterSpacing: -0.5,
    },
    emptyState: {
        marginTop: 40,
        padding: 20,
        alignItems: 'center',
    },
    emptyText: {
        textAlign: 'center',
        fontSize: 15,
        fontWeight: '500',
        lineHeight: 22,
    }
});
