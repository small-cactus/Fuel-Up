import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

const nativeModule = Platform.OS === 'ios'
    ? requireOptionalNativeModule('FuelUpMapKitRouting')
    : null;

function createUnavailableError() {
    const error = new Error('FuelUpMapKitRouting is unavailable on this platform.');
    error.code = 'ERR_ROUTE_MODULE_UNAVAILABLE';
    return error;
}

export function isFuelUpMapKitRoutingAvailable() {
    return typeof nativeModule?.getDrivingRouteAsync === 'function';
}

export async function getDrivingRouteAsync({ origin, destination }) {
    if (!isFuelUpMapKitRoutingAvailable()) {
        throw createUnavailableError();
    }

    return nativeModule.getDrivingRouteAsync(origin, destination);
}

export default {
    getDrivingRouteAsync,
    isFuelUpMapKitRoutingAvailable,
};
