import React, { createContext, useContext, useState } from 'react';

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
    const [rootRevealPhase, setRootRevealPhase] = useState('blurred');
    const [rootRevealVersion, setRootRevealVersion] = useState(0);
    const [hasCompletedRootReveal, setHasCompletedRootReveal] = useState(false);

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

    const holdRootReveal = () => {
        setRootRevealVersion(currentValue => currentValue + 1);
        setHasCompletedRootReveal(false);
        setRootRevealPhase('blurred');
    };

    const startRootReveal = () => {
        setRootRevealPhase('revealing');
    };

    const hideRootReveal = () => {
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
