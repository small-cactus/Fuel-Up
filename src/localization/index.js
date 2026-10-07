import { Platform } from 'react-native';
import { requireNativeModule } from 'expo';
import catalog from './translations.json';
import { resolveLanguage, translate, formatRelativeTime } from './core.cjs';

// Read Apple's resolved app language, not the device's region. Changing the
// per-app language in iOS Settings restarts the app with matching native resources.
const native = Platform.OS === 'ios' ? requireNativeModule('FuelUpGlass') : null;
export const language = resolveLanguage(native?.getAppLanguage?.() || Intl.DateTimeFormat().resolvedOptions().locale);
export const languageName = { en: 'English', es: 'Español', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文', fil: 'Filipino', vi: 'Tiếng Việt', fr: 'Français' }[language];
export const t = (key, values) => translate(catalog, language, key, values);
export const relativeTime = (timestamp, now) => formatRelativeTime(catalog, language, timestamp, now);

export function distanceText(miles) {
  if (!Number.isFinite(miles) || miles < 0) return null;
  return miles < 0.1 ? t("Right here") : t("{distance} mi away", { distance: miles.toFixed(1) });
}
