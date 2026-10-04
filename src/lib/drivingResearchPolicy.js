import { Platform } from 'react-native';
import DrivingActivity from '../../modules/fuel-up-driving-activity';
export function nativeResearchOwnsTracking() {
    return Platform.OS === 'ios' && DrivingActivity?.ownsBackgroundTracking?.() === true;
}
// The driving pilot is observational. It must never initiate an alert or activity.
export const DRIVING_ALERTS_ENABLED = false;
export const LIVE_ACTIVITIES_ENABLED = false;
