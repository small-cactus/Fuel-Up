import test from 'node:test';
import assert from 'node:assert/strict';

import {
    areClusterMarkerOverlayPropsEqual,
    didClusterActiveSelectionChange,
} from '../src/cluster/clusterMarkerOverlayMemo.js';

function buildCluster(originalIndexes) {
    return {
        quotes: originalIndexes.map(originalIndex => ({
            originalIndex,
            stationId: `station-${originalIndex}`,
        })),
    };
}

function buildProps(overrides = {}) {
    return {
        cluster: buildCluster([1, 4]),
        anchorCoordinate: { latitude: 40.7128, longitude: -74.0060 },
        isSuppressed: false,
        scrollX: { value: 0 },
        itemWidth: 320,
        isDark: false,
        themeColors: { text: '#111111' },
        activeIndex: 0,
        onDebugTransitionEvent: () => {},
        onDebugRenderFrame: () => {},
        isDebugWatched: false,
        isDebugRecording: false,
        mapRegion: {
            latitude: 40.7128,
            longitude: -74.0060,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
        },
        isMapMoving: false,
        ...overrides,
    };
}

test('didClusterActiveSelectionChange only flags clusters touched by the old or new active index', () => {
    const cluster = buildCluster([1, 4]);

    assert.equal(didClusterActiveSelectionChange(cluster, 0, 2), false);
    assert.equal(didClusterActiveSelectionChange(cluster, 1, 2), true);
    assert.equal(didClusterActiveSelectionChange(cluster, 2, 4), true);
    assert.equal(didClusterActiveSelectionChange(cluster, 4, 4), false);
});

test('areClusterMarkerOverlayPropsEqual skips rerenders when focus moves between unrelated clusters', () => {
    const previousProps = buildProps({ activeIndex: 0 });
    const nextProps = buildProps({
        cluster: previousProps.cluster,
        scrollX: previousProps.scrollX,
        onDebugTransitionEvent: previousProps.onDebugTransitionEvent,
        onDebugRenderFrame: previousProps.onDebugRenderFrame,
        activeIndex: 2,
    });

    assert.equal(areClusterMarkerOverlayPropsEqual(previousProps, nextProps), true);
});

test('areClusterMarkerOverlayPropsEqual rerenders when the overlay gains or loses the active quote', () => {
    const previousProps = buildProps({ activeIndex: 0 });
    const nextProps = buildProps({
        cluster: previousProps.cluster,
        scrollX: previousProps.scrollX,
        onDebugTransitionEvent: previousProps.onDebugTransitionEvent,
        onDebugRenderFrame: previousProps.onDebugRenderFrame,
        activeIndex: 1,
    });

    assert.equal(areClusterMarkerOverlayPropsEqual(previousProps, nextProps), false);
});
