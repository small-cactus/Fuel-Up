import DrivingActivity from '../../modules/fuel-up-driving-activity';
import { trackInstallationEvent } from './installationTelemetry';
import { interactionPayload } from './researchInteractionPayload.cjs';

// Native collector is the enrollment authority; tracking failure cannot block Go.
export async function recordResearchInteraction(action, fields) {
    try {
        const payload = interactionPayload(action, fields);
        if (!payload) return false;
        // Installation analytics captures intent without precise coordinates or viewport.
        const usage = { action, clientOccurredAt: payload.clientOccurredAt };
        for (const key of ['surface', 'gesture', 'phase']) if (payload[key]) usage[key] = payload[key];
        if (payload.station?.id) usage.stationId = payload.station.id;
        if (payload.station?.fuelGrade != null) usage.fuelGrade = payload.station.fuelGrade;
        if (payload.station?.displayedRank) usage.displayedRank = payload.station.displayedRank;
        await trackInstallationEvent('ui_action', usage);
        return (await DrivingActivity?.recordResearchInteractionAsync?.(payload)) === true;
    } catch { return false; }
}
