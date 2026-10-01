import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { supabase } from '../../lib/supabase';
import { normalizeUSState } from '../../lib/usStates';

const stateCache = new Map();
export default function useMembershipOptions(coordinate, active) {
    const latitude = coordinate?.latitude;
    const longitude = coordinate?.longitude;
    // Avoid reverse-geocoding every small GPS adjustment during onboarding.
    const key = Number.isFinite(latitude) && Number.isFinite(longitude) ? `${latitude.toFixed(2)}:${longitude.toFixed(2)}` : '';
    const [result, setResult] = useState(null);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        if (!active || !key) return;
        let cancelled = false;
        void (async () => {
            try {
                const [address] = await Location.reverseGeocodeAsync({ latitude: Number(key.split(':')[0]), longitude: Number(key.split(':')[1]) });
                const state = address?.isoCountryCode === 'US' ? normalizeUSState(address.region) : null;
                if (!state) throw new Error('Your US state could not be found. You can choose memberships later in Settings.');
                let ids = stateCache.get(state);
                if (!ids) {
                    const { data, error } = await supabase.rpc('fuel_memberships_for_state', { p_state: state });
                    if (error || !Array.isArray(data)) throw new Error('Could not load memberships. Try again or choose them later in Settings.');
                    ids = data;
                    stateCache.set(state, ids);
                }
                if (!cancelled) setResult({ key, state, ids });
            } catch (error) {
                if (!cancelled) setResult({ key, error: error.message, ids: [] });
            }
        })();
        return () => { cancelled = true; };
    }, [key, active, attempt]);
    return { ...(result?.key === key ? result : {}), hasLocation: Boolean(key), loading: Boolean(key && result?.key !== key),
        retry: () => { setResult(null); setAttempt(value => value + 1); } };
}
