# Bundled onboarding artwork

The October 1 nationwide cache contains 141,660 station IDs in 18,518 name/brand
combinations. `inventory-brands.json` is the grouped, non-secret inventory used
for matching, not a new provider collection. Matching against US entries from
[name-suggestion-index](https://github.com/osmlab/name-suggestion-index) version
8.0.20260918, plus reviewed same-operator aliases, produced this bundle:

- 167 unique 64 × 64 PNG logos, 736,825 bytes total.
- 256 lookup names, including all four membership identifiers.
- 97,893 station IDs have at least one mapped name (69.1% of the inventory).
- Unmatched station groups are preserved in `unmatched-brands.json`.

We do not claim complete logo coverage. Many independents have no catalog identity;
some source websites blocked downloads. Wikimedia 429 responses and other failures
are retained in `logo-manifest.json`. Promotional photos, generic framework icons,
and blank artwork were rejected. Unknown identities use Apple's neutral pump
symbol. The app performs **zero runtime logo requests**. One image is shared by all
stations of the same brand, well below the user's 1 GB threshold.

`logo-manifest.json` records source URLs and SHA-256 for shipped images.
`reviewed-sources.json` fixes the reviewed selection; null means do not ship a
candidate for that identity. Logos remain the property of their respective brands
and are displayed solely to identify station choices. NSI catalog data is BSD-3-Clause;
its logo references do not grant a blanket license to the referenced trademarks.

## Rebuild

Use a scratch directory with `inventory.json` copied from `inventory-brands.json`.
Download and unpack the pinned NSI npm package there (its root is `package/`).
Install `sharp` into a `tooling/` subdirectory of that scratch directory, then run:

```sh
python3 scripts/brand-assets/matchCatalog.py --workdir /absolute/scratch/path
node scripts/brand-assets/fetchLogos.mjs /absolute/scratch/path
```

Downloads use fixed identity, bounded concurrency, timeouts and size limits. A 429
halts further downloads to that host for the run; respect its Retry-After before
any later run. Source URLs may expire. Inspect every changed asset visually and
compare the generated `download-manifest.json` with the committed evidence before
updating it. Never replace a failed download with unrelated parent-company artwork.

`buildFuelIcons.py` produces original, simple SVG pump illustrations with outlined
numerals. It needs Python fontTools and macOS Arial Bold. The compiled Xcode asset
catalog preserves the vectors. Yellow gasoline/E85 and green diesel are illustrative
fuel cues, not a claim that nozzle colors are regulated by state. US octane labels
are yellow/black nationally; retailer nozzle colors vary. Sources:
[FTC fuel-rating rule](https://www.ftc.gov/business-guidance/resources/complying-ftc-fuel-rating-rule),
[DOE E85](https://afdc.energy.gov/fuels/ethanol-e85),
[OPW BP nozzle example](https://www.opwglobal.com/products/us/retail-fueling-products/standard-dispensing-equipment/automatic-nozzles-gas-station/14bp-nozzle-1).

Check bundle integrity with `node --test tests/onboardingAssets.test.cjs`.
