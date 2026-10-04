import * as Location from 'expo-location';
import DrivingActivity from '../../modules/fuel-up-driving-activity';
import { endAllLiveActivities } from './notifications';
import * as Notifications from 'expo-notifications';

import { nativeResearchOwnsTracking } from './drivingResearchPolicy';

// Complete migration before registering native fences: Expo's old consumer
// removes every monitored region when unregistered. Never run this after native
// fences have been installed except once at launch, followed by reconciliation.
export async function migrateToNativeResearchAsync() {
    if (!nativeResearchOwnsTracking()) return;
    for (const [name, check, stop] of [
        ['fuelup.predictive-location-updates', Location.hasStartedLocationUpdatesAsync, Location.stopLocationUpdatesAsync],
        ['fuelup.predictive-geofencing', Location.hasStartedGeofencingAsync, Location.stopGeofencingAsync],
    ]) {
        if (await check(name)) await stop(name);
    }
    await endAllLiveActivities();
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    for (const item of pending) {
        if (item.content?.categoryIdentifier === 'fuelup.predictive-recommendation') {
            await Notifications.cancelScheduledNotificationAsync(item.identifier);
        }
    }
    await DrivingActivity.resumeResearchAsync();
}
