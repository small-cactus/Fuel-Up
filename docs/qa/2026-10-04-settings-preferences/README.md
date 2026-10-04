# Settings preference pages — October 4, 2026

Settings now links to shared native onboarding fuel and station selection pages. These Settings versions use the app's black/light backgrounds, omit onboarding introductions and Save, and persist selections immediately. The native navigation bar hosts the wordmark and Back above the existing Settings progressive blur. The shared memberships section shows three skeleton rows and a neutral native spinner while loading.

## Verification

- iPhone 17 Pro Max simulator, iOS 26.5; Debug native build succeeded.
- Checked Settings → Fuel Type and Settings → Station Brands in light and dark themes. No page title, introductory copy, map, or Save button. Wordmark is aligned with Settings; Back remains crisp and usable.
- Selected Regular and enabled Also needs E85. Back showed `Regular + E85`; reopening preserved both selections. The saved 12-mile search radius and station choices were unchanged.
- Selected Sam's Club, then read persistent storage: memberships were Costco and Sam's Club, fuel remained Regular + E85, favorite remained Shell, and radius remained 12 miles. No Save action was needed.
- Held the membership RPC response in the simulator debugger to inspect loading. Three skeleton rows and a neutral spinner appeared while saved favorites stayed usable. Releasing the response replaced placeholders with selectable memberships and retained Costco. This was a controlled loading-state fixture, not a network-performance measurement. No production data or backend was modified.
- Both onboarding and Settings use `OnboardingBrandsPage` and `OnboardingMembershipSkeleton`. The data regression verifies that loading is forwarded while saved memberships survive discovery. The new skeleton was visually inspected in Settings; the complete onboarding flow was not repeated for this last styling change.
- 62 tests passed across preferences, onboarding state/interaction/assets/location/flow, Settings lifecycle and automatic saving, theme, and brand interactions.
- Scoped ESLint: no errors; existing component performance/style warnings remain. The new `PreferencePage` passes lint without warnings.
- Cluster animation code was not changed; the live cluster split/merge probe was not run for this task.

Screenshots: [fuel dark](fuel-dark.png), [fuel light](fuel-light.png), [membership loading](membership-loading.png), [brands light](brands-light.png).

## Physical installation

The final incremental signed Release build completed in 52 seconds. `codesign --verify --deep --strict` passed. Installed in place using `devicectl` over the paired network connection on iPhone 18 Pro Max (`00008160-001E206E02A0000A`). The follow-up app inventory confirmed `com.anthonyh.fuelup`, version 1.0.0, build 1. App data was preserved. Physical launch and visual QA are separate from this installation; screenshots above are from the simulator.
