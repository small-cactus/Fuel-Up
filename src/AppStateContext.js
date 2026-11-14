import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const ROOT_REVEAL_SESSION_DEFAULT = {
    phase: 'blurred',
    version: 0,
    hasCompleted: false,
    hasConsumed: false,
};

let rootRevealSessionState = { ...ROOT_REVEAL_SESSION_DEFAULT };

const DEFAULT_APP_STATE = {
    fuelResetToken: 0,
    fuelDebugState: null,
    homeStationSnapshot: null,
    setHomeStationSnapshot: () => { },
    manualLocationOverride: null,
    resolvedFuelSearchContext: null,
    resolvedFuelSearchVersion: 0,
    clusterProbeRequest: null,
    isClusterProbeSessionActive: false,
    rootRevealPhase: 'blurred',
    rootRevealVersion: 0,
    hasCompletedRootReveal: false,
    setFuelDebugState: () => { },
    setManualLocationOverride: () => { },
    clearManualLocationOverride: () => { },
    setResolvedFuelSearchContext: () => { },
    clearResolvedFuelSearchContext: () => { },
    requestClusterProbe: () => { },
    clearClusterProbeRequest: () => { },
    finishClusterProbeSession: () => { },
    requestFuelReset: () => { },
    holdRootReveal: () => { },
    startRootReveal: () => { },
    hideRootReveal: () => { },
};

const DEFAULT_APP_ACTIONS = Object.fromEntries(Object.entries(DEFAULT_APP_STATE)
    .filter(([, value]) => typeof value === 'function'));
const AppStateContext = createContext(DEFAULT_APP_STATE);
const AppActionsContext = createContext(DEFAULT_APP_ACTIONS);
const AppControlContext = createContext({
    ...DEFAULT_APP_ACTIONS,
    clusterProbeRequest: null,
    isClusterProbeSessionActive: false,
    rootRevealPhase: 'blurred',
    rootRevealVersion: 0,
    hasCompletedRootReveal: false,
});

export function AppStateProvider({ children }) {
    const [fuelResetToken, setFuelResetToken] = useState(0);
    const [fuelDebugState, setFuelDebugState] = useState(null);
    const [homeStationSnapshot, setHomeStationSnapshot] = useState(null);
    const [manualLocationOverride, setManualLocationOverrideState] = useState(null);
    const [resolvedFuelSearchContext, setResolvedFuelSearchContextState] = useState(null);
    const resolvedFuelSearchContextRef = useRef(null);
    const [resolvedFuelSearchVersion, setResolvedFuelSearchVersion] = useState(0);
    const [clusterProbeRequest, setClusterProbeRequest] = useState(null);
    const [isClusterProbeSessionActive, setIsClusterProbeSessionActive] = useState(false);
    const [rootRevealPhase, setRootRevealPhase] = useState(
        rootRevealSessionState.hasConsumed
            ? 'hidden'
            : rootRevealSessionState.phase
    );
    const [rootRevealVersion, setRootRevealVersion] = useState(rootRevealSessionState.version);
    const [hasCompletedRootReveal, setHasCompletedRootReveal] = useState(rootRevealSessionState.hasCompleted);

    const requestFuelReset = useCallback(() => {
        resolvedFuelSearchContextRef.current = null;
        setHomeStationSnapshot(null);
        setResolvedFuelSearchContextState(null);
        setResolvedFuelSearchVersion(currentValue => currentValue + 1);
        setFuelResetToken(currentValue => currentValue + 1);
    }, []);

    const setManualLocationOverride = useCallback(nextLocation => {
        if (!nextLocation) {
            setManualLocationOverrideState(null);
            resolvedFuelSearchContextRef.current = null;
            setHomeStationSnapshot(null);
            setResolvedFuelSearchContextState(null);
            setResolvedFuelSearchVersion(currentValue => currentValue + 1);
            return;
        }

        setManualLocationOverrideState({
            latitude: Number(nextLocation.latitude),
            longitude: Number(nextLocation.longitude),
            source: nextLocation.source || 'manual',
            updatedAt: new Date().toISOString(),
        });
        resolvedFuelSearchContextRef.current = null;
        setHomeStationSnapshot(null);
        setResolvedFuelSearchContextState(null);
        setResolvedFuelSearchVersion(currentValue => currentValue + 1);
    }, []);

    const clearManualLocationOverride = useCallback(() => {
        setManualLocationOverrideState(null);
        resolvedFuelSearchContextRef.current = null;
        setHomeStationSnapshot(null);
        setResolvedFuelSearchContextState(null);
        setResolvedFuelSearchVersion(currentValue => currentValue + 1);
    }, []);

    const setResolvedFuelSearchContext = useCallback(nextContext => {
        const currentValue = resolvedFuelSearchContextRef.current;
        if (nextContext?.requestKey && nextContext.requestKey === currentValue?.requestKey &&
            nextContext.latitude === currentValue.latitude && nextContext.longitude === currentValue.longitude &&
            nextContext.criteriaSignature === currentValue.criteriaSignature) return;
        if (!nextContext && !currentValue) return;
        resolvedFuelSearchContextRef.current = nextContext || null;
        setResolvedFuelSearchContextState(nextContext || null);
        setResolvedFuelSearchVersion(value => value + 1);
    }, []);

    const clearResolvedFuelSearchContext = useCallback(() => {
        if (!resolvedFuelSearchContextRef.current) return;
        resolvedFuelSearchContextRef.current = null;
        setHomeStationSnapshot(null);
        setResolvedFuelSearchContextState(null);
        setResolvedFuelSearchVersion(value => value + 1);
    }, []);

    const requestClusterProbe = useCallback(nextRequest => {
        if (!nextRequest) {
            setClusterProbeRequest(null);
            return;
        }

        const nextToken = String(nextRequest.token || nextRequest.clusterProbeToken || 'default');

        setClusterProbeRequest({
            ...nextRequest,
            token: nextToken,
            source: nextRequest.source || 'automation',
            requestedAt: nextRequest.requestedAt || new Date().toISOString(),
        });
        setIsClusterProbeSessionActive(true);
    }, []);

    const clearClusterProbeRequest = useCallback(() => {
        setClusterProbeRequest(null);
    }, []);

    const finishClusterProbeSession = useCallback(() => {
        setClusterProbeRequest(null);
        setIsClusterProbeSessionActive(false);
    }, []);

    const holdRootReveal = useCallback(({ force = false } = {}) => {
        if (rootRevealSessionState.hasConsumed && !force) {
            return;
        }

        const nextVersion = rootRevealSessionState.version + 1;

        rootRevealSessionState = {
            phase: 'blurred',
            version: nextVersion,
            hasCompleted: false,
            hasConsumed: false,
        };
        setRootRevealVersion(nextVersion);
        setHasCompletedRootReveal(false);
        setRootRevealPhase('blurred');
    }, []);

    const startRootReveal = useCallback(() => {
        if (rootRevealSessionState.hasConsumed || rootRevealSessionState.phase === 'revealing') {
            return;
        }

        rootRevealSessionState = {
            ...rootRevealSessionState,
            phase: 'hidden',
            hasConsumed: true,
        };
        setRootRevealPhase('revealing');
    }, []);

    const hideRootReveal = useCallback(() => {
        rootRevealSessionState = {
            ...rootRevealSessionState,
            phase: 'hidden',
            hasCompleted: true,
            hasConsumed: true,
        };
        setHasCompletedRootReveal(true);
        setRootRevealPhase('hidden');
    }, []);

    // Navigation and Settings do not consume moving coordinates. Keep their
    // subscriptions independent without suspending effects or background work.
    const actions = useMemo(() => ({
        setHomeStationSnapshot,
        setFuelDebugState,
        setManualLocationOverride,
        clearManualLocationOverride,
        setResolvedFuelSearchContext,
        clearResolvedFuelSearchContext,
        requestClusterProbe,
        clearClusterProbeRequest,
        finishClusterProbeSession,
        requestFuelReset,
        holdRootReveal,
        startRootReveal,
        hideRootReveal,
    }), [setHomeStationSnapshot, setFuelDebugState, setManualLocationOverride, clearManualLocationOverride,
        setResolvedFuelSearchContext, clearResolvedFuelSearchContext, requestClusterProbe,
        clearClusterProbeRequest, finishClusterProbeSession, requestFuelReset, holdRootReveal,
        startRootReveal, hideRootReveal]);
    const controls = useMemo(() => ({
        ...actions,
        clusterProbeRequest,
        isClusterProbeSessionActive,
        rootRevealPhase,
        rootRevealVersion,
        hasCompletedRootReveal,
    }), [actions, clusterProbeRequest, isClusterProbeSessionActive, rootRevealPhase,
        rootRevealVersion, hasCompletedRootReveal]);

    const value = useMemo(() => ({
        fuelDebugState,
        homeStationSnapshot,
        setHomeStationSnapshot,
        fuelResetToken,
        manualLocationOverride,
        resolvedFuelSearchContext,
        resolvedFuelSearchVersion,
        clusterProbeRequest,
        isClusterProbeSessionActive,
        rootRevealPhase,
        rootRevealVersion,
        hasCompletedRootReveal,
        setFuelDebugState,
        setManualLocationOverride,
        clearManualLocationOverride,
        setResolvedFuelSearchContext,
        clearResolvedFuelSearchContext,
        requestClusterProbe,
        clearClusterProbeRequest,
        finishClusterProbeSession,
        requestFuelReset,
        holdRootReveal,
        startRootReveal,
        hideRootReveal
    }), [fuelDebugState, homeStationSnapshot, fuelResetToken, manualLocationOverride, resolvedFuelSearchContext, resolvedFuelSearchVersion, clusterProbeRequest, isClusterProbeSessionActive, rootRevealPhase, rootRevealVersion, hasCompletedRootReveal, setFuelDebugState, setManualLocationOverride, clearManualLocationOverride, setResolvedFuelSearchContext, clearResolvedFuelSearchContext, requestClusterProbe, clearClusterProbeRequest, finishClusterProbeSession, requestFuelReset, holdRootReveal, startRootReveal, hideRootReveal]);

    return <AppActionsContext.Provider value={actions}>
        <AppControlContext.Provider value={controls}>
            <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
        </AppControlContext.Provider>
    </AppActionsContext.Provider>;
}

export function useAppState() {
    return useContext(AppStateContext);
}

export function useAppActions() {
    return useContext(AppActionsContext);
}

export function useAppControls() {
    return useContext(AppControlContext);
}
