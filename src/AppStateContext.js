import React, { createContext, useContext, useState } from 'react';

const ROOT_REVEAL_SESSION_DEFAULT = {
    phase: 'blurred',
    version: 0,
    hasCompleted: false,
    hasConsumed: false,
};

let rootRevealSessionState = { ...ROOT_REVEAL_SESSION_DEFAULT };

const AppStateContext = createContext({
    fuelResetToken: 0,
    fuelDebugState: null,
    manualLocationOverride: null,
    clusterProbeRequest: null,
    isClusterProbeSessionActive: false,
    rootRevealPhase: 'blurred',
    rootRevealVersion: 0,
    hasCompletedRootReveal: false,
    setFuelDebugState: () => { },
    setManualLocationOverride: () => { },
    clearManualLocationOverride: () => { },
    requestClusterProbe: () => { },
    clearClusterProbeRequest: () => { },
    finishClusterProbeSession: () => { },
    requestFuelReset: () => { },
    holdRootReveal: () => { },
    startRootReveal: () => { },
    hideRootReveal: () => { },
});

export function AppStateProvider({ children }) {
    const [fuelResetToken, setFuelResetToken] = useState(0);
    const [fuelDebugState, setFuelDebugState] = useState(null);
    const [manualLocationOverride, setManualLocationOverrideState] = useState(null);
    const [clusterProbeRequest, setClusterProbeRequest] = useState(null);
    const [isClusterProbeSessionActive, setIsClusterProbeSessionActive] = useState(false);
    const [rootRevealPhase, setRootRevealPhase] = useState(
        rootRevealSessionState.hasConsumed
            ? 'hidden'
            : rootRevealSessionState.phase
    );
    const [rootRevealVersion, setRootRevealVersion] = useState(rootRevealSessionState.version);
    const [hasCompletedRootReveal, setHasCompletedRootReveal] = useState(rootRevealSessionState.hasCompleted);

    const requestFuelReset = () => {
        setFuelResetToken(currentValue => currentValue + 1);
    };

    const setManualLocationOverride = nextLocation => {
        if (!nextLocation) {
            setManualLocationOverrideState(null);
            return;
        }

        setManualLocationOverrideState({
            latitude: Number(nextLocation.latitude),
            longitude: Number(nextLocation.longitude),
            source: nextLocation.source || 'manual',
            updatedAt: new Date().toISOString(),
        });
    };

    const clearManualLocationOverride = () => {
        setManualLocationOverrideState(null);
    };

    const requestClusterProbe = nextRequest => {
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
    };

    const clearClusterProbeRequest = () => {
        setClusterProbeRequest(null);
    };

    const finishClusterProbeSession = () => {
        setClusterProbeRequest(null);
        setIsClusterProbeSessionActive(false);
    };

    const holdRootReveal = ({ force = false } = {}) => {
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
    };

    const startRootReveal = () => {
        if (rootRevealSessionState.hasConsumed || rootRevealSessionState.phase === 'revealing') {
            return;
        }

        rootRevealSessionState = {
            ...rootRevealSessionState,
            phase: 'hidden',
            hasConsumed: true,
        };
        setRootRevealPhase('revealing');
    };

    const hideRootReveal = () => {
        rootRevealSessionState = {
            ...rootRevealSessionState,
            phase: 'hidden',
            hasCompleted: true,
            hasConsumed: true,
        };
        setHasCompletedRootReveal(true);
        setRootRevealPhase('hidden');
    };

    return (
        <AppStateContext.Provider
            value={{
                fuelDebugState,
                fuelResetToken,
                manualLocationOverride,
                clusterProbeRequest,
                isClusterProbeSessionActive,
                rootRevealPhase,
                rootRevealVersion,
                hasCompletedRootReveal,
                setFuelDebugState,
                setManualLocationOverride,
                clearManualLocationOverride,
                requestClusterProbe,
                clearClusterProbeRequest,
                finishClusterProbeSession,
                requestFuelReset,
                holdRootReveal,
                startRootReveal,
                hideRootReveal,
            }}
        >
            {children}
        </AppStateContext.Provider>
    );
}

export function useAppState() {
    return useContext(AppStateContext);
}
