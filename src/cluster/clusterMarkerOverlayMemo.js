function areCoordinatesEqual(previousCoordinate, nextCoordinate) {
  return (
    previousCoordinate?.latitude === nextCoordinate?.latitude &&
    previousCoordinate?.longitude === nextCoordinate?.longitude
  );
}

function areRegionsEqual(previousRegion, nextRegion) {
  return (
    previousRegion?.latitude === nextRegion?.latitude &&
    previousRegion?.longitude === nextRegion?.longitude &&
    previousRegion?.latitudeDelta === nextRegion?.latitudeDelta &&
    previousRegion?.longitudeDelta === nextRegion?.longitudeDelta
  );
}

export function clusterContainsOriginalIndex(cluster, activeIndex) {
  if (!Number.isInteger(activeIndex) || !Array.isArray(cluster?.quotes)) {
    return false;
  }

  return cluster.quotes.some(quote => quote?.originalIndex === activeIndex);
}

export function didClusterActiveSelectionChange(cluster, previousActiveIndex, nextActiveIndex) {
  if (previousActiveIndex === nextActiveIndex) {
    return false;
  }

  return (
    clusterContainsOriginalIndex(cluster, previousActiveIndex) ||
    clusterContainsOriginalIndex(cluster, nextActiveIndex)
  );
}

export function areClusterMarkerOverlayPropsEqual(previousProps, nextProps) {
  if (previousProps.cluster !== nextProps.cluster) {
    return false;
  }

  if (!areCoordinatesEqual(previousProps.anchorCoordinate, nextProps.anchorCoordinate)) {
    return false;
  }

  if (previousProps.isSuppressed !== nextProps.isSuppressed) {
    return false;
  }

  if (previousProps.scrollX !== nextProps.scrollX) {
    return false;
  }

  if (previousProps.itemWidth !== nextProps.itemWidth) {
    return false;
  }

  if (previousProps.isDark !== nextProps.isDark) {
    return false;
  }

  if (previousProps.themeColors?.text !== nextProps.themeColors?.text) {
    return false;
  }

  if (previousProps.onDebugTransitionEvent !== nextProps.onDebugTransitionEvent) {
    return false;
  }

  if (previousProps.onDebugRenderFrame !== nextProps.onDebugRenderFrame) {
    return false;
  }

  if (previousProps.isDebugWatched !== nextProps.isDebugWatched) {
    return false;
  }

  if (previousProps.isDebugRecording !== nextProps.isDebugRecording) {
    return false;
  }

  if (!areRegionsEqual(previousProps.mapRegion, nextProps.mapRegion)) {
    return false;
  }

  if (previousProps.isMapMoving !== nextProps.isMapMoving) {
    return false;
  }

  return !didClusterActiveSelectionChange(
    nextProps.cluster,
    previousProps.activeIndex,
    nextProps.activeIndex
  );
}
