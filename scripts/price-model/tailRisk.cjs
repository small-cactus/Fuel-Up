// Diagnostic only. Re-score frozen predictions; never train or call an API here.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { predictDelta } = require('./scoreRanking.cjs');

function distribution(values) {
    assert.ok(values.every(Number.isFinite));
    if (!values.length) return { count: 0, p95: null, worst5Mean: null, worst5Count: 0, max: null };
    const sorted = [...values].sort((a, b) => a - b);
    const position = .95 * (sorted.length - 1);
    const lower = Math.floor(position), upper = Math.ceil(position);
    const tailCount = Math.ceil(.05 * sorted.length);
    return { count: sorted.length,
        p95: sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower),
        worst5Mean: sorted.slice(-tailCount).reduce((sum, value) => sum + value, 0) / tailCount,
        worst5Count: tailCount, max: sorted.at(-1) };
}

function errors(rows, policy) {
    const signed = rows.map(row => (row.prices[policy] - row.targetPrice) * 100);
    return { absolute: distribution(signed.map(Math.abs)),
        tooLow: distribution(signed.map(value => Math.max(0, -value))),
        tooHigh: distribution(signed.map(value => Math.max(0, value))),
        underByMoreThan10Cents: signed.filter(value => value < -10 - 1e-6).length,
        overByMoreThan10Cents: signed.filter(value => value > 10 + 1e-6).length };
}

function fixedSlice(rows, baseline, policies) {
    // Include all boundary ties, rather than arbitrarily selecting easier rows
    // for one policy. Every policy is then judged on the identical hard cases.
    const ordered = [...rows].sort((a, b) => Math.abs(b.prices[baseline] - b.targetPrice) - Math.abs(a.prices[baseline] - a.targetPrice));
    const cutoff = Math.abs(ordered[Math.ceil(rows.length * .05) - 1].prices[baseline] - ordered[Math.ceil(rows.length * .05) - 1].targetPrice);
    const selected = ordered.filter(row => Math.abs(row.prices[baseline] - row.targetPrice) >= cutoff - 1e-8);
    return { baseline, cutoffCents: cutoff * 100, countWithBoundaryTies: selected.length,
        uniqueStations: new Set(selected.map(row => row.station)).size,
        cases: selected.map(row => ({ case: row.case, station: row.station, sourceAt: row.sourceAt, targetPrice: row.targetPrice })),
        policies: Object.fromEntries(policies.map(policy => [policy, {
            meanAbsoluteErrorCents: selected.reduce((sum, row) => sum + Math.abs(row.prices[policy] - row.targetPrice) * 100, 0) / selected.length,
            improved: selected.filter(row => Math.abs(row.prices[policy] - row.targetPrice) < Math.abs(row.prices[baseline] - row.targetPrice) - 1e-8).length,
            worsened: selected.filter(row => Math.abs(row.prices[policy] - row.targetPrice) > Math.abs(row.prices[baseline] - row.targetPrice) + 1e-8).length,
            ...errors(selected, policy) }])) };
}

function run(dataset, root) {
    const read = file => JSON.parse(fs.readFileSync(path.join(root, file)));
    const inputs = read('openai-history-inputs.json');
    const prior = read('openai-results.json');
    const groups = new Map();
    for (const sample of dataset.samples) {
        const key = `${sample.snapshotId}|${sample.payment}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(sample);
    }
    const models = Object.fromEntries(['ridge', 'huber', 'tiny_mlp_price'].map(name => [name, read(`${name}.json`)]));
    const tree = read('ranking-tree-predictions.json').predictions;
    const llms = Object.fromEntries([['gpt-6-luna', 'none'], ['gpt-5.6-terra', 'none'], ['gpt-6.1-sol', 'low']].map(([model, effort]) =>
        [`${model}/${effort}`, new Map(fs.readFileSync(path.join(root, `openai-history-${model}-${effort}.jsonl`), 'utf8')
            .trim().split('\n').map(JSON.parse).filter(row => row.valid).map(row => [row.case, row.prediction]))]));
    const commonCases = inputs.cases.filter(testCase => Object.values(llms).every(results => results.has(testCase.case)));
    const rows = commonCases.flatMap(testCase => {
        const predictions = Object.fromEntries(Object.entries(llms).map(([name, results]) => [name,
            new Map(results.get(testCase.case).predictions.map(row => [testCase.idMap[row.id], row.price]))]));
        return groups.get(testCase.batchId).filter(row => row.targetPrice !== null).map(row => ({
            case: testCase.case, id: row.id, station: row.station, fuel: row.fuel, payment: row.payment,
            sourceAt: row.sourceAt, targetSourceAt: row.targetSourceAt, targetPrice: row.targetPrice,
            prices: { raw: row.rawPrice, current_math: row.mathPrice, boosted_trees: tree[row.id],
                ...Object.fromEntries(Object.entries(models).map(([name, model]) => [name, row.rawPrice + predictDelta(model, row.featureValues)])),
                ...Object.fromEntries(Object.entries(predictions).map(([name, values]) => [name, values.get(row.station)])) } }));
    });
    const policies = Object.keys(rows[0].prices);
    for (const policy of policies) {
        const mae = rows.reduce((sum, row) => sum + Math.abs(row.prices[policy] - row.targetPrice) * 100, 0) / rows.length;
        assert.ok(Math.abs(mae - prior.commonCandidateMetrics[policy].maeCents) < 1e-8);
    }
    const seen = new Set();
    const uniqueReports = rows.filter(row => {
        const key = `${row.station}|${row.fuel}|${row.payment}|${row.sourceAt}|${row.targetSourceAt}|${row.targetPrice}`;
        if (seen.has(key)) return false;
        seen.add(key); return true;
    });
    const regrets = Object.fromEntries(Object.keys(prior.summaries).map(policy => {
        const choices = prior.details.filter(row => commonCases.some(testCase => testCase.case === row.case))
            .map(row => row.policies[policy]?.withinTwoHours);
        const observed = choices.filter(row => row?.regretLowerBoundCents !== null && row?.regretLowerBoundCents !== undefined);
        return [policy, { validCases: choices.filter(Boolean).length, unknown: choices.length - observed.length,
            laterReportRegretLowerBoundCents: distribution(observed.map(row => row.regretLowerBoundCents)),
            warning: 'Different partially labelled subsets; too few to estimate selection p95 reliably. Zero is not success.' }];
    }));
    return { scope: 'Post-hoc frozen prediction tail audit; future reported prices, not pump truth. No model selection or tuning.',
        percentileDefinition: 'Linear interpolation at (n-1)*.95; worst5Mean averages the largest ceil(n*.05) values. Fixed baseline slices include all cutoff ties.',
        commonCases: commonCases.length, candidateRows: rows.length, uniqueStations: new Set(rows.map(row => row.station)).size,
        uniqueReportPairs: uniqueReports.length,
        allCommonRows: Object.fromEntries(policies.map(policy => [policy, errors(rows, policy)])),
        earliestUniqueReportPairs: Object.fromEntries(policies.map(policy => [policy, errors(uniqueReports, policy)])),
        currentMathWorstSlice: fixedSlice(rows, 'current_math', policies),
        rawWorstSlice: fixedSlice(rows, 'raw', policies), selectionDiagnostics: regrets };
}

if (require.main === module) {
    const result = run(JSON.parse(fs.readFileSync(process.argv[2])), process.argv[3]);
    fs.writeFileSync(path.join(process.argv[3], 'tail-risk-results.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result.allCommonRows, null, 2));
}
module.exports = { distribution, errors, fixedSlice };
