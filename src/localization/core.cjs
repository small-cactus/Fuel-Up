// Locale selection is shared with iOS; unknown languages deliberately fall back to English.
const supported = ['en', 'es', 'zh-Hans', 'zh-Hant', 'fil', 'vi', 'fr'];
function resolveLanguage(value) {
  const tag = String(value || 'en').replaceAll('_', '-');
  if (/^zh/i.test(tag)) return /Hant|TW|HK|MO/i.test(tag) ? 'zh-Hant' : 'zh-Hans';
  const base = tag.toLowerCase().split('-')[0];
  return base === 'tl' ? 'fil' : supported.includes(base) ? base : 'en';
}
function translate(catalog, language, key, values = {}) {
  const text = catalog[resolveLanguage(language)]?.[key] || key;
  return text.replace(/\{(\w+)\}/g, (token, name) => Object.hasOwn(values, name) ? String(values[name]) : token);
}
function formatRelativeTime(catalog, language, timestamp, now = Date.now()) {
  const date = new Date(timestamp).getTime();
  if (!timestamp || !Number.isFinite(date)) return '—';
  const minutes = Math.max(0, Math.floor((now - date) / 60000));
  if (!minutes) return translate(catalog, language, 'Just now');
  // Hermes does not provide Intl.RelativeTimeFormat on every supported build.
  const [count, key] = minutes < 60 ? [minutes, '{count}m ago'] : minutes < 1440 ? [Math.floor(minutes / 60), '{count}h ago'] : [Math.floor(minutes / 1440), '{count}d ago'];
  return translate(catalog, language, key, { count });
}

module.exports = { supported, resolveLanguage, translate, formatRelativeTime };
