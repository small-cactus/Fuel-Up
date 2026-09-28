# Onboarding QA flow

`onboarding-native-controls.yaml` replays a clean onboarding path and selects E85. It passed all 22 steps on the iPhone 17 Pro Max simulator, iOS 26.5, at default text size with location and notification permissions already granted.

Run it from the welcome page, not an existing Home session. The flow deliberately does not reinstall or erase the app. Its `executionPrerequisite` describes the state to prepare.

Every Continue action uses `onboarding-continue`. The E85 row is a native SwiftUI Picker: XCTest exposes the row as a button, but Argent's UIKit projection does not expose its identifier. The flow first verifies its AX label and then uses one documented, device-specific coordinate tap. Do not reuse that coordinate on another device or text size.

The predictive demo intentionally animates and the final Home screen can load prices after its tab bar appears; idle warnings at those points do not prove animation or network completion. The independent XCTest harness verifies radius/grade persistence and compact-screen footer separation. See `docs/qa/2026-09-28-progress.md` for evidence and known failures.
