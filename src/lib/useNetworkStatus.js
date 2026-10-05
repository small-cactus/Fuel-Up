import { useSyncExternalStore } from 'react';
import { networkStatus } from './networkStatus';
import DrivingActivity from '../../modules/fuel-up-driving-activity';

// Native reachability distinguishes a disconnected phone from a server fault.
// Service reports come from the same deadlines as their normal API fallback.
DrivingActivity?.addListener?.('onNetworkStatus', event => {
    if (typeof event.connected === 'boolean') networkStatus.setConnected(event.connected);
    if (event.service) networkStatus.report(event.service, event.status, event.pending || null);
});
DrivingActivity?.getNetworkStatusAsync?.().then(event => {
    if (typeof event.connected === 'boolean') networkStatus.setConnected(event.connected);
}).catch(() => {});
export default function useNetworkStatus() {
    return useSyncExternalStore(networkStatus.subscribe, networkStatus.getSnapshot, networkStatus.getSnapshot);
}
