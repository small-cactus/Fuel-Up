/**
 * Native SwiftUI developer form, matching the settings screen's design.
 *
 * The dev screen previously used a custom drill-down page stack with
 * Pressable rows. This version renders a single flat SwiftUI `Form`
 * with `Section`s, mirroring `NativeSettingsForm` so the two screens
 * share the same look and feel.
 *
 * Every interactive row is a real native SwiftUI primitive (`Picker`,
 * `Toggle`, `Button`, `ProgressView`, `LabeledContent`) so you get
 * native row chevrons, native segmented controls, native pickers, and
 * native destructive button styling automatically.
 *
 * Note: we deliberately do NOT use `@expo/ui`'s SwiftUI `TextField`
 * here — it is a `FocusableView` and trips an `_isAncestorOfFirstResponder`
 * debug assertion in `SwiftUIVirtualViewObjC` when mounted under a
 * React Native Fabric parent, crashing the dev-client at launch. For
 * editing the push title/body we use React Native's `Alert.prompt`
 * (a UIKit alert) instead, wired from `dev.js`.
 *
 * The component's props contract is unchanged: `dev.js` still passes
 * the same `maintenance`, `notifications`, `predictive`, `analysis`,
 * and `simulation` objects it used to assemble.
 */

import React from 'react';
import {
    Button,
    Form,
    Host,
    Label,
    LabeledContent,
    Picker,
    ProgressView,
    Section,
    Text,
    Toggle,
} from '@expo/ui/swift-ui';
import {
    disabled,
    font,
    foregroundStyle,
    monospacedDigit,
    pickerStyle,
    tag,
} from '@expo/ui/swift-ui/modifiers';

const SECONDARY_TEXT = [
    font({ size: 12 }),
    foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
];

const TONE_COLORS = {
    positive: '#34C759',
    warning: '#FF9500',
    danger: '#FF3B30',
};

function Value({ children, tone = 'secondary', mono = false }) {
    const modifiers = [
        font({
            size: mono ? 16 : 17,
            weight: 'semibold',
            design: mono ? 'default' : 'rounded',
        }),
    ];

    if (mono) {
        modifiers.push(monospacedDigit());
    }

    if (TONE_COLORS[tone]) {
        modifiers.push(foregroundStyle(TONE_COLORS[tone]));
    } else {
        modifiers.push(foregroundStyle({ type: 'hierarchical', style: 'secondary' }));
    }

    return <Text modifiers={modifiers}>{children}</Text>;
}

function Footer({ children }) {
    return <Text modifiers={SECONDARY_TEXT}>{children}</Text>;
}

function MonoLine({ children }) {
    return (
        <Text
            modifiers={[
                font({ size: 13, design: 'monospaced' }),
                foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
            ]}
        >
            {children}
        </Text>
    );
}

function confidenceTone(confidence) {
    if (confidence >= 0.72) return 'positive';
    if (confidence >= 0.45) return 'warning';
    return 'secondary';
}

function ensureFn(fn) {
    return typeof fn === 'function' ? fn : () => { };
}

function truncate(value, max) {
    if (typeof value !== 'string' || value.length === 0) {
        return '';
    }
    if (value.length <= max) {
        return value;
    }
    return `${value.slice(0, max).trimEnd()}…`;
}

function formatRelativeTimestamp(timestamp) {
    const numericTimestamp = Number(timestamp);
    if (!Number.isFinite(numericTimestamp) || numericTimestamp <= 0) {
        return 'Never';
    }

    const deltaSeconds = Math.max(0, Math.round((Date.now() - numericTimestamp) / 1000));
    if (deltaSeconds < 10) return 'Just now';
    if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
    if (deltaSeconds < 3600) return `${Math.round(deltaSeconds / 60)}m ago`;
    return `${Math.round(deltaSeconds / 3600)}h ago`;
}

function recommendationPhaseLabel(backend) {
    if (backend?.activeRecommendation) {
        return 'Active';
    }
    if (backend?.pendingRecommendation) {
        return 'Pending';
    }
    return 'Idle';
}

function recommendationPhaseTone(backend) {
    if (backend?.activeRecommendation) {
        return 'positive';
    }
    if (backend?.pendingRecommendation) {
        return 'warning';
    }
    return 'secondary';
}

function formatMotionActivity(activity) {
    if (!activity) {
        return 'None';
    }

    if (activity.automotive) return `Automotive · ${activity.confidence || 'unknown'}`;
    if (activity.cycling) return `Cycling · ${activity.confidence || 'unknown'}`;
    if (activity.walking) return `Walking · ${activity.confidence || 'unknown'}`;
    if (activity.running) return `Running · ${activity.confidence || 'unknown'}`;
    if (activity.stationary) return `Stationary · ${activity.confidence || 'unknown'}`;
    if (activity.unknown) return `Unknown · ${activity.confidence || 'unknown'}`;
    return activity.confidence || 'Unknown';
}

function formatReason(reason) {
    if (!reason) {
        return 'none';
    }

    return String(reason).replace(/[_-]+/g, ' ');
}

function pushDebugPart(parts, label, value) {
    if (value == null || value === '') {
        return;
    }

    parts.push(`${label}=${value}`);
}

function buildDebugLine(title, record, descriptors = []) {
    if (!record) {
        return `${title}: none`;
    }

    const parts = [title];
    pushDebugPart(parts, 'at', formatRelativeTimestamp(record.at));
    pushDebugPart(parts, 'action', record.action);
    pushDebugPart(parts, 'phase', record.phase);
    pushDebugPart(parts, 'outcome', record.outcome);
    pushDebugPart(parts, 'reason', formatReason(record.reason));

    descriptors.forEach(descriptor => {
        const value = typeof descriptor.value === 'function'
            ? descriptor.value(record)
            : record?.[descriptor.key];
        pushDebugPart(parts, descriptor.label || descriptor.key, value);
    });

    return parts.join(' · ');
}

function driveGateLabel(driveGate) {
    if (!driveGate?.started) {
        return 'Stopped';
    }

    if (driveGate?.backendRunning) {
        return 'Promoted';
    }

    if (driveGate?.activityUpdatesRunning) {
        return 'Watching';
    }

    if (driveGate?.motionAvailable && !driveGate?.motionSupported) {
        return 'Unsupported';
    }

    if (driveGate?.motionAuthorizationStatus && driveGate.motionAuthorizationStatus !== 'authorized') {
        return 'Waiting Permission';
    }

    return 'Armed';
}

function driveGateTone(driveGate) {
    if (!driveGate?.started) {
        return 'secondary';
    }

    if (driveGate?.backendRunning || driveGate?.activityUpdatesRunning) {
        return 'positive';
    }

    if (driveGate?.motionAvailable && !driveGate?.motionSupported) {
        return 'warning';
    }

    if (driveGate?.motionAuthorizationStatus && driveGate.motionAuthorizationStatus !== 'authorized') {
        return 'warning';
    }

    return 'secondary';
}

export default function NativeDevForm({
    isDark,
    maintenance,
    notifications,
    predictive,
    analysis,
    simulation,
    liveActivitySim,
}) {
    const batch = analysis.batchResults;
    const fetchStats = simulation.fetchStats;
    const progressValue = predictive.harnessTotal > 0
        ? Math.min(1, predictive.harnessStep / predictive.harnessTotal)
        : 0;
    const hasProgress = predictive.harnessTotal > 0;
    const isPlaying = predictive.harnessPhase === 'playing';
    const isComplete = predictive.harnessPhase === 'complete';

    const profileDescription = simulation.selectedProfileDescription;
    const scenarioFooter = profileDescription
        || 'Pick a driver profile and fill-up history, then estimate range to see urgency output.';
    const backend = predictive.backend;
    const backendDebug = predictive.backendDebug;
    const driveGate = predictive.driveGate;
    const locationDebug = predictive.locationDebug;
    const runtimeDebug = backend?.debug;
    const backendRecommendation = backend?.activeRecommendation || backend?.pendingRecommendation || null;

    return (
        <Host
            style={{ flex: 1 }}
            colorScheme={isDark ? 'dark' : 'light'}
            useViewportSizeMeasurement
            ignoreSafeArea="all"
        >
            <Form>

                {/* ─────────── Predictive Backend ─────────── */}
                <Section
                    title="Predictive Backend"
                    footer={(
                        <Footer>
                            Live runtime state from the background predictive tracking backend: recommendation focus, live activity ownership, learned fueling history, and geofence coverage.
                        </Footer>
                    )}
                >
                    <LabeledContent
                        label={(
                            <Label title="Runtime" systemImage="server.rack" />
                        )}
                    >
                        <Value tone={backend?.isRunning ? 'positive' : 'secondary'}>
                            {backend?.isRunning ? 'Running' : 'Idle'}
                        </Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Drive Gate" systemImage="car.fill" />
                        )}
                    >
                        <Value tone={driveGateTone(driveGate)}>
                            {driveGateLabel(driveGate)}
                        </Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Activity Updates" systemImage="bolt.horizontal.circle" />
                        )}
                    >
                        <Value tone={driveGate?.activityUpdatesRunning ? 'positive' : 'secondary'}>
                            {driveGate?.activityUpdatesRunning ? 'Live' : 'Idle'}
                        </Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Motion Support" systemImage="figure.walk.motion" />
                        )}
                    >
                        <Value tone={driveGate?.motionSupported ? 'positive' : 'warning'}>
                            {driveGate?.motionAvailable
                                ? (driveGate?.motionSupported
                                    ? `Supported · ${driveGate?.motionAuthorizationStatus || 'unknown'}`
                                    : 'Unavailable on this device')
                                : 'Module Unavailable'}
                        </Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Motion Activity" systemImage="waveform.path.ecg" />
                        )}
                    >
                        <Value>{formatMotionActivity(driveGate?.latestActivity)}</Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Last Automotive" systemImage="clock.arrow.trianglehead.counterclockwise.rotate.90" />
                        )}
                    >
                        <Value>{formatRelativeTimestamp(driveGate?.lastAutomotiveAt)}</Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Recommendation" systemImage="sparkles" />
                        )}
                    >
                        <Value tone={recommendationPhaseTone(backend)}>
                            {recommendationPhaseLabel(backend)}
                        </Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Tracking Mode" systemImage="location.circle.fill" />
                        )}
                    >
                        <Value tone={backend?.trackingMode === 'engaged' ? 'warning' : 'secondary'}>
                            {backend?.trackingMode === 'engaged' ? 'Engaged' : 'Monitoring'}
                        </Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Prefetch Cadence" systemImage="timer" />
                        )}
                    >
                        <Value mono>
                            {backend?.prefetchCooldownMs == null
                                ? 'Unknown'
                                : `${Math.round(Number(backend.prefetchCooldownMs) / 1000)}s`}
                        </Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Tracking Reason" systemImage="text.magnifyingglass" />
                        )}
                    >
                        <Value>{formatReason(backend?.trackingReason)}</Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Urgency" systemImage="exclamationmark.triangle.fill" />
                        )}
                    >
                        <Value
                            tone={confidenceTone(Number(backend?.urgency) || 0)}
                            mono
                        >
                            {`${Math.round((Number(backend?.urgency) || 0) * 100)}%`}
                        </Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Station Focus" systemImage="fuelpump.fill" />
                        )}
                    >
                        <Value>
                            {backend?.focusedStationLabel || backendRecommendation?.stationId || 'None'}
                        </Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Attention State" systemImage="eye.fill" />
                        )}
                    >
                        <Value>
                            {backendRecommendation?.presentation?.attentionState || 'None'}
                        </Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Confidence" systemImage="scope" />
                        )}
                    >
                        <Value
                            tone={confidenceTone(Number(backendRecommendation?.confidence) || 0)}
                            mono
                        >
                            {backendRecommendation
                                ? `${Math.round((Number(backendRecommendation.confidence) || 0) * 100)}%`
                                : '0%'}
                        </Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Live Activity" systemImage="waveform" />
                        )}
                    >
                        <Value tone={backend?.liveActivity?.active ? 'positive' : 'secondary'}>
                            {backend?.liveActivity?.active
                                ? `${backend.liveActivity.phase || 'active'} · ${backend.liveActivity.source || 'runtime'}`
                                : 'Idle'}
                        </Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Geofences" systemImage="mappin.and.ellipse" />
                        )}
                    >
                        <Value mono>{String(backend?.geofenceCount || 0)}</Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Known Stations" systemImage="map.fill" />
                        )}
                    >
                        <Value mono>{String(backend?.knownStationCount || 0)}</Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Recent Samples" systemImage="location.fill" />
                        )}
                    >
                        <Value mono>{String(backend?.recentSampleCount || 0)}</Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Arrival Session" systemImage="car.side.fill" />
                        )}
                    >
                        <Value>
                            {backend?.arrivalSession?.stationId || 'None'}
                        </Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Since Fill" systemImage="clock" />
                        )}
                    >
                        <Value mono>
                            {backend?.milesSinceLastFill == null
                                ? 'Unknown'
                                : `${Math.round(Number(backend.milesSinceLastFill))} mi`}
                        </Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Odometer" systemImage="gauge.with.dots.needle.67percent" />
                        )}
                    >
                        <Value mono>
                            {backend?.odometerMiles == null
                                ? 'Unknown'
                                : `${Math.round(Number(backend.odometerMiles)).toLocaleString()} mi`}
                        </Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Visit History" systemImage="person.text.rectangle.fill" />
                        )}
                    >
                        <Value mono>{String(backend?.visitHistoryCount || 0)}</Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Fill History" systemImage="drop.fill" />
                        )}
                    >
                        <Value mono>{String(backend?.fillUpHistoryCount || 0)}</Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Last Processed" systemImage="clock.badge.checkmark.fill" />
                        )}
                    >
                        <Value>{formatRelativeTimestamp(backend?.lastProcessedAt)}</Value>
                    </LabeledContent>

                    <LabeledContent
                        label={(
                            <Label title="Last Alert" systemImage="bell.badge.fill" />
                        )}
                    >
                        <Value>{formatRelativeTimestamp(backend?.lastNotificationAt)}</Value>
                    </LabeledContent>

                    <Button
                        role="destructive"
                        systemImage={backend?.isResetting ? 'hourglass' : 'trash'}
                        onPress={ensureFn(predictive.onResetBackendData)}
                        label={backend?.isResetting ? 'Resetting Predictive Data…' : 'Reset Predictive Fueling Data'}
                        modifiers={backend?.isResetting ? [disabled(true)] : []}
                    />
                </Section>

                <Section
                    title="Predictive Causes"
                    footer={(
                        <Footer>
                            Every meaningful predictive state transition should have a visible cause here. If a row says none, that branch has not fired in this session.
                        </Footer>
                    )}
                >
                    <MonoLine>
                        {buildDebugLine('Drive decision', driveGate?.lastDecision, [
                            { key: 'authorizationStatus', label: 'auth' },
                        ])}
                    </MonoLine>
                    <MonoLine>
                        {buildDebugLine('Drive refresh', driveGate?.lastRefresh, [
                            { key: 'monitoring', label: 'monitoring' },
                            {
                                label: 'activity',
                                value: (record) => formatMotionActivity(record?.latestActivity),
                            },
                        ])}
                    </MonoLine>
                    <MonoLine>
                        {buildDebugLine('Motion support', driveGate?.lastSupportCheck, [
                            { key: 'available', label: 'available' },
                            { key: 'supported', label: 'supported' },
                        ])}
                    </MonoLine>
                    <MonoLine>
                        {buildDebugLine('Backend lifecycle', backendDebug?.lastLifecycle)}
                    </MonoLine>
                    <MonoLine>
                        {buildDebugLine('Queue replay', backendDebug?.lastQueuedDrain, [
                            { key: 'drainedCount', label: 'drained' },
                        ])}
                    </MonoLine>
                    <MonoLine>
                        {buildDebugLine('Location dispatch', locationDebug?.lastDispatch, [
                            { key: 'kind', label: 'kind' },
                            { key: 'path', label: 'path' },
                            { key: 'listenerCount', label: 'listeners' },
                        ])}
                    </MonoLine>
                    <MonoLine>
                        {buildDebugLine('Background gate', locationDebug?.lastBackgroundDecision, [
                            { key: 'kind', label: 'kind' },
                            { key: 'automotive', label: 'automotive' },
                            { key: 'withinGrace', label: 'grace' },
                            { key: 'drivingHeuristic', label: 'speedGate' },
                            { key: 'speedMps', label: 'speed' },
                            { key: 'accuracyMeters', label: 'accuracy' },
                        ])}
                    </MonoLine>
                    <MonoLine>
                        {buildDebugLine('Task payload', locationDebug?.lastTaskPayload, [
                            { key: 'kind', label: 'kind' },
                            { key: 'sampleCount', label: 'samples' },
                            { key: 'speedMps', label: 'speed' },
                            { key: 'accuracyMeters', label: 'accuracy' },
                            { key: 'regionIdentifier', label: 'region' },
                        ])}
                    </MonoLine>
                    <MonoLine>
                        {buildDebugLine('Tracking activation', locationDebug?.lastTrackingActivation, [
                            { key: 'mode', label: 'mode' },
                            { key: 'started', label: 'started' },
                            { key: 'restarted', label: 'restarted' },
                            { key: 'permissionReady', label: 'perm' },
                        ])}
                    </MonoLine>
                    <MonoLine>
                        {buildDebugLine('Location geofences', locationDebug?.lastGeofenceSync, [
                            { key: 'regionCount', label: 'regions' },
                        ])}
                    </MonoLine>
                    <MonoLine>
                        {buildDebugLine('Queue mutation', locationDebug?.lastQueueMutation, [
                            { key: 'action', label: 'action' },
                            { key: 'queueSize', label: 'size' },
                            { key: 'drainedCount', label: 'drained' },
                        ])}
                    </MonoLine>
                    <MonoLine>
                        {`Queue size: ${Number(locationDebug?.queueSize) || 0}`}
                    </MonoLine>
                </Section>

                <Section title="Runtime Causes">
                    <MonoLine>
                        {buildDebugLine('Tracking', runtimeDebug?.lastTrackingDecision, [
                            { key: 'mode', label: 'mode' },
                            { key: 'urgency', label: 'urgency' },
                            { key: 'milesSinceLastFill', label: 'sinceFill' },
                            { key: 'hasActiveRecommendation', label: 'active' },
                            { key: 'hasPendingRecommendation', label: 'pending' },
                            { key: 'hasArrivalSession', label: 'arrival' },
                        ])}
                    </MonoLine>
                    <MonoLine>
                        {buildDebugLine('Location batch', runtimeDebug?.lastLocationBatch, [
                            { key: 'sampleCount', label: 'samples' },
                            { key: 'latestSampleSpeedMps', label: 'speed' },
                            { key: 'latestSampleAccuracyMeters', label: 'accuracy' },
                            { key: 'knownStationCount', label: 'stations' },
                            { key: 'recommendationPhase', label: 'phase' },
                            { key: 'triggeredStationId', label: 'triggered' },
                            { key: 'urgency', label: 'urgency' },
                        ])}
                    </MonoLine>
                    <MonoLine>
                        {buildDebugLine('Prefetch', runtimeDebug?.lastPrefetch, [
                            { key: 'queued', label: 'queued' },
                            { key: 'trajectorySpeedMps', label: 'speed' },
                            { key: 'trajectoryHeading', label: 'heading' },
                            { key: 'topStationCount', label: 'topStations' },
                            { key: 'cooldownMs', label: 'cooldownMs' },
                        ])}
                    </MonoLine>
                    <MonoLine>
                        {buildDebugLine('Recommendation', runtimeDebug?.lastRecommendationDecision, [
                            { key: 'stationId', label: 'station' },
                            { key: 'confidence', label: 'confidence' },
                            { key: 'attentionState', label: 'attention' },
                            { key: 'surfaceNow', label: 'surfaceNow' },
                        ])}
                    </MonoLine>
                    <MonoLine>
                        {buildDebugLine('Notification', runtimeDebug?.lastNotificationDecision, [
                            { key: 'stationId', label: 'station' },
                            { key: 'cooldownRemainingMs', label: 'cooldownLeft' },
                            { key: 'title', label: 'title' },
                        ])}
                    </MonoLine>
                    <MonoLine>
                        {buildDebugLine('Live Activity', runtimeDebug?.lastLiveActivityDecision, [
                            { key: 'stationId', label: 'station' },
                            { key: 'source', label: 'source' },
                            { key: 'phase', label: 'phase' },
                        ])}
                    </MonoLine>
                    <MonoLine>
                        {buildDebugLine('Runtime geofences', runtimeDebug?.lastGeofenceSync, [
                            { key: 'focusStationId', label: 'focus' },
                            { key: 'regionCount', label: 'regions' },
                        ])}
                    </MonoLine>
                    <MonoLine>
                        {buildDebugLine('Geofence event', runtimeDebug?.lastGeofenceEvent, [
                            { key: 'stationId', label: 'station' },
                            { key: 'eventType', label: 'event' },
                            { key: 'dwellMs', label: 'dwellMs' },
                            { key: 'didFuel', label: 'fuel' },
                        ])}
                    </MonoLine>
                    <MonoLine>
                        {buildDebugLine('Persistence', runtimeDebug?.lastPersistence, [
                            { key: 'forced', label: 'forced' },
                            { key: 'persisted', label: 'persisted' },
                        ])}
                    </MonoLine>
                </Section>

                <Section
                    title="Runtime Trace"
                    footer={(
                        <Footer>
                            Recent predictive backend events in execution order.
                        </Footer>
                    )}
                >
                    {(Array.isArray(runtimeDebug?.trace) && runtimeDebug.trace.length > 0)
                        ? runtimeDebug.trace.slice().reverse().map((entry, index) => (
                            <MonoLine key={`predictive-trace-${index}`}>
                                {buildDebugLine(entry.type || 'event', entry, [
                                    { key: 'stationId', label: 'station' },
                                    { key: 'sampleCount', label: 'samples' },
                                    { key: 'recommendationPhase', label: 'phase' },
                                    { key: 'regionCount', label: 'regions' },
                                    { key: 'didFuel', label: 'fuel' },
                                ])}
                            </MonoLine>
                        ))
                        : (
                            <MonoLine>No predictive trace yet.</MonoLine>
                        )}
                </Section>

                {/* ─────────── Fuel Refresh ─────────── */}
                <Section
                    title="Fuel Refresh"
                    footer={(
                        <Footer>
                            Runs the full hourly refresh pipeline against GasBuddy live. Updates the API counters below on completion.
                        </Footer>
                    )}
                >
                    <Button
                        systemImage={maintenance.isRefreshingFuel ? 'hourglass' : 'arrow.clockwise.circle.fill'}
                        onPress={ensureFn(maintenance.onRunHourlyRefreshPath)}
                        label={maintenance.isRefreshingFuel ? 'Running Hourly Refresh…' : 'Run Hourly Refresh'}
                        modifiers={maintenance.isRefreshingFuel ? [disabled(true)] : []}
                    />
                </Section>

                {/* ─────────── API Counters ─────────── */}
                <Section
                    title="API Counters"
                    footer={(
                        <Footer>
                            Per-provider call counts for this session. Reset between test runs to isolate the calls a single flow makes.
                        </Footer>
                    )}
                >
                    {maintenance.apiCounterRows.map(counter => (
                        <LabeledContent
                            key={counter.key}
                            label={(
                                <Label title={counter.label} systemImage="number.circle.fill" />
                            )}
                        >
                            <Value mono>{String(counter.value)}</Value>
                        </LabeledContent>
                    ))}
                    <Button
                        role="destructive"
                        systemImage="arrow.counterclockwise"
                        onPress={ensureFn(maintenance.onResetCounters)}
                        label="Reset Counters"
                    />
                </Section>

                {/* ─────────── Predictive Playback ─────────── */}
                <Section
                    title="Predictive Playback"
                    footer={(
                        <Footer>
                            Replays a scripted route through the fueling engine. Live confidence updates below as the harness advances.
                        </Footer>
                    )}
                >
                    <Picker
                        label="Route"
                        systemImage="point.bottomleft.forward.to.point.topright.scurvepath"
                        selection={predictive.selectedRouteId}
                        modifiers={[pickerStyle('menu')]}
                        onSelectionChange={ensureFn(predictive.onSelectRoute)}
                    >
                        {predictive.routeOptions.map(option => (
                            <Text key={option.key} modifiers={[tag(option.key)]}>
                                {option.label}
                            </Text>
                        ))}
                    </Picker>

                    <Picker
                        label="Speed"
                        systemImage="gauge.with.needle"
                        selection={predictive.speedMult}
                        modifiers={[pickerStyle('segmented')]}
                        onSelectionChange={ensureFn(predictive.onSelectSpeed)}
                    >
                        {predictive.speedOptions.map(option => (
                            <Text key={option.key} modifiers={[tag(option.key)]}>
                                {option.label}
                            </Text>
                        ))}
                    </Picker>

                    <LabeledContent
                        label={(
                            <Label title="Step" systemImage="figure.walk.motion" />
                        )}
                    >
                        <Value mono>
                            {isComplete
                                ? 'Complete'
                                : `${predictive.harnessStep} / ${predictive.harnessTotal || 0}`}
                        </Value>
                    </LabeledContent>

                    {hasProgress ? (
                        <ProgressView value={progressValue} />
                    ) : null}

                    <LabeledContent
                        label={(
                            <Label title="State" systemImage="waveform.path.ecg" />
                        )}
                    >
                        <Value tone={isComplete ? 'positive' : isPlaying ? 'warning' : 'secondary'}>
                            {predictive.harnessPhase}
                        </Value>
                    </LabeledContent>

                    {isPlaying ? (
                        <Button
                            systemImage="pause.circle.fill"
                            onPress={ensureFn(predictive.onPause)}
                            label="Pause Playback"
                        />
                    ) : (
                        <Button
                            systemImage="play.circle.fill"
                            onPress={ensureFn(predictive.onPlay)}
                            label={isComplete ? 'Replay Route' : 'Play Route'}
                        />
                    )}

                    <Button
                        role="destructive"
                        systemImage="arrow.counterclockwise"
                        onPress={ensureFn(predictive.onReset)}
                        label="Reset Harness"
                    />
                </Section>

                {/* ─────────── Live Confidence ─────────── */}
                <Section
                    title="Live Confidence"
                    footer={(
                        <Footer>
                            Green ≥ 72% likely to trigger · Orange ≥ 45% marginal · Gray unlikely. Play a route above to populate this list.
                        </Footer>
                    )}
                >
                    {analysis.stationScores.length ? (
                        analysis.stationScores.map(score => (
                            <LabeledContent
                                key={score.stationId}
                                label={(
                                    <Label
                                        title={analysis.stationNameForId(score.stationId)}
                                        systemImage="fuelpump.fill"
                                    />
                                )}
                            >
                                <Value tone={confidenceTone(score.confidence)} mono>
                                    {`${Math.round(score.confidence * 100)}%`}
                                </Value>
                            </LabeledContent>
                        ))
                    ) : (
                        <Text modifiers={SECONDARY_TEXT}>
                            No confidence data yet.
                        </Text>
                    )}
                </Section>

                {/* ─────────── Recent Triggers (only when populated) ─────────── */}
                {analysis.triggerLog.length > 0 ? (
                    <Section title="Recent Triggers">
                        {analysis.triggerLog.map((entry, index) => (
                            <LabeledContent
                                key={`trigger-${entry.time}-${index}`}
                                label={(
                                    <Label
                                        title={analysis.stationNameForId(entry.stationId)}
                                        systemImage="bolt.fill"
                                    />
                                )}
                            >
                                <Value mono>{`${entry.confidence} · ${entry.time}`}</Value>
                            </LabeledContent>
                        ))}
                    </Section>
                ) : null}

                {/* ─────────── Batch Accuracy ─────────── */}
                <Section
                    title="Batch Accuracy"
                    footer={(
                        <Footer>
                            Runs every route with the current engine and tallies hits, false positives, and false negatives.
                        </Footer>
                    )}
                >
                    <Button
                        systemImage={analysis.isBatchRunning ? 'hourglass' : 'rectangle.stack.badge.play.fill'}
                        onPress={ensureFn(analysis.onRunBatch)}
                        label={
                            analysis.isBatchRunning
                                ? 'Running Batch…'
                                : `Run All ${analysis.batchRouteCount} Routes`
                        }
                        modifiers={analysis.isBatchRunning ? [disabled(true)] : []}
                    />

                    {batch ? (
                        <>
                            <LabeledContent
                                label={(
                                    <Label title="Accuracy" systemImage="target" />
                                )}
                            >
                                <Value tone="positive" mono>
                                    {`${batch.correctPredictions}/${batch.totalRoutes} (${batch.accuracyPercent}%)`}
                                </Value>
                            </LabeledContent>
                            <LabeledContent
                                label={(
                                    <Label title="False Positives" systemImage="exclamationmark.triangle.fill" />
                                )}
                            >
                                <Value tone="warning" mono>{String(batch.falsePositives)}</Value>
                            </LabeledContent>
                            <LabeledContent
                                label={(
                                    <Label title="False Negatives" systemImage="xmark.octagon.fill" />
                                )}
                            >
                                <Value tone="danger" mono>{String(batch.falseNegatives)}</Value>
                            </LabeledContent>
                        </>
                    ) : null}
                </Section>

                {/* ─────────── Model Tuning ─────────── */}
                <Section
                    title="Model Tuning"
                    footer={(
                        <Footer>
                            Compare heuristic vs ML classifiers. Grid search scans threshold, window, and bearing weight for the best F1.
                        </Footer>
                    )}
                >
                    <Picker
                        label="Prediction Mode"
                        systemImage="brain"
                        selection={analysis.predictionMode}
                        modifiers={[pickerStyle('segmented')]}
                        onSelectionChange={ensureFn(analysis.onSetPredictionMode)}
                    >
                        {analysis.predictionModeOptions.map(option => (
                            <Text key={option.key} modifiers={[tag(option.key)]}>
                                {option.label}
                            </Text>
                        ))}
                    </Picker>

                    {analysis.predictionMode === 'ml' ? (
                        <Button
                            systemImage={analysis.mlStatus === 'training' ? 'hourglass' : 'cpu.fill'}
                            onPress={ensureFn(analysis.onTrainModel)}
                            label={
                                analysis.mlStatus === 'training'
                                    ? 'Training Model…'
                                    : analysis.mlStatus === 'trained'
                                        ? 'Retrain Model'
                                        : 'Train Model'
                            }
                            modifiers={analysis.mlStatus === 'training' ? [disabled(true)] : []}
                        />
                    ) : null}

                    <Button
                        systemImage={analysis.isGridSearching ? 'hourglass' : 'square.grid.3x3.square'}
                        onPress={ensureFn(analysis.onRunGridSearch)}
                        label={analysis.isGridSearching ? 'Searching…' : 'Grid Search'}
                        modifiers={analysis.isGridSearching ? [disabled(true)] : []}
                    />

                    {analysis.heuristicPRF1 && analysis.mlMetrics ? (
                        <>
                            <LabeledContent
                                label={(
                                    <Label title="Precision" systemImage="scope" />
                                )}
                            >
                                <Value mono>
                                    {`H ${analysis.heuristicPRF1.precision} · ML ${analysis.mlMetrics.precision}`}
                                </Value>
                            </LabeledContent>
                            <LabeledContent
                                label={(
                                    <Label title="Recall" systemImage="arrow.triangle.2.circlepath" />
                                )}
                            >
                                <Value mono>
                                    {`H ${analysis.heuristicPRF1.recall} · ML ${analysis.mlMetrics.recall}`}
                                </Value>
                            </LabeledContent>
                            <LabeledContent
                                label={(
                                    <Label title="F1" systemImage="star.leadinghalf.filled" />
                                )}
                            >
                                <Value mono>
                                    {`H ${analysis.heuristicPRF1.f1} · ML ${analysis.mlMetrics.f1}`}
                                </Value>
                            </LabeledContent>
                            <LabeledContent
                                label={(
                                    <Label title="Accuracy" systemImage="checkmark.seal.fill" />
                                )}
                            >
                                <Value tone="positive" mono>
                                    {`H ${analysis.heuristicPRF1.accuracy}% · ML ${analysis.mlMetrics.accuracy}%`}
                                </Value>
                            </LabeledContent>
                        </>
                    ) : null}

                    {analysis.gridSearchResults?.best ? (
                        <>
                            <LabeledContent
                                label={(
                                    <Label title="Best Threshold" systemImage="slider.horizontal.3" />
                                )}
                            >
                                <Value mono>{String(analysis.gridSearchResults.best.params.threshold)}</Value>
                            </LabeledContent>
                            <LabeledContent
                                label={(
                                    <Label title="Window Size" systemImage="rectangle.and.text.magnifyingglass" />
                                )}
                            >
                                <Value mono>{String(analysis.gridSearchResults.best.params.windowSize)}</Value>
                            </LabeledContent>
                            <LabeledContent
                                label={(
                                    <Label title="Bearing Weight" systemImage="location.north.line.fill" />
                                )}
                            >
                                <Value mono>{String(analysis.gridSearchResults.best.params.bearingWeight)}</Value>
                            </LabeledContent>
                        </>
                    ) : null}
                </Section>

                {/* ─────────── Local Push ─────────── */}
                <Section
                    title="Local Push"
                    footer={(
                        <Footer>
                            Tap Title or Body to edit via a native prompt. Use the 5-second delayed variant to background the app before it fires.
                        </Footer>
                    )}
                >
                    <LabeledContent
                        label={(
                            <Label title="Title" systemImage="textformat" />
                        )}
                    >
                        <Value>{notifications.testTitle || 'Test Push'}</Value>
                    </LabeledContent>
                    <Button
                        systemImage="square.and.pencil"
                        onPress={ensureFn(notifications.onEditTitle)}
                        label="Edit Title"
                    />

                    <LabeledContent
                        label={(
                            <Label title="Body" systemImage="text.alignleft" />
                        )}
                    >
                        <Value>{truncate(notifications.testBody, 28) || 'Default body'}</Value>
                    </LabeledContent>
                    <Button
                        systemImage="square.and.pencil"
                        onPress={ensureFn(notifications.onEditBody)}
                        label="Edit Body"
                    />

                    <Button
                        systemImage="bell.fill"
                        onPress={ensureFn(notifications.onSendNow)}
                        label="Send Now"
                    />
                    <Button
                        systemImage="bell.badge.fill"
                        onPress={ensureFn(notifications.onSendDelayed)}
                        label="Send in 5 Seconds"
                    />
                </Section>

                {/* ─────────── Live Activity ─────────── */}
                <Section
                    title="Live Activity"
                    footer={(
                        <Footer>
                            Tests the Price Drop Live Activity lifecycle. Start, update to a lower price, then end from here or the lock screen.
                        </Footer>
                    )}
                >
                    <LabeledContent
                        label={(
                            <Label title="Status" systemImage="waveform" />
                        )}
                    >
                        <Value tone={notifications.liveActivityActive ? 'positive' : 'secondary'}>
                            {notifications.liveActivityActive ? 'Active' : 'Idle'}
                        </Value>
                    </LabeledContent>

                    <Button
                        systemImage="play.circle.fill"
                        onPress={ensureFn(notifications.onStartLiveActivity)}
                        label="Start Price Drop Activity"
                    />
                    <Button
                        systemImage="arrow.down.circle.fill"
                        onPress={ensureFn(notifications.onUpdateLiveActivity)}
                        label="Update to $2.85"
                        modifiers={notifications.liveActivityActive ? [] : [disabled(true)]}
                    />
                    <Button
                        role="destructive"
                        systemImage="stop.circle.fill"
                        onPress={ensureFn(notifications.onEndLiveActivity)}
                        label="End Activity"
                        modifiers={notifications.liveActivityActive ? [] : [disabled(true)]}
                    />
                    <Button
                        systemImage="paintpalette.fill"
                        onPress={ensureFn(notifications.onOpenLiveActivityDesigner)}
                        label="Open Design Previewer"
                    />
                </Section>

                {/* ─────────── Predictive Drive Simulation ───────────
                 *
                 * Dedicated test surface for the predictive fueling Live
                 * Activity. Pick a scenario, hit Start, and the sim
                 * advances a fake driver toward a station once per
                 * second — distance, ETA, and the progress bar all tick
                 * forward so you can verify the layout under motion on
                 * the lock screen and Dynamic Island.
                 */}
                {liveActivitySim ? (
                    <Section
                        title="Predictive Drive Simulation"
                        footer={(
                            <Footer>
                                Starts a real Live Activity and advances it once a
                                second over the scenario's drive time. Swipe to the
                                lock screen to see the banner, or pull down the
                                Dynamic Island to see the expanded layout.
                            </Footer>
                        )}
                    >
                        <Picker
                            label="Scenario"
                            systemImage="map.fill"
                            selection={liveActivitySim.scenarioId}
                            modifiers={[pickerStyle('menu')]}
                            onSelectionChange={ensureFn(liveActivitySim.onSelectScenario)}
                        >
                            {liveActivitySim.scenarioOptions.map(option => (
                                <Text key={option.key} modifiers={[tag(option.key)]}>
                                    {option.label}
                                </Text>
                            ))}
                        </Picker>

                        <LabeledContent
                            label={(
                                <Label title="State" systemImage="waveform.path.ecg" />
                            )}
                        >
                            <Value
                                tone={
                                    liveActivitySim.isComplete
                                        ? 'positive'
                                        : liveActivitySim.isRunning
                                            ? 'warning'
                                            : liveActivitySim.isPaused
                                                ? 'warning'
                                                : 'secondary'
                                }
                            >
                                {liveActivitySim.phase}
                            </Value>
                        </LabeledContent>

                        {liveActivitySim.state ? (
                            <>
                                <LabeledContent
                                    label={(
                                        <Label title="Station" systemImage="fuelpump.fill" />
                                    )}
                                >
                                    <Value>{liveActivitySim.state.stationName}</Value>
                                </LabeledContent>
                                <LabeledContent
                                    label={(
                                        <Label title="Price" systemImage="dollarsign.circle.fill" />
                                    )}
                                >
                                    <Value tone="positive" mono>
                                        {`$${liveActivitySim.state.price}/gal`}
                                    </Value>
                                </LabeledContent>
                                <LabeledContent
                                    label={(
                                        <Label title="Savings" systemImage="arrow.down.circle.fill" />
                                    )}
                                >
                                    <Value
                                        tone={liveActivitySim.state.savingsPerGallon ? 'positive' : 'secondary'}
                                        mono
                                    >
                                        {liveActivitySim.state.savingsPerGallon
                                            ? `$${liveActivitySim.state.savingsPerGallon}/gal · $${liveActivitySim.state.totalSavings || '0.00'} total`
                                            : 'none'}
                                    </Value>
                                </LabeledContent>
                                <LabeledContent
                                    label={(
                                        <Label title="Distance" systemImage="arrow.left.and.right" />
                                    )}
                                >
                                    <Value mono>{`${liveActivitySim.state.distanceMiles} mi`}</Value>
                                </LabeledContent>
                                <LabeledContent
                                    label={(
                                        <Label title="ETA" systemImage="clock.fill" />
                                    )}
                                >
                                    <Value mono>{`${liveActivitySim.state.etaMinutes} min`}</Value>
                                </LabeledContent>
                                <LabeledContent
                                    label={(
                                        <Label title="Status" systemImage="location.fill" />
                                    )}
                                >
                                    <Value
                                        tone={
                                            liveActivitySim.state.phase === 'arrived'
                                                ? 'positive'
                                                : liveActivitySim.state.phase === 'arriving'
                                                    ? 'warning'
                                                    : 'secondary'
                                        }
                                    >
                                        {liveActivitySim.state.status}
                                    </Value>
                                </LabeledContent>
                                <ProgressView value={Math.max(0, Math.min(1, liveActivitySim.state.progress || 0))} />
                            </>
                        ) : (
                            <Text modifiers={SECONDARY_TEXT}>
                                Pick a scenario and hit Start Drive Simulation.
                            </Text>
                        )}

                        {liveActivitySim.isRunning ? (
                            <Button
                                systemImage="pause.circle.fill"
                                onPress={ensureFn(liveActivitySim.onPause)}
                                label="Pause Simulation"
                            />
                        ) : liveActivitySim.isPaused ? (
                            <Button
                                systemImage="play.circle.fill"
                                onPress={ensureFn(liveActivitySim.onResume)}
                                label="Resume Simulation"
                            />
                        ) : (
                            <Button
                                systemImage="play.circle.fill"
                                onPress={ensureFn(liveActivitySim.onStart)}
                                label={
                                    liveActivitySim.isComplete
                                        ? 'Restart Simulation'
                                        : 'Start Drive Simulation'
                                }
                            />
                        )}

                        <Button
                            role="destructive"
                            systemImage="stop.circle.fill"
                            onPress={ensureFn(liveActivitySim.onStop)}
                            label="End Simulation"
                            modifiers={
                                liveActivitySim.phase === 'idle'
                                    ? [disabled(true)]
                                    : []
                            }
                        />
                    </Section>
                ) : null}

                {/* ─────────── Scenario Lab ─────────── */}
                <Section
                    title="Scenario Lab"
                    footer={(
                        <Footer>
                            {scenarioFooter}
                        </Footer>
                    )}
                >
                    <Picker
                        label="Driver Profile"
                        systemImage="person.crop.circle.fill"
                        selection={simulation.selectedProfileId}
                        modifiers={[pickerStyle('menu')]}
                        onSelectionChange={ensureFn(simulation.onSelectProfile)}
                    >
                        {simulation.profileOptions.map(option => (
                            <Text key={option.key} modifiers={[tag(option.key)]}>
                                {option.label}
                            </Text>
                        ))}
                    </Picker>

                    <Picker
                        label="Fill-Up History"
                        systemImage="clock.arrow.circlepath"
                        selection={simulation.fillUpHistoryKey}
                        modifiers={[pickerStyle('menu')]}
                        onSelectionChange={ensureFn(simulation.onSelectFillUpHistory)}
                    >
                        {simulation.fillUpHistoryOptions.map(option => (
                            <Text key={option.key} modifiers={[tag(option.key)]}>
                                {option.label}
                            </Text>
                        ))}
                    </Picker>

                    <Toggle
                        label="Expanded Routes"
                        systemImage="road.lanes"
                        isOn={Boolean(simulation.useExpandedRoutes)}
                        onIsOnChange={ensureFn(simulation.onSetUseExpandedRoutes)}
                    />

                    <Button
                        systemImage="fuelpump.circle.fill"
                        onPress={ensureFn(simulation.onEstimateRange)}
                        label="Estimate Range"
                    />

                    {simulation.rangeResult ? (
                        <>
                            <LabeledContent
                                label={(
                                    <Label title="Urgency" systemImage="bolt.circle.fill" />
                                )}
                            >
                                <Value
                                    tone={
                                        simulation.rangeResult.urgent
                                            ? 'danger'
                                            : simulation.rangeResult.lowFuel
                                                ? 'warning'
                                                : 'positive'
                                    }
                                >
                                    {simulation.rangeResult.urgency}
                                </Value>
                            </LabeledContent>
                            <LabeledContent
                                label={(
                                    <Label title="Avg Interval" systemImage="arrow.left.and.right" />
                                )}
                            >
                                <Value mono>{`${simulation.rangeResult.avgIntervalMiles} mi`}</Value>
                            </LabeledContent>
                            <LabeledContent
                                label={(
                                    <Label title="Since Fill" systemImage="clock" />
                                )}
                            >
                                <Value mono>
                                    {simulation.rangeResult.milesSinceLastFill == null
                                        ? 'Unknown'
                                        : `${simulation.rangeResult.milesSinceLastFill} mi`}
                                </Value>
                            </LabeledContent>
                            {simulation.rangeSummary ? (
                                <Text modifiers={SECONDARY_TEXT}>
                                    {simulation.rangeSummary}
                                </Text>
                            ) : null}
                        </>
                    ) : null}
                </Section>

                {/* ─────────── Background Fetch ─────────── */}
                <Section
                    title="Background Fetch"
                    footer={(
                        <Footer>
                            Simulates a 30-minute background fetch window. Network profile affects latency and failure rate.
                        </Footer>
                    )}
                >
                    <Picker
                        label="Network"
                        systemImage="wifi"
                        selection={simulation.fetchNetworkCondition}
                        modifiers={[pickerStyle('menu')]}
                        onSelectionChange={ensureFn(simulation.onSelectFetchNetwork)}
                    >
                        {simulation.fetchNetworkOptions.map(option => (
                            <Text key={option.key} modifiers={[tag(option.key)]}>
                                {option.label}
                            </Text>
                        ))}
                    </Picker>

                    <Picker
                        label="Interval"
                        systemImage="timer"
                        selection={simulation.fetchIntervalKey}
                        modifiers={[pickerStyle('menu')]}
                        onSelectionChange={ensureFn(simulation.onSelectFetchInterval)}
                    >
                        {simulation.fetchIntervalOptions.map(option => (
                            <Text key={option.key} modifiers={[tag(option.key)]}>
                                {option.label}
                            </Text>
                        ))}
                    </Picker>

                    <Button
                        systemImage="play.fill"
                        onPress={ensureFn(simulation.onRunFetchSimulation)}
                        label="Run 30 Minute Simulation"
                    />
                    <Button
                        role="destructive"
                        systemImage="arrow.counterclockwise"
                        onPress={ensureFn(simulation.onResetFetchSimulation)}
                        label="Reset Simulation"
                    />

                    {fetchStats ? (
                        <>
                            <LabeledContent
                                label={(
                                    <Label title="Fetches" systemImage="arrow.down.doc" />
                                )}
                            >
                                <Value mono>{String(fetchStats.fetchesAttempted)}</Value>
                            </LabeledContent>
                            <LabeledContent
                                label={(
                                    <Label title="Succeeded" systemImage="checkmark.circle.fill" />
                                )}
                            >
                                <Value tone="positive" mono>{String(fetchStats.fetchesSucceeded)}</Value>
                            </LabeledContent>
                            <LabeledContent
                                label={(
                                    <Label title="Success Rate" systemImage="chart.line.uptrend.xyaxis" />
                                )}
                            >
                                <Value
                                    tone={fetchStats.successRate >= 80 ? 'positive' : 'warning'}
                                    mono
                                >
                                    {`${fetchStats.successRate}%`}
                                </Value>
                            </LabeledContent>
                            <LabeledContent
                                label={(
                                    <Label title="Data Used" systemImage="externaldrive.fill.badge.timemachine" />
                                )}
                            >
                                <Value mono>{`${fetchStats.totalDataKB} KB`}</Value>
                            </LabeledContent>
                            <LabeledContent
                                label={(
                                    <Label title="Battery" systemImage="battery.50percent" />
                                )}
                            >
                                <Value mono>{`${fetchStats.estimatedBatteryMah} mAh`}</Value>
                            </LabeledContent>
                            <LabeledContent
                                label={(
                                    <Label title="Price Changes" systemImage="arrow.up.arrow.down" />
                                )}
                            >
                                <Value tone="warning" mono>{String(fetchStats.priceChangesDetected)}</Value>
                            </LabeledContent>
                            <LabeledContent
                                label={(
                                    <Label title="Stations Offline" systemImage="wifi.slash" />
                                )}
                            >
                                <Value tone="danger" mono>{String(fetchStats.stationsWentOffline)}</Value>
                            </LabeledContent>
                        </>
                    ) : null}
                </Section>

                {/* ─────────── Fetch Event Log (only when populated) ─────────── */}
                {simulation.fetchLog.length > 0 ? (
                    <Section title="Fetch Events">
                        {simulation.fetchLog.map((entry, index) => (
                            <MonoLine key={`fetch-log-${index}`}>{entry}</MonoLine>
                        ))}
                    </Section>
                ) : null}

                {/* ─────────── Diagnostics ─────────── */}
                <Section
                    title="Diagnostics"
                    footer={(
                        <Footer>
                            Shows the home-map diagnostic overlay. Useful for tuning cluster handoff animations.
                        </Footer>
                    )}
                >
                    <Toggle
                        label="Cluster Debug Overlay"
                        systemImage="circle.grid.3x3.fill"
                        isOn={Boolean(maintenance.clusterDebugEnabled)}
                        onIsOnChange={ensureFn(maintenance.onSetClusterDebugEnabled)}
                    />
                </Section>

            </Form>
        </Host>
    );
}
