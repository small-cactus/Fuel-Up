// Public availability feeds. Deliberately discard prices and contributor identities.
export const E85_SOURCES = {
  e85prices: { url: 'https://e85prices.com/bigmap/ajaxGetMarkers', minimum: 4000 },
  thorntons: { url: 'https://www.mythorntons.com/locations/', minimum: 100 },
};
const stateNames = 'Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|District of Columbia|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming'.split('|');
const stateCodes = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
const states = new Map(stateNames.map((name, i) => [name.toLowerCase(), stateCodes[i]]));
const decode = text => String(text || '').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&nbsp;/g, ' ');
const clean = text => decode(text).trim().replace(/\s+/g, ' ');
function valid(row) {
  return row.source_id && row.name && row.street && row.city && stateCodes.includes(row.state) &&
    Number.isFinite(row.latitude) && Number.isFinite(row.longitude) &&
    row.latitude >= 18 && row.latitude <= 72 && row.longitude >= -180 && row.longitude <= -60;
}
export function parseE85Source(source, body) {
  let raw;
  if (source === 'e85prices') {
    const data = JSON.parse(body);
    if (!Array.isArray(data)) throw Error('INVALID_SOURCE_SCHEMA');
    raw = data.filter(row => String(row.active) === '1').map(row => ({
      source_id: String(row.id || ''), name: clean(row.name), street: clean(row.address), city: clean(row.city_name),
      state: states.get(clean(row.state_name).replaceAll('-', ' ').toLowerCase()),
      latitude: Number(row.lat), longitude: Number(row.lng),
    }));
  } else if (source === 'thorntons') {
    // These attributes/classes drive the retailer's own E85 filter. Never infer
    // availability from brand, other grades, or arbitrary text on the page.
    raw = [...body.matchAll(/<div\s+data-type="store"([^>]+)>([\s\S]*?)<\/p>/g)].flatMap(([, attrs, block]) => {
      const classes = block.match(/<p\s+class="([^"]*)"/)?.[1]?.split(/\s+/) || [];
      if (!classes.includes('E85')) return [];
      const parts = block.replace(/<p[^>]*>/, '').split(/<br\s*\/?\s*>/i)
        .map(part => clean(part.replace(/<[^>]*>/g, ' '))).filter(Boolean);
      const id = parts[0]?.match(/#(\d+)/)?.[1];
      const state = classes.find(value => stateCodes.includes(value));
      return [{ source_id: id, name: 'Thorntons', street: parts[1], city: clean(block.match(/data-type="city"[^>]*>([^<]*)/)?.[1]), state,
        latitude: Number(attrs.match(/data-latitude="([^"]+)"/)?.[1]),
        longitude: Number(attrs.match(/data-longitude="([^"]+)"/)?.[1]) }];
    });
  } else throw Error('UNKNOWN_SOURCE');
  const rows = raw.filter(valid);
  if (rows.length < E85_SOURCES[source].minimum || rows.length < raw.length * 0.98) throw Error('INCOMPLETE_SOURCE');
  if (new Set(rows.map(row => row.source_id)).size !== rows.length) throw Error('DUPLICATE_SOURCE_IDS');
  return { rows, rejected: raw.length - rows.length, sourceCount: raw.length };
}
