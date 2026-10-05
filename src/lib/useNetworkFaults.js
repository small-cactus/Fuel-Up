import { useSyncExternalStore } from 'react';
import DrivingActivity from '../../modules/fuel-up-driving-activity';
import { apiTransport } from './apiTransport';
export function setNetworkFaultsEnabled(enabled) {
    apiTransport.setEnabled(enabled);
    DrivingActivity?.setNetworkFaultsEnabled?.(enabled);
}
export default function useNetworkFaults() {
    return useSyncExternalStore(apiTransport.subscribe, apiTransport.getSnapshot, apiTransport.getSnapshot);
}
