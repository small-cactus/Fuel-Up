let hasConsumedFreshLaunchMapBootstrap = false;

export function consumeFreshLaunchMapBootstrap() {
    if (hasConsumedFreshLaunchMapBootstrap) {
        return false;
    }

    hasConsumedFreshLaunchMapBootstrap = true;
    return true;
}
