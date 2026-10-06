# TestFlight 1.0.0 (24)

Application source: master through `5784811`, including `03d3cba`; repository checkpoint before packaging: `ee80bbc`.

## Changes from build 23

- Station-stop policy v2 reduces prompts caused by traffic stops.
- Optional driving research records Apple step and walking-distance summaries around station stops, nearby system visit observations, course accuracy, and collection conditions.
- Consent and Motion & Fitness wording explicitly include steps and walking distance.
- Cross-checks retain unknown results separately from zero measurements and never establish a fuel purchase without a tester answer.

## What to Test

Enable optional Driving Research in Settings, then drive normally. Check whether station prompts correspond to actual stops and answer whether you got fuel, stopped without fuel, or did not stop. Check that background prompts arrive with the app closed normally. Research now includes walking and step summaries plus Apple visit observations to help distinguish stops. Check pause/resume, permission recovery, and syncing on Wi-Fi after 500 samples or using Sync Data. Please report missed stops or prompts during traffic waits.

## Preparation

- Reserved build 24 in EAS and confirmed the remote build number.
- Updated the app configuration and local generated native app/extension versions to 24.
- 23 focused packaging, research, cross-check, APNs, permission, and health tests passed; packaging tests also passed after the version change.
- Archive uses Release configuration and `EXPO_PUBLIC_APNS_ENV=production`, reusing the existing device build cache.

## Distribution

Archive/upload and tester availability verification pending.
