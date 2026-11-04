import {useEffect, useRef} from 'react';
import {AppState} from 'react-native';
import * as Location from 'expo-location';
import {setPriceWatch, clearPriceWatch} from '../../lib/priceWatchClient';
import {calculateDistanceMiles} from '../../lib/homeState';
import {priceWatchProduct,priceWatchStations} from '../../lib/priceWatchStations';

export default function usePriceWatch({active, manual, preferencesReady, preferences, stations, origin, loaded, error}) {
    const enabled = preferences.priceAlertsEnabled === true;
    const grade = preferences.preferredOctane;
    const radius = preferences.searchRadiusMiles;
    const criteria = JSON.stringify([grade, radius, preferences.requiresE85, preferences.preferredBrands, preferences.fuelMemberships, preferences.minimumRating]);
    const previousCriteria = useRef(criteria);
    useEffect(() => {
        let cancelled=false;
        async function sync() {
            if (!preferencesReady) return;
            if (!enabled || manual) { await clearPriceWatch(); return; }
            if (previousCriteria.current !== criteria) {
                previousCriteria.current = criteria;
                await clearPriceWatch();
                if (cancelled) return;
            }
            if (!loaded || error || !origin || AppState.currentState!=='active') return;
            const product=priceWatchProduct(grade);
            if (!product) return;
            const fix=await Location.getLastKnownPositionAsync({maxAge:3600000});
            if (cancelled) return;
            const distance=fix && calculateDistanceMiles(fix.coords,origin);
            if (!Number.isFinite(distance) || distance>0.25) { await clearPriceWatch(); return; }
            await setPriceWatch(priceWatchStations(stations,grade,radius),product);
        }
        const refresh=()=>{ void sync().catch(()=>{}); };
        refresh();
        const sub=AppState.addEventListener('change',s=>{ if(s==='active')refresh(); });
        return ()=>{cancelled=true;sub.remove();};
    },[active,manual,preferencesReady,enabled,criteria,grade,radius,stations,origin,loaded,error]);
}
