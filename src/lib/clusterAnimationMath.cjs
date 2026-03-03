const CLUSTER_MERGE_LAT_FACTOR = 0.040;
const CLUSTER_MERGE_LNG_FACTOR = 0.16;
const CLUSTER_SPLIT_MULTIPLIER = 1.5;
const CLUSTER_SPREAD_DEADZONE = 0.15;
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
    return lerp(COLLAPSED_SECONDARY_WIDTH, COLLAPSED_PRIMARY_WIDTH, shellProgress);
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
    const primaryQuote = quotes[0] ?? null;
    const primaryLat = primaryQuote?.latitude ?? averageLat;
    const primaryLng = primaryQuote?.longitude ?? averageLng;
    const projectedQuotes = projectQuotes(quotes, primaryLat, primaryLng, ptPerLng, ptPerLat);
    const emergingProjectedQuote = pickFarthestSecondary(projectedQuotes);
    const remainingQuotes = emergingProjectedQuote
        ? quotes.filter((quote, index) => index > 0 && quote.stationId !== emergingProjectedQuote.stationId)
        : [];
    const nextClusterQuotes = emergingProjectedQuote
        ? [primaryQuote, ...remainingQuotes]
        : [primaryQuote].filter(Boolean);
    const nextClusterAverageLat = nextClusterQuotes.length > 0
        ? nextClusterQuotes.reduce((sum, quote) => sum + quote.latitude, 0) / nextClusterQuotes.length
        : primaryLat;
    const nextClusterAverageLng = nextClusterQuotes.length > 0
        ? nextClusterQuotes.reduce((sum, quote) => sum + quote.longitude, 0) / nextClusterQuotes.length
        : primaryLng;
    const nextClusterProjectedQuotes = projectQuotes(
        nextClusterQuotes,
        primaryLat,
        primaryLng,
        ptPerLng,
        ptPerLat
    );
    const nextClusterEmergingQuote = pickFarthestSecondary(nextClusterProjectedQuotes);

    const currentPrimary = {
        x: 0,
        y: 0,
    };
    const currentBreakout = {
        x: lerp(COLLAPSED_BUBBLE_OFFSET, emergingProjectedQuote?.dx ?? COLLAPSED_BUBBLE_OFFSET, safeSpreadProgress),
        y: lerp(0, emergingProjectedQuote?.dy ?? 0, safeSpreadProgress),
    };
    const incomingPrimary = {
        x: 0,
        y: 0,
    };
    const incomingSecondary = {
        x: lerp(COLLAPSED_BUBBLE_OFFSET, nextClusterEmergingQuote?.dx ?? COLLAPSED_BUBBLE_OFFSET, safeSpreadProgress),
        y: lerp(0, nextClusterEmergingQuote?.dy ?? 0, safeSpreadProgress),
    };
    const outgoingPrimary = {
        x: 0,
        y: 0,
    };
    const outgoingRemainder = {
        x: incomingSecondary.x,
        y: incomingSecondary.y,
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
        nextClusterCenterOffset: {
            x: 0,
            y: 0,
        },
        outgoingBreakoutPlusCount: Math.max(0, quotes.length - 1),
        outgoingRemainderPlusCount: Math.max(0, nextClusterQuotes.length - 1),
        incomingSecondaryPlusCount: Math.max(0, nextClusterQuotes.length - 1),
        secondaryShellMinWidth,
        escapingPriceOpacity,
        hasRemainderBubble: nextClusterQuotes.length > 1,
        nextClusterQuoteCount: nextClusterQuotes.length,
        nextClusterPrimaryStationId: nextClusterQuotes[0]?.stationId ?? null,
        nextClusterEmergingStationId: nextClusterEmergingQuote?.stationId ?? null,
        nextClusterQuotes,
        nextClusterAverageLat,
        nextClusterAverageLng,
    };
}

function computeClusterHandoffDiagnostic({
    quotes,
    averageLat,
    averageLng,
    mapRegion,
    screenWidth,
    screenHeight,
}) {
    if (!quotes || quotes.length <= 1 || !mapRegion) {
        return null;
    }

    const currentResolvedSpread = computeSpreadProgressFromCluster({
        quotes,
        averageLat,
        averageLng,
        mapRegion,
    });
    const currentResolvedMorph = computeMorphProgress(currentResolvedSpread);
    const currentSnapshot = computeClusterTransitionSnapshot({
        quotes,
        averageLat,
        averageLng,
        mapRegion,
        screenWidth,
        screenHeight,
        spreadProgress: currentResolvedSpread,
        morphProgress: currentResolvedMorph,
    });

    if (currentSnapshot.nextClusterQuotes.length <= 0) {
        return null;
    }

    const nextQuotes = currentSnapshot.nextClusterQuotes;
    const nextAverageLat = currentSnapshot.nextClusterAverageLat;
    const nextAverageLng = currentSnapshot.nextClusterAverageLng;
    const nextResolvedSpread = computeSpreadProgressFromCluster({
        quotes: nextQuotes,
        averageLat: nextAverageLat,
        averageLng: nextAverageLng,
        mapRegion,
    });
    const nextResolvedMorph = computeMorphProgress(nextResolvedSpread);
    const nextMountSpread = nextQuotes.length > 1 ? currentResolvedSpread : 0;
    const nextMountMorph = nextQuotes.length > 1 ? currentResolvedMorph : 0;
    const nextMountSnapshot = computeClusterTransitionSnapshot({
        quotes: nextQuotes,
        averageLat: nextAverageLat,
        averageLng: nextAverageLng,
        mapRegion,
        screenWidth,
        screenHeight,
        spreadProgress: nextMountSpread,
        morphProgress: nextMountMorph,
    });
    const nextResolvedSnapshot = computeClusterTransitionSnapshot({
        quotes: nextQuotes,
        averageLat: nextAverageLat,
        averageLng: nextAverageLng,
        mapRegion,
        screenWidth,
        screenHeight,
        spreadProgress: nextResolvedSpread,
        morphProgress: nextResolvedMorph,
    });
    const currentContainerCenter = {
        x: 0,
        y: 0,
        latitude: quotes[0].latitude,
        longitude: quotes[0].longitude,
    };
    const nextContainerCenter = {
        x: 0,
        y: 0,
        latitude: nextQuotes[0]?.latitude ?? quotes[0].latitude,
        longitude: nextQuotes[0]?.longitude ?? quotes[0].longitude,
    };
    const nextMountPrimaryAbsolute = {
        x: nextContainerCenter.x + nextMountSnapshot.outgoingPrimary.x,
        y: nextContainerCenter.y + nextMountSnapshot.outgoingPrimary.y,
    };
    const nextMountSecondaryAbsolute = {
        x: nextContainerCenter.x + nextMountSnapshot.currentBreakout.x,
        y: nextContainerCenter.y + nextMountSnapshot.currentBreakout.y,
    };
    const nextResolvedPrimaryAbsolute = {
        x: nextContainerCenter.x + nextResolvedSnapshot.outgoingPrimary.x,
        y: nextContainerCenter.y + nextResolvedSnapshot.outgoingPrimary.y,
    };
    const nextResolvedSecondaryAbsolute = {
        x: nextContainerCenter.x + nextResolvedSnapshot.currentBreakout.x,
        y: nextContainerCenter.y + nextResolvedSnapshot.currentBreakout.y,
    };

    const primarySwitchDx = nextMountPrimaryAbsolute.x - currentSnapshot.outgoingPrimary.x;
    const primarySwitchDy = nextMountPrimaryAbsolute.y - currentSnapshot.outgoingPrimary.y;
    const primarySwitchDistance = Math.hypot(primarySwitchDx, primarySwitchDy);
    const secondaryCurrentReference = currentSnapshot.hasRemainderBubble
        ? currentSnapshot.outgoingRemainder
        : currentSnapshot.currentBreakout;
    const secondaryNextReference = nextMountSecondaryAbsolute;
    const secondarySwitchDx = secondaryNextReference.x - secondaryCurrentReference.x;
    const secondarySwitchDy = secondaryNextReference.y - secondaryCurrentReference.y;
    const secondarySwitchDistance = Math.hypot(secondarySwitchDx, secondarySwitchDy);
    const shellWidthDelta = nextMountSnapshot.secondaryShellMinWidth - currentSnapshot.secondaryShellMinWidth;
    const nextPrimarySettleDx = nextResolvedPrimaryAbsolute.x - nextMountPrimaryAbsolute.x;
    const nextPrimarySettleDy = nextResolvedPrimaryAbsolute.y - nextMountPrimaryAbsolute.y;
    const nextPrimarySettleDistance = Math.hypot(nextPrimarySettleDx, nextPrimarySettleDy);
    const nextSecondarySettleDx = nextResolvedSecondaryAbsolute.x - nextMountSecondaryAbsolute.x;
    const nextSecondarySettleDy = nextResolvedSecondaryAbsolute.y - nextMountSecondaryAbsolute.y;
    const nextSecondarySettleDistance = Math.hypot(nextSecondarySettleDx, nextSecondarySettleDy);
    const centerShiftDistance = Math.hypot(
        nextContainerCenter.x - currentContainerCenter.x,
        nextContainerCenter.y - currentContainerCenter.y
    );
    const centerShiftLat = nextContainerCenter.latitude - currentContainerCenter.latitude;
    const centerShiftLng = nextContainerCenter.longitude - currentContainerCenter.longitude;

    const causes = [];

    if (Math.abs(nextMountSpread - nextResolvedSpread) > 0.001) {
        causes.push(`incoming cluster keeps prior spread ${nextMountSpread.toFixed(2)} then settles to ${nextResolvedSpread.toFixed(2)}`);
    }
    if (Math.abs(nextMountMorph - nextResolvedMorph) > 0.001) {
        causes.push(`incoming cluster keeps prior morph ${nextMountMorph.toFixed(2)} then settles to ${nextResolvedMorph.toFixed(2)}`);
    }
    if (centerShiftDistance > 0.25) {
        causes.push(`primary anchor shifts ${centerShiftDistance.toFixed(2)}pt when one quote exits`);
    }
    if (primarySwitchDistance > 0.25) {
        causes.push(`primary handoff misses by ${primarySwitchDistance.toFixed(2)}pt at the switch`);
    }
    if (secondarySwitchDistance > 0.25) {
        causes.push(`secondary shell handoff misses by ${secondarySwitchDistance.toFixed(2)}pt at the switch`);
    }
    if (Math.abs(shellWidthDelta) > 0.25) {
        causes.push(`secondary shell width changes by ${shellWidthDelta.toFixed(2)}pt across the switch`);
    }
    if (nextPrimarySettleDistance > 0.25) {
        causes.push(`incoming primary settles another ${nextPrimarySettleDistance.toFixed(2)}pt after mount`);
    }
    if (nextSecondarySettleDistance > 0.25) {
        causes.push(`incoming secondary settles another ${nextSecondarySettleDistance.toFixed(2)}pt after mount`);
    }

    return {
        currentResolvedSpread,
        currentResolvedMorph,
        nextMountSpread,
        nextMountMorph,
        nextResolvedSpread,
        nextResolvedMorph,
        primarySwitchDx,
        primarySwitchDy,
        primarySwitchDistance,
        secondarySwitchDx,
        secondarySwitchDy,
        secondarySwitchDistance,
        shellWidthDelta,
        nextPrimarySettleDistance,
        nextSecondarySettleDistance,
        centerShiftDistance,
        centerShiftLat,
        centerShiftLng,
        currentContainerCenter,
        nextContainerCenter,
        currentPrimaryPosition: currentSnapshot.outgoingPrimary,
        currentSecondaryPosition: secondaryCurrentReference,
        nextMountPrimaryLocal: nextMountSnapshot.outgoingPrimary,
        nextMountSecondaryLocal: nextMountSnapshot.currentBreakout,
        nextMountPrimaryAbsolute,
        nextMountSecondaryAbsolute,
        nextResolvedPrimaryAbsolute,
        nextResolvedSecondaryAbsolute,
        currentPrimaryStartLocal: currentSnapshot.currentPrimary,
        currentSecondaryStartLocal: currentSnapshot.currentBreakout,
        currentRemainderTargetLocal: currentSnapshot.outgoingRemainder,
        plannedPrimaryMove: {
            dx: nextMountPrimaryAbsolute.x - currentSnapshot.currentPrimary.x,
            dy: nextMountPrimaryAbsolute.y - currentSnapshot.currentPrimary.y,
        },
        plannedSecondaryMove: {
            dx: nextMountSecondaryAbsolute.x - currentSnapshot.currentBreakout.x,
            dy: nextMountSecondaryAbsolute.y - currentSnapshot.currentBreakout.y,
        },
        causes,
        summary: causes.length > 0
            ? causes[0]
            : 'No measurable handoff error in the shared math model',
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
    computeClusterHandoffDiagnostic,
    computeClusterTransitionSnapshot,
    computeMorphProgress,
    computeSpreadProgressFromCluster,
};
