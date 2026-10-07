# Fuel Up app languages

The initial iOS language set is English, Spanish, Simplified Chinese, Traditional
Chinese, Filipino/Tagalog, Vietnamese, and French. App Store distribution remains
US-only; this does not change fuel coverage, dollars, gallons, miles, octane
identifiers, station names, or research answer IDs.

Settings → Language opens Apple's per-app Settings. iOS owns the persisted choice
and restarts the app when that choice changes. `FuelUpGlass.getAppLanguage` reads
`Bundle.main.preferredLocalizations` so React Native uses the same choice as
SwiftUI and the localized system permission purpose strings. Unsupported languages
fall back to English. Apple shows the per-app language picker when the device has
more than one preferred language in Settings → General → Language & Region.
No private AppleLanguages preference is written by the app.

## Adding text or a language

- Keep English source copy as keys in `translations.json` and add every translation.
- Use `t(key, values)` in React Native. Translate presentation only, never stored
  status codes, fuel grade IDs, search queries, or participant label values.
- SwiftUI string literals resolve through the main app bundle. For dynamic source
  strings, use `LocalizedStringKey` or `NSLocalizedString` at the display boundary.
- Dynamic templates use named `{placeholders}`; keep the exact names in every
  language. Do not insert already-interpolated English into a localization lookup.
- `plugins/withFuelUpLocalization.js` generates and registers the native resources
  during prebuild. `node scripts/localization/buildResources.cjs` refreshes them in
  an existing native checkout without regenerating Pods. Language additions also
  require updating the supported list, display names, plugin locales, and app.json.
- `node --test tests/localization.test.cjs` checks matching keys, placeholders,
  fallback behavior, permission resources, and idempotent Xcode registration.

The translations cover the main iOS flows, research consent, and local stop and
tracking notifications. Provider/OS errors and server-authored remote test-push
text may fall back to English. Store listing metadata is separate. Translations
have not received native-speaker editorial review.
