# Support, privacy, localization, and accessibility receipt

Saved October 7, 2026 UTC. App Store Connect app 6759831421, version 1.0.

## Published website

- Support: https://sites.google.com/view/fuel-up-gas/support
- Privacy: https://sites.google.com/view/fuel-up-gas/home
- Replaced the obsolete site logo with `assets/fuelup-icon.png`, the current yellow/orange pump artwork. Set logo alt text to Fuel Up and updated the favicon.
- Published the support page and revised privacy policy together. Reloaded both public pages and verified their rendered text. Public screenshots and the published HTML are included here.
- Public support contact was explicitly approved by the user. The support page calls out no signup, U.S. coverage, reported-price limitations, E85 availability versus price, research controls, and support/privacy contact.

## Saved store metadata

- English description and promotional text mention no signup. Saved the support URL above.
- Added Spanish (Mexico), Simplified Chinese, Traditional Chinese, French, and Vietnamese descriptions, promotional text, keywords, localized names, and subtitles. Saved each locale through App Store Connect and confirmed saved state.
- `listing-localizations.json` preserves the copy. Names/subtitles, promotional text, keywords, and descriptions pass their character limits.
- These are assistant-drafted translations, without native-speaker review. Screenshots remain the English assets; localized screenshot artwork was not uploaded in this task. Filipino was not offered as a store metadata locale.
- No app binary changed, no new build uploaded, and no App Review submission made. The UI still showed Prepare for Submission.

## Accessibility evidence and declaration

Tested the installed simulator app on iPhone 17 Pro Max, iOS 26.5, device E5661CAA-BB65-4806-879A-D00C553836E7. This is simulator evidence, not physical-device certification.

- **Dark Interface:** saved as an iPhone draft in App Store Connect. Runtime screens inspected in dark mode: home/map and station card, Trends, Settings, fuel types, brand settings, research screen/consent, onboarding welcome, and location introduction. Screenshots included. The remaining onboarding sequence stalled waiting for a simulator location fix; it was not completed in this audit. Native onboarding theme handling was also inspected in source.
- Apple disabled Publish because no app version has been released on the App Store. The accessibility declaration is saved under Drafts, not public yet.
- **Larger Text:** not declared. At the maximum accessibility text size, station-card and settings labels enlarged, but map price bubbles and search-radius values stayed small. Screenshots preserve the gap. Research consent enlarged as well; its full scrolling behavior at maximum size was not certified.
- **VoiceOver / Voice Control:** not declared. Simulator Settings did not expose these features. The accessibility tree alone is not a screen-reader pass; map entries included duplicated groups and decorative icon labels.
- **Reduced Motion:** not declared. Enabled the system setting and exercised the app, inspected the source guards for splash, onboarding, and map behavior. No complete recorded animation audit was performed, so static screenshots and source checks were not treated as full verification.
- **Differentiate Without Color Alone / Sufficient Contrast:** not declared without complete feature/contrast validation. Yellow E85 and price ranking colors need a dedicated audit of their redundant labels.
- **Captions / Audio Descriptions:** not declared; no relevant app media was verified.

Criteria consulted: Apple's App Store Connect accessibility overview, Dark Interface evaluation criteria, and Reduced Motion evaluation criteria. The label is intentionally limited to the evidence gathered, not every accessibility option offered by Apple.

## Cleanup and remaining test state

- Restored simulator Dynamic Type to its original 18% slider value and Reduce Motion to Off. The pre-existing Larger Accessibility Sizes switch remained On.
- Simulator app remains in dark theme and setup was reopened for testing; location lookup was still pending. No research consent was accepted and no physical phone was opened.
- Stopped only this session's simulator automation services. Other simulators were left alone.
