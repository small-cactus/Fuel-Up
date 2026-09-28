import { useMemo, useEffect, useRef, useState } from 'react';
import { formatDebugMetric, buildClusterDebugRecordingLog } from './probeTelemetry.js';
import { finalizeDebugSample } from '../../cluster/telemetry';
import { areRegionsEquivalent } from './locationBootstrap.js';
import {
    waitForMilliseconds,
    writeClusterDebugProbeArtifact,
    buildClusterDebugProbePlan,
    buildProbeStationScreenSnapshot,
    compareProbeStationScreenSnapshots,
    buildClusterDebugProbeLog,
    buildClusterDebugProbeSummary,
    buildClusterDebugAutomationSeedRegion,
} from './probePlan.js';
import {
    CLUSTER_DEBUG_PROBE_SETTLE_DURATION,
    CLUSTER_DEBUG_PROBE_ANIMATION_DURATION,
    CLUSTER_DEBUG_PROBE_IDLE_TIMEOUT,
    CLUSTER_DEBUG_PROBE_INITIAL_LOAD_WAIT,
    CLUSTER_DEBUG_PROBE_RECORDING_DELAY,
    CLUSTER_DEBUG_PROBE_BETWEEN_STEP_DELAY,
} from './constants.js';
import { buildClusterMembershipKey } from '../../cluster/layout';
export default function useClusterProbe({
    debugClusterAnimations,
    renderedClusters,
    mapRegion,
    mapRef,
    mapRegionRef,
    setMapRegionIfNeeded,
    isAnimatingRef,
    setMapMotionState,
    waitForMapIdle,
    isMountedRef,
    mapMotionRef,
    isMapLoaded,
    location,
    clustersSignatureRef,
    stationQuotesRef,
    width,
    height,
    finishClusterProbeSession,
    autoClusterProbeRequested,
    isMapMoving,
    autoClusterProbeRequestKey,
    stationQuotes,
    autoClusterProbeRequestSource,
    flushMapIdleWaiters
}) {
    const lastClusterDebugSignatureRef = useRef('');
    const clusterDebugSamplesRef = useRef([]);
    const clusterDebugTransitionEventsRef = useRef([]);
    const clusterDebugTransitionEventKeysRef = useRef(new Set());
    const clusterDebugWatchedPrimaryIdRef = useRef(null);
    const clusterDebugProbeModeRef = useRef('idle');
    const clusterDebugProbeRunIdRef = useRef(0);
    const clusterDebugAutoProbeHandledKeyRef = useRef('');
    const clusterDebugAutoProbeSeededKeyRef = useRef('');
    const [isClusterDebugRecording, setIsClusterDebugRecording] = useState(false);
    const [isClusterDebugProbeRunning, setIsClusterDebugProbeRunning] = useState(false);
    const [clusterDebugProbeSummary, setClusterDebugProbeSummary] = useState('');

    const recordClusterDebugTransitionEvent = (event) => {
        if (!debugClusterAnimations || !isClusterDebugRecording || !event?.type) {
            return;
        }

        const eventKey = [
            event.type,
            event.primaryStationId || '',
            event.fromClusterKey || '',
            event.toClusterKey || '',
            event.transitionKey || '',
            event.moverStationId || '',
        ].join('|');

        if (clusterDebugTransitionEventKeysRef.current.has(eventKey)) {
            return;
        }

        clusterDebugTransitionEventKeysRef.current.add(eventKey);
        clusterDebugTransitionEventsRef.current = [
            ...clusterDebugTransitionEventsRef.current,
            {
                timestamp: Date.now(),
                ...event,
            },
        ];
    };

    const watchedCluster = useMemo(() => {
        if (!debugClusterAnimations) {
            return null;
        }

        const multiQuoteClusters = renderedClusters.filter(cluster => cluster.quotes.length > 1);
        if (multiQuoteClusters.length === 0) {
            return null;
        }

        const latScale = mapRegion.latitudeDelta || 1;
        const lngScale = mapRegion.longitudeDelta || 1;

        return multiQuoteClusters.reduce((closestCluster, cluster) => {
            if (!closestCluster) {
                return cluster;
            }

            const clusterDistance = Math.hypot(
                (cluster.averageLat - mapRegion.latitude) / latScale,
                (cluster.averageLng - mapRegion.longitude) / lngScale
            );
            const closestDistance = Math.hypot(
                (closestCluster.averageLat - mapRegion.latitude) / latScale,
                (closestCluster.averageLng - mapRegion.longitude) / lngScale
            );

            return clusterDistance < closestDistance ? cluster : closestCluster;
        }, null);
    }, [debugClusterAnimations, renderedClusters, mapRegion.latitude, mapRegion.longitude, mapRegion.latitudeDelta, mapRegion.longitudeDelta]);
    const watchedClusterDiagnostic = null;
    const activeClusterDebugPrimaryId = isClusterDebugRecording
        ? clusterDebugWatchedPrimaryIdRef.current
        : (watchedCluster?.quotes?.[0]?.stationId || null);

    const recordClusterDebugRenderFrame = (frame) => {
        if (!debugClusterAnimations || !isClusterDebugRecording || !frame) {
            return false;
        }

        const probeMode = clusterDebugProbeModeRef.current || 'idle';
        const signature = [
            frame.clusterKey || '',
            frame.stageSignature || '',
            frame.runtimePhase || 'live',
            probeMode,
            formatDebugMetric(frame.spreadProgress, 5),
            formatDebugMetric(frame.morphProgress, 5),
            formatDebugMetric(frame.bridgeProgress, 5),
            formatDebugMetric(frame.outsideX, 4),
            formatDebugMetric(frame.outsideY, 4),
            frame.outsideVisible ? '1' : '0',
            formatDebugMetric(frame.accumulatorX, 4),
            formatDebugMetric(frame.accumulatorY, 4),
            frame.accumulatorVisible ? '1' : '0',
            formatDebugMetric(frame.mergeMoverX, 4),
            formatDebugMetric(frame.mergeMoverY, 4),
            frame.mergeMoverVisible ? '1' : '0',
            formatDebugMetric(frame.splitMoverX, 4),
            formatDebugMetric(frame.splitMoverY, 4),
            frame.splitMoverVisible ? '1' : '0',
        ].join('|');

        const previousSample = clusterDebugSamplesRef.current[clusterDebugSamplesRef.current.length - 1] || null;
        const nextSample = finalizeDebugSample(frame, previousSample, probeMode);

        clusterDebugSamplesRef.current.push(nextSample);
        lastClusterDebugSignatureRef.current = signature;
        return true;
    };

    const startClusterDebugCapture = (primaryStationId = null) => {
        clusterDebugSamplesRef.current = [];
        clusterDebugTransitionEventsRef.current = [];
        clusterDebugTransitionEventKeysRef.current = new Set();
        lastClusterDebugSignatureRef.current = '';
        clusterDebugWatchedPrimaryIdRef.current = primaryStationId;
        clusterDebugProbeModeRef.current = 'warmup';
        setIsClusterDebugRecording(true);
    };

    const stopClusterDebugCapture = () => {
        const recordedSamples = clusterDebugSamplesRef.current;
        const recordedTransitionEvents = clusterDebugTransitionEventsRef.current;

        setIsClusterDebugRecording(false);
        lastClusterDebugSignatureRef.current = '';
        clusterDebugWatchedPrimaryIdRef.current = null;
        clusterDebugProbeModeRef.current = 'idle';
        clusterDebugSamplesRef.current = [];
        clusterDebugTransitionEventsRef.current = [];
        clusterDebugTransitionEventKeysRef.current = new Set();

        return {
            recordedSamples,
            recordedTransitionEvents,
            logText: buildClusterDebugRecordingLog(recordedSamples, recordedTransitionEvents),
        };
    };

    const handleStartClusterDebugRecording = () => {
        if (isClusterDebugProbeRunning) {
            return;
        }

        startClusterDebugCapture(watchedCluster?.quotes?.[0]?.stationId || null);
    };

    const handleStopClusterDebugRecording = () => {
        if (isClusterDebugProbeRunning) {
            return;
        }

        const { logText } = stopClusterDebugCapture();
        console.debug(logText);
    };

    const animateClusterDebugProbeToRegion = async (nextRegion, runId) => {
        if (!mapRef.current || !nextRegion || clusterDebugProbeRunIdRef.current !== runId) {
            return false;
        }

        if (areRegionsEquivalent(mapRegionRef.current, nextRegion)) {
            setMapRegionIfNeeded(nextRegion);
            await waitForMilliseconds(CLUSTER_DEBUG_PROBE_SETTLE_DURATION);
            return true;
        }

        isAnimatingRef.current = true;
        setMapMotionState(true);
        mapRef.current.animateToRegion(nextRegion, CLUSTER_DEBUG_PROBE_ANIMATION_DURATION);

        const didReachIdle = await waitForMapIdle(
            CLUSTER_DEBUG_PROBE_ANIMATION_DURATION + CLUSTER_DEBUG_PROBE_IDLE_TIMEOUT
        );

        if (!didReachIdle && isMountedRef.current && clusterDebugProbeRunIdRef.current === runId) {
            isAnimatingRef.current = false;
            setMapMotionState(false);
            setMapRegionIfNeeded(nextRegion);
        }

        await waitForMilliseconds(CLUSTER_DEBUG_PROBE_SETTLE_DURATION);
        return didReachIdle;
    };

    const waitForClusterDebugProbeResetSettle = async (runId, timeoutMs = 4500) => {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            if (clusterDebugProbeRunIdRef.current !== runId) {
                return false;
            }

            if (!mapMotionRef.current && !isAnimatingRef.current) {
                await waitForMilliseconds(CLUSTER_DEBUG_PROBE_SETTLE_DURATION);

                if (
                    clusterDebugProbeRunIdRef.current !== runId ||
                    mapMotionRef.current ||
                    isAnimatingRef.current
                ) {
                    continue;
                }

                return true;
            }

            await waitForMilliseconds(50);
        }

        return false;
    };

    const handleRunClusterDebugProbe = async (trigger = 'manual') => {
        if (!debugClusterAnimations || isClusterDebugProbeRunning || isClusterDebugRecording || !isMapLoaded) {
            return;
        }

        if (!watchedCluster || !mapRef.current) {
            const message = 'Move the map until a multi-station cluster is near center, then run Probe.';

            setClusterDebugProbeSummary(message);
            await writeClusterDebugProbeArtifact({
                status: 'blocked',
                trigger,
                message,
                clusterKey: watchedCluster ? buildClusterMembershipKey(watchedCluster) : '',
                sampleCount: 0,
                transitionCount: 0,
                maxFrameDelta: 0,
                timedOutStages: [],
                plan: watchedCluster ? buildClusterDebugProbePlan(watchedCluster, mapRegion, location) : null,
                logText: '',
            });
            return;
        }

        const probePlan = buildClusterDebugProbePlan(watchedCluster, mapRegion, location);

        if (!probePlan) {
            const message = 'Unable to build a probe plan for the current cluster.';

            setClusterDebugProbeSummary(message);
            await writeClusterDebugProbeArtifact({
                status: 'blocked',
                trigger,
                message,
                clusterKey: buildClusterMembershipKey(watchedCluster),
                sampleCount: 0,
                transitionCount: 0,
                maxFrameDelta: 0,
                timedOutStages: [],
                plan: null,
                logText: '',
            });
            return;
        }

        const runId = clusterDebugProbeRunIdRef.current + 1;
        let didStartCapture = false;

        clusterDebugProbeRunIdRef.current = runId;
        setIsClusterDebugProbeRunning(true);
        setClusterDebugProbeSummary('Probe: locking onto the nearest cluster.');

        try {
            await writeClusterDebugProbeArtifact({
                status: 'running',
                trigger,
                message: 'Probe is waiting for the map to settle before recording.',
                clusterKey: probePlan.clusterKey,
                sampleCount: 0,
                transitionCount: 0,
                maxFrameDelta: 0,
                timedOutStages: [],
                plan: probePlan,
                logText: '',
            });

            setClusterDebugProbeSummary('Probe: waiting 3 seconds for the map to load.');
            await waitForMilliseconds(CLUSTER_DEBUG_PROBE_INITIAL_LOAD_WAIT);
            if (clusterDebugProbeRunIdRef.current !== runId) {
                return;
            }

            if (!areRegionsEquivalent(mapRegionRef.current, probePlan.focusStartRegion)) {
                setClusterDebugProbeSummary('Probe: centering on your current location before recording.');
                await animateClusterDebugProbeToRegion(probePlan.focusStartRegion, runId);
                if (clusterDebugProbeRunIdRef.current !== runId) {
                    return;
                }
            }

            startClusterDebugCapture(watchedCluster.quotes[0].stationId);
            didStartCapture = true;
            const startClusterSignature = clustersSignatureRef.current;
            const startStationScreenSnapshot = buildProbeStationScreenSnapshot(
                stationQuotesRef.current,
                mapRegionRef.current,
                width,
                height
            );

            setClusterDebugProbeSummary('Probe: recording started. Holding for 150ms.');
            await waitForMilliseconds(CLUSTER_DEBUG_PROBE_RECORDING_DELAY);
            if (clusterDebugProbeRunIdRef.current !== runId) {
                return;
            }

            const timedOutStages = [];
            const totalZoomInSteps = probePlan.zoomInRegions.length;
            clusterDebugProbeModeRef.current = 'stepped';

            for (let stepIndex = 0; stepIndex < totalZoomInSteps; stepIndex += 1) {
                if (clusterDebugProbeRunIdRef.current !== runId) {
                    return;
                }

                setClusterDebugProbeSummary(
                    `Probe: zooming in ${stepIndex + 1}/${totalZoomInSteps}.`
                );

                if (!await animateClusterDebugProbeToRegion(probePlan.zoomInRegions[stepIndex], runId)) {
                    timedOutStages.push(`zoom-in-${stepIndex + 1}`);
                }

                if (stepIndex < totalZoomInSteps - 1) {
                    await waitForMilliseconds(CLUSTER_DEBUG_PROBE_BETWEEN_STEP_DELAY);
                }
            }

            const totalZoomOutSteps = probePlan.zoomOutRegions.length;

            for (let stepIndex = 0; stepIndex < totalZoomOutSteps; stepIndex += 1) {
                if (clusterDebugProbeRunIdRef.current !== runId) {
                    return;
                }

                setClusterDebugProbeSummary(
                    `Probe: zooming out ${stepIndex + 1}/${totalZoomOutSteps}.`
                );

                if (!await animateClusterDebugProbeToRegion(probePlan.zoomOutRegions[stepIndex], runId)) {
                    timedOutStages.push(`zoom-out-${stepIndex + 1}`);
                }

                if (stepIndex < totalZoomOutSteps - 1) {
                    await waitForMilliseconds(CLUSTER_DEBUG_PROBE_BETWEEN_STEP_DELAY);
                }
            }

            clusterDebugProbeModeRef.current = 'one-shot';
            setClusterDebugProbeSummary('Probe: one-shot zoom in.');
            if (!await animateClusterDebugProbeToRegion(probePlan.splitRegion, runId)) {
                timedOutStages.push('zoom-oneshot-in');
            }
            if (clusterDebugProbeRunIdRef.current !== runId) {
                return;
            }

            await waitForMilliseconds(CLUSTER_DEBUG_PROBE_BETWEEN_STEP_DELAY);
            if (clusterDebugProbeRunIdRef.current !== runId) {
                return;
            }

            setClusterDebugProbeSummary('Probe: one-shot zoom out.');
            if (!await animateClusterDebugProbeToRegion(probePlan.focusStartRegion, runId)) {
                timedOutStages.push('zoom-oneshot-out');
            }
            if (clusterDebugProbeRunIdRef.current !== runId) {
                return;
            }

            clusterDebugProbeModeRef.current = 'settle';
            setClusterDebugProbeSummary('Probe: final 150ms hold before stopping recording.');
            await waitForMilliseconds(CLUSTER_DEBUG_PROBE_RECORDING_DELAY);
            if (clusterDebugProbeRunIdRef.current !== runId) {
                return;
            }

            const {
                recordedSamples,
                recordedTransitionEvents,
            } = stopClusterDebugCapture();

            didStartCapture = false;

            if (!areRegionsEquivalent(mapRegionRef.current, probePlan.focusStartRegion)) {
                setClusterDebugProbeSummary('Probe: restoring the original map view.');
                await animateClusterDebugProbeToRegion(probePlan.focusStartRegion, runId);
            }
            if (clusterDebugProbeRunIdRef.current !== runId) {
                return;
            }
            setClusterDebugProbeSummary('Probe: waiting for split handoffs to settle.');
            await waitForClusterDebugProbeResetSettle(runId);
            if (clusterDebugProbeRunIdRef.current !== runId) {
                return;
            }

            const endClusterSignature = clustersSignatureRef.current;
            const endStationScreenSnapshot = buildProbeStationScreenSnapshot(
                stationQuotesRef.current,
                mapRegionRef.current,
                width,
                height
            );
            const resetStationInvariant = compareProbeStationScreenSnapshots(
                startStationScreenSnapshot,
                endStationScreenSnapshot
            );
            const resetSignaturesMatch = (
                startClusterSignature === endClusterSignature ||
                (
                    (resetStationInvariant?.maxPairDistanceDelta || 0) <= 0.001 &&
                    (resetStationInvariant?.meanPairDistanceDelta || 0) <= 0.001
                )
            );
            const modesCaptured = Array.from(new Set(
                recordedSamples
                    .map(sample => sample?.probeMode || 'unknown')
                    .filter(Boolean)
            ));

            const maxFrameDelta = recordedSamples.reduce((maxDelta, sample) => (
                Math.max(maxDelta, sample?.maxFrameDelta || 0)
            ), 0);
            const report = {
                status: 'completed',
                trigger,
                message: timedOutStages.length > 0
                    ? `Completed with idle timeouts in ${timedOutStages.join(', ')}.`
                    : 'Completed without timeouts.',
                clusterKey: probePlan.clusterKey,
                sampleCount: recordedSamples.length,
                transitionCount: recordedTransitionEvents.length,
                maxFrameDelta,
                timedOutStages,
                plan: probePlan,
                modesCaptured,
                resetInvariant: {
                    startClusterSignature,
                    endClusterSignature,
                    signaturesMatch: resetSignaturesMatch,
                    startStationScreenSnapshot,
                    endStationScreenSnapshot,
                    ...resetStationInvariant,
                },
            };
            const logText = buildClusterDebugProbeLog(report, recordedSamples, recordedTransitionEvents);

            await writeClusterDebugProbeArtifact({
                ...report,
                samples: recordedSamples,
                transitionEvents: recordedTransitionEvents,
                logText,
            });
            console.debug(logText);
            if (isMountedRef.current && clusterDebugProbeRunIdRef.current === runId) {
                setClusterDebugProbeSummary(buildClusterDebugProbeSummary(report));
            }
        } catch (error) {
            if (didStartCapture) {
                stopClusterDebugCapture();
                didStartCapture = false;
            }

            const message = error instanceof Error ? error.message : 'Unexpected probe failure.';
            const logText = `[ClusterDebug Probe]\nstatus=failed\ntrigger=${trigger}\nmessage=${message}`;

            await writeClusterDebugProbeArtifact({
                status: 'failed',
                trigger,
                message,
                clusterKey: probePlan.clusterKey,
                sampleCount: 0,
                transitionCount: 0,
                maxFrameDelta: 0,
                timedOutStages: [],
                plan: probePlan,
                logText,
            });
            console.debug(logText);
            if (isMountedRef.current && clusterDebugProbeRunIdRef.current === runId) {
                setClusterDebugProbeSummary(`Probe failed: ${message}`);
            }
        } finally {
            if (didStartCapture) {
                stopClusterDebugCapture();
            }

            if (trigger.startsWith('automation:')) {
                finishClusterProbeSession();
            }

            if (isMountedRef.current && clusterDebugProbeRunIdRef.current === runId) {
                setIsClusterDebugProbeRunning(false);
            }
        }
    };

    useEffect(() => {
        if (!autoClusterProbeRequested) {
            clusterDebugAutoProbeHandledKeyRef.current = '';
            clusterDebugAutoProbeSeededKeyRef.current = '';
        }
    }, [autoClusterProbeRequested]);

    useEffect(() => {
        if (
            !autoClusterProbeRequested ||
            !debugClusterAnimations ||
            isClusterDebugProbeRunning ||
            isClusterDebugRecording ||
            !isMapLoaded ||
            watchedCluster ||
            !mapRef.current ||
            isAnimatingRef.current ||
            isMapMoving
        ) {
            return;
        }

        if (clusterDebugAutoProbeSeededKeyRef.current === autoClusterProbeRequestKey) {
            return;
        }

        const seedRegion = buildClusterDebugAutomationSeedRegion(stationQuotes, mapRegion);

        if (!seedRegion) {
            setClusterDebugProbeSummary('Probe automation is waiting for enough stations to form a cluster.');
            return;
        }

        clusterDebugAutoProbeSeededKeyRef.current = autoClusterProbeRequestKey;
        setClusterDebugProbeSummary('Probe automation is preparing a cluster.');
        console.log(`[ClusterDebug Probe Automation] seeding cluster ${autoClusterProbeRequestKey}`);
        isAnimatingRef.current = true;
        setMapMotionState(true);
        mapRef.current.animateToRegion(seedRegion, CLUSTER_DEBUG_PROBE_ANIMATION_DURATION);
    }, [
        autoClusterProbeRequested,
        autoClusterProbeRequestKey,
        debugClusterAnimations,
        isClusterDebugProbeRunning,
        isClusterDebugRecording,
        isMapLoaded,
        watchedCluster,
        stationQuotes,
        mapRegion,
        isMapMoving,
    ]);

    useEffect(() => {
        if (
            !autoClusterProbeRequested ||
            !debugClusterAnimations ||
            isClusterDebugProbeRunning ||
            isClusterDebugRecording ||
            !isMapLoaded
        ) {
            return;
        }

        if (clusterDebugAutoProbeHandledKeyRef.current === autoClusterProbeRequestKey) {
            return;
        }

        if (!watchedCluster || !mapRef.current) {
            setClusterDebugProbeSummary('Probe automation is waiting for a cluster near the map center.');
            const waitingTrigger = autoClusterProbeRequestSource === 'file'
                ? `automation:file:${autoClusterProbeRequestKey}`
                : `automation:${autoClusterProbeRequestKey}`;

            void writeClusterDebugProbeArtifact({
                status: 'waiting',
                trigger: waitingTrigger,
                message: 'Waiting for a multi-station cluster near the map center.',
                clusterKey: watchedCluster ? buildClusterMembershipKey(watchedCluster) : '',
                sampleCount: 0,
                transitionCount: 0,
                maxFrameDelta: 0,
                timedOutStages: [],
                plan: watchedCluster ? buildClusterDebugProbePlan(watchedCluster, mapRegion, location) : null,
                logText: '',
            });
            return;
        }

        clusterDebugAutoProbeHandledKeyRef.current = autoClusterProbeRequestKey;
        clusterDebugAutoProbeSeededKeyRef.current = '';
        setClusterDebugProbeSummary(`Probe automation requested (${autoClusterProbeRequestKey}).`);

        const automationTrigger = autoClusterProbeRequestSource === 'file'
            ? `automation:file:${autoClusterProbeRequestKey}`
            : `automation:${autoClusterProbeRequestKey}`;

        console.log(`[ClusterDebug Probe Automation] starting ${automationTrigger}`);
        void handleRunClusterDebugProbe(automationTrigger);
    }, [
        autoClusterProbeRequested,
        autoClusterProbeRequestKey,
        autoClusterProbeRequestSource,
        debugClusterAnimations,
        isClusterDebugProbeRunning,
        isClusterDebugRecording,
        isMapLoaded,
        finishClusterProbeSession,
        watchedCluster,
    ]);

    useEffect(() => {
        if (!debugClusterAnimations) {
            clusterDebugProbeRunIdRef.current += 1;
            setIsClusterDebugRecording(false);
            setIsClusterDebugProbeRunning(false);
            setClusterDebugProbeSummary('');
            clusterDebugAutoProbeHandledKeyRef.current = '';
            lastClusterDebugSignatureRef.current = '';
            clusterDebugWatchedPrimaryIdRef.current = null;
            clusterDebugSamplesRef.current = [];
            clusterDebugTransitionEventsRef.current = [];
            clusterDebugTransitionEventKeysRef.current = new Set();
            flushMapIdleWaiters(false);
            return;
        }
    }, [debugClusterAnimations]);
    return { isClusterDebugRecording, isClusterDebugProbeRunning, clusterDebugProbeSummary, recordClusterDebugTransitionEvent, watchedCluster, watchedClusterDiagnostic, activeClusterDebugPrimaryId, recordClusterDebugRenderFrame, handleStartClusterDebugRecording, handleStopClusterDebugRecording, handleRunClusterDebugProbe };
}
