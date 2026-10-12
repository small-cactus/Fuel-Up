import DrivingActivity from '../../modules/fuel-up-driving-activity';

export async function trackInstallationEvent(kind, fields = {}) {
    try { await DrivingActivity?.recordInstallationEventAsync?.(kind, fields); }
    catch { /* Product telemetry never prevents the user's action. */ }
}
