#!/usr/bin/env node
// Opt-in simulator workload: measures real native overlay CPU, not GPU/phone FPS.
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const device = process.env.FUELUP_SIMULATOR_UDID;
if (!device) throw new Error('Set FUELUP_SIMULATOR_UDID explicitly');
const token = `performance-${Date.now()}`;
const run = (args, options = {}) => execFileSync('xcrun', ['simctl', ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options,
}).trim();
const container = run(['get_app_container', device, 'com.anthonyh.fuelup', 'data']);
try {
  run(['terminate', device, 'com.anthonyh.fuelup']);
} catch (error) {
  if (!String(error.stderr).includes('found nothing to terminate')) throw error;
}
run(['launch', device, 'com.anthonyh.fuelup'], {
  env: { ...process.env, SIMCTL_CHILD_FUELUP_MAP_PERFORMANCE_PROBE: token },
});

const quantile = (values, p) => values.slice().sort((a, b) => a - b)[Math.floor((values.length - 1) * p)] ?? 0;
function summarize(report) {
  if (report.baseline !== true && (report.reuseChecksPassed !== true || report.liveCacheValid !== true)) {
    throw new Error('Native effect reuse invariants failed');
  }
  if (report.stages.length !== 13 || !report.frames.length) throw new Error('Incomplete performance workload');
  return [0, 1, 2].map(cycle => {
    const frames = report.frames.filter(frame => Math.floor(frame.phase / 4) === cycle);
    if ([0, 1, 2, 3].some(step => !frames.some(frame => frame.phase === cycle * 4 + step))) {
      throw new Error('Missing camera phase samples');
    }
    const cpu = frames.map(frame => frame.reconcileMs + frame.renderMs);
    if (cpu.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid native duration');
    const intervals = frames.map(frame => frame.intervalMs).filter(value => value > 0);
    const start = report.stages[cycle * 4], end = report.stages[(cycle + 1) * 4];
    return {
      cycle, frames: frames.length,
      cpuMedianMs: quantile(cpu, 0.5), cpuP95Ms: quantile(cpu, 0.95), cpuMaxMs: Math.max(...cpu),
      intervalP95Ms: quantile(intervals, 0.95), intervalsOver33ms: intervals.filter(value => value > 33.4).length,
      newContainers: end.containers - start.containers, newPills: end.pills - start.pills,
    };
  });
}

(async () => {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const report = JSON.parse(readFileSync(path.join(container, 'Documents/map-performance-probe.json'), 'utf8'));
      if (report.token === token) {
        report.summary = summarize(report);
        if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify({
          stationCount: report.stationCount, reuseChecksPassed: report.reuseChecksPassed,
          liveCacheValid: report.liveCacheValid, summary: report.summary,
        }, null, 2));
        return;
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Map performance probe did not complete');
})().catch(error => { console.error(error); process.exitCode = 1; });
