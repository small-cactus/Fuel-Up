import { USER_LOCATION_BUBBLE_SIZE } from './constants.js';
import { CLUSTER_PRIMARY_PILL_WIDTH } from '../../cluster/constants';
import { CLUSTER_TOUCH_PILL_HEIGHT } from '../../cluster/constants';
import { USER_LOCATION_OVERLAP_PILL_WIDTH } from './constants.js';
import { USER_LOCATION_OVERLAP_PILL_HEIGHT } from './constants.js';
import { SUPPRESSION_REVEAL_PADDING } from './constants.js';
import { STATION_FOCUS_MIN_LATITUDE_DELTA } from './constants.js';
import { STATION_FOCUS_MIN_LONGITUDE_DELTA } from './constants.js';
import { STATION_FOCUS_MAX_STEPS } from './constants.js';
import { STATION_FOCUS_ZOOM_STEP_MULTIPLIER } from './constants.js';

export function buildSingleQuoteClusters(stationQuotes) {
    return (stationQuotes || []).map(quote => ({
        quotes: [quote],
        averageLat: quote.latitude,
        averageLng: quote.longitude,
    }));
}

export function doRectsTouch(left, right) {
    return (
        left.left <= right.right &&
        left.right >= right.left &&
        left.top <= right.bottom &&
        left.bottom >= right.top
    );
}

export function expandRect(rect, padding) {
    if (!rect || !Number.isFinite(padding) || padding <= 0) {
        return rect;
    }

    return {
        left: rect.left - padding,
        right: rect.right + padding,
        top: rect.top - padding,
        bottom: rect.bottom + padding,
    };
}

export function areStationIdSetsEqual(left, right) {
    if (left === right) {
        return true;
    }

    if (!left || !right || left.size !== right.size) {
        return false;
    }

    for (const value of left) {
        if (!right.has(value)) {
            return false;
        }
    }

    return true;
}

export function buildSuppressedOverlapStationIds(
    stationQuotes,
    mapRegion,
    screenWidth,
    screenHeight,
    userLocation = null,
    previousSuppressedStationIds = null,
    activeStationId = null
) {
    if (!Array.isArray(stationQuotes) || stationQuotes.length <= 1 || !mapRegion) {
        return new Set();
    }

    const ptPerLng = mapRegion.longitudeDelta ? screenWidth / mapRegion.longitudeDelta : 0;
    const ptPerLat = mapRegion.latitudeDelta ? screenHeight / mapRegion.latitudeDelta : 0;
    const centerLng = mapRegion.longitude || 0;
    const centerLat = mapRegion.latitude || 0;
    const orderedQuotes = [...stationQuotes].sort((left, right) => {
        if (left.price !== right.price) {
            return left.price - right.price;
        }
        return String(left.stationId).localeCompare(String(right.stationId));
    });

    const visibleRects = [];
    const suppressedIds = new Set();
    const previousSuppressedIds = previousSuppressedStationIds instanceof Set
        ? previousSuppressedStationIds
        : new Set(previousSuppressedStationIds || []);
    const normalizedActiveStationId = activeStationId == null ? null : String(activeStationId);
    const hasValidUserLocation = (
        typeof userLocation?.latitude === 'number' &&
        typeof userLocation?.longitude === 'number'
    );
    const userLocationRect = hasValidUserLocation
        ? {
            left: (userLocation.longitude - centerLng) * ptPerLng - USER_LOCATION_BUBBLE_SIZE / 2,
            right: (userLocation.longitude - centerLng) * ptPerLng + USER_LOCATION_BUBBLE_SIZE / 2,
            top: -((userLocation.latitude - centerLat) * ptPerLat) - USER_LOCATION_BUBBLE_SIZE / 2,
            bottom: -((userLocation.latitude - centerLat) * ptPerLat) + USER_LOCATION_BUBBLE_SIZE / 2,
        }
        : null;

    orderedQuotes.forEach(quote => {
        const stationIdString = String(quote.stationId);
        const isActiveStation = normalizedActiveStationId != null &&
            stationIdString === normalizedActiveStationId;
        const x = (quote.longitude - centerLng) * ptPerLng;
        const y = -(quote.latitude - centerLat) * ptPerLat;
        const rect = {
            left: x - CLUSTER_PRIMARY_PILL_WIDTH / 2,
            right: x + CLUSTER_PRIMARY_PILL_WIDTH / 2,
            top: y - CLUSTER_TOUCH_PILL_HEIGHT / 2,
            bottom: y + CLUSTER_TOUCH_PILL_HEIGHT / 2,
        };
        const userOverlapRect = {
            left: x - USER_LOCATION_OVERLAP_PILL_WIDTH / 2,
            right: x + USER_LOCATION_OVERLAP_PILL_WIDTH / 2,
            top: y - USER_LOCATION_OVERLAP_PILL_HEIGHT / 2,
            bottom: y + USER_LOCATION_OVERLAP_PILL_HEIGHT / 2,
        };

        const overlapsVisible = visibleRects.some(visibleRect => doRectsTouch(rect, visibleRect));
        const shouldKeepSuppressedForRevealSpacing = previousSuppressedIds.has(stationIdString) &&
            visibleRects.some(visibleRect => doRectsTouch(rect, expandRect(visibleRect, SUPPRESSION_REVEAL_PADDING)));
        const overlapsUserLocationBubble = userLocationRect
            ? doRectsTouch(userOverlapRect, userLocationRect)
            : false;
        const shouldKeepSuppressedNearUserLocation = previousSuppressedIds.has(stationIdString) && userLocationRect
            ? doRectsTouch(userOverlapRect, expandRect(userLocationRect, SUPPRESSION_REVEAL_PADDING))
            : false;
        // The station the user just explicitly focused (by tapping its marker or
        // scrolling the carousel to it) always bypasses every suppression rule —
        // reveal-spacing stability AND the underlying hard-overlap check. At the
        // densest real-world zoom the map allows, two stations can still sit on top
        // of each other (e.g. adjacent gas stations on opposite corners of an
        // intersection), and without this bypass the chip the user is trying to
        // view would stay stuck hidden. Because ActiveStationOverlay is rendered
        // with a higher z-index than the base StationMarkers, the active pill reads
        // clearly even when the underlying pills visually overlap.
        if (
            !isActiveStation && (
                overlapsVisible ||
                overlapsUserLocationBubble ||
                shouldKeepSuppressedForRevealSpacing ||
                shouldKeepSuppressedNearUserLocation
            )
        ) {
            suppressedIds.add(stationIdString);
            return;
        }

        visibleRects.push(rect);
    });

    return suppressedIds;
}

export function resolveStationFocusZoom({
    targetQuote,
    stationQuotes,
    baseFitRegion,
    screenWidth,
    screenHeight,
    userLocation = null,
}) {
    if (
        !targetQuote ||
        !Array.isArray(stationQuotes) ||
        stationQuotes.length === 0
    ) {
        return {
            latitudeDelta: STATION_FOCUS_MIN_LATITUDE_DELTA,
            longitudeDelta: STATION_FOCUS_MIN_LONGITUDE_DELTA,
        };
    }

    const targetStationId = String(targetQuote.stationId);
    let latitudeDelta = Math.max(
        STATION_FOCUS_MIN_LATITUDE_DELTA,
        Number(baseFitRegion?.latitudeDelta) || STATION_FOCUS_MIN_LATITUDE_DELTA
    );
    let longitudeDelta = Math.max(
        STATION_FOCUS_MIN_LONGITUDE_DELTA,
        Number(baseFitRegion?.longitudeDelta) || STATION_FOCUS_MIN_LONGITUDE_DELTA
    );

    for (let step = 0; step < STATION_FOCUS_MAX_STEPS; step += 1) {
        const candidateRegion = {
            latitude: targetQuote.latitude,
            longitude: targetQuote.longitude,
            latitudeDelta,
            longitudeDelta,
        };
        const suppressedIds = buildSuppressedOverlapStationIds(
            stationQuotes,
            candidateRegion,
            screenWidth,
            screenHeight,
            userLocation
        );

        if (!suppressedIds.has(targetStationId)) {
            return { latitudeDelta, longitudeDelta };
        }

        const nextLatitudeDelta = Math.max(
            STATION_FOCUS_MIN_LATITUDE_DELTA,
            latitudeDelta * STATION_FOCUS_ZOOM_STEP_MULTIPLIER
        );
        const nextLongitudeDelta = Math.max(
            STATION_FOCUS_MIN_LONGITUDE_DELTA,
            longitudeDelta * STATION_FOCUS_ZOOM_STEP_MULTIPLIER
        );

        if (nextLatitudeDelta === latitudeDelta && nextLongitudeDelta === longitudeDelta) {
            break;
        }

        latitudeDelta = nextLatitudeDelta;
        longitudeDelta = nextLongitudeDelta;
    }

    return { latitudeDelta, longitudeDelta };
}

export function buildStationsFitZoomRegion(stationQuotes, fallbackRegion = null) {
    const validQuotes = (stationQuotes || []).filter(quote => (
        Number.isFinite(quote?.latitude) &&
        Number.isFinite(quote?.longitude)
    ));

    if (validQuotes.length === 0) {
        return {
            latitudeDelta: Math.max(
                STATION_FOCUS_MIN_LATITUDE_DELTA,
                Number(fallbackRegion?.latitudeDelta) || STATION_FOCUS_MIN_LATITUDE_DELTA
            ),
            longitudeDelta: Math.max(
                STATION_FOCUS_MIN_LONGITUDE_DELTA,
                Number(fallbackRegion?.longitudeDelta) || STATION_FOCUS_MIN_LONGITUDE_DELTA
            ),
        };
    }

    let minLat = validQuotes[0].latitude;
    let maxLat = validQuotes[0].latitude;
    let minLng = validQuotes[0].longitude;
    let maxLng = validQuotes[0].longitude;

    validQuotes.forEach(quote => {
        minLat = Math.min(minLat, quote.latitude);
        maxLat = Math.max(maxLat, quote.latitude);
        minLng = Math.min(minLng, quote.longitude);
        maxLng = Math.max(maxLng, quote.longitude);
    });

    const latSpan = Math.max(0, maxLat - minLat);
    const lngSpan = Math.max(0, maxLng - minLng);

    return {
        latitudeDelta: Math.max(STATION_FOCUS_MIN_LATITUDE_DELTA, latSpan * 1.55, 0.008),
        longitudeDelta: Math.max(STATION_FOCUS_MIN_LONGITUDE_DELTA, lngSpan * 1.55, 0.008),
    };
}
