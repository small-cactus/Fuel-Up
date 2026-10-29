# Settings tab-bar viewport correction

The Settings screen applied its bottom safe-area inset outside the SwiftUI Form,
shortening the scroll viewport and leaving a solid background strip behind the
floating tab bar. The form now fills the bottom of the screen. SwiftUI content
margins place the safe-area allowance plus 16 points inside the scrolling content
and scroll indicators, so the last row can move fully above the tab bar. Settings
disables the navigator's automatic content insets because it manages them itself.
The native tab bar and glass materials are unchanged.

Verified on FuelUp Glass Lab, iOS 26.5 simulator, after a successful native Debug
build and in-place installation. Light/dark screenshots show content continuing
behind the tab bar. At the bottom in both themes the Privacy Policy row ends at
normalized y=0.878, above the tab bar beginning at y=0.898. The simulator theme was
restored to Light. This is simulator visual verification, not physical-phone QA.

165 standard tests and seven focused Settings lifecycle/preference-page tests
pass. The lifecycle fixture needed a no-op installation telemetry mock after an
older production import had been added; no assertions were changed. No cluster
or map behavior is changed by this layout correction.

Native API: https://developer.apple.com/documentation/swiftui/view/contentmargins(_:_:for:)-lgl5
