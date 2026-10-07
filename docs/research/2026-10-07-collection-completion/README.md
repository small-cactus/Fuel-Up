# Seven-day research collection completion

Both fixed research windows ended October 7, 2026 at 18:19 UTC (2:19 PM Eastern).
The 24-city campaign began September 30 at 18:19 UTC; the national window began
at 22:00 UTC. Neither window was extended and no replacement collection was run.

## City observations

The campaign completed 3,978 of 4,032 planned city-hours (98.66%), with 54
historical missed slots and zero unresolved jobs. All 24 cities were observed,
producing 79,560 station observations across 505 distinct station IDs.
27,206 station observations contained no usable price for any returned grade;
these remain missing. The reserved final two days contain all 1,152 planned
city-hour snapshots, retained without model scoring. The campaign is marked complete and its
collection Cron schedules were removed by its existing completion logic.

`city-observations.json.gz` is the complete raw export from the committed
`exportCollection.mjs` tool. `city-summary.json` validates distinct snapshot IDs,
observation times and totals against campaign health, records the export hash,
and reports city and chronological split inventory. These are provider-selected
first-page panels, not complete city inventories.

## National observations

Of 165 expected hour slots, including the shortened final 18:00–18:19 slot:

- 149 completed all 72 batches and 141,660 catalog IDs (90.30% of slots).
- 11 run rows are partial, including three with zero successful batches.
- Five expired slots have no run row. These are counted as missing, not omitted.
- No runs remain in progress. Historical gaps are enumerated in `coverage.json`.

Across complete and partial runs, 11,098 successful batches preserve 21,831,273
station observations. Of those, 14,200,242 have at least one reported price;
7,631,031 do not. No price was filled in or treated as pump truth. Successful
batch coverage is 11,098 of 11,880 planned batches (93.42%).

Final run 9001 completed at 18:16:26 UTC, before the deadline. Full read-back with
`auditHour.mjs` verified all 72 objects, SHA-256 hashes, sizes, exact catalog IDs,
price schema, observation times and regional provenance. Its 141,660 IDs include
93,479 with prices and 48,181 without prices. This is a full final-hour audit,
not a claim that every historical object was downloaded and hash-checked again.

The catalog remains `4d220708-04f3-4c27-bdae-88d1aa45ebe2`. Across the campaign,
zero successful jobs used a region different from their assigned batch region.
Final-hour distribution: Virginia 117,700 IDs, Northern California 17,747 and
Oregon 6,213. Texas and DC retain the documented geographic coverage assumptions;
Texas returned one more inventory ID than the provider's reported aggregate.
Catalog coverage is not proof of complete real-world station coverage.

## Preservation and shutdown

National raw archives remain in Supabase project `vjindchxfebaltbslqwc`, private
Storage bucket `fuel-national`. `national-archive-manifest.json.gz` records each
successful job's exact object path, hash, region, timestamps and size. Object URLs
are not made public. Every successful job's referenced object exists in Storage.
The bucket retains 11,121 objects totaling 570,217,294 bytes, below its unchanged
900,000,000-byte budget; this includes retained objects beyond the 11,098
successful job references. Nothing was pruned or overwritten.

The national collector is disabled with `COLLECTION_END`, and its last provider
request was 18:16:22 UTC. National dispatcher/watchdog Cron entries still exist,
but the disabled/end-time guards prevent further collection. Cache/publication
maintenance was left intact. All ten Trends scopes reference the final complete
run. No recent Cron failures were found. No deployment or repair was necessary.

The October 5 18:19 through October 7 18:19 final two-day evaluation remains
reserved under `scripts/price-model/MARKET_LAG_PROTOCOL.md` and the prospective
model protocol. Exporting and validating inventory does not authorize model
fitting, model selection, holdout scoring, or production ranking changes.
The full raw export is preserved; the completion summary performs no model or
price-change evaluation.

Validation: final full-hour archive read-back passed; raw city export is checked
against all 3,978 successful jobs and 79,560 station observations. The auxiliary
manifest query initially used an ambiguous join column and was corrected before
export; that was a local diagnostic error, not a collector incident.
