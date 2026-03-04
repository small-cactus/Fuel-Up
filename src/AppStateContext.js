import React, { createContext, useContext, useState } from 'react';

const AppStateContext = createContext({
    fuelResetToken: 0,
    fuelDebugState: null,
    manualLocationOverride: null,
    clusterProbeRequest: null,
    isClusterProbeSessionActive: false,
    setFuelDebugState: () => { },
    setManualLocationOverride: () => { },
    clearManualLocationOverride: () => { },
    requestClusterProbe: () => { },
    clearClusterProbeRequest: () => { },
    finishClusterProbeSession: () => { },
    requestFuelReset: () => { },
});

export function AppStateProvider({ children }) {
    const [fuelResetToken, setFuelResetToken] = useState(0);
    const [fuelDebugState, setFuelDebugState] = useState(null);
    const [manualLocationOverride, setManualLocationOverrideState] = useState(null);
    const [clusterProbeRequest, setClusterProbeRequest] = useState(null);
    const [isClusterProbeSessionActive, setIsClusterProbeSessionActive] = useState(false);

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

    return (
        <AppStateContext.Provider
            value={{
                fuelDebugState,
                fuelResetToken,
                manualLocationOverride,
                clusterProbeRequest,
                isClusterProbeSessionActive,
                setFuelDebugState,
                setManualLocationOverride,
                clearManualLocationOverride,
                requestClusterProbe,
                clearClusterProbeRequest,
                finishClusterProbeSession,
                requestFuelReset,
            }}
        >
            {children}
        </AppStateContext.Provider>
    );
}

export function useAppState() {
    return useContext(AppStateContext);
}
