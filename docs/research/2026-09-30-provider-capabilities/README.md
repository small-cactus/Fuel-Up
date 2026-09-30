# GasBuddy price history, geographic scope, and pagination probes

Observed September 30, 2026. This is a research checkpoint; no app, production
collector, schedule, or price-correction behavior was changed.

## Findings

1. **Current per-station prices work.** `station(id: "172657")` returned the
   station and five fuel-product entries, each with separate cash/credit price
   and report time. E85 was zero with no timestamp, which means no usable quote,
   not free fuel. These are current reports, not all contributor submissions.
2. **No consumer station-history query was confirmed.** The explicit
   `Station.priceHistory` field is rejected. Schema introspection is disabled;
   we did not attempt to circumvent that. This does not prove no other history
   interface exists. Direct HTML retrieval of the homepage received 403 and was
   not retried; no challenge solver, account rotation, or proxy rotation was used.
3. **Historical station data exists outside the tested consumer interface.**
   Chicago Booth's Kilts Center describes PDI/GasBuddy station-level historical
   data for 2018–2024, delivered as CSV files, restricted to eligible academic
   researchers. This is evidence that an archive exists, not access for Fuel Up.
   OPIS separately advertises historical retail-site prices for over 85,000
   stations, with some history dating to 1996. Its retail history is a commercial
   product, not a discovered free GasBuddy history endpoint.
4. **Regional trends are available now.** A live `Location.trends` query returned
   Tampa, Florida, and United States values for `today`, `todayLow`, and `trend`.
   This response is an aggregate snapshot/direction, not a dated time series.
   GasBuddy also advertises historical area-average charts; these cannot label
   an individual station's true historical pump price.
5. **The default page size is not the ceiling.** `Location.stations(limit: 500)`
   works. We tested up to 500; the absolute maximum permitted page size is unknown.
6. **Nearby search appears to use about 25 km (15.53 miles).** All 1,426 stations
   counted near New York were retrieved in three pages of 500/500/426, with no
   duplicate IDs; the farthest was 24.976 km away. Clearwater returned all 321
   counted stations in one request, with the farthest 24.918 km away. This supports
   an approximately 25-km default boundary, not proof of an absolute server limit
   or completeness against every real-world station. `radius`, `maxDistance`, and
   `distance` were rejected as arguments on `Location.stations`; `radius` was
   also rejected on `Query.locationBySearchTerm`.
7. **State-name searches cover much more than nearby searches.** Searching
   `Florida` reports 7,931 stations. Its first 500 results spanned latitudes
   25.58–30.78 and longitudes -87.42–-80.06, so this is statewide scope. However,
   the next 500 contained 57 IDs already seen, leaving 943 unique stations.
   Completeness of state pagination is unproven. The cause of overlap was not
   established; sorting ties and live updates are possibilities, not findings.
8. **A non-null cursor does not prove another full page exists.** New York still
   returned a next cursor after all 1,426 unique records had been read. The rural
   Kansas probe returned all 10 counted stations on page one, then one duplicate
   on page two. A collector needs distinct-ID accounting, no-progress detection,
   bounded page counts, and coverage reconciliation, not a cursor-only loop.
9. **Searching `United States` is not a national inventory.** It returned a count
   of three. Do not treat that search result as all US stations or a national count.

## Small-probe evidence

| Query | Reported total | Returned | Distinct within response | Furthest from origin |
| --- | ---: | ---: | ---: | ---: |
| Clearwater, default limit | 321 | 20 | 20 | 2.42 mi reported |
| Clearwater, limit 100 | 321 | 100 | 100 | 6.25 mi reported |
| Clearwater, limit 500 | 321 | 321 | 321 | 24.918 km calculated |
| Rural Kansas, default limit | 10 | 10 | 10 | 14.96 mi reported |
| Fairbanks, limit 100 | 45 | 45 | 45 | 13.65 mi reported |
| New York, three pages at limit 500 | 1,426 | 1,426 | 1,426 across all pages | 24.976 km calculated |
| Florida, two pages at limit 500 | 7,931 | 1,000 | 943 across both pages | Statewide, no radius origin |

All returned records include every reported grade from the `prices` field; no
fuel filter was used in these geographic probes. Many catalog records have no
usable current price: only 694 of the 1,426 New York records had any positive
cash/credit quote. Returned station count is not current-price coverage.

The investigation made **21 direct GraphQL requests**: 17 HTTP 200 responses and
four HTTP 400 validation responses (schema inspection, history field, radius
arguments, and distance arguments). The initial app-query response was inspected
but not saved; it is excluded from the saved station comparisons. Subsequent
scripted probes were sequential with a two-second pre-request delay and stopped
on authentication/access/rate-limit responses. This was not a throughput test.

[Machine-readable evidence](probe-results.json) saves queries, public search
coordinates, timestamps, counts, computed distances, and station-ID fingerprints.
Headers, tokens, cursors, reporter identities, and full bulk price payloads are
not included. Offline assertions checked the New York union and Florida overlap.

## Nationwide hourly request estimates

These are estimates, not an executed national collection or an approved quota.

**Geographic grid:** Using Census land area of 3,533,038.28 square miles, including
Alaska and Hawaii, and an assumed 25-km radius:

- Staggered triangular centers: `area / ((3*sqrt(3)/2) * radiusMiles^2)` = about
  **5,635 requests/hour**, before extra pages and boundary overhead.
- Square centers, separated by `sqrt(2)*radius`: `area / (2 * radiusMiles^2)` =
  about **7,320 requests/hour**, before extra pages and boundary overhead.
- These are idealized flat-plane area estimates. Coastlines, boundaries, islands,
  projection effects, result limits, overlaps, and retries require adjustment.
- A conservative 15-mile planning radius gives about **6,044–7,851** base queries.
- Dense areas need extra pages: the sampled New York circle required three.

**State paging:** If a US inventory contains an illustrative **150,000–200,000
station records**, 500 per page across 50 states plus DC implies approximately
**300–450 requests/hour**: `sum(ceil(stateCount/500))`. That is roughly
7,200–10,800 requests/day, before overlap, retries, and reconciliation. The US
record count was not measured, all states were not tested, and the Florida
overlap prevents presenting this as verified complete coverage. These are ideal
page-budget scenarios, not evidence that 300–450 requests will collect everything.

State paging is the more promising direction to investigate. Before expanding
the collector, establish stable enumeration/coverage checks and an agreed
provider quota and data-use arrangement. A successful 500-row response does not
establish permission, rate tolerance, or a service-level guarantee. We did not
increase the running seven-day campaign's request volume.

## Sources inspected

- [PDI/GasBuddy historical research dataset, Chicago Booth](https://www.chicagobooth.edu/research/kilts/research-data/gasbuddy)
- [OPIS custom retail price history](https://www.opis.com/product/pricing/oil-prices-forecast-and-history/custom-history/)
- [GasBuddy historical area charts](https://charts.gasbuddy.com/)
- [Census US land area](https://www.census.gov/quickfacts/fact/table/US/LND110220)
- [py-gasbuddy author documentation](https://pypi.org/project/py-gasbuddy/): used
  to identify the ordinary `cursor { next }` and `trends` query fields. Package
  source was read, not installed or executed. Its documented `limit` is a
  client-side slice; the server-side `Location.stations(limit:)` above was
  separately established by live requests.

No conclusion here assumes that a later crowd report is verified pump truth.
