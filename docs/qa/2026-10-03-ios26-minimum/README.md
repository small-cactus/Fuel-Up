# iOS 26 minimum support

The user requires Fuel Up to support only iOS 26 and later. Expo build properties now set deploymentTarget to 26.0. The Xcode config plugin enforces the same floor for the app and widget configurations so regeneration cannot restore expo-widgets' older minimum. Generated native project settings and CocoaPods platform were refreshed locally; their durable source is the committed Expo configuration and plugin.

On iOS the onboarding entry always selects NativeOnboarding. It no longer parses Platform.Version or routes older version strings to the legacy screen. The React flow remains available only to other platforms.

Eight focused tests passed, covering regenerated app/widget settings, native routing on iOS patch versions and missing version metadata, Android fallback, onboarding state, and completion persistence. Signed Release build succeeded. The built app and widget Info.plists both report MinimumOSVersion 26.0. Installation on the connected iPhone 18 Pro Max succeeded, preserving app data. Physical-screen verification remains unobserved because the phone is connected wirelessly and the UI tooling requires USB.
