# Older onboarding selected on iOS patch releases

The connected iPhone reports iOS 27.0.1. React Native's `Platform.Version` on iOS returns the native `UIDevice.systemVersion` string. The onboarding gate used `Number(Platform.Version) >= 16`; `Number('27.0.1')` is NaN, so the gate selected the legacy React onboarding even with the latest native onboarding present in the installed application. Reinstalling identical source could not fix this routing defect.

The gate now parses the integer major version in base 10. The native flow remains selected on iOS 16 and later, including patch versions. Older iOS and Android retain the legacy fallback. No onboarding layout or saved preference changes.

Validation: 29 focused tests passed. The routing test renders the actual onboarding entry with iOS 27.0.1, 26.5, 16.0.3, numeric 16, iOS 15.8.4, and Android API 35, asserting the selected flow. This covers the device-only version shape that the iOS 26.5 simulator did not expose.

Physical-screen inspection was unavailable over the phone's wireless connection; Argent requires USB. The source defect is reproduced by the exact reported operating-system version. Build and installation results are recorded below after completion.

The signed Release build succeeded and was installed successfully on the iPhone 18 Pro Max (com.anthonyh.fuelup). Preferences were preserved. This confirms installation, not a directly observed physical-screen result.
