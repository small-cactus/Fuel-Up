import React, { createContext, useContext, useState } from 'react';

const AppStateContext = createContext({
    fuelResetToken: 0,
    fuelDebugState: null,
    manualLocationOverride: null,
    setFuelDebugState: () => { },
    setManualLocationOverride: () => { },
    clearManualLocationOverride: () => { },
    requestFuelReset: () => { },
});

export function AppStateProvider({ children }) {
    const [fuelResetToken, setFuelResetToken] = useState(0);
    const [fuelDebugState, setFuelDebugState] = useState(null);
    const [manualLocationOverride, setManualLocationOverrideState] = useState(null);

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

    return (
        <AppStateContext.Provider
            value={{
                fuelDebugState,
                fuelResetToken,
                manualLocationOverride,
                setFuelDebugState,
                setManualLocationOverride,
                clearManualLocationOverride,
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
