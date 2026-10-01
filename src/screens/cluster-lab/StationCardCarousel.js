import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, View, useWindowDimensions } from 'react-native';
import GlassActionButton from '../../components/native/GlassActionButton';
import { requireNativeViewManager } from 'expo-modules-core';
import StationPriceCard from './StationPriceCard';
import { pageFromOffset } from './stationCardModel';

const NativePages = requireNativeViewManager('FuelUpMapKitRouting', 'ClusterLabPageControl');

const StationCardCarousel = forwardRef(function StationCardCarousel({ stations, selectedId, active, bottom,
    fuelGrade, isDark, themeColors, onSelect, onNavigate, onHeight, onShowAll, overview }, ref) {
    const { width, height, fontScale } = useWindowDimensions();
    const compact = height < 500;
    const list = useRef(null);
    const programmaticPage = useRef(null);
    const measuredHeights = useRef(new Map());
    const [cardHeight, setCardHeight] = useState(230);
    const [now, setNow] = useState(Date.now);
    const index = Math.max(0, stations.findIndex(station => station.id === selectedId));
    const selected = useRef(index);
    selected.current = index;

    useEffect(() => {
        if (!active) return;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 60000);
        return () => clearInterval(timer);
    }, [active]);

    useLayoutEffect(() => {
        measuredHeights.current.clear();
        list.current?.scrollToOffset({ offset: selected.current * width, animated: false });
    }, [width, fontScale, compact]);

    useImperativeHandle(ref, () => ({
        scrollTo(index, animated = true) {
            programmaticPage.current = index;
            list.current?.scrollToOffset({ offset: index * width, animated });
        },
    }), [width]);

    const choose = page => {
        if (!stations[page]) return;
        programmaticPage.current = page;
        list.current?.scrollToOffset({ offset: page * width, animated: true });
        onSelect(stations[page].id);
    };
    const settle = offset => {
        const page = pageFromOffset(offset, width, stations.length);
        if (page === null) return;
        if (programmaticPage.current !== null) {
            if (page === programmaticPage.current) programmaticPage.current = null;
            return;
        }
        if (page !== selected.current) onSelect(stations[page].id);
    };

    return (
        <View pointerEvents="box-none" style={[styles.overlay, { bottom }]}
            onLayout={event => onHeight(event.nativeEvent.layout.height + bottom)}>
            <View pointerEvents={overview ? 'none' : 'box-none'} accessibilityElementsHidden={overview}
                importantForAccessibility={overview ? 'no-hide-descendants' : 'auto'}
                style={[styles.resetRow, overview && styles.hiddenReset]}>
                <GlassActionButton title="Show all" icon="arrow.up.left.and.arrow.down.right"
                    label="Show all stations" hint="Fits all stations and your location on the map"
                    isDark={isDark} onPress={onShowAll} />
            </View>
            <FlatList key={`${width}:${fontScale}`} ref={list} testID="glass-lab-station-cards" data={stations} horizontal pagingEnabled
                style={{ height: cardHeight, flexGrow: 0 }} contentContainerStyle={styles.items}
                showsHorizontalScrollIndicator={false} keyExtractor={station => station.id}
                getItemLayout={(_, page) => ({ length: width, offset: page * width, index: page })}
                initialScrollIndex={index} initialNumToRender={2} maxToRenderPerBatch={2} windowSize={3}
                onScrollBeginDrag={() => { programmaticPage.current = null; }}
                onMomentumScrollEnd={event => settle(event.nativeEvent.contentOffset.x)}
                onScrollEndDrag={event => {
                    const offset = event.nativeEvent.targetContentOffset?.x;
                    if (Number.isFinite(offset)) settle(offset);
                }}
                renderItem={({ item, index: page }) => <View style={{ width, paddingHorizontal: 16 }}>
                    <StationPriceCard station={item} rank={page + 1} fuelGrade={fuelGrade} isDark={isDark}
                        themeColors={themeColors} compact={compact} now={now} onNavigate={onNavigate}
                        onLayout={event => {
                            const measured = Math.ceil(event.nativeEvent.layout.height);
                            measuredHeights.current.set(item.id, measured);
                            // Card content has no fixed height. Keep neighboring pages aligned.
                            const tallest = Math.max(...measuredHeights.current.values());
                            setCardHeight(value => Math.abs(value - tallest) > 1 ? tallest : value);
                        }} />
                </View>} />
            <NativePages style={styles.pages} pageCount={stations.length} currentPage={index} isDark={isDark}
                onPageChange={event => choose(event.nativeEvent.page)} />
        </View>
    );
});

export default StationCardCarousel;

const styles = StyleSheet.create({
    overlay: { position: 'absolute', left: 0, right: 0 },
    resetRow: { minHeight: 52, paddingBottom: 8, alignItems: 'center' },
    // Preserve the native button's measured height while hiding it. Removing it
    // changes the camera's usable viewport during the Show all flight.
    hiddenReset: { opacity: 0 },
    items: { alignItems: 'flex-start' },
    pages: { height: 44, marginHorizontal: 24 },
});
