// Explicit opt-in for local design builds. Never enables billing or entitlements.
// Expo inlines this at bundle time; ordinary builds keep the preview hidden.
export const PAYWALL_PREVIEW_ENABLED = process.env.EXPO_PUBLIC_PAYWALL_PREVIEW === '1';
