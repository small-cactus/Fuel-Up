let launchOverrides = {
    forceNullLastKnownPosition: false,
};

export function getLocationProbeLaunchOverrides() {
    return { ...launchOverrides };
}

export function setLocationProbeLaunchOverrides(nextOverrides = {}) {
    launchOverrides = {
        forceNullLastKnownPosition: Boolean(nextOverrides.forceNullLastKnownPosition),
    };
}

export function resetLocationProbeLaunchOverrides() {
    launchOverrides = {
        forceNullLastKnownPosition: false,
    };
}
