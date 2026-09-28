

export function hasPredictiveLocationAccess(permissionState) {
    return permissionState?.isReady === true;
}

export function getLocationActionLabel(permissionState) {
    if (!permissionState?.foregroundGranted) {
        return 'Enable Location';
    }

    if (!permissionState?.backgroundGranted) {
        return 'Enable Always-On Location';
    }

    if (!permissionState?.motionGranted) {
        return 'Enable Motion Access';
    }

    if (!permissionState?.preciseLocationGranted) {
        return 'Enable Precise Location';
    }

    return 'Continue';
}

export function getLocationStatusCopy(permissionState) {
    if (!permissionState) {
        return 'Choose Always Allow, keep Precise Location on, and allow Motion & Fitness when iOS asks.';
    }

    if (!permissionState.servicesEnabled) {
        return 'Turn on Location Services in iPhone Settings to unlock predictive fueling.';
    }

    if (permissionState.isReady) {
        return 'Always-on location and Motion & Fitness access are enabled.';
    }

    if (!permissionState.foregroundGranted) {
        return 'Choose Allow While Using App first so Fuel Up can find gas near you.';
    }

    if (!permissionState.backgroundGranted) {
        return 'Choose Always Allow so Fuel Up can keep watching for likely fuel stops.';
    }

    if (!permissionState.motionGranted) {
        return 'Enable Motion & Fitness so Fuel Up only starts predictive fueling when Apple detects you are driving.';
    }

    if (!permissionState.preciseLocationGranted) {
        return 'Enable Precise Location in iPhone Settings for accurate route and stop predictions.';
    }

    return 'Fuel Up still needs full predictive tracking access.';
}
