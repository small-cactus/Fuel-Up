// Post-run scoring only: labels never enter openaiBenchmark.py requests.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { predictDelta, evaluateChoice, summarize } = require('./scoreRanking.cjs');

function priceMetrics(pairs) {
    return { labelledCandidates: pairs.length,
        maeCents: pairs.length ? pairs.reduce((s, [p, t]) => s + Math.abs(p - t), 0) / pairs.length * 100 : null,
        underByMoreThan10Cents: pairs.filter(([p, t]) => p < t - .10 - 1e-8).length,
        overByMoreThan10Cents: pairs.filter(([p, t]) => p > t + .10 + 1e-8).length };
}

function pairedChoices(candidate, baseline, maxHours = Infinity) {
    const pairs = candidate.flatMap((choice, index) => {
        const other = baseline[index];
        if (!choice || !other || !Number.isFinite(choice.targetPrice) || !Number.isFinite(other.targetPrice)) return [];
        if (Math.abs(Date.parse(choice.targetSourceAt) - Date.parse(other.targetSourceAt)) > maxHours * 3600000) return [];
        return [(choice.targetPrice - other.targetPrice) * 100];
    });
    return { pairs: pairs.length, cheaper: pairs.filter(d => d < -1e-6).length,
        tied: pairs.filter(d => Math.abs(d) <= 1e-6).length, moreExpensive: pairs.filter(d => d > 1e-6).length,
        meanExtraCentsPerGallon: pairs.length ? pairs.reduce((s, d) => s + d, 0) / pairs.length : null };
}

function run(dataset, root) {
    const read = name => JSON.parse(fs.readFileSync(path.join(root, name)));
    const inputs = read('openai-history-inputs.json');
    const groups = new Map();
    for (const sample of dataset.samples) {
        const key = `${sample.snapshotId}|${sample.payment}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(sample);
    }
    const models = Object.fromEntries(['ridge', 'huber', 'tiny_mlp_price'].map(name => [name, read(`${name}.json`)]));
    const tree = read('ranking-tree-predictions.json');
    assert.ok(tree.maxOriginalDifference < 1e-10);
    const policies = { raw: row => row.rawPrice, current_math: row => row.mathPrice,
        boosted_trees: row => tree.predictions[row.id],
        ...Object.fromEntries(Object.entries(models).map(([name, model]) => [name, row => row.rawPrice + predictDelta(model, row.featureValues)])) };
    const details = inputs.cases.map(testCase => {
        const rows = groups.get(testCase.batchId);
        return { case: testCase.case, batchId: testCase.batchId, policies: Object.fromEntries(Object.entries(policies).map(([name, score]) => [name,
            { anyTargetTime: evaluateChoice(rows, score), withinTwoHours: evaluateChoice(rows, score, 2) }])) };
    });
    const metrics = {}, usage = {}, priceByCase = {};
    for (const [name, score] of Object.entries(policies)) {
        priceByCase[name] = new Map(inputs.cases.map(testCase => [testCase.case,
            groups.get(testCase.batchId).filter(row => row.targetPrice !== null).map(row => [score(row), row.targetPrice])]));
        metrics[name] = priceMetrics(inputs.cases.flatMap(testCase => groups.get(testCase.batchId)
            .filter(row => row.targetPrice !== null).map(row => [score(row), row.targetPrice])));
    }
    for (const [model, effort] of [['gpt-6-luna', 'none'], ['gpt-5.6-terra', 'none'], ['gpt-6.1-sol', 'low']]) {
        const name = `${model}/${effort}`;
        priceByCase[name] = new Map();
        const outputs = fs.readFileSync(path.join(root, `openai-history-${model}-${effort}.jsonl`), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
        assert.equal(new Set(outputs.map(row => row.case)).size, outputs.length);
        assert.equal(outputs.length, inputs.cases.length, 'every attempted case must be accounted for');
        const valid = outputs.filter(row => row.valid);
        const latencies = outputs.map(row => row.elapsedSeconds).sort((a, b) => a - b);
        const tokenSum = key => outputs.reduce((sum, row) => sum + (row.usage?.[key] || 0), 0);
        usage[name] = { attempted: outputs.length, valid: valid.length,
            returnedModels: [...new Set(outputs.map(row => row.model))],
            inputTokens: tokenSum('input_tokens'), outputTokens: tokenSum('output_tokens'),
            reasoningTokens: outputs.reduce((sum, row) => sum + (row.usage?.output_tokens_details?.reasoning_tokens || 0), 0),
            cachedInputTokens: outputs.reduce((sum, row) => sum + (row.usage?.input_tokens_details?.cached_tokens || 0), 0),
            medianSeconds: latencies[Math.floor(latencies.length / 2)], p95Seconds: latencies[Math.ceil(latencies.length * .95) - 1] };
        const pairs = [], probabilities = [];
        for (const output of valid) {
            const testCase = inputs.cases[output.case];
            assert.equal(testCase.case, output.case);
            const rows = groups.get(testCase.batchId);
            const predictions = new Map(output.prediction.predictions.map(row => [testCase.idMap[row.id], row]));
            assert.equal(predictions.size, rows.length);
            const selected = testCase.idMap[output.prediction.recommended_id];
            const score = row => predictions.get(row.station).price;
            priceByCase[name].set(output.case, rows.filter(row => row.targetPrice !== null).map(row => [score(row), row.targetPrice]));
            details[output.case].policies[name] = {
                anyTargetTime: evaluateChoice(rows, score, Infinity, selected),
                withinTwoHours: evaluateChoice(rows, score, 2, selected) };
            details[output.case].policies[`${name}/lowest_prediction`] = {
                anyTargetTime: evaluateChoice(rows, score), withinTwoHours: evaluateChoice(rows, score, 2) };
            for (const row of rows.filter(row => row.targetPrice !== null)) {
                pairs.push([score(row), row.targetPrice]);
                probabilities.push([predictions.get(row.station).underpriced_probability, Number(row.underpriced)]);
            }
        }
        metrics[name] = { ...priceMetrics(pairs), upwardCorrectionBrier: probabilities.length
            ? probabilities.reduce((sum, [p, t]) => sum + (p - t) ** 2, 0) / probabilities.length : null };
    }
    const names = [...new Set(details.flatMap(row => Object.keys(row.policies)))];
    const commonCases = inputs.cases.filter(testCase => Object.values(priceByCase).every(values => values.has(testCase.case)));
    const commonCandidateMetrics = Object.fromEntries(Object.entries(priceByCase).map(([name, values]) => [name,
        priceMetrics(commonCases.flatMap(testCase => values.get(testCase.case)))]));
    const summaries = Object.fromEntries(names.map(name => [name,
        Object.fromEntries(['anyTargetTime', 'withinTwoHours'].map(timing => [timing,
            summarize(details.map(row => row.policies[name]?.[timing]).filter(Boolean))]))]));
    const paired = Object.fromEntries(names.filter(name => name.startsWith('gpt')).map(name => [name,
        Object.fromEntries(Object.keys(policies).map(baseline => [baseline,
            Object.fromEntries([['anyTargetTime', Infinity], ['withinTwoHours', 2]].map(([timing, hours]) => [timing,
                pairedChoices(details.map(row => row.policies[name]?.anyTargetTime), details.map(row => row.policies[baseline].anyTargetTime), hours)]))]))]));
    const coverage = {};
    for (const candidate of inputs.cases.flatMap(testCase => testCase.input.candidates)) {
        const n = candidate.history.reports.length;
        coverage[n] = (coverage[n] || 0) + 1;
    }
    return { scope: '100 distinct price-only stored candidate sets; partial later-report outcomes, not pump truth',
        historyReportCounts: coverage, usage, metrics, commonValidCases: commonCases.length,
        commonCandidateMetrics, summaries, paired, details };
}

if (require.main === module) {
    const result = run(JSON.parse(fs.readFileSync(process.argv[2])), process.argv[3]);
    fs.writeFileSync(path.join(process.argv[3], 'openai-results.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ usage: result.usage, metrics: result.metrics, summaries: result.summaries, paired: result.paired }, null, 2));
}
module.exports = { pairedChoices, priceMetrics };
