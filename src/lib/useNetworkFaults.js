import { useSyncExternalStore } from 'react';
import { apiTransport } from './apiTransport';
export function setNetworkFaultsEnabled(enabled) {
    apiTransport.setEnabled(enabled);
}
export default function useNetworkFaults() {
    return useSyncExternalStore(apiTransport.subscribe, apiTransport.getSnapshot, apiTransport.getSnapshot);
}
