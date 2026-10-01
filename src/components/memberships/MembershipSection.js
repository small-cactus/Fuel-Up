import React, { useRef } from 'react';
import { Section, Toggle, Text, ProgressView, Button } from '@expo/ui/swift-ui';
import { FUEL_MEMBERSHIPS } from '../../lib/fuelMemberships';
import useMembershipOptions from './useMembershipOptions';

const EMPTY = [];
export default function MembershipSection({ coordinate, isActive = true, hidden = false, selected = EMPTY, onChange }) {
    const { ids = EMPTY, state, hasLocation, loading, error, retry } = useMembershipOptions(coordinate, isActive);
    const selection = useRef(selected);
    selection.current = selected;
    // A move never discards a saved membership. Keep saved options editable.
    const options = FUEL_MEMBERSHIPS.filter(option => ids.includes(option.id) || selected.includes(option.id));
    // Keep discovery mounted while searching; clearing search must not geocode again.
    if (hidden) return null;
    return (
        <Section title={state ? `Memberships in ${state}` : 'Memberships'}
            footer={<Text>Select the memberships you have. Other member-only stations stay hidden.</Text>}>
            {!hasLocation && <Text>Enable location to find memberships in your state. You can set these later in Settings.</Text>}
            {hasLocation && loading && <ProgressView><Text>Finding memberships…</Text></ProgressView>}
            {error && <Text>{error}</Text>}
            {error && <Button label="Try Again" onPress={retry} />}
            {hasLocation && !loading && !error && !options.length && <Text>No membership gas chains found in your state.</Text>}
            {options.map(option => <Toggle key={option.id} testID={`fuel-membership-${option.id}`} isOn={selected.includes(option.id)}
                onIsOnChange={value => {
                    const next = value ? [...new Set([...selection.current, option.id])] : selection.current.filter(id => id !== option.id);
                    selection.current = next;
                    onChange(next);
                }}><Text>{option.label}</Text>{option.detail && <Text>{option.detail}</Text>}</Toggle>)}
        </Section>
    );
}
