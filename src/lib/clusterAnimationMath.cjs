const CLUSTER_MERGE_LAT_FACTOR = 0.040;
const CLUSTER_MERGE_LNG_FACTOR = 0.16;
const CLUSTER_SPLIT_MULTIPLIER = 1.5;
const CLUSTER_SPREAD_DEADZONE = 0.4;
const COLLAPSED_PRIMARY_WIDTH = 84;
const COLLAPSED_SECONDARY_WIDTH = 44;
const COLLAPSED_BUBBLE_OVERLAP = 8;
const COLLAPSED_BUBBLE_OFFSET = ((COLLAPSED_PRIMARY_WIDTH + COLLAPSED_SECONDARY_WIDTH) / 2) - COLLAPSED_BUBBLE_OVERLAP;
const MORPH_PRICE_REVEAL_START = 0.75;
const MORPH_PRICE_REVEAL_RANGE = 0.25;

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function lerp(start, end, progress) {
    return start + ((end - start) * progress);
}

function projectQuotes(quotes, centerLat, centerLng, ptPerLng, ptPerLat) {
    return quotes.map(quote => {
        const dx = (quote.longitude - centerLng) * ptPerLng;
        const dy = -(quote.latitude - centerLat) * ptPerLat;

        return {
            ...quote,
            dx,
            dy,
            distanceFromCenter: Math.hypot(dx, dy),
        };
    });
}

function pickFarthestSecondary(projectedQuotes) {
    const secondaryQuotes = projectedQuotes.slice(1);

    if (secondaryQuotes.length === 0) {
        return null;
    }

    return secondaryQuotes.reduce((farthestQuote, quote) => (
        quote.distanceFromCenter > farthestQuote.distanceFromCenter ? quote : farthestQuote
    ), secondaryQuotes[0]);
}

function computeSecondaryShellMinWidth(morphProgress) {
    const shellProgress = clamp01(morphProgress / 0.7);
    return lerp(40, 72, shellProgress);
}

function computeEscapingPriceOpacity(morphProgress) {
    return clamp01((morphProgress - 0.6) / 0.4);
}

function computeMorphProgress(spreadProgress) {
    if (spreadProgress <= MORPH_PRICE_REVEAL_START) {
        return 0;
    }

    return clamp01((spreadProgress - MORPH_PRICE_REVEAL_START) / MORPH_PRICE_REVEAL_RANGE);
}

function computeSpreadProgressFromCluster({
    quotes,
    averageLat,
    averageLng,
    mapRegion,
}) {
    if (!mapRegion || !mapRegion.longitudeDelta || quotes.length <= 1) {
        return 0;
    }

    const lngThreshold = mapRegion.longitudeDelta * CLUSTER_MERGE_LNG_FACTOR;
    const latThreshold = mapRegion.latitudeDelta * CLUSTER_MERGE_LAT_FACTOR;
    const splitLngThreshold = lngThreshold * CLUSTER_SPLIT_MULTIPLIER;
    const splitLatThreshold = latThreshold * CLUSTER_SPLIT_MULTIPLIER;
    const maxLngDiff = Math.max(...quotes.map(quote => Math.abs(quote.longitude - averageLng)));
    const maxLatDiff = Math.max(...quotes.map(quote => Math.abs(quote.latitude - averageLat)));
    const ratioLng = splitLngThreshold > 0 ? maxLngDiff / splitLngThreshold : 0;
    const ratioLat = splitLatThreshold > 0 ? maxLatDiff / splitLatThreshold : 0;
    const maxRatio = clamp01(Math.max(ratioLng, ratioLat));

    if (maxRatio <= CLUSTER_SPREAD_DEADZONE) {
        return 0;
    }

    return clamp01((maxRatio - CLUSTER_SPREAD_DEADZONE) / (1 - CLUSTER_SPREAD_DEADZONE));
}

function computeClusterTransitionSnapshot({
    quotes,
    averageLat,
    averageLng,
    mapRegion,
    screenWidth,
    screenHeight,
    spreadProgress,
    morphProgress,
}) {
    const safeSpreadProgress = clamp01(spreadProgress);
    const safeMorphProgress = clamp01(morphProgress);
    const ptPerLng = mapRegion?.longitudeDelta ? screenWidth / mapRegion.longitudeDelta : 0;
    const ptPerLat = mapRegion?.latitudeDelta ? screenHeight / mapRegion.latitudeDelta : 0;
    const projectedQuotes = projectQuotes(quotes, averageLat, averageLng, ptPerLng, ptPerLat);
    const primaryProjectedQuote = projectedQuotes[0] ?? null;
    const emergingProjectedQuote = pickFarthestSecondary(projectedQuotes);
    const remainingProjectedQuotes = emergingProjectedQuote
        ? projectedQuotes.filter((quote, index) => index > 0 && quote.stationId !== emergingProjectedQuote.stationId)
        : [];
    const nextClusterQuotes = emergingProjectedQuote
        ? [quotes[0], ...remainingProjectedQuotes]
        : [quotes[0]];
    const nextClusterAverageLat = nextClusterQuotes.reduce((sum, quote) => sum + quote.latitude, 0) / nextClusterQuotes.length;
    const nextClusterAverageLng = nextClusterQuotes.reduce((sum, quote) => sum + quote.longitude, 0) / nextClusterQuotes.length;
    const nextClusterCenterOffset = {
        x: (nextClusterAverageLng - averageLng) * ptPerLng,
        y: -(nextClusterAverageLat - averageLat) * ptPerLat,
    };
    const nextClusterProjectedQuotes = projectQuotes(
        nextClusterQuotes,
        nextClusterAverageLat,
        nextClusterAverageLng,
        ptPerLng,
        ptPerLat
    );
    const nextClusterPrimaryQuote = nextClusterProjectedQuotes[0] ?? null;
    const nextClusterEmergingQuote = pickFarthestSecondary(nextClusterProjectedQuotes);

    const currentPrimary = {
        x: primaryProjectedQuote ? lerp(0, primaryProjectedQuote.dx, safeSpreadProgress) : 0,
        y: primaryProjectedQuote ? lerp(0, primaryProjectedQuote.dy, safeSpreadProgress) : 0,
    };
    const currentBreakout = {
        x: lerp(COLLAPSED_BUBBLE_OFFSET, emergingProjectedQuote?.dx ?? COLLAPSED_BUBBLE_OFFSET, safeSpreadProgress),
        y: lerp(0, emergingProjectedQuote?.dy ?? 0, safeSpreadProgress),
    };
    const incomingPrimary = {
        x: nextClusterCenterOffset.x + lerp(0, nextClusterPrimaryQuote?.dx ?? 0, safeSpreadProgress),
        y: nextClusterCenterOffset.y + lerp(0, nextClusterPrimaryQuote?.dy ?? 0, safeSpreadProgress),
    };
    const incomingSecondary = {
        x: nextClusterCenterOffset.x + lerp(COLLAPSED_BUBBLE_OFFSET, nextClusterEmergingQuote?.dx ?? COLLAPSED_BUBBLE_OFFSET, safeSpreadProgress),
        y: nextClusterCenterOffset.y + lerp(0, nextClusterEmergingQuote?.dy ?? 0, safeSpreadProgress),
    };
    const outgoingPrimary = {
        x: lerp(currentPrimary.x, incomingPrimary.x, safeSpreadProgress),
        y: lerp(currentPrimary.y, incomingPrimary.y, safeSpreadProgress),
    };
    const outgoingRemainder = {
        x: lerp(currentBreakout.x, incomingSecondary.x, safeSpreadProgress),
        y: lerp(currentBreakout.y, incomingSecondary.y, safeSpreadProgress),
    };
    const secondaryShellMinWidth = computeSecondaryShellMinWidth(safeMorphProgress);
    const escapingPriceOpacity = computeEscapingPriceOpacity(safeMorphProgress);

    return {
        spreadProgress: safeSpreadProgress,
        morphProgress: safeMorphProgress,
        currentPrimary,
        currentBreakout,
        outgoingPrimary,
        outgoingRemainder,
        incomingPrimary,
        incomingSecondary,
        nextClusterCenterOffset,
        outgoingBreakoutPlusCount: Math.max(0, quotes.length - 1),
        outgoingRemainderPlusCount: Math.max(0, nextClusterQuotes.length - 1),
        incomingSecondaryPlusCount: Math.max(0, nextClusterQuotes.length - 1),
        secondaryShellMinWidth,
        escapingPriceOpacity,
        hasRemainderBubble: nextClusterQuotes.length > 1,
        nextClusterQuoteCount: nextClusterQuotes.length,
        nextClusterPrimaryStationId: nextClusterQuotes[0]?.stationId ?? null,
        nextClusterEmergingStationId: nextClusterEmergingQuote?.stationId ?? null,
    };
}

module.exports = {
    CLUSTER_MERGE_LAT_FACTOR,
    CLUSTER_MERGE_LNG_FACTOR,
    CLUSTER_SPLIT_MULTIPLIER,
    CLUSTER_SPREAD_DEADZONE,
    COLLAPSED_PRIMARY_WIDTH,
    COLLAPSED_SECONDARY_WIDTH,
    COLLAPSED_BUBBLE_OFFSET,
    computeClusterTransitionSnapshot,
    computeMorphProgress,
    computeSpreadProgressFromCluster,
};
