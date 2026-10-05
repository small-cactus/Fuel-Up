import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { supabase } from '../../lib/supabase';
import { normalizeUSState } from '../../lib/usStates';
import { createMembershipRequestCache, membershipCoordinateKey } from './membershipRequestCache';

const requests = createMembershipRequestCache({
    reverseGeocode: coordinate => Location.reverseGeocodeAsync(coordinate),
    fetchMembershipIDs: state => supabase.rpc('fuel_memberships_for_state', { p_state: state }),
    normalizeState: normalizeUSState,
});
export default function useMembershipOptions(coordinate, active) {
    const latitude = coordinate?.latitude;
    const longitude = coordinate?.longitude;
    const key = membershipCoordinateKey(coordinate);
    const [result, setResult] = useState(() => active ? requests.peek(coordinate) : null);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        if (!active || !key) return;
        let cancelled = false;
        void requests.load({ latitude, longitude }).then(
            value => { if (!cancelled) setResult(value); },
            error => { if (!cancelled) setResult({ key, error: error.message, ids: [] }); },
        );
        return () => { cancelled = true; };
    }, [key, latitude, longitude, active, attempt]);
    const retry = useCallback(() => { setResult(null); setAttempt(value => value + 1); }, []);
    return { ...(result?.key === key ? result : {}), hasLocation: Boolean(key), loading: Boolean(key && result?.key !== key),
        retry };
}
