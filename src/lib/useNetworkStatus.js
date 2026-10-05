import { useSyncExternalStore } from 'react';
import { networkStatus } from './networkStatus';
import DrivingActivity from '../../modules/fuel-up-driving-activity';

// Native reachability distinguishes a disconnected phone from a server fault.
// The native transport shares the same session-only fault switch.
DrivingActivity?.addListener?.('onNetworkStatus', event => {
    if (typeof event.connected === 'boolean') networkStatus.setConnected(event.connected);
    if (event.service) networkStatus.report(event.service, event.status);
});
DrivingActivity?.getNetworkStatusAsync?.().then(event => {
    if (typeof event.connected === 'boolean') networkStatus.setConnected(event.connected);
}).catch(() => {});
export function setNetworkFaultsEnabled(enabled) {
    networkStatus.setFaultsEnabled(enabled);
    DrivingActivity?.setNetworkFaultsEnabled?.(enabled);
}
export default function useNetworkStatus() {
    return useSyncExternalStore(networkStatus.subscribe, networkStatus.getSnapshot, networkStatus.getSnapshot);
}
