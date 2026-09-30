// Research only. See RANKING_PROTOCOL.md; no application imports this evaluator.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

function predictDelta(model, features) {
    let values = features.map((value, index) =>
        (value - model.scalerMean[index]) / model.scalerScale[index]);
    if (model.coef) return values.reduce((sum, value, index) => sum + value * model.coef[index], model.intercept);
    assert.equal(model.outputActivation, 'identity');
    for (let layer = 0; layer < model.layers.length; layer++) {
        values = model.biases[layer].map((bias, column) => {
            const value = values.reduce((sum, input, row) => sum + input * model.layers[layer][row][column], bias);
            return layer < model.layers.length - 1 ? Math.max(0, value) : value;
        });
    }
    return values[0] * model.targetScale + model.targetMean;
}

function evaluateChoice(candidates, priceFor, maxSourceGapHours = Infinity, chosenStation = null) {
    assert.ok(candidates.length > 0);
    // Selection receives no target fields. Unknown future outcomes cannot remove
    // candidates or influence ties, scores, or the chosen station.
    const scored = candidates.map(candidate => {
        const { id, station, rawPrice, mathPrice, featureValues } = candidate;
        const price = priceFor({ id, station, rawPrice, mathPrice, featureValues });
        assert.ok(Number.isFinite(price));
        return { candidate, price };
    }).sort((a, b) => a.price - b.price ||
        (a.candidate.station < b.candidate.station ? -1 : a.candidate.station > b.candidate.station ? 1 : 0));
    const selected = chosenStation === null ? scored[0] : scored.find(row => row.candidate.station === chosenStation);
    assert.ok(selected, 'chosen station must belong to the original candidate set');
    const { candidate: winner, price: selectionPrice } = selected;
    const result = { station: winner.station, stationName: winner.stationName, selectionPrice,
        rawPrice: winner.rawPrice, sourceAt: winner.sourceAt, targetPrice: winner.targetPrice,
        targetSourceAt: winner.targetSourceAt, status: 'unknown_winner',
        comparatorCount: 0, regretLowerBoundCents: null, falseCheapWinnerProxy: null };
    if (!Number.isFinite(winner.targetPrice)) return result;
    const comparators = candidates.filter(row => row.station !== winner.station && Number.isFinite(row.targetPrice) &&
        Math.abs(Date.parse(row.targetSourceAt) - Date.parse(winner.targetSourceAt)) <= maxSourceGapHours * 3600000);
    if (!comparators.length) return { ...result, status: 'unknown_alternatives' };
    const cheapest = comparators.reduce((best, row) => row.targetPrice < best.targetPrice ? row : best);
    const regret = Math.max(0, winner.targetPrice - cheapest.targetPrice) * 100;
    return { ...result, status: regret > 1e-6 ? 'witnessed_later_report_loss' : 'no_witnessed_loss',
        comparatorCount: comparators.length, alternativeStation: cheapest.station,
        alternativeTargetPrice: cheapest.targetPrice, alternativeTargetSourceAt: cheapest.targetSourceAt,
        regretLowerBoundCents: regret,
        falseCheapWinnerProxy: regret > 1e-6 && winner.targetPrice - selectionPrice >= .10 - 1e-8 };
}

function summarize(choices) {
    const comparable = choices.filter(row => row.regretLowerBoundCents !== null);
    return { batches: choices.length,
        unknownWinner: choices.filter(row => row.status === 'unknown_winner').length,
        unknownAlternatives: choices.filter(row => row.status === 'unknown_alternatives').length,
        comparable: comparable.length,
        witnessedLosses: comparable.filter(row => row.regretLowerBoundCents > 1e-6).length,
        witnessedLossesAtLeast10Cents: comparable.filter(row => row.regretLowerBoundCents >= 10 - 1e-6).length,
        falseCheapWinnerProxies: comparable.filter(row => row.falseCheapWinnerProxy).length,
        meanRegretLowerBoundCentsAmongComparable: comparable.length
            ? comparable.reduce((sum, row) => sum + row.regretLowerBoundCents, 0) / comparable.length : null,
        maxRegretLowerBoundCents: comparable.length ? Math.max(...comparable.map(row => row.regretLowerBoundCents)) : null };
}

function run(dataset, artifactDirectory) {
    const modelNames = ['ridge', 'huber', 'tiny_mlp_price'];
    const models = Object.fromEntries(modelNames.map(name => {
        const model = JSON.parse(fs.readFileSync(path.join(artifactDirectory, `${name}.json`)));
        assert.deepEqual(model.featureNames, dataset.featureNames);
        return [name, model];
    }));
    // Verify this independent inference implementation against every old output.
    const original = JSON.parse(fs.readFileSync(path.join(artifactDirectory, 'dataset.json')));
    const predictions = new Map(JSON.parse(fs.readFileSync(path.join(artifactDirectory, 'predictions.json'))).map(row => [row.id, row]));
    const checks = {};
    for (const name of modelNames) {
        const maxDelta = Math.max(...original.samples.map(row =>
            Math.abs(predictDelta(models[name], row.featureValues) - predictions.get(row.id).deltas[name])));
        assert.ok(maxDelta < 1e-10);
        checks[name] = { samples: original.samples.length, maxAbsoluteDifference: maxDelta };
    }
    const policies = { raw: row => row.rawPrice, current_math: row => row.mathPrice,
        ...Object.fromEntries(modelNames.map(name => [name, row => row.rawPrice + predictDelta(models[name], row.featureValues)])) };
    const batches = new Map();
    for (const sample of dataset.samples) {
        const key = `${sample.snapshotId}|${sample.payment}`;
        if (!batches.has(key)) batches.set(key, []);
        batches.get(key).push(sample);
    }
    const signatures = new Set();
    const details = [...batches].filter(([, rows]) => rows.length > 1).map(([id, rows]) => {
        assert.equal(new Set(rows.map(row => row.station)).size, rows.length);
        const signature = JSON.stringify([id.slice(id.indexOf('|')), rows.map(row =>
            [row.station, row.rawPrice, row.sourceAt]).sort((a, b) => a[0].localeCompare(b[0]))]);
        const firstOccurrence = !signatures.has(signature);
        signatures.add(signature);
        return { id, observedAt: rows[0].observedAt, candidates: rows.length,
            labelledCandidates: rows.filter(row => row.targetPrice !== null).length, firstOccurrence,
            policies: Object.fromEntries(Object.entries(policies).map(([name, score]) => [name, {
                anyTargetTime: evaluateChoice(rows, score), withinTwoHours: evaluateChoice(rows, score, 2) }])) };
    });
    return { version: 2, scope: 'post-hoc partial later-report price-only batch audit; not actual trip accuracy',
        inputSha256: dataset.inputSha256, frozenModelChecks: checks,
        coverage: { candidates: dataset.samples.length, labelledCandidates: dataset.samples.filter(row => row.targetPrice !== null).length,
            paymentBatches: batches.size, singleCandidateBatchesExcluded: [...batches.values()].filter(rows => rows.length < 2).length,
            evaluatedBatches: details.length, fullyLabelledBatches: details.filter(row => row.candidates === row.labelledCandidates).length,
            uniqueQuoteSets: signatures.size },
        summaries: Object.fromEntries(['allBatches', 'firstOccurrence'].map(scope => [scope,
            Object.fromEntries(Object.keys(policies).map(name => [name,
                Object.fromEntries(['anyTargetTime', 'withinTwoHours'].map(timing => [timing,
                    summarize(details.filter(row => scope === 'allBatches' || row.firstOccurrence).map(row => row.policies[name][timing]))]))]))])),
        details };
}

if (require.main === module) {
    const result = run(JSON.parse(fs.readFileSync(process.argv[2])), process.argv[3]);
    fs.writeFileSync(process.argv[4], JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ coverage: result.coverage, summaries: result.summaries }, null, 2));
}
module.exports = { predictDelta, evaluateChoice, summarize, run };
