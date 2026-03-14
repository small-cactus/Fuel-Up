export function shouldDelayHomeLaunchReveal({
    usesLaunchBootstrap,
    hasCachedRegion,
    hasManualLocationOverride = false,
}) {
    return Boolean(
        usesLaunchBootstrap &&
        !hasCachedRegion &&
        !hasManualLocationOverride
    );
}

export function canTriggerHomeLaunchReveal({
    hasTriggeredInitialReveal,
    hasCompletedRootReveal,
    isFocused,
    isMapLoaded,
    isLaunchVisualReady,
}) {
    return Boolean(
        !hasTriggeredInitialReveal &&
        !hasCompletedRootReveal &&
        isFocused &&
        isMapLoaded &&
        isLaunchVisualReady
    );
}

export function shouldRevealDuringInitialHomeFit({
    isFirstLaunchWithoutCachedRegion,
    hasTriggeredInitialReveal,
    isLaunchCriticalFitPending,
    shouldAnimateInitialFit,
}) {
    return Boolean(
        isFirstLaunchWithoutCachedRegion &&
        !hasTriggeredInitialReveal &&
        isLaunchCriticalFitPending &&
        shouldAnimateInitialFit
    );
}
