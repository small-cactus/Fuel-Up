import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Button, Form, Host, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { getFuelGradeMeta } from '../lib/fuelGrade';
import useNearbyBrands from './brands/useNearbyBrands';

const NO_BRANDS = [];
export default function BrandPreferences({ isDark, themeColors, coordinate, radiusMiles, fuelGrade,
    requiresE85 = false, selectedBrands = NO_BRANDS, onChange, isActive = true }) {
    const { options, hasLocation, loading, error, retry } = useNearbyBrands({ coordinate, radiusMiles, fuelGrade, requiresE85, isActive });
    const [isSearching, setIsSearching] = useState(false);
    const [search, setSearch] = useState('');
    const selectionRef = useRef(selectedBrands);
    selectionRef.current = selectedBrands;
    const rows = useMemo(() => {
        const known = new Set(options.map(option => option.id));
        // Preserve saved selections even if a brand has no matching station in this area.
        const saved = selectedBrands.filter(id => !known.has(id)).map(id => ({ id, label: id, count: 0 }));
        const term = search.trim().toLocaleLowerCase();
        return [...options, ...saved].filter(option => option.label.toLocaleLowerCase().includes(term));
    }, [options, selectedBrands, search]);
    const setSelected = (id, selected) => {
        const next = selected ? [...new Set([...selectionRef.current, id])] : selectionRef.current.filter(value => value !== id);
        selectionRef.current = next;
        onChange(next);
    };
    return (
        <View style={styles.container}>
            <Host style={styles.searchButton} colorScheme={isDark ? 'dark' : 'light'}>
                <Button label={isSearching ? 'Done Searching' : 'Search Brands'} systemImage={isSearching ? 'checkmark' : 'magnifyingglass'}
                    onPress={() => { setIsSearching(value => !value); setSearch(''); }} />
            </Host>
            {isSearching && (
                // UIKit TextInput is native and avoids the known SwiftUI TextField
                // first-responder crash when hosted inside React Native Fabric.
                <TextInput testID="brand-search" accessibilityLabel="Search station brands" placeholder="Search brands"
                    placeholderTextColor={isDark ? '#8E8E93' : '#636366'} style={[styles.searchInput, {
                        color: themeColors.text, backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF',
                    }]} value={search} onChangeText={setSearch} clearButtonMode="while-editing"
                    autoCorrect={false} autoCapitalize="none" returnKeyType="search" />
            )}
            <Host style={styles.container} colorScheme={isDark ? 'dark' : 'light'}>
                <Form>
                    {(!hasLocation || loading || error || !rows.length) && <Section>
                        {!hasLocation && <Text>Enable location to see brands near you. You can choose brands later in Settings.</Text>}
                        {loading && <ProgressView><Text>Finding nearby brands…</Text></ProgressView>}
                        {error && <Text>{error}</Text>}
                        {hasLocation && !loading && !rows.length && <Text>{search.trim() ? 'No matching brands.' : 'No matching stations found within your radius.'}</Text>}
                        {hasLocation && !loading && (error || !options.length) && <Button label="Try Again" systemImage="arrow.clockwise" onPress={retry} />}
                    </Section>}
                    {rows.length > 0 && <Section title={`${getFuelGradeMeta(fuelGrade).label} · Within ${radiusMiles} mi`}
                        footer={<Text>Preferred brands get a 20¢/gal ranking advantage. Pump prices stay unchanged.</Text>}>
                        {rows.map(brand => (
                            <Toggle key={brand.id} testID={`brand-preference-${brand.id}`} isOn={selectedBrands.includes(brand.id)}
                                onIsOnChange={selected => setSelected(brand.id, selected)}>
                                <Text>{brand.label}</Text>
                                <Text>{brand.count} {brand.count === 1 ? 'station' : 'stations'}</Text>
                            </Toggle>
                        ))}
                    </Section>}
                </Form>
            </Host>
        </View>
    );
}
const styles = StyleSheet.create({
    container: { flex: 1 },
    searchButton: { height: 44, marginHorizontal: 24 },
    searchInput: { minHeight: 44, marginHorizontal: 24, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, fontSize: 17 },
});
