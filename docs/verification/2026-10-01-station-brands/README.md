# Combined station brands screen

Memberships now live on Station Brands in onboarding and Settings. Onboarding returns to seven pages. One native SwiftUI Form contains state-specific membership switches and preferred brands; native search filters preferred brands and temporarily hides memberships without clearing their selections. The former membership-only page and sheet were removed.

The search control is UIKit UISearchBar in the local FuelUpNativeSearch Expo module. UIKit supplies the field, magnifier, clear button, Cancel action and system appearance. No React Native TextInput or custom glass rendering is used. New installations require a native build (pod autolinking discovers the module).

Membership eligibility and the 20-cent preferred-brand ranking advantage are unchanged. Displayed prices remain raw. Both selections save together at onboarding completion; Settings persists each edit.

Checks:
- 25 focused tests passed: brand request lifecycle/search, membership rapid edits and saved out-of-state access, seven-page onboarding, permission navigation, atomic final preference saving, and eligibility/ranking rules.
- Standard npm test: 149 passed.
- ESLint: no errors; existing inline-style/performance warnings remain.
- Native simulator and device Release builds succeeded.
- iOS 26.5 simulator, 375×812: seven-page onboarding, native search keyboard, Wawa filter, row selection, clear text, Cancel, light/dark appearance, and combined Settings sheet checked. Sam’s Club and Wawa survived clearing/canceling search and persisted together after Get Started (verified in local storage).
- One transient membership lookup failed initially; native Try Again recovered. Search now hides the membership section without unmounting discovery, so clearing a search does not trigger another geocode.
- Caught and fixed an Expo import integration error during live QA (`requireNativeView` comes from `expo` in this SDK). Rebuilt Release after the fix.
- Installed the completed Release build on the iPhone 18 Pro Max; installation confirmed by devicectl. Did not open the phone app. Phone interaction remains unverified.
