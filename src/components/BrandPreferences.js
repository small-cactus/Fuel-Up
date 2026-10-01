import { GlassForm as Form, GlassSection as Section } from '../../modules/fuel-up-glass';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Host, ProgressView, Text, Toggle } from '@expo/ui/swift-ui';
import { getFuelGradeMeta } from '../lib/fuelGrade';
import NativeSearchBar from '../../modules/fuel-up-native-search';
import MembershipSection from './memberships/MembershipSection';
import useNearbyBrands from './brands/useNearbyBrands';

const NO_BRANDS = [];
export default function BrandPreferences({ isDark, coordinate, radiusMiles, fuelGrade,
    requiresE85 = false, selectedBrands = NO_BRANDS, onChange, fuelMemberships = NO_BRANDS, onMembershipsChange, isActive = true }) {
    const { options, hasLocation, loading, error, retry } = useNearbyBrands({ coordinate, radiusMiles, fuelGrade, requiresE85, isActive });
    const [search, setSearch] = useState('');
    useEffect(() => { if (!isActive) setSearch(''); }, [isActive]);
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
            <NativeSearchBar style={styles.searchBar} isDark={isDark} active={isActive}
                placeholder="Search preferred brands" onQueryChange={event => setSearch(event.nativeEvent.text)} />
            <Host style={styles.container} colorScheme={isDark ? 'dark' : 'light'}>
                <Form>
                    <MembershipSection hidden={Boolean(search.trim())} coordinate={coordinate} isActive={isActive} selected={fuelMemberships} onChange={onMembershipsChange} />
                    {(!hasLocation || loading || error || !rows.length) && <Section>
                        {!hasLocation && <Text>Enable location to see brands near you. You can choose brands later in Settings.</Text>}
                        {loading && <ProgressView><Text>Finding nearby brands…</Text></ProgressView>}
                        {error && <Text>{error}</Text>}
                        {hasLocation && !loading && !rows.length && <Text>{search.trim() ? 'No matching brands.' : 'No matching stations found within your radius.'}</Text>}
                        {hasLocation && !loading && (error || !options.length) && <Button label="Try Again" systemImage="arrow.clockwise" onPress={retry} />}
                    </Section>}
                    {rows.length > 0 && <Section title="Preferred brands"
                        footer={<Text>{`${getFuelGradeMeta(fuelGrade).label} · Within ${radiusMiles} mi. Favor these by up to 20¢/gal; shown prices stay unchanged.`}</Text>}>
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
    searchBar: { height: 56, marginHorizontal: 12 },
});
