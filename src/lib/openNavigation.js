/**
 * Cross-app navigation helper for opening a station in the user's preferred
 * map app. Supports Apple Maps (default) and Google Maps. Falls back to
 * the system Apple Maps URL scheme if Google Maps isn't installed.
 *
 * Apple's legacy `maps://` URL scheme is documented at
 * https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html
 *
 * Apple's current unified Maps URLs are documented at
 * https://developer.apple.com/documentation/mapkit/unified-map-urls
 *
 * The Google Maps URL scheme is documented at
 * https://developers.google.com/maps/documentation/urls/ios-urlscheme
 *
 * CRITICAL — native Maps handoff vs URL fallback:
 *
 *   The preferred Apple Maps path is a native `MKMapItem.openInMaps`
 *   handoff with a single destination item and driving directions, because
 *   that stays in the iOS Maps app flow instead of constructing directions
 *   through a URL first.
 *
 *   If the native module is unavailable, the current unified Maps URL format
 *   is the best public fallback because it can request navigation when we
 *   pass only a destination and a short `start` delay:
 *
 *   `https://maps.apple.com/directions?destination=lat,lng&mode=driving&start=1`
 *
 *   That matches the requested Fuel Summary card behavior better than
 *   constructing the full route with the legacy `daddr` scheme.
 */

import { Linking } from 'react-native';
import {
    canOpenDrivingDirectionsInMaps,
    openDrivingDirectionsInMapsAsync,
} from './FuelUpMapKitRouting';

export const NAVIGATION_APPS = {
    APPLE_MAPS: 'apple-maps',
    GOOGLE_MAPS: 'google-maps',
};

function toFiniteNumber(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

function buildAppleMapsUrl({ latitude, longitude }) {
    // The unified Apple Maps directions URL opens the navigation flow when we
    // provide a destination-only URL plus a short start delay.
    const params = new URLSearchParams();
    params.set('destination', `${latitude},${longitude}`);
    params.set('mode', 'driving');
    params.set('start', '1');
    return `https://maps.apple.com/directions?${params.toString()}`;
}

function buildAppleMapsLegacyUrl({ latitude, longitude }) {
    // Legacy fallback: keep the older route-preview URL available in case the
    // unified directions path is unavailable on a given device/runtime.
    const params = new URLSearchParams();
    params.set('daddr', `${latitude},${longitude}`);
    params.set('dirflg', 'd');
    return `maps://?${params.toString()}`;
}

function buildGoogleMapsAppUrl({ latitude, longitude, label }) {
    // Google's comgooglemaps:// scheme requires the app to be installed.
    const params = new URLSearchParams();
    params.set('daddr', `${latitude},${longitude}`);
    params.set('directionsmode', 'driving');
    if (label) {
        params.set('q', label);
    }
    return `comgooglemaps://?${params.toString()}`;
}

function buildGoogleMapsWebUrl({ latitude, longitude }) {
    // Universal Google Maps URL — opens in browser if app isn't installed.
    const params = new URLSearchParams();
    params.set('api', '1');
    params.set('destination', `${latitude},${longitude}`);
    params.set('travelmode', 'driving');
    return `https://www.google.com/maps/dir/?${params.toString()}`;
}

async function openUrlSafely(url) {
    try {
        const canOpen = await Linking.canOpenURL(url);
        if (!canOpen) {
            return false;
        }
        await Linking.openURL(url);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Open the user's preferred map app with driving directions to the given
 * latitude/longitude. Returns a boolean for whether navigation was launched.
 */
export async function openStationNavigation({
    latitude,
    longitude,
    label,
    navigationApp,
}) {
    const lat = toFiniteNumber(latitude);
    const lng = toFiniteNumber(longitude);
    if (lat === null || lng === null) {
        return false;
    }

    const sanitizedLabel = typeof label === 'string' ? label.trim() : '';
    const target = sanitizedLabel || null;

    if (navigationApp === NAVIGATION_APPS.GOOGLE_MAPS) {
        const googleAppUrl = buildGoogleMapsAppUrl({
            latitude: lat,
            longitude: lng,
            label: target,
        });
        if (await openUrlSafely(googleAppUrl)) {
            return true;
        }

        const googleWebUrl = buildGoogleMapsWebUrl({
            latitude: lat,
            longitude: lng,
        });
        if (await openUrlSafely(googleWebUrl)) {
            return true;
        }
    }

    if (canOpenDrivingDirectionsInMaps()) {
        try {
            const result = await openDrivingDirectionsInMapsAsync({
                destination: {
                    latitude: lat,
                    longitude: lng,
                    name: target,
                },
            });
            if (result?.opened) {
                return true;
            }
        } catch (error) {
            // Fall through to URL-based Apple Maps launch below.
        }
    }

    // Fallback Apple Maps path: try the unified destination-only directions
    // URL before dropping all the way back to the legacy route preview link.
    const appleSchemeUrl = buildAppleMapsUrl({
        latitude: lat,
        longitude: lng,
    });
    if (await openUrlSafely(appleSchemeUrl)) {
        return true;
    }

    // Final fallback to the older route-preview deep link.
    const appleLegacyUrl = buildAppleMapsLegacyUrl({
        latitude: lat,
        longitude: lng,
    });
    return openUrlSafely(appleLegacyUrl);
}

export {
    buildAppleMapsUrl,
    buildAppleMapsLegacyUrl,
    buildGoogleMapsAppUrl,
    buildGoogleMapsWebUrl,
};
