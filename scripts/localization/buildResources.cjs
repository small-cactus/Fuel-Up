const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const catalogs = require(path.join(root, 'src/localization/translations.json'));
const english = Object.fromEntries(Object.keys(catalogs.es).map(key => [key, key]));
const quote = value => JSON.stringify(value);
function build(output = path.join(root, 'ios/FuelUp/Localization')) {
  for (const [locale, strings] of Object.entries({ en: english, ...catalogs })) {
    const dir = path.join(output, `${locale}.lproj`);
    fs.mkdirSync(dir, { recursive: true });
    const info = {
      NSLocationWhenInUseUsageDescription: 'Fuel Up uses your precise location to find the closest cheapest gas around you.',
      NSLocationAlwaysAndWhenInUseUsageDescription: 'Fuel Up uses your precise location in the background to predict where and when you should stop for gas.',
      NSLocationAlwaysUsageDescription: 'Fuel Up uses your precise location in the background to predict where and when you should stop for gas.',
      NSMotionUsageDescription: 'Fuel Up uses driving, walking, and step activity to understand station stops and improve fuel recommendations.',
    };
    fs.writeFileSync(path.join(dir, 'InfoPlist.strings'), Object.entries(info).map(([key, source]) => `${quote(key)} = ${quote(strings[source] || source)};`).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'Localizable.strings'), Object.entries(strings).map(([key, value]) => `${quote(key)} = ${quote(value)};`).join('\n') + '\n');
  }
  return ['en', ...Object.keys(catalogs)];
}
module.exports = { build };
if (require.main === module) console.log(build().join(', '));
